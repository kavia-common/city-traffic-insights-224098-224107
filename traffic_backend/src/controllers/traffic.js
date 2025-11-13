'use strict';

const { store, getDbHistory } = require('../services/traffic');
const logger = require('../logger');

/**
 * Controller for traffic endpoints: live, history, predict.
 */
class TrafficController {
  // PUBLIC_INTERFACE
  live(req, res) {
    /** Returns live traffic snapshot suitable for map overlays (LineString-like). */
    try {
      const snapshot = store.getLiveSnapshot();
      logger.debug({ msg: 'live snapshot generated', count: snapshot.features.length });
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
     */
    try {
      const { from, to } = req.query;

      if (from && isNaN(Date.parse(from))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid from timestamp' } });
      }
      if (to && isNaN(Date.parse(to))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid to timestamp' } });
      }

      // Try DB-backed history
      let data = null;
      try {
        data = await getDbHistory({ fromISO: from, toISO: to, limit: 50, city: 'Bangalore' });
      } catch (dbErr) {
        logger.warn({ msg: 'DB history retrieval failed, falling back to memory', error: dbErr.message });
      }

      if (!data || (data && data.count === 0)) {
        // Fallback to in-memory if DB not available or no records
        const mem = store.getHistory(from, to);
        // Align shape roughly (avgDensity absent in DB aggregation; keep mem fields)
        return res.status(200).json(mem);
      }

      return res.status(200).json(data);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: { code: err.code || 'INTERNAL', message: err.message || 'History error' } });
    }
  }

  // PUBLIC_INTERFACE
  predict(req, res) {
    /** Returns short-term predicted traffic for given horizonMinutes (default 15) */
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
      const data = store.predictShortTerm(horizon);
      res.status(200).json(data);
    } catch (err) {
      res.status(500).json({ error: { message: 'Prediction error' } });
    }
  }
}

module.exports = new TrafficController();
