import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outFile = path.join(root, 'src', 'data', 'releases.json');

const base = (process.env.PUBLISH_BASE_URL || 'https://we-media-creator.oss-cn-beijing.aliyuncs.com').replace(/\/+$/, '');

function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  const files = [];
  let current = null;
  const meta = {};
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const item = line.match(/^\s*-\s+url:\s*(.+)$/);
    if (item) {
      current = { url: item[1].trim() };
      files.push(current);
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
    if (current && /^\s{4,}/.test(line)) {
      current[key] = /^\d+$/.test(value) ? Number(value) : value;
    } else if (!current || /^\S/.test(line)) {
      meta[key] = /^\d+$/.test(value) ? Number(value) : value;
    } else {
      current[key] = /^\d+$/.test(value) ? Number(value) : value;
    }
  }
  return { meta, files };
}

async function fetchManifest(p) {
  const res = await fetch(`${base}${p}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return parseYaml(await res.text());
}

function pick(files, ext) {
  const f = files.find((x) => x.url.endsWith(ext));
  return f ? { name: f.url, size: f.size, sha512: f.sha512 } : null;
}

function abs(dir, f) {
  if (!f) return null;
  return {
    url: `${base}/${dir}/${f.name}`,
    name: f.name,
    size: f.size,
    sha512: f.sha512,
  };
}

async function main() {
  const [win, linux, macX64, macArm64] = await Promise.all([
    fetchManifest('/we-media/win/x64/latest.yml'),
    fetchManifest('/we-media/linux/x64/latest-linux.yml'),
    fetchManifest('/we-media/mac/x64/latest-mac.yml'),
    fetchManifest('/we-media/mac/arm64/latest-mac.yml'),
  ]);

  const out = {
    base,
    version: win.meta.version,
    releaseDate: win.meta.releaseDate,
    generatedAt: new Date().toISOString(),
    platforms: {
      win: {
        x64: {
          exe: abs('we-media/win/x64', pick(win.files, '.exe')),
        },
      },
      linux: {
        x64: {
          appimage: abs('we-media/linux/x64', pick(linux.files, '.AppImage')),
          deb: abs('we-media/linux/x64', pick(linux.files, '.deb')),
        },
      },
      mac: {
        x64: {
          dmg: abs('we-media/mac/x64', pick(macX64.files, '.dmg')),
          zip: abs('we-media/mac/x64', pick(macX64.files, '.zip')),
        },
        arm64: {
          dmg: abs('we-media/mac/arm64', pick(macArm64.files, '.dmg')),
          zip: abs('we-media/mac/arm64', pick(macArm64.files, '.zip')),
        },
      },
    },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`releases.json -> ${out.version} (${base})`);
}

main().catch((err) => {
  console.error(`sync-releases failed: ${err.message}`);
  if (fs.existsSync(outFile)) {
    console.error('keeping existing releases.json');
    process.exit(0);
  }
  process.exit(1);
});
