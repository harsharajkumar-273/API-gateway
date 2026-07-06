const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');

const config = require('./config');
const rateLimiter = require('./middleware/rateLimiter');
const authenticate = require('./middleware/auth');
const CircuitBreaker = require('./utils/circuitBreaker');

const app = express();

// Standard monitoring & logging middleware
app.use(cors());
app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));

// Global rate limiting
app.use(rateLimiter);

// Global authentication gate
app.use(authenticate);

// Initialize Circuit Breakers for each downstream service
const breakers = {
  auth: new CircuitBreaker('auth-service'),
  billing: new CircuitBreaker('billing-service'),
  users: new CircuitBreaker('user-service')
};

// Health Check route (bypasses auth check)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      auth: breakers.auth.state,
      billing: breakers.billing.state,
      users: breakers.users.state
    }
  });
});

// Configure proxy routing wrapper with Circuit Breaker tracking
Object.keys(config.services).forEach((key) => {
  const service = config.services[key];
  const breaker = breakers[key];

  app.use(
    service.route,
    (req, res, next) => {
      // Check if Circuit Breaker allows the request
      if (!breaker.allowRequest()) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: `Downstream service [${breaker.serviceName}] is currently unavailable. Circuit breaker tripped.`,
          state: breaker.state
        });
      }
      next();
    },
    createProxyMiddleware({
      target: service.target,
      changeOrigin: service.changeOrigin,
      pathRewrite: {
        [`^${service.route}`]: '' // strip base route
      },
      // Track proxy status outcomes
      onProxyRes: (proxyRes, req, res) => {
        if (proxyRes.statusCode >= 500) {
          breaker.recordFailure();
        } else {
          breaker.recordSuccess();
        }
      },
      onError: (err, req, res) => {
        breaker.recordFailure();
        res.status(502).json({
          error: 'Bad Gateway',
          message: `Connection to downstream service [${breaker.serviceName}] timed out or failed.`
        });
      }
    })
  );
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Gateway Error]', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred in the gateway router.'
  });
});

app.listen(config.port, () => {
  console.log(`=========================================`);
  console.log(`🚀 Production API Gateway is running on port ${config.port}`);
  console.log(`🔧 Services mapped to routing paths:`);
  Object.keys(config.services).forEach(key => {
    console.log(`   - ${config.services[key].route} -> ${config.services[key].target}`);
  });
  console.log(`=========================================`);
});
