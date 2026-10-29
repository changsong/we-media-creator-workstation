'use strict';

/**
 * 微博个人作品与账号数据采集器。
 *
 * 作品列表直接请求 weibo.com/ajax/statuses/mymblog，自带每条博文的阅读数
 * （reads_count）、点赞 / 评论 / 转发；视频的「播放量 / 播放人数」来自
 * 数据中心的视频分析接口，按 mid 合并进对应博文。
 *
 * 涨粉是账号级指标：数据中心的粉丝趋势接口按天返回新增 / 减少粉丝，
 * 这里写入 @monitor:微博 的账号日汇总（与公众号监控同一套结构）。
 * 数据中心接口限制单次查询 30 天，采集窗口固定为最近 30 天。
 *
 * 落库方式与其它渠道一致：
 *   - 内容日历：按博文 ID / 标题匹配，匹配不到则自动建档（阶段=已发布）
 *   - 数据复盘：同一排期每天一条快照，已存在则更新指标
 */

const store = require('./store');
const channelConnections = require('./channel-connections');

const PLATFORM = '微博';
const HOME_URL = 'https://weibo.com/';
const MYMBLOG_API = 'https://weibo.com/ajax/statuses/mymblog';
const DSS_BASE = 'https://dss.sc.weibo.com/pc/aj/chart';
const DSS_REFERER = 'https://dss.sc.weibo.com/pc/index';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20000;
const MAX_PAGES = 10;
const MAX_LIST_PAGES = 3;
const ACCOUNT_DAYS = 30;

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
  const firstLine = String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';
  return firstLine.replace(/https?:\/\/\S+/g, '').trim().slice(0, 80);
}

async function getJson(url, cookie, referer) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        Cookie: cookie,
        'User-Agent': UA,
        Referer: referer,
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw httpError(502, '无法连接微博：' + err.message);
  }
  if (!resp.ok) throw httpError(502, `微博接口返回 HTTP ${resp.status}`);
  return resp.json().catch(() => null);
}

/** 微博首页的 CONFIG 里带有当前登录用户的 uid */
async function fetchUid(cookie) {
  let resp;
  try {
    resp = await fetch(HOME_URL, {
      headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw httpError(502, '无法连接微博首页：' + err.message);
  }
  if (!resp.ok) throw httpError(502, '微博首页返回 HTTP ' + resp.status);
  const html = await resp.text();
  const m = html.match(/"uid"\s*:\s*"?(\d+)/);
  if (!m) throw httpError(401, '未能识别微博登录用户，请到「连接设置」重新一键登录');
  return m[1];
}

async function fetchPosts(cookie, uid) {
  const posts = [];
  const seen = new Set();
  let total = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url = `${MYMBLOG_API}?uid=${encodeURIComponent(uid)}&page=${pages + 1}&feature=0`;
    const json = await getJson(url, cookie, HOME_URL);
    if (!json) throw httpError(502, '微博博文列表返回的不是合法 JSON');
    if (json.ok !== 1) {
      throw httpError(401, (json.message || '微博登录态已失效') + '，请到「连接设置」重新一键登录');
    }
    pages++;
    if (json.data && json.data.total != null) total = Number(json.data.total) || total;
    const list = (json.data && json.data.list) || [];
    if (!list.length) break;
    list.forEach((item) => {
      if (!item || (!item.id && !item.mid)) return;
      const id = String(item.id || item.mid);
      if (seen.has(id)) return;
      seen.add(id);
      posts.push(item);
    });
    if (total != null && posts.length >= total) break;
  }

  return { posts, total: total == null ? posts.length : total, pages };
}

/** 数据中心图表接口：code=100000 表示成功；单次查询不得超过 30 天 */
async function dssChart(cookie, name, params) {
  const query = Object.keys(params || {})
    .map((key) => key + '=' + encodeURIComponent(params[key]))
    .join('&');
  const url = `${DSS_BASE}/${name}?${query}${query ? '&' : ''}_=${Date.now()}`;
  const json = await getJson(url, cookie, DSS_REFERER);
  if (!json) throw httpError(502, '微博数据中心返回的不是合法 JSON');
  if (Number(json.code) !== 100000) {
    const msg = String(json.msg || '');
    if (/登录|登陆/.test(msg)) {
      throw httpError(401, '微博登录态已失效，请到「连接设置」重新一键登录');
    }
    throw httpError(502, '微博数据中心接口错误：' + (msg || json.code));
  }
  return (json.data && json.data.chart) || {};
}

async function fetchVideoMap(cookie, starttime, endtime) {
  const map = new Map();
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const chart = await dssChart(cookie, 'video/videoList', { starttime, endtime, page });
    const data = chart.videoList || {};
    const list = data.list || [];
    list.forEach((item) => {
      if (!item || !item.mid) return;
      map.set(String(item.mid), item);
    });
    if (!data.hasMore || !list.length) break;
  }
  return map;
}

async function fetchArticleMap(cookie, starttime, endtime) {
  const map = new Map();
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const chart = await dssChart(cookie, 'article/articleSingleList', { starttime, endtime, page });
    const data = chart.articleSingleList || {};
    const list = data.list || [];
    list.forEach((item) => {
      if (!item) return;
      const id = String(item.mid || item.id || '');
      if (id) map.set(id, item);
    });
    if (!data.hasMore || !list.length) break;
  }
  return map;
}

