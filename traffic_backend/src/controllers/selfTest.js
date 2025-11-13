'use strict';

const logger = require('../logger');
const trafficService = require('../services/traffic');

/**
 * PUBLIC_INTERFACE
 * getSelfTest
 * 
 * This endpoint returns runtime information about the traffic live update scheduler.
 * It includes the current server timestamp, operating mode (simulated or tomtom),
 * global tick count, and the last tick timestamp per city.
 * 
 * Query: none
 * 
 * Returns: 200 JSON {
 *   serverTimestamp: string (ISO),
 *   mode: 'simulated' | 'tomtom',
 *   tickCount: number,
 *   cities: {
 *     [cityName: string]: {
 *       lastTickTimestamp: string | null
 *     }
 *   }
 * }
 */
async function getSelfTest(req, res) {
  const now = new Date().toISOString();

  // Safely get metrics from the traffic service. If undefined, provide defaults.
  const metrics = trafficService.getSchedulerMetrics
    ? trafficService.getSchedulerMetrics()
    : {
        mode: 'simulated',
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
    cities[city] = {
      lastTickTimestamp: ts ? new Date(ts).toISOString() : null
    };
  }

  return res.status(200).json({
    serverTimestamp: now,
    mode: metrics.mode,
    tickCount: metrics.tickCount || 0,
    cities
  });
}

module.exports = {
  getSelfTest
};
