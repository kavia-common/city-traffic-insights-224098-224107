'use strict';
const app = require('./app');
const config = require('./config');
const logger = require('./logger');

const PORT = config.port;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  logger.info({ msg: 'Server running', host: HOST, port: PORT, env: config.env });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.warn('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

module.exports = server;
