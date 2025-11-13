'use strict';

const mongoose = require('mongoose');
const logger = require('../logger');
const config = require('../config');

/**
 * Initialize and manage a single MongoDB connection using Mongoose.
 * Uses MONGO_URI from environment (via config.mongoUri). Logs status via Winston.
 */
class MongoClient {
  constructor() {
    this._connected = false;
    this._connecting = false;
  }

  // PUBLIC_INTERFACE
  async connect() {
    /** Establishes a mongoose connection if not already connected. */
    if (this._connected || this._connecting) return;
    if (!config.mongoUri) {
      logger.warn({ msg: 'MONGO_URI not provided; traffic history persistence disabled' });
      return;
    }
    try {
      this._connecting = true;
      await mongoose.connect(config.mongoUri, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10,
        autoIndex: true,
      });
      this._connected = true;
      logger.info({ msg: 'MongoDB connected', uriMasked: this._maskUri(config.mongoUri) });
      mongoose.connection.on('error', (err) => {
        logger.error({ msg: 'MongoDB connection error', error: err.message });
      });
      mongoose.connection.on('disconnected', () => {
        this._connected = false;
        logger.warn({ msg: 'MongoDB disconnected' });
      });
    } catch (err) {
      logger.error({ msg: 'MongoDB connection failed', error: err.message });
      this._connecting = false;
      // Do not throw to allow app to run in non-persistent mode
    } finally {
      this._connecting = false;
    }
  }

  // PUBLIC_INTERFACE
  async disconnect() {
    /** Closes the mongoose connection if open. */
    if (!this._connected) return;
    try {
      await mongoose.connection.close();
      logger.info({ msg: 'MongoDB connection closed' });
      this._connected = false;
    } catch (err) {
      logger.error({ msg: 'Error closing MongoDB connection', error: err.message });
    }
  }

  _maskUri(uri) {
    try {
      const u = new URL(uri);
      if (u.password) {
        u.password = '***';
      }
      if (u.username) {
        u.username = '***';
      }
      return u.toString();
    } catch {
      return 'mongodb://***:***@***';
    }
  }
}

const mongoClient = new MongoClient();

module.exports = mongoClient;
