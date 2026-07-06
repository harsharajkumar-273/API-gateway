require('dotenv').config();

module.exports = {
  port: process.env.PORT || 8080,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // Rate limiting configurations
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10) // max requests per window
  },

  // Service Routing configurations (Microservices)
  services: {
    auth: {
      route: '/v1/auth',
      target: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
      changeOrigin: true
    },
    billing: {
      route: '/v1/billing',
      target: process.env.BILLING_SERVICE_URL || 'http://localhost:3002',
      changeOrigin: true
    },
    users: {
      route: '/v1/users',
      target: process.env.USERS_SERVICE_URL || 'http://localhost:3003',
      changeOrigin: true
    }
  }
};
