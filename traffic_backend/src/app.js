'use strict';

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../swagger');
const config = require('./config');
const logger = require('./logger');

const healthController = require('./controllers/health');
const trafficRoutes = require('./routes/traffic');
const selfTestRoutes = require('./routes/selfTest');
const routes = require('./routes');
const mongoClient = require('./db/mongo');

/**
 * Initialize express app and DB connections.
 */
const app = express();
// Initialize Mongo (non-blocking; app continues if connect fails)
mongoClient.connect();

// Trust proxy (behind load balancers)
app.set('trust proxy', config.trustProxy);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS - restricted to frontend origin if provided
app.use(cors({
  origin: (origin, callback) => {
    if (!config.frontendOrigin || config.frontendOrigin === '*' || !origin) {
      return callback(null, true);
    }
    if (origin === config.frontendOrigin) {
      return callback(null, true);
    }
    // Allow same-origin tools and localhost dev convenience
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Logging HTTP with morgan -> winston
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.http ? logger.http(message.trim()) : logger.info(message.trim())
  }
}));

// JSON body
app.use(express.json());

// Rate limiting for /api/traffic/*
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/traffic', limiter);

/**
 * Swagger Docs with dynamic server URL
 * Description notes that live endpoint uses real TomTom data when TOMTOM_API_KEY is configured.
 */
app.use('/api/docs', swaggerUi.serve, (req, res, next) => {
  const host = req.get('host');
  let protocol = req.secure ? 'https' : req.protocol;
  const spec = {
    ...swaggerSpec,
    info: {
      ...swaggerSpec.info,
      title: 'Traffic Insights API',
      description: 'Live traffic, history, and predictions. When TOMTOM_API_KEY is configured, /api/traffic/live returns real TomTom data; otherwise simulated. Params unchanged.',
      version: '1.0.0'
    },
    servers: [{ url: `${protocol}://${host}` }],
    tags: [
      { name: 'Health', description: 'Service health' },
      { name: 'Traffic', description: 'Live traffic, history and predictions' }
    ]
  };
  swaggerUi.setup(spec, { explorer: true })(req, res, next);
});

// Health route
app.get('/api/health', healthController.check.bind(healthController));

 // Traffic routes
app.use('/api/traffic', trafficRoutes);

// Self-test under both /api/traffic/self-test and /api/self-test
app.use('/api/traffic', selfTestRoutes);
app.use('/api', selfTestRoutes);

// Keep existing root routes (if any)
app.use('/', routes);

// Centralized error handling
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ msg: 'Unhandled error', error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Internal Server Error'
    }
  });
});

module.exports = app;
