'use strict';
const app = require('./app');
const config = require('./config');
const logger = require('./logger');
const mongoClient = require('./db/mongo');

const PORT = config.port;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  logger.info({ msg: 'Server running', host: HOST, port: PORT, env: config.env });
});

// Graceful shutdown
async function shutdown() {
  logger.warn('Shutdown signal received: closing HTTP server');
  server.close(async () => {
    logger.info('HTTP server closed');
    await mongoClient.disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = server;
