'use strict';

const { store, getDbHistory, normalizeCity, DEFAULT_CITY } = require('../services/traffic');
const logger = require('../logger');

/**
 * Controller for traffic endpoints: live, history, predict.
 */
class TrafficController {
  // PUBLIC_INTERFACE
  async live(req, res) {
    /** Returns live traffic snapshot suitable for map overlays (LineString-like). */
    try {
      const city = normalizeCity(req.query.city);
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
      const city = normalizeCity(req.query.city || DEFAULT_CITY);
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
      } catch (dbErr) {
        logger.warn({ msg: 'DB history retrieval failed, falling back to memory', error: dbErr.message, city });
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
          return res.status(200).json({
            city: mem.city,
            from: mem.from,
            to: mem.to,
            count: mem.count,
            format: 'points',
            points
          });
        }
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
        return res.status(200).json({
          city: data.city,
          from: data.from,
          to: data.to,
          count: data.count,
          format: 'points',
          points
        });
      }
      return res.status(200).json(data);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: { code: err.code || 'INTERNAL', message: err.message || 'History error' } });
    }
  }

  // PUBLIC_INTERFACE
  predict(req, res) {
    /** Returns short-term predicted traffic for given horizonMinutes (default 15) with city selection */
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
      const city = normalizeCity(req.query.city || DEFAULT_CITY);
      const data = store.predictShortTerm(horizon, city);
      res.status(200).json(data);
    } catch (err) {
      res.status(500).json({ error: { message: 'Prediction error' } });
    }
  }
}

module.exports = new TrafficController();
