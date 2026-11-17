#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const target = process.env.DEPLOY_TARGET || 'root@121.43.145.14';
const remoteDir = process.env.DEPLOY_DIR || '/opt/we-media-site';
const slug = process.argv[2];

if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('用法：npm run site:jiayouzhan:takedown -- <slug>');
  process.exit(1);
}

const command = [
  `cd ${remoteDir}`,
  `/usr/bin/flock -w 300 /tmp/jiayouzhan.lock /opt/node22/bin/node scripts/jiayouzhan/takedown.mjs ${slug}`,
].join(' && ');

const result = spawnSync('ssh', [target, command], { stdio: 'inherit' });
process.exit(result.status === 0 ? 0 : 1);
