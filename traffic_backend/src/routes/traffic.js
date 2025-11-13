'use strict';

const express = require('express');
const trafficController = require('../controllers/traffic');

const router = express.Router();

/**
 * @openapi
 * /api/traffic/live:
 *   get:
 *     summary: Get live traffic snapshot (simulated)
 *     tags: [Traffic]
 *     responses:
 *       200:
 *         description: Live traffic data for map overlays.
 */
router.get('/live', trafficController.live.bind(trafficController));

/**
 * @openapi
 * /api/traffic/history:
 *   get:
 *     summary: Get aggregated traffic history between timestamps
 *     tags: [Traffic]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO timestamp start
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO timestamp end
 *     responses:
 *       200:
 *         description: Aggregated history
 *       400:
 *         description: Validation error
 */
router.get('/history', trafficController.history.bind(trafficController));

/**
 * @openapi
 * /api/traffic/predict:
 *   get:
 *     summary: Get short-term traffic predictions (simulated)
 *     tags: [Traffic]
 *     parameters:
 *       - in: query
 *         name: horizonMinutes
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 120
 *         description: Prediction horizon in minutes (default 15)
 *     responses:
 *       200:
 *         description: Predicted traffic snapshot
 *       400:
 *         description: Validation error
 */
router.get('/predict', trafficController.predict.bind(trafficController));

module.exports = router;
