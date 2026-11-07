import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { KeygateClient, MockKeygateClient } from './keygate.mjs';
import { createRateLimiter } from './ratelimit.mjs';
import { createReconciler } from './reconcile.mjs';
import { handleCheckout } from './routes/checkout.mjs';
import { handleWeChat } from './routes/wechat.mjs';
import { WeChatClient } from './wechat/client.mjs';
import { MockWeChatClient } from './wechat/mock.mjs';

export function createCheckout({ env = process.env, logger = console } = {}) {
  const config = loadConfig(env);
  const db = openDb(config.dbPath);
  const wechat = config.wechat.mock ? new MockWeChatClient() : new WeChatClient(config.wechat);
  const keygate = config.keygate.mock ? new MockKeygateClient() : new KeygateClient(config.keygate);
  const limiter = createRateLimiter({ limit: config.rateLimit });
  const statusLimiter = createRateLimiter({ limit: Math.max(120, config.rateLimit * 20) });
  const reconciler = createReconciler({ db, config, wechat, keygate, logger });
  const ctx = { config, db, wechat, keygate, limiter, statusLimiter, reconciler, logger };

  const prune = setInterval(() => {
    limiter.prune();
    statusLimiter.prune();
  }, 10 * 60 * 1000);
  prune.unref?.();

  if (config.wechatConfigured && config.keygateConfigured) reconciler.start();

  const wechatState = config.wechatConfigured
    ? config.wechat.mock
      ? 'mock wechat'
      : 'wechat configured'
    : 'wechat disabled';
  const keygateState = config.keygateConfigured
    ? config.keygate.mock
      ? 'mock keygate'
      : 'keygate configured'
    : 'keygate disabled';
  logger.log(`checkout: ${wechatState}, ${keygateState}, orders db ${config.dbPath}`);

  return {
    config,
    ctx,
    async handle(req, res, url) {
      if (await handleWeChat(req, res, url, ctx)) return true;
      if (await handleCheckout(req, res, url, ctx)) return true;
      return false;
    },
    close() {
      clearInterval(prune);
      reconciler.stop();
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}
