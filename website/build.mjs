import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SITE_URL, SITE_BASE, VERSION } from './src/config.mjs';
import { renderHome } from './src/lib/home.mjs';
import { render404, renderRoutes, renderSitemap, renderRobots, renderLlms } from './src/lib/pages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const shippedSiteDir = path.join(__dirname, 'site');
const siteDir = process.env.SITE_OUT ? path.resolve(process.env.SITE_OUT) : shippedSiteDir;
const assetsDir = path.join(siteDir, 'assets');
const skipTailwind = process.env.SKIP_TAILWIND === '1';
const checkout = process.env.CHECKOUT_URL || '';

const ASSET_FILES = [
  'fonts-text.css',
  'fonts-icons2.css',
  'img-1.png',
  'img-2.jpg',
  'img-3.jpg',
  'img-4.png',
];
const ASSET_GLOBS = [/\.woff2$/];

function copyAssets() {
  const src = path.join(repoRoot, 'public', 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const keep = (name) => ASSET_FILES.includes(name) || ASSET_GLOBS.some((re) => re.test(name));
  if (fs.existsSync(src)) {
    for (const name of fs.readdirSync(src)) {
      if (!keep(name)) continue;
      fs.copyFileSync(path.join(src, name), path.join(assetsDir, name));
    }
  } else {
    // 服务器上没有 public/assets，从上一版站点产物兜底复制
    const legacy = path.join(shippedSiteDir, 'assets');
    if (!fs.existsSync(legacy)) throw new Error(`缺少素材目录：${src} 与 ${legacy} 都不存在`);
    for (const name of fs.readdirSync(legacy)) {
      if (!keep(name)) continue;
      fs.copyFileSync(path.join(legacy, name), path.join(assetsDir, name));
    }
  }
  fs.copyFileSync(path.join(__dirname, 'src', 'site.js'), path.join(assetsDir, 'site.js'));
  fs.copyFileSync(path.join(__dirname, 'src', 'checkout.js'), path.join(assetsDir, 'checkout.js'));
  fs.copyFileSync(path.join(__dirname, 'src', 'vendor', 'qrcode.js'), path.join(assetsDir, 'qrcode.js'));
  fs.copyFileSync(path.join(__dirname, 'src', 'assets', 'og.png'), path.join(assetsDir, 'og.png'));
  const videoDir = path.join(__dirname, 'public', 'video');
  if (fs.existsSync(videoDir)) {
    fs.cpSync(videoDir, path.join(siteDir, 'video'), { recursive: true });
  }
}

function writePage(route, html, lang = 'zh') {
  const clean = route.replace(/^\/|\/$/g, '');
  const prefix = lang === 'en' ? 'en/' : '';
  const rel = clean ? `${prefix}${clean}/index.html` : `${prefix}index.html`;
  const file = path.join(siteDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
}

function runTailwind() {
  if (skipTailwind) {
    const previous = path.join(shippedSiteDir, 'assets', 'site.css');
    if (path.resolve(siteDir) === path.resolve(shippedSiteDir) || !fs.existsSync(previous)) {
      throw new Error('SKIP_TAILWIND=1 时需要使用 SITE_OUT 指向新目录，且上一版 site/assets/site.css 必须存在');
    }
    fs.copyFileSync(previous, path.join(assetsDir, 'site.css'));
    return;
  }
  const cli = path.join(repoRoot, 'node_modules', 'tailwindcss', 'lib', 'cli.js');
  const result = spawnSync(
    process.execPath,
    [cli, '-c', 'tailwind.config.js', '-i', 'src/site.css', '-o', 'site/assets/site.css', '--minify'],
    { cwd: __dirname, stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Tailwind build failed');
}

function main() {
  const started = Date.now();
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });
  copyAssets();

  const hasVideo = fs.existsSync(path.join(__dirname, 'public', 'video', 'demo.mp4'));
  const routes = [];

  for (const lang of ['zh', 'en']) {
    writePage('/', renderHome({ lang, checkout, hasVideo }), lang);
    routes.push({ lang, route: '/', priority: 1.0 });
  }

  for (const page of renderRoutes({ checkout })) {
    writePage(page.route, page.html, page.lang);
    routes.push({ lang: page.lang, route: page.route, priority: page.priority || 0.7, lastmod: page.lastmod, noindex: page.noindex });
  }

  fs.writeFileSync(path.join(siteDir, '404.html'), render404(), 'utf8');
  fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), renderSitemap(routes), 'utf8');
  fs.writeFileSync(path.join(siteDir, 'robots.txt'), renderRobots(), 'utf8');
  fs.writeFileSync(path.join(siteDir, 'ads.txt'), '# No authorized digital advertising sellers for this site.\n', 'utf8');
  const llms = renderLlms();
  fs.writeFileSync(path.join(siteDir, 'llms.txt'), llms.short, 'utf8');
  fs.writeFileSync(path.join(siteDir, 'llms-full.txt'), llms.full, 'utf8');

  runTailwind();

  const htmlFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) htmlFiles.push(path.relative(siteDir, full));
    }
  })(siteDir);

  console.log(`site -> ${path.relative(repoRoot, siteDir)} (${htmlFiles.length} pages, ${routes.length} indexed routes, tailwind ${skipTailwind ? 'reused' : 'built'}) in ${Date.now() - started}ms`);
  console.log(`url ${SITE_URL}${SITE_BASE || ''} · version ${VERSION}`);
}

main();
