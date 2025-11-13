'use strict';

const { store } = require('../services/traffic');
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
  history(req, res) {
    /** Returns aggregated traffic history between from and to ISO timestamps */
    try {
      const { from, to } = req.query;

      if (from && isNaN(Date.parse(from))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid from timestamp' } });
      }
      if (to && isNaN(Date.parse(to))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid to timestamp' } });
      }
      const data = store.getHistory(from, to);
      res.status(200).json(data);
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
