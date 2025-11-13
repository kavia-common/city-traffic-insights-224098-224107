'use strict';

const { store, getDbHistory, normalizeCity, DEFAULT_CITY, validateCity } = require('../services/traffic');
const logger = require('../logger');

/**
 * Controller for traffic endpoints: live, history, predict.
 */
class TrafficController {
  // PUBLIC_INTERFACE
  async live(req, res) {
    /**
     * Returns live traffic snapshot suitable for map overlays (LineString-like).
     * Response normalization:
     * - features[].lat, features[].lon included (first coordinate)
     * - features[].congestion and features[].densityVpkm always present
     */
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
      // Normalize features to include lat/lon
      snapshot.features = (snapshot.features || []).map(f => {
        if (typeof f.lat === 'number' && typeof f.lon === 'number') return f;
        const first = (f.coordinates && f.coordinates[0]) || [null, null];
        return { ...f, lon: first[0], lat: first[1] };
      });
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
      let { from, to } = req.query;
      const v = validateCity(req.query.city);
      if (!v.valid) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: v.error } });
      }
      const city = v.normalized || normalizeCity(req.query.city || DEFAULT_CITY);
      const format = (req.query.format || '').toString().toLowerCase();

      // Default to last 60 minutes if not provided
      if (!from && !to) {
        const now = Date.now();
        from = new Date(now - 60 * 60 * 1000).toISOString();
        to = new Date(now).toISOString();
      }

      if (from && isNaN(Date.parse(from))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid from timestamp' } });
      }
      if (to && isNaN(Date.parse(to))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid to timestamp' } });
      }

      // Try DB-backed history
      let data = null;
      try {
        data = await getDbHistory({ fromISO: from, toISO: to, limit: 500, city });
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

      // Helper to produce Recharts-friendly points:
      // Return array of { timestamp, congestion } averaged across segments per snapshot interval.
      const toRechartsPoints = (aggregated) => {
        // We only have aggregated per-segment averages. Construct a synthetic time series by sampling
        // equally spaced points between from..to using available segment averages as baseline.
        // For simple analytics, map segments' avgCongestion into an overall average per time bucket.
        const fromMs = Date.parse(aggregated.from);
        const toMs = Date.parse(aggregated.to);
        const step = Math.max(1, Math.floor((toMs - fromMs) / (60 * 1000))); // ~1 minute resolution
        const buckets = [];
        const overall = (aggregated.segments || []);
        const avgCong = overall.length
          ? Number((overall.map(s => s.avgCongestion || 0).reduce((a, b) => a + b, 0) / overall.length).toFixed(3))
          : 0.0;

        for (let i = 0; i <= 60; i++) {
          const ts = new Date(fromMs + i * 60_000).toISOString();
          buckets.push({ timestamp: ts, congestion: avgCong });
        }
        return buckets;
      };

      if (!data || (data && data.count === 0)) {
        // Fallback to in-memory if DB not available or no records
        const mem = store.getHistory(from, to, city);
        if (format === 'points') {
          const points = toRechartsPoints(mem);
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
        const points = toRechartsPoints(data);
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
    /**
     * Returns short-term predicted traffic.
     * Default horizonMinutes = 30.
     * Response includes timeSeries with points suitable for Recharts: { timestamp, speedKph, densityVpkm, congestion }.
     */
    try {
      const horizonStr = req.query.horizonMinutes;
      let horizon = 30; // default per integration requirement
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
