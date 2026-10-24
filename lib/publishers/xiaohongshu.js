'use strict';

/**
 * 小红书发布适配器。
 *
 * 投稿页：https://creator.xiaohongshu.com/publish/publish（视频）
 *        ?from=menu_left&target=image（图文）
 * 标题 ≤20 字；正文是 tiptap 富文本，话题以 #tag 形式随正文写入。
 * 发布按钮封装在 closed shadow DOM（<xhs-publish-btn>）里，内核通过宿主元素的
 * shadowRoot/_sr 取到按钮，因此这里需要声明 shadowHosts。
 */

const { runWithConfig, evalJs, clickMatch, sleep } = require('./browser-publish');

const TITLE_MAX = 20;
const DESC_MAX = 1000;
const TAGS_MAX = 10;
const NOTE_MANAGER_URL = 'https://creator.xiaohongshu.com/new/note-manager';
const VERIFY_MS = 90 * 1000;
const VERIFY_INTERVAL_MS = 4000;
const NOTE_MATCH_MS = 30 * 60 * 1000;

function normalizeTag(tag) {
  return String(tag || '').trim().replace(/^#+/, '');
}

function compose(task, tags, kind) {
  const title = String(task.title || '').trim().slice(0, kind === 'image' ? TITLE_MAX : 80);
  const body = String(task.description || '').trim();
  // 正文里已经写过的话题不再重复追加
  const seen = new Set();
  (body.match(/#[^\s#]+/g) || []).forEach((t) => seen.add(normalizeTag(t).toLowerCase()));
  const missing = [];
  (tags || []).forEach((t) => {
    const tag = normalizeTag(t);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return;
    seen.add(key);
    missing.push(tag);
  });
  const line = missing.slice(0, TAGS_MAX).map((t) => '#' + t).join(' ');
  const desc = [body, line].filter(Boolean).join('\n');
  return { title, description: desc.slice(0, DESC_MAX) };
}

function normalizeTitle(title) {
  return String(title || '').replace(/\s+/g, '').toLowerCase();
}

function parseNoteTime(text) {
  const m = String(text || '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

async function readNotes(call) {
  return evalJs(call, `(() => {
    return Array.from(document.querySelectorAll('.note-card')).slice(0, 12).map((card) => {
      let raw = card.getAttribute('data-impression') || '';
      if (raw.indexOf('noteId') < 0) {
        const holder = card.querySelector('[data-impression*="noteId"]');
        raw = holder ? holder.getAttribute('data-impression') || '' : '';
      }
      const m = raw.match(/"noteId":"([^"]+)"/);
      return {
        noteId: m ? m[1] : '',
        title: String((card.querySelector('.note-card__title') || {}).innerText || '').trim(),
        time: String((card.querySelector('.note-card__time') || {}).innerText || '').trim(),
        status: String((card.querySelector('.note-card__tag') || {}).innerText || '').trim()
      };
    }).filter((n) => n.noteId);
  })()`);
}

/** 发布后到「笔记管理」核验新笔记，拿到 noteId 与链接。 */
async function verifyNewNote(call, ctx, title) {
  const wanted = normalizeTitle(title);
  if (!wanted) {
    ctx.log('任务没有标题，跳过小红书笔记列表核验', 'warn');
    return null;
  }

  ctx.log('正在核验小红书笔记列表…');
  try {
    await call('Page.navigate', { url: NOTE_MANAGER_URL });
  } catch (err) {
    ctx.log('打开发布列表失败：' + err.message, 'warn');
    return null;
  }
  await sleep(3000);

  const started = Date.now();
  while (Date.now() - started < VERIFY_MS) {
    let notes = [];
    try {
      notes = (await readNotes(call)) || [];
    } catch (err) {
      notes = [];
    }
    const now = Date.now();
    for (const note of notes) {
      const got = normalizeTitle(note.title);
      if (!got) continue;
      const sameTitle =
        got === wanted || (wanted.length >= 6 && (got.indexOf(wanted) >= 0 || wanted.indexOf(got) >= 0));
      if (!sameTitle) continue;
      const at = parseNoteTime(note.time);
      if (at && Math.abs(now - at) > NOTE_MATCH_MS) continue;
      ctx.log('笔记列表已匹配到新笔记：' + note.noteId + (note.status ? '（' + note.status + '）' : ''));
      return note;
    }
    await sleep(VERIFY_INTERVAL_MS);
  }
  return null;
}

async function afterPublish(call, ctx) {
  const verified = await verifyNewNote(call, ctx, ctx.task && ctx.task.title);
  if (!verified) {
    ctx.log('未在笔记列表核验到新笔记，保留「待核验」状态，请人工确认', 'warn');
    return null;
  }
  return {
    status: 'published',
    workId: verified.noteId,
    publishUrl: 'https://www.xiaohongshu.com/explore/' + verified.noteId,
    message: '已发布并核验笔记链接' + (verified.status ? '（' + verified.status + '）' : '')
  };
}

async function chooseTab(call, ctx, kind) {
  // 视频投稿页默认就是「上传视频」，不再点击，避免误触导航；
  // 图文必须确认切到「上传图文」页签，否则图片会被交给视频控件。
  if (kind !== 'image') return;
  const hit = await clickMatch(call, '上传图文|图文', false);
  if (hit) {
    ctx.log('已切换到「' + hit + '」发布页签');
    await sleep(900);
  }
}

const cfg = {
  platform: '小红书',
  uploadUrls: {
    video: 'https://creator.xiaohongshu.com/publish/publish',
    image: 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image'
  },
  cookieDomain: '.xiaohongshu.com',
  cookieMode: 'header',
  loginUrlRe: /\/login/i,
  loginTextRe: /扫码登录|登录小红书|手机号登录|密码登录/,
  kinds: ['video', 'image'],
  maxImages: 18,
  titleHintRe: '标题',
  descHintRe: '正文|描述|输入正文|添加正文',
  useTagInput: false,
  titleMax: TITLE_MAX,
  descFirst: true,
  shadowHosts: ['xhs-publish-btn'],
  publishButtons: ['发布', '发布笔记'],
  uploadRouteRe: /publish\/publish/,
  successRe: /发布成功|已发布|审核中|发布完成/,
  preparePage: chooseTab,
  compose,
  afterPublish
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '小红书', supported: true, kinds: ['video', 'image'], run };
