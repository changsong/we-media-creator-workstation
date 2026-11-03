'use strict';

/**
 * macOS 打包专用：从源码编译 universal whisper-cli，写入
 * vendor/whisper/darwin-{arm64,x64}，让终端用户装完即可用。
 *
 * 依赖：macOS + Xcode Command Line Tools + cmake。
 * 可用 WB_WHISPER_BUILD 指定 whisper.cpp 版本，WB_WHISPER_SRC 指向本地源码目录。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = process.env.WB_WHISPER_BUILD || 'b5454';
const ARCHIVE_URL = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${BUILD}.tar.gz`;
const DEPLOYMENT_TARGET = process.env.WB_MACOS_DEPLOYMENT_TARGET || '11.0';
const OUT_DIRS = ['darwin-arm64', 'darwin-x64'];

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
  if (res.error) throw new Error(`无法执行 ${cmd}：${res.error.message}`);
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失败（退出码 ${res.status}）`);
}

function capture(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.error || res.status !== 0) return '';
  return res.stdout || '';
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
  if (!res.ok || !res.body) throw new Error('下载源码失败（HTTP ' + res.status + '）：' + url);
  const handle = await fs.promises.open(target, 'w');
  try {
    for await (const chunk of res.body) await handle.write(chunk);
  } finally {
    await handle.close();
  }
}

function ensureStaticBinary(bin) {
  const out = capture('otool', ['-L', bin]);
  if (!out) return;
  const deps = out
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' (')[0])
    .filter(Boolean)
    .filter((p) => !p.startsWith('/usr/lib/') && !p.startsWith('/System/Library/'));
  if (deps.length) {
    throw new Error('whisper-cli 仍依赖非系统动态库：' + deps.join(', ') + '（请确认 BUILD_SHARED_LIBS=OFF）');
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('macOS 版 whisper 只能在 macOS 上编译，请在 Mac 构建机运行。');
  }
  if (!capture('cmake', ['--version'])) {
    throw new Error('未找到 cmake。请先安装 Xcode Command Line Tools（xcode-select --install）和 cmake（brew install cmake）。');
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wb-whisper-mac-'));
  const buildDir = path.join(tempDir, 'build');
  try {
    let srcDir = process.env.WB_WHISPER_SRC ? path.resolve(process.env.WB_WHISPER_SRC) : '';
    if (!srcDir) {
      const archive = path.join(tempDir, `whisper-${BUILD}.tar.gz`);
      console.log('[whisper] 下载源码 ' + ARCHIVE_URL);
      await download(ARCHIVE_URL, archive);
      run('tar', ['-xzf', path.basename(archive)], { cwd: tempDir });
      srcDir = path.join(tempDir, `whisper.cpp-${BUILD}`);
    }
    if (!fs.existsSync(path.join(srcDir, 'CMakeLists.txt'))) {
      throw new Error('源码目录无效（缺少 CMakeLists.txt）：' + srcDir);
    }

    const threads = String(Math.max(2, Math.min(16, (os.cpus().length || 4) - 1)));
    const buildWith = (metal) => {
      fs.rmSync(buildDir, { recursive: true, force: true });
      console.log('[whisper] 配置 universal 构建（arm64 + x86_64，' + (metal ? 'Metal' : 'CPU') + '）');
      run('cmake', [
        '-S', srcDir,
        '-B', buildDir,
        '-DCMAKE_BUILD_TYPE=Release',
        '-DBUILD_SHARED_LIBS=OFF',
        '-DWHISPER_BUILD_EXAMPLES=ON',
        '-DWHISPER_BUILD_TESTS=OFF',
        '-DWHISPER_BUILD_SERVER=OFF',
        '-DGGML_NATIVE=OFF',
        metal ? '-DGGML_METAL=ON' : '-DGGML_METAL=OFF',
        metal ? '-DGGML_METAL_EMBED_LIBRARY=ON' : '-DGGML_METAL_EMBED_LIBRARY=OFF',
        '-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64',
        '-DCMAKE_OSX_DEPLOYMENT_TARGET=' + DEPLOYMENT_TARGET
      ]);
      console.log('[whisper] 编译 whisper-cli');
      run('cmake', ['--build', buildDir, '--config', 'Release', '--target', 'whisper-cli', '-j', threads]);
    };

    const useMetal = process.env.WB_WHISPER_MAC_METAL !== '0';
    try {
      buildWith(useMetal);
    } catch (err) {
      if (!useMetal) throw err;
      console.warn('[whisper] Metal 构建失败，改用纯 CPU 构建：' + err.message);
      buildWith(false);
    }

    const bin = findFile(buildDir, ['whisper-cli', 'main']);
    if (!bin) throw new Error('编译完成但未找到 whisper-cli 可执行文件');
    ensureStaticBinary(bin);

    for (const dir of OUT_DIRS) {
      const destDir = path.join(ROOT, 'vendor', 'whisper', dir);
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, 'whisper-cli');
      fs.copyFileSync(bin, dest);
      fs.chmodSync(dest, 0o755);
      console.log('[whisper] → ' + path.relative(ROOT, dest));
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[whisper] ' + err.message);
  process.exit(1);
});
