import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const websiteDir = path.join(repoRoot, 'website');

const target = process.env.DEPLOY_TARGET || 'root@121.43.145.14';
const remoteDir = process.env.DEPLOY_DIR || '/opt/we-media-site';
const service = process.env.DEPLOY_SERVICE || 'we-media-site';
const siteUrl = (process.env.SITE_URL || 'https://www.wemediacreator.com').replace(/\/+$/, '');
const healthHost = new URL(siteUrl).hostname;
const stamp = Date.now();
const remoteTarball = `/tmp/wm-deploy-${stamp}.tgz`;
const localTarball = path.join(os.tmpdir(), `wm-site-${stamp}.tgz`);
const localTarballName = path.basename(localTarball);

function step(message) {
  console.log(`\n==> ${message}`);
}

function runBuild() {
  step(`构建站点（SITE_URL=${siteUrl}）`);
  const result = spawnSync('npm run site:build', {
    cwd: repoRoot,
    env: { ...process.env, SITE_URL: siteUrl },
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) throw new Error('构建失败');
}

function pack() {
  step('打包 site/ 与 server.mjs');
  const result = spawnSync('tar', ['-czf', localTarballName, '-C', websiteDir, 'site', 'server.mjs'], {
    cwd: os.tmpdir(),
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('打包失败');
  const size = (fs.statSync(localTarball).size / 1024 / 1024).toFixed(1);
  console.log(`包大小 ${size} MB`);
}

function deploy() {
  step(`上传并部署到 ${target}:${remoteDir}`);
  const remote = [
    'set -e',
    `cat > ${remoteTarball}`,
    `mkdir -p ${remoteDir}`,
    `tar -xzf ${remoteTarball} -C ${remoteDir}`,
    `rm -f ${remoteTarball}`,
    `systemctl restart ${service}`,
    'sleep 1',
    `systemctl is-active ${service}`,
    `curl -s -o /dev/null -w 'health_http=%{http_code}\\n' -H 'Host: ${healthHost}' http://127.0.0.1:4321/`,
  ].join('; ');

  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [target, remote], { stdio: ['pipe', 'inherit', 'inherit'] });
    fs.createReadStream(localTarball).pipe(child.stdin);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`远程部署失败（ssh 退出码 ${code}）`));
      else resolve();
    });
  });
}

async function main() {
  const started = Date.now();
  try {
    runBuild();
    pack();
    await deploy();
    console.log(`\n部署完成：${siteUrl}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`);
  } finally {
    fs.rmSync(localTarball, { force: true });
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