function dateList(starttime, count) {
  const start = new Date(starttime + 'T00:00:00');
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime());
    d.setDate(start.getDate() + i);
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
}

/** 粉丝趋势：tIncrTrend 为每日净增（新增 - 减少） */
async function fetchFanDays(cookie, starttime, endtime) {
  const chart = await dssChart(cookie, 'fans/fansTrend', { starttime, endtime });
  const data = chart.fansTrend || {};
  const dates = dateList(data.starttime || starttime, (data.incrTrend || []).length);
  const map = new Map();
  dates.forEach((date, i) => {
    map.set(date, {
      incr: Number((data.incrTrend || [])[i]) || 0,
      decr: Number((data.descTrend || [])[i]) || 0,
      net: Number((data.tIncrTrend || [])[i]) || 0
    });
  });
  return map;
}

async function fetchReadDays(cookie, starttime, endtime) {
  const chart = await dssChart(cookie, 'content/weiboReadTrend', { starttime, endtime });
  const data = chart.weiboReadTrend || {};
  const reads = data.reads || [];
  const dates = dateList(data.starttime || starttime, reads.length);
  const map = new Map();
  dates.forEach((date, i) => map.set(date, Number(reads[i]) || 0));
  return map;
}

function findSchedule(platform, ids, title) {
  for (const id of ids) {
    if (!id) continue;
    const hit = store.findScheduleByNote(platform, id, title);
    if (hit) return hit;
  }
  return null;
}

