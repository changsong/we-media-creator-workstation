'use strict';

/**
 * 视频号个人作品数据采集器。
 *
 * 视频号助手没有面向个人创作者的公开数据接口，这里复用「一键登录」
 * 保存的 Cookie 直接请求视频号助手网页版的 post_list 接口。该接口
 * 只需 Cookie 即可调用，不需要签名，可翻页拉取全部作品与互动数据。
 *
 * 视频号作品没有公开链接，因此：
 *   - 内容日历不填「发布链接」，在「备注」里记录作品 ID 用于去重匹配
 *   - 数据复盘：同一排期每天一条快照，已存在则更新指标
 */

const store = require('./store');
const channelConnections = require('./channel-connections');

const PLATFORM = '视频号';
const API = 'https://channels.weixin.qq.com/micro/content/cgi-bin/mmfinderassistant-bin/post/post_list';
const REFERER = 'https://channels.weixin.qq.com/micro/content/page';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const PAGE_COUNT = 50;
const MAX_PAGES = 200;
const REQUEST_TIMEOUT_MS = 20000;
const AUTH_ERROR_CODES = [300330, 300333, 300334];

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

async function fetchPage(cookie, currentPage) {
  let resp;
  try {
    resp = await fetch(API, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Referer: REFERER,
        Origin: 'https://channels.weixin.qq.com',
        Accept: 'application/json, text/plain, */*'
      },
      body: JSON.stringify({
        pageSize: PAGE_COUNT,
        currentPage,
        userpageType: 11,
        stickyOrder: false,
        timestamp: String(Date.now()),
        _log_finder_uin: '',
        _log_finder_id: '',
        rawKeyBuff: '',
        pluginSessionId: null,
        scene: 7,
        reqScene: 7
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw httpError(502, '无法连接视频号助手：' + err.message);
  }
  if (!resp.ok) throw httpError(502, `视频号接口返回 HTTP ${resp.status}`);
  const json = await resp.json().catch(() => null);
  if (!json) throw httpError(502, '视频号接口返回的不是合法 JSON');
  if (json.errCode === 0 && json.data) return json.data;
  if (AUTH_ERROR_CODES.indexOf(json.errCode) >= 0) {
    throw httpError(401, '视频号登录态已失效，请到「连接设置」重新扫码登录');
  }
  throw httpError(502, `视频号接口错误 ${json.errCode}：${json.errMsg || '未知原因'}`);
}

async function fetchAllWorks(cookie) {
  const works = [];
  const seen = new Set();
  const warnings = [];
  let total = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages++;
    const data = await fetchPage(cookie, pages);
    if (data.totalCount != null) total = Number(data.totalCount);
    const list = Array.isArray(data.list) ? data.list : [];
    list.forEach((item) => {
      if (!item || !item.objectId || seen.has(item.objectId)) return;
      seen.add(item.objectId);
      works.push(item);
    });

    if (!list.length) break;
    if (total != null && works.length >= total) break;
    if (data.continueFlag !== true) break;
  }

  if (pages >= MAX_PAGES) warnings.push(`已达到 ${MAX_PAGES} 页上限，可能未拉取完整`);
  if (total != null && works.length < total) {
    warnings.push(`接口统计 ${total} 条，去重后 ${works.length} 条`);
  }
  return { works, total: total == null ? works.length : total, pages, warnings };
}

function saveWorks(works) {
  const statDate = today();
  let schedulesCreated = 0;
  let schedulesMatched = 0;
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;

  works.forEach((item) => {
    const id = String(item.objectId);
    const desc = item.desc || {};
    const rawTitle = String(desc.description || '').trim();
    const title = (rawTitle || `视频号作品 ${id.slice(-12)}`).slice(0, 80);
    const isVideo = Number(desc.mediaType) === 4;

    let schedule = store.findScheduleByNote(PLATFORM, id, title);
    if (schedule) {
      schedulesMatched++;
    } else {
      schedule = store.create('calendar', {
        标题: title,
        平台: PLATFORM,
        计划发布时间: localMinute((Number(item.createTime) || Math.floor(Date.now() / 1000)) * 1000),
        当前阶段: '已发布',
        内容形式: isVideo ? '短视频' : '图文',
        发布链接: '',
        备注: `视频号作品自动同步（ID: ${id}）`
      });
      schedulesCreated++;
    }

    const playRate = Number(item.fullPlayRate);
    const avgPlay = Number(item.avgPlayTimeSec);
    const snap = store.upsertNoteSnapshot(schedule['排期ID'], PLATFORM, statDate, {
      reads: Number(item.readCount) || 0,
      likes: Number(item.likeCount) || 0,
      followers: Number(item.followCount) || 0,
      conversions: 0,
      note:
        `视频号自动同步 · 评论 ${Number(item.commentCount) || 0}` +
        ` · 收藏 ${Number(item.favCount) || 0}` +
        ` · 转发 ${Number(item.forwardCount) || 0}` +
        (Number.isFinite(playRate) && playRate > 0 ? ` · 完播率 ${(playRate * 100).toFixed(1)}%` : '') +
        (Number.isFinite(avgPlay) && avgPlay > 0 ? ` · 平均播放 ${avgPlay.toFixed(1)}s` : '') +
        ` · 作品 ID ${id}`
    });
    if (snap.updated) snapshotsUpdated++;
    else snapshotsCreated++;
  });

  return { schedulesCreated, schedulesMatched, snapshotsCreated, snapshotsUpdated };
}

async function run() {
  if (state.running) throw httpError(409, '视频号数据同步正在进行，请稍候');
  const connection = channelConnections.getRaw(PLATFORM);
  const cookie = connection && connection.enabled ? connection.fields['Cookie'] : '';
  if (!cookie) throw httpError(400, '请先在「连接设置」完成视频号扫码登录');

  state.running = true;
  state.lastRunAt = new Date().toISOString();
  state.lastError = null;
  try {
    const { works, total, pages, warnings } = await fetchAllWorks(cookie);
    const summary = saveWorks(works);
    const result = {
      ok: true,
      platform: PLATFORM,
      total,
      fetched: works.length,
      pages,
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
