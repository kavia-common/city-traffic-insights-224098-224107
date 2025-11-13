'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const traffic = require('../services/traffic');

/**
 * PUBLIC_INTERFACE
 * GET /api/traffic/self-test
 *
 * Returns runtime information about the traffic live update scheduler,
 * including server time, mode (simulated or tomtom), tick counter, and
 * per-city last tick timestamps.
 */
router.get('/self-test', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const metrics = traffic.getSchedulerMetrics
      ? traffic.getSchedulerMetrics()
      : {
          mode: process.env.TOMTOM_API_KEY ? 'tomtom' : 'simulated',
          tickCount: 0,
          cityLastTick: {}
        };

    logger.info('Self-test endpoint accessed', {
      route: req.originalUrl,
      method: req.method,
      mode: metrics.mode,
      tickCount: metrics.tickCount
    });

    const cities = {};
    for (const [city, ts] of Object.entries(metrics.cityLastTick || {})) {
      cities[city] = { lastTickTimestamp: ts ? new Date(ts).toISOString() : null };
    }

    res.status(200).json({
      serverTimestamp: now,
      mode: metrics.mode,
      tickCount: metrics.tickCount || 0,
      cities
    });
  } catch (err) {
    logger.error('Self-test endpoint error', { error: err.message });
    res.status(500).json({ error: { code: 'SELF_TEST_ERROR', message: 'Failed to fetch self-test metrics' } });
  }
});

module.exports = router;
