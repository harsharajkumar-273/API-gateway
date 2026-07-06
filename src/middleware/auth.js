// Simple API Token Verification with memory edge checking
const VALID_TOKENS_MOCK = new Set(['sde_token_prod_99f3', 'sde_token_sandbox_de82']);

/**
 * Edge Auth Token Verification Middleware
 */
function authenticate(req, res, next) {
  // Bypassing auth check for public routes (e.g., status/health checks)
  if (req.path === '/health' || req.path === '/status') {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header is missing. Access denied.'
    });
  }

  const token = authHeader.replace(/^Bearer\s+/, '').trim();

  // In production, you would fetch token verification states from a Redis cache or call a lightweight JWKS verifier.
  // Here, we check against our mock valid token list.
  if (!VALID_TOKENS_MOCK.has(token)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or expired API token. Access denied.'
    });
  }

  // Inject token meta context for downstream proxy headers
  req.headers['x-user-role'] = 'SDE-Developer';
  req.headers['x-authenticated-client'] = token;

  next();
}

module.exports = authenticate;
