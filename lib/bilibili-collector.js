'use strict';

/**
 * B站个人稿件数据采集器。
 *
 * 复用「连接设置 → B站」一键登录保存的 SESSDATA / bili_jct，直接请求
 * 创作中心「稿件管理」页（upload-manager/article）同源的稿件列表接口，
 * 取每条稿件的播放、点赞、评论、收藏、投币、转发、弹幕。
 *
 * 落库方式与其它渠道一致：
 *   - 内容日历：按 BV 号 / 标题匹配，匹配不到则自动建档（阶段=已发布）
 *   - 数据复盘：同一排期每天一条快照，已存在则更新指标
 *
 * 只采集最近 30 天发布的稿件，避免把多年历史全部建成排期；稿件的播放/点赞
 * 是累计值，每次同步只更新当天快照。未发布的草稿 / 审核中稿件没有发布时间
 * （ptime），不计入复盘。不采集账号级涨粉等数据。
 */

const store = require('./store');
const channelConnections = require('./channel-connections');

const PLATFORM = 'B站';
const LIST_URL = 'https://member.bilibili.com/x/web/archives';
const REFERER = 'https://member.bilibili.com/platform/upload-manager/article';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20000;
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const WINDOW_DAYS = 30;

const state = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null
};

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localMinute(ms) {
  const d = new Date(Number(ms) || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanTitle(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function getJson(url, cookie) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        Cookie: cookie,
        'User-Agent': UA,
        Referer: REFERER,
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw httpError(502, '无法连接B站：' + err.message);
  }
  if (!resp.ok) throw httpError(502, `B站接口返回 HTTP ${resp.status}`);
  return resp.json().catch(() => null);
}

/** 稿件列表按发布时间倒序返回，遇到早于窗口的稿件就可以停止翻页 */
async function fetchArchives(cookie, cutoffMs) {
  const items = [];
  const seen = new Set();
  let total = null;
  let pages = 0;
  let scanned = 0;
  let reachedOldest = false;

  while (pages < MAX_PAGES && !reachedOldest) {
    const url =
      `${LIST_URL}?status=is_pubing,pubed,not_pubed` +
      `&pn=${pages + 1}&ps=${PAGE_SIZE}&coop=1&interactive=1&_=${Date.now()}`;
    const json = await getJson(url, cookie);
    if (!json) throw httpError(502, 'B站稿件列表返回的不是合法 JSON');
    if (Number(json.code) !== 0) {
      const msg = String(json.message || '');
      if (Number(json.code) === -101 || /登录|未登录/.test(msg)) {
        throw httpError(401, 'B站登录态已失效，请到「连接设置」重新一键登录');
      }
      throw httpError(502, 'B站稿件列表接口错误：' + (msg || json.code));
    }

    pages++;
    const data = json.data || {};
    if (data.page && data.page.count != null) total = Number(data.page.count) || total;
    const list = data.arc_audits || [];
    if (!list.length) break;
    list.forEach((item) => {
      const archive = item && item.Archive;
      if (!archive || !archive.bvid) return;
      const bvid = String(archive.bvid);
      if (seen.has(bvid)) return;
      seen.add(bvid);
      scanned++;
      const ptime = Number(archive.ptime) * 1000;
      if (ptime && ptime < cutoffMs) {
        reachedOldest = true;
        return;
      }
      items.push(item);
    });
    if (total != null && scanned >= total) break;
  }

  return { items, total: total == null ? scanned : total, pages };
}

const STAT_LABELS = [
  ['reply', '评论'],
  ['favorite', '收藏'],
  ['coin', '投币'],
  ['share', '转发'],
  ['danmaku', '弹幕']
];

function saveWorks(items) {
  const statDate = today();
  let schedulesCreated = 0;
  let schedulesMatched = 0;
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
  let totalReads = 0;
  let totalLikes = 0;

  items.forEach((item) => {
    const archive = (item && item.Archive) || {};
    const stat = (item && item.stat) || {};
    const bvid = String(archive.bvid || '').trim();
    if (!bvid) return;
    // 草稿 / 审核中稿件没有发布时间，还没产生公开数据
    if (!Number(archive.ptime)) return;

    const title = cleanTitle(archive.title) || 'B站作品 ' + bvid;
    let schedule = store.findScheduleByNote(PLATFORM, bvid, title);
    if (schedule) {
      schedulesMatched++;
    } else {
      schedule = store.create('calendar', {
        标题: title,
        平台: PLATFORM,
        计划发布时间: localMinute(Number(archive.ptime) * 1000),
        当前阶段: '已发布',
        内容形式: '短视频',
        发布链接: 'https://www.bilibili.com/video/' + bvid,
        备注: 'B站作品自动同步（ID: ' + bvid + '）'
      });
      schedulesCreated++;
    }

    const reads = Math.max(0, parseInt(stat.view, 10) || 0);
    const likes = Math.max(0, parseInt(stat.like, 10) || 0);
    const parts = ['B站自动同步', '播放 ' + reads, '点赞 ' + likes];
    STAT_LABELS.forEach(([key, label]) => {
      parts.push(label + ' ' + (Math.max(0, parseInt(stat[key], 10) || 0)));
    });
    parts.push('稿件 ID ' + bvid);

    const snap = store.upsertNoteSnapshot(schedule['排期ID'], PLATFORM, statDate, {
      reads,
      likes,
      followers: 0,
      conversions: 0,
      note: parts.join(' · ')
    });
    if (snap.updated) snapshotsUpdated++;
    else snapshotsCreated++;
    totalReads += reads;
    totalLikes += likes;
  });

  return { schedulesCreated, schedulesMatched, snapshotsCreated, snapshotsUpdated, totalReads, totalLikes };
}

async function run() {
  if (state.running) throw httpError(409, 'B站数据同步正在进行，请稍候');
  const connection = channelConnections.getRaw(PLATFORM);
  const fields = (connection && connection.fields) || {};
  const cookieParts = [];
  if (connection && connection.enabled && fields.SESSDATA) {
    cookieParts.push('SESSDATA=' + fields.SESSDATA);
  }
  if (connection && connection.enabled && fields.bili_jct) {
    cookieParts.push('bili_jct=' + fields.bili_jct);
  }
  const cookie = cookieParts.join('; ');
  if (!cookie) throw httpError(400, '请先在「连接设置」完成B站一键登录');

  state.running = true;
  state.lastRunAt = new Date().toISOString();
  state.lastError = null;

  try {
    const warnings = [];
    const cutoffMs = Date.now() - WINDOW_DAYS * 86400000;
    const { items, total, pages } = await fetchArchives(cookie, cutoffMs);
    const published = items.filter((item) => item && item.Archive && Number(item.Archive.ptime));
    if (!published.length) {
      warnings.push('最近 ' + WINDOW_DAYS + ' 天没有已发布的稿件，暂未写入复盘快照');
    }

    const summary = saveWorks(published);
    const result = {
      ok: true,
      platform: PLATFORM,
      total,
      fetched: published.length,
      pages,
      windowDays: WINDOW_DAYS,
      statDate: today(),
      ...summary,
      warnings
    };
    state.lastSuccessAt = new Date().toISOString();
    state.lastResult = result;
    return result;
  } catch (err) {
    state.lastError = err && err.message ? err.message : '采集失败';
    if (err && !err.status) err.status = 502;
    throw err;
  } finally {
    state.running = false;
  }
}

function getStatus() {
  return {
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    lastResult: state.lastResult
  };
}

module.exports = { run, getStatus };
