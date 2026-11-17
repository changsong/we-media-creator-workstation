import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function syncContentFromServer({
  target = process.env.DEPLOY_TARGET || 'root@121.43.145.14',
  remoteDir = process.env.DEPLOY_DIR || '/opt/we-media-site',
  localDir = path.resolve(__dirname, '../../content'),
} = {}) {
  const remoteFile = `${remoteDir}/content/jiayouzhan.json`;
  const result = spawnSync(
    'ssh',
    [target, `if [ -f ${remoteFile} ]; then printf '__PRESENT__\\n'; cat ${remoteFile}; else printf '__MISSING__\\n'; fi`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`无法从服务器拉取加油站内容（ssh 退出码 ${result.status}）：${(result.stderr || '').trim()}`);
  }
  const output = result.stdout || '';
  const firstLine = output.split(/\r?\n/, 1)[0];
  if (firstLine === '__MISSING__') return { pulled: false };
  if (firstLine !== '__PRESENT__') throw new Error('拉取加油站内容失败：服务器返回格式异常');

  const json = output.slice(output.indexOf('\n') + 1);
  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`服务器上的 jiayouzhan.json 已损坏，已中止部署：${error.message}`);
  }
  const items = Array.isArray(data) ? data : data?.articles;
  if (!Array.isArray(items)) throw new Error('服务器上的 jiayouzhan.json 结构异常，已中止部署');

  fs.mkdirSync(localDir, { recursive: true });
  const file = path.join(localDir, 'jiayouzhan.json');
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return { pulled: true, file, count: items.length };
}
