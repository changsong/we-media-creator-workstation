'use strict';

/**
 * CI 打包前准备 ffmpeg 与 whisper 二进制，并把失败输出写成
 * GitHub Actions 注解，方便在公开日志受限时定位问题。
 *
 * 用法：node tools/ci-vendor.js <platform> <arch>
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const [platform, arch] = process.argv.slice(2);

if (!platform || !arch) {
  console.error('用法：node tools/ci-vendor.js <platform> <arch>');
  process.exit(2);
}

function annotate(label, code, output) {
  console.log(`::error::${label} 失败（退出码 ${code}）`);
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-15);
  for (const line of lines) {
    const escaped = line
      .replace(/%/g, '%25')
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A')
      .slice(0, 1200);
    console.log(`::error::${escaped}`);
  }
}

function run(label, args, env) {
  console.log(`\n==> ${label}: node ${args.map((a) => path.basename(a)).join(' ')}`);
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${res.stdout || ''}${res.stderr || ''}`;
  if (output) process.stdout.write(output);
  if (res.error) {
    annotate(label, res.error.message, output);
    process.exit(1);
  }
  if (res.status !== 0) {
    annotate(label, res.status, output);
    process.exit(res.status || 1);
  }
}

run('ffmpeg 依赖准备', [path.join(ROOT, 'tools', 'prepare-vendor.js')]);
run(
  'whisper 依赖准备',
  [path.join(ROOT, 'tools', 'fetch-whisper.js'), '--platform', platform, '--arch', arch],
  platform === 'darwin' ? { WB_WHISPER_ARCH: arch } : {}
);
console.log('\nvendor 依赖准备完成');
