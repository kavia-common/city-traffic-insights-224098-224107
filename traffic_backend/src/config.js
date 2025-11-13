'use strict';

/**
 * Configuration loader using environment variables.
 * This respects REACT_APP_* variables as provided in the container and avoids hardcoded secrets.
 */
require('dotenv').config();

const toBool = (v, def = false) => {
  if (v === undefined || v === null) return def;
  return String(v).toLowerCase() === 'true';
};

const config = {
  env: process.env.NODE_ENV || process.env.REACT_APP_NODE_ENV || 'development',
  // Backend port: if REACT_APP_API_BASE includes a port and equals our host, we still allow overriding via PORT
  port: parseInt(process.env.PORT, 10) ||
    parseInt(process.env.REACT_APP_PORT, 10) ||
    3001,
  trustProxy: toBool(process.env.REACT_APP_TRUST_PROXY, true),
  logLevel: process.env.LOG_LEVEL ||
    process.env.REACT_APP_LOG_LEVEL ||
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  frontendOrigin: process.env.REACT_APP_FRONTEND_URL || '*',
  apiBase: process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || '',
  healthPath: process.env.REACT_APP_HEALTHCHECK_PATH || '/api/health',
  mongoUri: process.env.MONGO_URI || '', // MongoDB connection string; required for persistence
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute
    max: 120, // 120 req/min per IP
  },
  features: {
    experiments: toBool(process.env.REACT_APP_EXPERIMENTS_ENABLED, false),
    featureFlags: process.env.REACT_APP_FEATURE_FLAGS || '',
  }
};

module.exports = config;
