const buckets = new Map();

export function rateLimit({
  windowMs = 60000,
  max = 120,
  namespace = 'default'
} = {}) {
  const safeWindow = Math.max(1000, Number(windowMs) || 60000);
  const safeMax = Math.max(1, Number(max) || 120);

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const identity = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${namespace}:${identity}`;

    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + safeWindow
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, safeMax - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );

    res.setHeader('X-RateLimit-Limit', String(safeMax));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader(
      'X-RateLimit-Reset',
      String(Math.ceil(bucket.resetAt / 1000))
    );

    if (bucket.count > safeMax) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.'
      });
    }

    if (buckets.size > 5000) {
      pruneExpired(now);
    }

    next();
  };
}

export function clearRateLimitState() {
  buckets.clear();
}

function pruneExpired(now) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}
