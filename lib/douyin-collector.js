'use strict';

/**
 * 抖音个人作品数据采集器。
 *
 * 抖音开放平台没有面向个人创作者的「作品列表 + 互动数据」接口，
 * 这里复用「一键登录」保存的 Cookie 直接请求创作者中心的 work_list 接口。
 * 该接口不需要 a_bogus 签名，Cookie 有效即可分页拉取全部作品。
 *
 * 落库方式与小红书一致：
 *   - 内容日历：按作品 ID / 标题匹配，匹配不到则自动建档（阶段=已发布）
 *   - 数据复盘：同一排期每天一条快照，已存在则更新指标
 */

const store = require('./store');
const channelConnections = require('./channel-connections');

const PLATFORM = '抖音';
const API = 'https://creator.douyin.com/janus/douyin/creator/pc/work_list';
const REFERER = 'https://creator.douyin.com/creator-micro/content/manage';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const PAGE_COUNT = 40; // 接口单页上限为 40
const MAX_PAGES = 100;
const REQUEST_TIMEOUT_MS = 20000;

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

async function fetchPage(cookie, cursor) {
  const url =
    `${API}?status=0&count=${PAGE_COUNT}&max_cursor=${encodeURIComponent(cursor)}` +
    '&scene=star_atlas&device_platform=android&aid=1128';
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        Cookie: cookie,
        'User-Agent': UA,
        Referer: REFERER,
        Accept: 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw httpError(502, '无法连接抖音创作者中心：' + err.message);
  }
  if (!resp.ok) throw httpError(502, `抖音接口返回 HTTP ${resp.status}`);
  const json = await resp.json().catch(() => null);
  if (!json) throw httpError(502, '抖音接口返回的不是合法 JSON');
  if (json.status_code === 8) {
    throw httpError(401, '抖音登录态已失效，请到「连接设置」重新一键登录');
  }
  if (json.status_code !== 0) {
    throw httpError(502, `抖音接口错误 ${json.status_code}：${json.status_msg || '未知原因'}`);
  }
  if (!Array.isArray(json.aweme_list)) {
    throw httpError(502, '抖音接口未返回作品列表');
  }
  return json;
}

async function fetchAllWorks(cookie) {
  const works = [];
  const seen = new Set();
  const warnings = [];
  let total = null;
  let cursor = 0;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const json = await fetchPage(cookie, cursor);
    pages++;
    if (json.total != null) total = json.total;
    json.aweme_list.forEach((item) => {
      if (!item || !item.aweme_id || seen.has(item.aweme_id)) return;
      seen.add(item.aweme_id);
      works.push(item);
    });

    if (!json.has_more) break;
    const next = json.max_cursor;
    if (next == null || next === cursor) {
      warnings.push(`第 ${pages} 页后游标未推进，已停止翻页`);
      break;
    }
    cursor = next;
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
    const id = String(item.aweme_id);
    const rawTitle = String(item.desc || item.item_title || item.caption || '').trim();
    const title = (rawTitle || `抖音作品 ${id}`).slice(0, 80);
    const isImage = [2, 68].indexOf(Number(item.aweme_type)) >= 0;

    let schedule = store.findScheduleByNote(PLATFORM, id, title);
    if (schedule) {
      schedulesMatched++;
    } else {
      schedule = store.create('calendar', {
        标题: title,
        平台: PLATFORM,
        计划发布时间: localMinute((Number(item.create_time) || Math.floor(Date.now() / 1000)) * 1000),
        当前阶段: '已发布',
        内容形式: isImage ? '图文' : '短视频',
        发布链接: `https://www.douyin.com/${isImage ? 'note' : 'video'}/${id}`,
        备注: `抖音作品自动同步（ID: ${id}）`
      });
      schedulesCreated++;
    }

    const st = item.statistics || {};
    const snap = store.upsertNoteSnapshot(schedule['排期ID'], PLATFORM, statDate, {
      reads: Number(st.play_count) || 0,
      likes: Number(st.digg_count) || 0,
      followers: 0,
      conversions: 0,
      note:
        `抖音自动同步 · 评论 ${Number(st.comment_count) || 0}` +
        ` · 收藏 ${Number(st.collect_count) || 0}` +
        ` · 分享 ${Number(st.share_count) || 0}` +
        ` · 作品 ID ${id}`
    });
    if (snap.updated) snapshotsUpdated++;
    else snapshotsCreated++;
  });

  return { schedulesCreated, schedulesMatched, snapshotsCreated, snapshotsUpdated };
}

async function run() {
  if (state.running) throw httpError(409, '抖音数据同步正在进行，请稍候');
  const connection = channelConnections.getRaw(PLATFORM);
  const cookie = connection && connection.enabled ? connection.fields['Cookie'] : '';
  if (!cookie) throw httpError(400, '请先在「连接设置」完成抖音一键登录');

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

/** 发布适配器专用：只取最近几页作品，用于核验刚发布的作品是否出现在列表中 */
async function fetchRecentWorks(cookie, pages) {
  const out = [];
  let cursor = 0;
  const max = Math.max(1, Math.min(Number(pages) || 2, 10));
  for (let i = 0; i < max; i++) {
    const json = await fetchPage(cookie, cursor);
    out.push.apply(out, json.aweme_list || []);
    if (!json.has_more) break;
    if (json.max_cursor == null || json.max_cursor === cursor) break;
    cursor = json.max_cursor;
  }
  return out;
}

module.exports = { run, getStatus, fetchRecentWorks };
