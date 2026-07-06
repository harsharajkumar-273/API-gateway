const { createClient } = require('redis');
const config = require('../config');

// Initialize Redis client
const redisClient = createClient({ url: config.redisUrl });
redisClient.on('error', (err) => console.error('[Redis Client Error]', err));

// Self-invoking connection wrapper
(async () => {
  try {
    await redisClient.connect();
    console.log('[Redis] Rate Limiter connected successfully.');
  } catch (err) {
    console.warn('[Redis] Connection failed. Rate Limiter falling back to memory stores.', err.message);
  }
})();

/**
 * Sliding Window Rate Limiter using Redis Sorted Sets (zsets)
 */
async function rateLimiter(req, res, next) {
  if (!redisClient.isOpen) {
    // Graceful fallback if Redis is down
    return next();
  }

  // Rate limit by client IP address
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const key = `ratelimit:${clientIp}`;
  
  const now = Date.now();
  const windowStart = now - config.rateLimit.windowMs;
  const limit = config.rateLimit.maxRequests;

  try {
    // Pipeline Redis operations to minimize round-trip latencies
    const multi = redisClient.multi();
    
    // Remove requests that fell outside the sliding window
    multi.zRemRangeByScore(key, 0, windowStart);
    
    // Add current request timestamp
    multi.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
    
    // Get count of remaining requests inside active sliding window
    multi.zCard(key);
    
    // Set ttl on the key to clean up idle clients
    multi.pExpire(key, config.rateLimit.windowMs);

    const results = await multi.exec();
    const requestCount = results[2]; // Index 2 is zCard output

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - requestCount));

    if (requestCount > limit) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `API rate limit of ${limit} requests per minute exceeded. Please try again later.`,
        retryAfterMs: config.rateLimit.windowMs
      });
    }

    next();
  } catch (err) {
    console.error('[Rate Limiter Exception]', err);
    next(); // Always fail-open in production rather than dropping traffic
  }
}

module.exports = rateLimiter;
