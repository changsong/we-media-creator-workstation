'use strict';

/**
 * 知乎个人视频作品数据采集器。
 *
 * 复用「连接设置 → 知乎」保存的 Cookie，请求创作中心「内容管理」页
 * （creator/manage/creation/all）同源的作品列表接口，列表每项自带
 * reaction 统计：播放 / 点赞 / 评论 / 收藏 / 转发。
 *
 * 只采集视频类内容（视频想法 pin、zvideo），回答和文章不计入复盘；
 * 只采集最近 30 天发布的作品，避免把历史内容全部建成排期。
 * 播放量优先取 play_count，为 0 时退回 view_count（视频想法的浏览量）。
 *
 * 落库方式与其它渠道一致：
 *   - 内容日历：按作品 ID / 标题匹配，匹配不到则自动建档（阶段=已发布）
 *   - 数据复盘：同一排期每天一条快照，已存在则更新指标
 * 不采集账号级涨粉等数据。
 */

const store = require('./store');
const channelConnections = require('./channel-connections');

const PLATFORM = '知乎';
const LIST_URL = 'https://www.zhihu.com/api/v4/creators/creations/v2/all';
const REFERER = 'https://www.zhihu.com/creator/manage/creation/all';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20000;
const PAGE_SIZE = 20;
const MAX_PAGES = 10;
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
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function getCookie() {
  const raw = channelConnections.getRaw(PLATFORM);
  if (!raw || !raw.enabled) return '';
  return String((raw.fields && raw.fields.Cookie) || '').trim();
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
    throw httpError(502, '无法连接知乎：' + err.message);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw httpError(401, '知乎登录态已失效，请到「连接设置」重新一键登录');
  }
  if (!resp.ok) throw httpError(502, `知乎接口返回 HTTP ${resp.status}`);
  return resp.json().catch(() => null);
}

/** 列表按发布时间倒序返回，遇到早于窗口的作品就可以停止翻页 */
async function fetchWorks(cookie, cutoffMs) {
  const works = [];
  const seen = new Set();
  let total = null;
  let pages = 0;
  let reachedOldest = false;

  while (pages < MAX_PAGES && !reachedOldest) {
    const url = `${LIST_URL}?limit=${PAGE_SIZE}&offset=${pages * PAGE_SIZE}&sort_type=created`;
    const json = await getJson(url, cookie);
    if (!json) throw httpError(502, '知乎作品列表返回的不是合法 JSON');
    const list = Array.isArray(json.data) ? json.data : [];
    pages++;
    if (json.paging && json.paging.totals != null) total = Number(json.paging.totals) || total;
    if (!list.length) break;

    list.forEach((item) => {
      const info = itemInfo(item);
      if (!info || !info.workId) return;
      if (seen.has(info.workId)) return;
      seen.add(info.workId);
      if (info.createdMs && info.createdMs < cutoffMs) {
        reachedOldest = true;
        return;
      }
      if (info.isVideo) works.push(info);
    });

    if (json.paging && json.paging.is_end) break;
  }

  return { works, total: total == null ? works.length : total, pages };
}

/** 把列表项归一化成作品信息；非视频内容返回 null */
function itemInfo(item) {
  const data = (item && item.data) || {};
  const id = String(data.id || '').trim();
  if (!id) return null;
  const createdMs = (Number(data.created_time) || 0) * 1000;
  const reaction = (item && item.reaction) || {};

  if (item.type === 'zvideo') {
    return {
      workId: id,
      isVideo: true,
      title: cleanTitle(data.title || data.excerpt),
      createdMs,
      publishUrl: 'https://www.zhihu.com/zvideo/' + id,
      reaction
    };
  }

  if (item.type === 'pin') {
    const contents = Array.isArray(data.content) ? data.content : [];
    const video = contents.find((c) => c && c.type === 'video');
    if (!video) return null;
    const text = contents.find((c) => c && c.type === 'text') || {};
    const title =
      cleanTitle(text.title) ||
      cleanTitle(data.excerpt) ||
      cleanTitle(String(text.content || '').slice(0, 80));
    return {
      workId: id,
      isVideo: true,
      title,
      createdMs,
      publishUrl: 'https://www.zhihu.com/pin/' + id,
      reaction
    };
  }

  return null;
}

const STAT_LABELS = [
  ['comment_count', '评论'],
  ['collect_count', '收藏'],
  ['repin_count', '转发']
];

function saveWorks(works) {
  const statDate = today();
  let schedulesCreated = 0;
  let schedulesMatched = 0;
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
  let totalReads = 0;
  let totalLikes = 0;

  works.forEach((work) => {
    const title = work.title || '知乎作品 ' + work.workId;
    let schedule = store.findScheduleByNote(PLATFORM, work.workId, title);
    if (schedule) {
      schedulesMatched++;
    } else {
      schedule = store.create('calendar', {
        标题: title,
        平台: PLATFORM,
        计划发布时间: localMinute(work.createdMs || Date.now()),
        当前阶段: '已发布',
        内容形式: '短视频',
        发布链接: work.publishUrl,
        备注: '知乎作品自动同步（ID: ' + work.workId + '）'
      });
      schedulesCreated++;
    }

    const reaction = work.reaction || {};
    const play = Math.max(0, parseInt(reaction.play_count, 10) || 0);
    const view = Math.max(0, parseInt(reaction.view_count, 10) || 0);
    const reads = play > 0 ? play : view;
    const likes = Math.max(0, parseInt(reaction.like_count, 10) || 0);

    const parts = ['知乎自动同步', '播放 ' + reads, '点赞 ' + likes];
    STAT_LABELS.forEach(([key, label]) => {
      parts.push(label + ' ' + (Math.max(0, parseInt(reaction[key], 10) || 0)));
    });
    parts.push('作品 ID ' + work.workId);

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
  if (state.running) throw httpError(409, '知乎数据同步正在进行，请稍候');
  const cookie = getCookie();
  if (!cookie) throw httpError(400, '请先在「连接设置」完成知乎一键登录');

  state.running = true;
  state.lastRunAt = new Date().toISOString();
  state.lastError = null;

  try {
    const warnings = [];
    const cutoffMs = Date.now() - WINDOW_DAYS * 86400000;
    const { works, total, pages } = await fetchWorks(cookie, cutoffMs);
    if (!works.length) {
      warnings.push('最近 ' + WINDOW_DAYS + ' 天没有已发布的视频作品，暂未写入复盘快照');
    }

    const summary = saveWorks(works);
    const result = {
      ok: true,
      platform: PLATFORM,
      total,
      fetched: works.length,
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
