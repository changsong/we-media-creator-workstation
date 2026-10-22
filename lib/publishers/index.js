'use strict';

const douyin = require('./douyin');
const mock = require('./mock');

const ADAPTERS = {
  抖音: douyin
};

function get(platform) {
  if (process.env.WB_PUBLISH_MOCK === '1') return mock;
  return ADAPTERS[platform] || null;
}

function supported(platform) {
  return !!get(platform);
}

function list() {
  return Object.keys(ADAPTERS).map((platform) => ({
    platform,
    supported: true,
    mode: 'browser'
  }));
}

module.exports = { get, supported, list };
