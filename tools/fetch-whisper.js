'use strict';

/**
 * 下载 whisper.cpp 预编译 CLI 到 vendor/whisper/<platform>-<arch>。
 *
 * 模型不在这里下载，首次转写时由 lib/asr.js 按需下载到 DATA_DIR/models。
 * 默认使用 b5454 构建；可用 WB_WHISPER_BUILD 覆盖。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = process.env.WB_WHISPER_BUILD || 'b5454';
const BASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/' + BUILD;

const TARGETS = {
  'win32-x64': { asset: 'whisper-bin-x64.zip', kind: 'zip' },
  'win32-arm64': { asset: 'whisper-bin-win-cpu-arm64.zip', kind: 'zip' },
  'linux-x64': { asset: 'whisper-bin-ubuntu-x64.tar.gz', kind: 'tar' },
  'linux-arm64': { asset: 'whisper-bin-ubuntu-arm64.tar.gz', kind: 'tar' }
};

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx > 0 ? process.argv[idx + 1] : '';
}

function findFile(dir, names) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, names);
      if (hit) return hit;
    } else if (names.includes(entry.name)) {
      return full;
    }
  }
  return '';
}

async function download(url, target) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10 * 60 * 1000),
    headers: { 'User-Agent': 'we-media-creator-workstation-vendor' }
  });
  if (!res.ok || !res.body) throw new Error('下载失败（HTTP ' + res.status + '）：' + url);
  const handle = await fs.promises.open(target, 'w');
  try {
    for await (const chunk of res.body) await handle.write(chunk);
  } finally {
    await handle.close();
  }
}

function extract(archive, kind, destDir) {
  // Windows 自带 bsdtar 支持 zip；Git Bash 里的 GNU tar 不支持，
  // 且会把盘符当远程主机，所以这里固定用 System32 的 tar。
  const isWin = process.platform === 'win32';
  const bin = isWin ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const cwd = path.dirname(archive);
  const args = kind === 'zip' ? ['-xf', path.basename(archive)] : ['-xzf', path.basename(archive)];
  const result = spawnSync(bin, args, { cwd, windowsHide: true, encoding: 'utf8' });
  if (result.error) throw new Error('解压失败，需要系统自带 tar：' + result.error.message);
  if (result.status !== 0) throw new Error('解压失败：' + String(result.stderr || '').trim());
}

async function main() {
  const platform = argValue('--platform') || process.platform;
  const arch = argValue('--arch') || process.arch;
  const key = platform + '-' + arch;
  const target = TARGETS[key];
  if (!target) {
    if (platform === 'darwin') {
      // macOS 没有官方 CLI 预编译包，改为在 Mac 构建机上从源码编译
      const res = spawnSync(process.execPath, [path.join(__dirname, 'build-whisper-mac.js')], {
        stdio: 'inherit'
      });
      process.exit(res.status == null ? 1 : res.status);
    }
    console.error('[whisper] 暂不提供 ' + key + ' 的预编译包。可安装 whisper-cli 后设置 WB_WHISPER_PATH。');
    process.exit(1);
  }

  const destDir = path.join(ROOT, 'vendor', 'whisper', key);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-whisper-'));
  const archive = path.join(tempDir, target.asset);
  const url = BASE + '/' + target.asset;
  try {
    console.log('[whisper] 下载 ' + url);
    await download(url, archive);
    extract(archive, target.kind, tempDir);

    const cli = findFile(tempDir, ['whisper-cli.exe', 'whisper-cli']);
    if (!cli) throw new Error('压缩包内没有 whisper-cli');
    const binDir = path.dirname(cli);

    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(binDir, destDir, { recursive: true });

    for (const name of fs.readdirSync(destDir)) {
      const full = path.join(destDir, name);
      if (fs.statSync(full).isFile() && !name.endsWith('.exe')) fs.chmodSync(full, 0o755);
    }
    console.log('[whisper] → ' + path.relative(ROOT, destDir));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[whisper] ' + err.message);
  process.exit(1);
});
