// 从 ipdeny 拉取中国大陆/台湾/香港/澳门 IPv4 段，合并成 server.mjs 可直接加载的区间表。
// 用法：node website/scripts/update-geo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(__dirname, '..', 'geo', 'zh-regions.txt');
const ZONES = ['cn', 'tw', 'hk', 'mo'];

function ipToInt(ip) {
  const [a, b, c, d] = ip.split('.').map(Number);
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

function parseCidr(cidr) {
  const [ip, bitsRaw] = cidr.trim().split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const base = ipToInt(ip);
  const size = 2 ** (32 - bits);
  return [base, base + size - 1];
}

function merge(ranges) {
  ranges.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [start, end] of ranges) {
    const last = out[out.length - 1];
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

const ranges = [];
for (const zone of ZONES) {
  const url = `https://www.ipdeny.com/ipblocks/data/aggregated/${zone}-aggregated.zone`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${zone}: HTTP ${res.status}`);
  const text = await res.text();
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const range = parseCidr(line);
    if (range) {
      ranges.push(range);
      count += 1;
    }
  }
  console.log(`${zone}: ${count} blocks`);
}

const merged = merge(ranges);
const body = merged.map(([start, end]) => `${start}-${end}`).join('\n');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${body}\n`, 'utf8');
console.log(`merged ${ranges.length} -> ${merged.length} ranges -> ${path.relative(process.cwd(), outFile)}`);
