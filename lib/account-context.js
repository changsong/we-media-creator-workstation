'use strict';

/**
 * 当前运营账号的请求上下文。
 *
 * 每个账号是一套独立的 SQLite + 配置目录；HTTP 请求、发布任务、采集任务
 * 都在对应账号的上下文中执行，db.open() 与各处配置路径据此解析。
 * 没有上下文时回落到默认账号（升级前的存量数据）。
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_ACCOUNT_ID = 'default';
const storage = new AsyncLocalStorage();

function current() {
  const store = storage.getStore();
  return store && store.accountId ? store.accountId : null;
}

function currentOrDefault() {
  return current() || DEFAULT_ACCOUNT_ID;
}

function run(accountId, fn) {
  return storage.run({ accountId: accountId || DEFAULT_ACCOUNT_ID }, fn);
}

module.exports = {
  DEFAULT_ACCOUNT_ID,
  current,
  currentOrDefault,
  run
};
