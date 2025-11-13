'use strict';

const { store, getDbHistory, normalizeCity, DEFAULT_CITY, validateCity } = require('../services/traffic');
const logger = require('../logger');

/**
 * Controller for traffic endpoints: live, history, predict.
 */
class TrafficController {
  // PUBLIC_INTERFACE
  async live(req, res) {
    /** Returns live traffic snapshot suitable for map overlays (LineString-like). */
    try {
      const v = validateCity(req.query.city);
      if (!v.valid) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: v.error } });
      }
      const city = v.normalized || normalizeCity(req.query.city);
      const snapshot = await store.getLiveSnapshot(city);
      // Ensure incidents array exists for contract consistency
      if (!Array.isArray(snapshot.incidents)) {
        snapshot.incidents = [];
      }
      logger.debug({ msg: 'live snapshot generated', city: snapshot.city, count: snapshot.features.length, source: snapshot.source });
      res.status(200).json(snapshot);
    } catch (err) {
      logger.error({ msg: 'live snapshot error', error: err.message });
      res.status(500).json({ error: { message: 'Unable to get live traffic' } });
    }
  }

  // PUBLIC_INTERFACE
  async history(req, res) {
    /**
     * Returns recent traffic history. If from/to provided, filters by timestamps.
     * Primary source: MongoDB last 50 records (sorted desc). Fallback: in-memory aggregation.
     * Supports city filter (?city=Bangalore|Mumbai|Delhi), default Bangalore.
     */
    try {
      const { from, to } = req.query;
      const v = validateCity(req.query.city);
      if (!v.valid) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: v.error } });
      }
      const city = v.normalized || normalizeCity(req.query.city || DEFAULT_CITY);
      const format = (req.query.format || '').toString().toLowerCase();

      if (from && isNaN(Date.parse(from))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid from timestamp' } });
      }
      if (to && isNaN(Date.parse(to))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid to timestamp' } });
      }

      // Try DB-backed history
      let data = null;
      try {
        data = await getDbHistory({ fromISO: from, toISO: to, limit: 50, city });
        if (data && data.count > 0) {
          logger.info({
            msg: 'DB history retrieval success',
            route: '/api/traffic/history',
            mode: 'db',
            city,
            count: data.count,
            from: data.from,
            to: data.to
          });
        } else {
          logger.info({
            msg: 'DB history empty',
            route: '/api/traffic/history',
            mode: 'db',
            city,
            from,
            to
          });
        }
      } catch (dbErr) {
        logger.warn({
          msg: 'DB history retrieval failed, falling back to memory',
          route: '/api/traffic/history',
          mode: 'db->memory',
          error: dbErr.message,
          city
        });
      }

      if (!data || (data && data.count === 0)) {
        // Fallback to in-memory if DB not available or no records
        const mem = store.getHistory(from, to, city);
        if (format === 'points') {
          const points = (mem.segments || []).map(s => ({
            id: s.id,
            coordinates: s.coordinates,
            speedKph: s.avgSpeedKph ?? null,
            congestion: s.avgCongestion ?? null,
            densityVpkm: s.avgDensityVpkm ?? null,
            samples: s.samples ?? 0,
          }));
          logger.info({
            msg: 'Memory history served (points)',
            route: '/api/traffic/history',
            mode: 'memory',
            city,
            count: mem.count,
            from: mem.from,
            to: mem.to
          });
          return res.status(200).json({
            city: mem.city,
            from: mem.from,
            to: mem.to,
            count: mem.count,
            format: 'points',
            points
          });
        }
        logger.info({
          msg: 'Memory history served',
          route: '/api/traffic/history',
          mode: 'memory',
          city,
          count: mem.count,
          from: mem.from,
          to: mem.to
        });
        return res.status(200).json(mem);
      }

      if (format === 'points') {
        const points = (data.segments || []).map(s => ({
          id: s.id,
          coordinates: s.coordinates,
          speedKph: s.avgSpeedKph ?? null,
          congestion: s.avgCongestion ?? null,
          densityVpkm: s.avgDensityVpkm ?? null,
          samples: s.samples ?? 0,
        }));
        logger.info({
          msg: 'DB history served (points)',
          route: '/api/traffic/history',
          mode: 'db',
          city: data.city,
          count: data.count,
          from: data.from,
          to: data.to
        });
        return res.status(200).json({
          city: data.city,
          from: data.from,
          to: data.to,
          count: data.count,
          format: 'points',
          points
        });
      }
      logger.info({
        msg: 'DB history served',
        route: '/api/traffic/history',
        mode: 'db',
        city: data.city,
        count: data.count,
        from: data.from,
        to: data.to
      });
      return res.status(200).json(data);
    } catch (err) {
      const status = err.status || 500;
      logger.error({
        msg: 'History endpoint error',
        route: '/api/traffic/history',
        city: req?.query?.city || DEFAULT_CITY,
        error: err.message,
        status
      });
      res.status(status).json({ error: { code: err.code || 'INTERNAL', message: err.message || 'History error' } });
    }
  }

  // PUBLIC_INTERFACE
  async predict(req, res) {
    /** Returns short-term predicted traffic for given horizonMinutes (default 15) with city selection.
     * Uses trend-based projection from last up to 10 samples (per city/segment) with 5-minute intervals.
     * Falls back to simulated predictor if DB and memory are empty.
     */
    try {
      const horizonStr = req.query.horizonMinutes;
      let horizon = 15;
      if (horizonStr !== undefined) {
        const parsed = Number(horizonStr);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 120) {
          return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'horizonMinutes must be 1..120' } });
        }
        horizon = Math.floor(parsed);
      }
      const v = validateCity(req.query.city);
      if (!v.valid) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: v.error } });
      }
      const city = v.normalized || normalizeCity(req.query.city || DEFAULT_CITY);

      // Delegate to services layer trend predictor
      const data = await store.predictTrendBased(horizon, city);

      logger.info({
        msg: 'Prediction served',
        route: '/api/traffic/predict',
        city,
        horizonMinutes: horizon,
        mode: data?.meta?.mode || 'unknown',
        pointsPerSeries: data?.timeSeries?.[0]?.points?.length || 0
      });

      res.status(200).json(data);
    } catch (err) {
      logger.error({
        msg: 'Prediction endpoint error',
        route: '/api/traffic/predict',
        city: req?.query?.city || DEFAULT_CITY,
        error: err.message
      });
      res.status(500).json({ error: { message: 'Prediction error' } });
    }
  }
}

module.exports = new TrafficController();