function saveWorks(posts, videoMap, articleMap, uid) {
  const statDate = today();
  let schedulesCreated = 0;
  let schedulesMatched = 0;
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
  let totalReads = 0;
  let totalLikes = 0;

  posts.forEach((item) => {
    const id = String(item.id || item.mid || '').trim();
    if (!id) return;
    const mblogid = String(item.mblogid || '').trim();
    const info = item.page_info || {};
    const isVideo = info.object_type === 'video' || Number(info.type) === 11;
    const isArticle = !isVideo && (info.object_type === 'article' || !!info.page_title);
    const rawTitle = cleanTitle(item.text_raw || item.text);
    const pageTitle = cleanTitle(info.page_title);
    const title = (isArticle && pageTitle ? pageTitle : rawTitle || pageTitle || '微博作品 ' + (mblogid || id)).slice(0, 80);

    let schedule = findSchedule(PLATFORM, [mblogid, id], title);
    if (schedule) {
      schedulesMatched++;
    } else {
      const created = new Date(item.created_at || '').getTime();
      schedule = store.create('calendar', {
        标题: title,
        平台: PLATFORM,
        计划发布时间: localMinute(Number.isFinite(created) ? created : Date.now()),
        当前阶段: '已发布',
        内容形式: isVideo ? '短视频' : '图文',
        发布链接: 'https://weibo.com/' + uid + '/' + (mblogid || id),
        备注: '微博作品自动同步（ID: ' + id + (mblogid ? ' / ' + mblogid : '') + '）'
      });
      schedulesCreated++;
    }

    const videoStats = videoMap.get(id) || videoMap.get(mblogid) || null;
    const articleStats = articleMap.get(id) || articleMap.get(mblogid) || null;
    const readsCount = Number(item.reads_count) || 0;
    const play = videoStats && Number.isFinite(Number(videoStats.play)) ? Number(videoStats.play) : null;
    const articleReads = articleStats && Number(articleStats.read);
    // 「阅读播放」列：视频优先真实播放量，文章优先数据中心阅读量，缺失时退回博文阅读数
    const reads = isVideo && play ? play : isArticle && articleReads ? articleReads : readsCount;
    const likes = Number(item.attitudes_count) || 0;
    const comments = Number(item.comments_count) || 0;
    const reposts = Number(item.reposts_count) || 0;

    const parts = ['微博自动同步', '阅读 ' + (articleReads || readsCount)];
    if (videoStats) {
      parts.push('播放 ' + (play || 0));
      if (videoStats.playPeople != null) parts.push('播放人数 ' + (Number(videoStats.playPeople) || 0));
    }
    parts.push('转发 ' + reposts, '评论 ' + comments, '点赞 ' + likes, '博文 ID ' + (mblogid || id));

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

function saveAccount(days, fanMap, readMap) {
  let created = 0;
  let updated = 0;
  let totalFollowers = 0;

  days.forEach((date) => {
    const prev = store.getMonitor(PLATFORM, date) || {};
    const fan = fanMap.get(date);
    const reads = readMap.has(date) ? readMap.get(date) : Number(prev.reads) || 0;
    const followers = fan ? fan.net : Number(prev.followers) || 0;
    const saved = store.upsertMonitor(date, {
      platform: PLATFORM,
      reads,
      likes: 0,
      followers,
      conversions: 0
    });
    if (saved.updated) updated++;
    else created++;
    totalFollowers += followers;
  });

  return { accountRows: days.length, monitorCreated: created, monitorUpdated: updated, totalFollowers };
}

async function run() {
  if (state.running) throw httpError(409, '微博数据同步正在进行，请稍候');
  const connection = channelConnections.getRaw(PLATFORM);
  const cookie = connection && connection.enabled ? String(connection.fields['Cookie'] || '') : '';
  if (!cookie) throw httpError(400, '请先在「连接设置」完成微博一键登录');

  state.running = true;
  state.lastRunAt = new Date().toISOString();
  state.lastError = null;

  try {
    const warnings = [];
    const uid = await fetchUid(cookie);
    const { posts, total, pages } = await fetchPosts(cookie, uid);

    const statDate = today();
    const days = dateList(
      (() => {
        const d = new Date();
        d.setDate(d.getDate() - (ACCOUNT_DAYS - 1));
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      })(),
      ACCOUNT_DAYS
    );
    const starttime = days[0];
    const endtime = days[days.length - 1];

    let videoMap = new Map();
    try {
      videoMap = await fetchVideoMap(cookie, starttime, endtime);
    } catch (err) {
      if (err && err.status === 401) throw err;
      warnings.push('视频播放量获取失败：' + (err && err.message ? err.message : err));
    }

    let articleMap = new Map();
    try {
      articleMap = await fetchArticleMap(cookie, starttime, endtime);
    } catch (err) {
      if (err && err.status === 401) throw err;
      warnings.push('文章阅读量获取失败：' + (err && err.message ? err.message : err));
    }

    let fanMap = new Map();
    try {
      fanMap = await fetchFanDays(cookie, starttime, endtime);
    } catch (err) {
      if (err && err.status === 401) throw err;
      warnings.push('涨粉数据获取失败，账号日汇总保留上次快照：' + (err && err.message ? err.message : err));
    }

    let readMap = new Map();
    try {
      readMap = await fetchReadDays(cookie, starttime, endtime);
    } catch (err) {
      if (err && err.status === 401) throw err;
      warnings.push('账号阅读趋势获取失败：' + (err && err.message ? err.message : err));
    }

    const workSummary = saveWorks(posts, videoMap, articleMap, uid);
    const accountSummary = saveAccount(days, fanMap, readMap);
    if (!posts.length) warnings.push('微博博文列表为空，暂未写入作品快照');

    const result = {
      ok: true,
      platform: PLATFORM,
      total,
      fetched: posts.length,
      pages,
      statDate,
      ...workSummary,
      ...accountSummary,
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
