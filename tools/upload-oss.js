'use strict';

/**
 * CI 专用：把各平台构建产物同步到阿里云 OSS 的自动更新目录。
 * 目录约定（与 electron-builder.yml 的 generic publish url 对齐）：
 *   artifacts/win-x64        -> we-media/win/x64
 *   artifacts/linux-x64      -> we-media/linux/x64
 *   artifacts/mac-x64        -> we-media/mac/x64
 *   artifacts/mac-arm64      -> we-media/mac/arm64
 */

const fs = require('fs');
const path = require('path');
const OSS = require('ali-oss');

const ROOT = process.env.ARTIFACT_ROOT || path.join(process.cwd(), 'artifacts');
const TARGETS = [
  { dir: 'win-x64', prefix: 'we-media/win/x64' },
  { dir: 'linux-x64', prefix: 'we-media/linux/x64' },
  { dir: 'mac-x64', prefix: 'we-media/mac/x64' },
  { dir: 'mac-arm64', prefix: 'we-media/mac/arm64' }
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error('缺少环境变量 ' + name);
  return value;
}

function listFiles(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === '.DS_Store') return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  });
  return out;
}

function cacheControl(file) {
  return /\.ya?ml$/i.test(file)
    ? 'no-cache, max-age=0'
    : 'public, max-age=31536000, immutable';
}

async function main() {
  const client = new OSS({
    region: required('OSS_REGION'),
    endpoint: required('OSS_ENDPOINT'),
    bucket: required('OSS_BUCKET'),
    accessKeyId: required('OSS_ACCESS_KEY_ID'),
    accessKeySecret: required('OSS_ACCESS_KEY_SECRET'),
    secure: true
  });

  let uploaded = 0;
  for (const target of TARGETS) {
    const dir = path.join(ROOT, target.dir);
    if (!fs.existsSync(dir)) throw new Error('缺少构建产物目录：' + dir);
    const files = listFiles(dir, []);
    if (!files.length) throw new Error('构建产物目录为空：' + dir);
    for (const file of files) {
      const key = target.prefix + '/' + path.basename(file);
      await client.put(key, file, {
        headers: { 'Cache-Control': cacheControl(file) }
      });
      uploaded++;
      console.log('uploaded', key);
    }
  }
  console.log('完成，共上传 ' + uploaded + ' 个文件');
}

main().catch((err) => {
  console.error('[upload-oss] ' + (err && err.message ? err.message : err));
  process.exit(1);
});
