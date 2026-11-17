import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const TEMPLATES_FILE = path.join(ROOT, 'outreach', 'templates.json');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function loadTemplates() {
  return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
}

export function render(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

// 五个渠道的归一化标识、中文名和主页域名（含常见子域/短链）。
export const PLATFORMS = [
  { key: 'douyin', label: '抖音', hosts: ['douyin.com'] },
  { key: 'kuaishou', label: '快手', hosts: ['kuaishou.com'] },
  { key: 'xiaohongshu', label: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com'] },
  { key: 'channels', label: '视频号', hosts: ['channels.weixin.qq.com', 'weixin.qq.com'] },
  { key: 'bilibili', label: 'B站', hosts: ['bilibili.com', 'b23.tv'] },
];

const PLATFORM_ALIASES = {
  douyin: 'douyin', dy: 'douyin', '抖音': 'douyin',
  kuaishou: 'kuaishou', ks: 'kuaishou', '快手': 'kuaishou',
  xiaohongshu: 'xiaohongshu', xhs: 'xiaohongshu', red: 'xiaohongshu', redbook: 'xiaohongshu', '小红书': 'xiaohongshu',
  channels: 'channels', shipinhao: 'channels', sph: 'channels', weixin: 'channels', '视频号': 'channels',
  bilibili: 'bilibili', bili: 'bilibili', bzhan: 'bilibili', b23: 'bilibili', 'b站': 'bilibili',
};

export function normalizePlatform(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return '';
  return PLATFORM_ALIASES[key] || (PLATFORMS.some((p) => p.key === key) ? key : '');
}

export function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const hit = PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith('.' + h)));
    return hit ? hit.key : '';
  } catch (err) {
    return '';
  }
}

export function platformLabel(key) {
  const hit = PLATFORMS.find((p) => p.key === key);
  return hit ? hit.label : (key || '未知');
}

export function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (question) => rl.question(question),
    close: () => rl.close(),
  };
}

// 单键读取：终端里按一个键立即返回，不用回车；非 TTY 环境回退成按行读取。
export function createKeyReader() {
  const stdin = process.stdin;
  return {
    async key(question = '') {
      if (question) process.stdout.write(question);
      if (!stdin.isTTY) {
        const rl = readline.createInterface({ input: stdin, output: process.stdout });
        try {
          const line = (await rl.question('')).trim().toLowerCase();
          return line ? line[0] : '\r';
        } finally {
          rl.close();
        }
      }
      return new Promise((resolve) => {
        const wasRaw = stdin.isRaw;
        const finish = (value) => {
          stdin.removeListener('data', onData);
          if (!wasRaw) stdin.setRawMode(false);
          stdin.pause();
          resolve(value);
        };
        const onData = (buf) => {
          const raw = buf.toString('utf8');
          if (raw === '\u0003') return finish('\u0003'); // Ctrl+C
          if (raw === '\r' || raw === '\n') return finish('\r');
          if (raw === '\u001b[D') return finish('k'); // ← 上一条
          if (raw === '\u001b[C') return finish('j'); // → 下一条
          if (raw.startsWith('\u001b')) return finish('\u001b'); // 其他方向键，忽略
          finish(raw.toLowerCase()[0]);
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
      });
    },
  };
}

// 剪贴板：Windows 的 clip.exe 会把 UTF-8 按 ANSI 解码导致中文乱码，
// 改用 PowerShell 从 base64 还原，避免控制台代码页影响。
function copyWindows(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const script = [
    "$b=[Convert]::FromBase64String('" + b64 + "')",
    '$t=[Text.Encoding]::UTF8.GetString($b)',
    'Set-Clipboard -Value $t',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

export function copyToClipboard(text) {
  if (process.platform === 'win32') return copyWindows(text);
  const commands = process.platform === 'darwin'
    ? [['pbcopy']]
    : [['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, args] of commands) {
    try {
      const result = spawnSync(cmd, args || [], { input: text, encoding: 'utf8' });
      if (!result.error && result.status === 0) return true;
    } catch (err) {
      /* 尝试下一个命令 */
    }
  }
  return false;
}

// 支持引号、逗号和换行的最小 CSV 解析器。
export function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const text = String(raw).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  return rows.map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] || '').trim();
    });
    return record;
  });
}

export function readCsv(file) {
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}
