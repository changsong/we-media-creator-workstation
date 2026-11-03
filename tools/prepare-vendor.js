'use strict';

/**
 * 把 ffmpeg-static 的可执行文件复制到 vendor/ffmpeg，
 * 打包时随 extraResources 一起进入 app-server/vendor。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST_DIR = path.join(ROOT, 'vendor', 'ffmpeg');

function main() {
  let src = '';
  try {
    src = require('ffmpeg-static');
  } catch (err) {
    console.error('[vendor] 未安装 ffmpeg-static，请先运行 npm install');
    process.exit(1);
  }
  src = String(src || '').replace('app.asar', 'app.asar.unpacked');
  if (!src || !fs.existsSync(src)) {
    console.error('[vendor] 找不到 ffmpeg-static 可执行文件：' + (src || '(空)'));
    process.exit(1);
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });
  // mac 暂无预编译 whisper，保留空目录以便打包配置引用
  fs.mkdirSync(path.join(ROOT, 'vendor', 'whisper'), { recursive: true });
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dest = path.join(DEST_DIR, name);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  console.log('[vendor] ffmpeg → ' + path.relative(ROOT, dest));
}

main();
