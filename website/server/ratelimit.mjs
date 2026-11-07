const HOUR_MS = 60 * 60 * 1000;

export function createRateLimiter({ limit = 10, windowMs = HOUR_MS, now = Date.now } = {}) {
  const buckets = new Map();

  function hit(key) {
    const at = now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= at) {
      buckets.set(key, { count: 1, resetAt: at + windowMs });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }

  function prune() {
    const at = now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= at) buckets.delete(key);
    }
  }

  return { hit, prune };
}
