'use strict';

/**
 * 校验灰豚数据客户端：离线验证响应解密与 URL 拼接，在线验证公开榜单解密；
 * 传入 Cookie 时再验证登录态、达人搜索与笔记列表。
 *
 * 用法：
 *   node tools/verify-huitun.js
 *   node tools/verify-huitun.js --cookie "a=1; b=2"
 *   node tools/verify-huitun.js --cookie "..." --keyword "博主昵称"
 *   node tools/verify-huitun.js --cookie "..." --anchor "https://xhs.huitun.com/#/anchor/anchor_detail?id=..."
 */

const crypto = require('crypto');
const huitun = require('../lib/huitun');

const results = [];
let failed = 0;

function check(name, ok, detail) {
  results.push({ name, ok });
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''));
}

function argValue(args, name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? String(args[i + 1] || '') : '';
}

function offlineChecks() {
  const key = Buffer.from(
    [93, 24, 43, 91, 81, 72, 3, 99, 125, 28, 45, 112, 118, 45, 0, 108].map(
      (v, i) => v ^ [19, 47, 83, 11, 101, 37, 72, 90, 14, 77, 31, 6, 58, 21, 99, 40][i]
    )
  );
  const payload = '{"ok":1,"1":{"id":"abc"},"title":"解密测试"}';
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]).toString('base64');
  const decrypted = huitun.decryptExtData(encrypted);
  check('响应解密（AES-128-ECB + PKCS7）', decrypted.ok === 1 && decrypted.title === '解密测试');
  check('数字键 JSON 修复', decrypted['1'] && decrypted['1'].id === 'abc');

  const url = new URL(huitun.buildUrl('/anchor/v2/search', { keyword: '测试', page: 0, empty: '' }));
  check(
    '公共参数与空值过滤',
    url.searchParams.get('vs') === '16101520.52.102' &&
      url.searchParams.get('source') === 'web' &&
      !!url.searchParams.get('_t') &&
      url.searchParams.get('keyword') === '测试' &&
      url.searchParams.get('page') === '0' &&
      !url.searchParams.has('empty')
  );

  check('灰豚达人链接解析', huitun.parseAnchorUrl('https://xhs.huitun.com/#/anchor/anchor_detail?id=66896a31000000000f036053') === '66896a31000000000f036053');
  check('非灰豚链接拒绝', huitun.parseAnchorUrl('https://www.xiaohongshu.com/user/profile/abc') === '');
  check('北京时间转换', huitun.parsePublishedAt('2026-11-02 20:57:56') === '2026-11-02T12:57:56.000Z');
}

async function onlineChecks(cookie, keyword, anchorInput) {
  const json = await huitun.request({
    path: '/workbench/ranks',
    params: { rankType: 'hot' },
    allowAnonymous: true
  });
  check('公开榜单返回 status 0', Number(json.status) === 0, String(json.status));
  check('响应体已解密为对象', !!json.extData && typeof json.extData === 'object');
  const list = (json.extData && (json.extData.hotNoteRank || json.extData.list)) || [];
  check('榜单条目可解析为作品', list.length > 0 && !!huitun.parseNote(list[0]));

  if (!cookie) return;

  try {
    const user = await huitun.requireUser(cookie);
    check('登录态有效（/user/currentUser）', true, user.nickname || user.userName || '');
  } catch (err) {
    check('登录态有效（/user/currentUser）', false, err.message);
    return;
  }

  if (keyword) {
    try {
      const anchors = await huitun.searchAnchor(cookie, keyword);
      check('达人搜索', anchors.length > 0, '命中 ' + anchors.length + ' 个');
      const anchorId = huitun.parseAnchorUrl(anchorInput) || (anchors[0] && (anchors[0].anchorId || anchors[0].id));
      if (anchorId) {
        const notes = await huitun.listAnchorNotes(cookie, anchorId, { page: 1, pageSize: 10 });
        check('达人笔记列表', notes.list.length > 0, '共 ' + notes.total + ' 条，本页 ' + notes.list.length);
        const parsed = notes.list.map(huitun.parseNote).filter(Boolean);
        check('笔记映射为对标作品', parsed.length > 0);
      }
    } catch (err) {
      check('达人搜索 / 笔记列表', false, err.message);
    }
    return;
  }

  if (anchorInput) {
    const anchorId = huitun.parseAnchorUrl(anchorInput);
    if (!anchorId) {
      check('达人链接解析', false, '无法识别的灰豚达人链接');
      return;
    }
    try {
      const notes = await huitun.listAnchorNotes(cookie, anchorId, { page: 1, pageSize: 10 });
      check('达人笔记列表', notes.list.length > 0, '共 ' + notes.total + ' 条');
    } catch (err) {
      check('达人笔记列表', false, err.message);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  offlineChecks();
  try {
    await onlineChecks(argValue(args, 'cookie'), argValue(args, 'keyword'), argValue(args, 'anchor'));
  } catch (err) {
    check('在线请求', false, err.message);
  }
  console.log('');
  console.log(failed ? failed + ' 项失败' : '全部通过');
  process.exit(failed ? 1 : 0);
}

main();
