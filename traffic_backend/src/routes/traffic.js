'use strict';

const express = require('express');
const trafficController = require('../controllers/traffic');

const router = express.Router();

/**
 * @openapi
 * /api/traffic/live:
 *   get:
 *     summary: Get live traffic snapshot (real when TOMTOM_API_KEY is set, else simulated)
 *     description: |
 *       Returns a live traffic snapshot for the requested city. When TOMTOM_API_KEY is configured,
 *       the snapshot is sourced from TomTom Traffic Flow; otherwise it is simulated.
 *       The "incidents" array is always present (reserved for future use).
 *       Each feature contains lat, lon (first coordinate), congestion, and densityVpkm fields.
 *     tags: [Traffic]
 *     parameters:
 *       - $ref: '#/components/parameters/CityParam'
 *     responses:
 *       200:
 *         description: Live traffic data for map overlays.
 *       400:
 *         description: Validation error (e.g., invalid city)
 */
router.get('/live', trafficController.live.bind(trafficController));

/**
 * @openapi
 * /api/traffic/history:
 *   get:
 *     summary: Get traffic history (last 60 minutes by default; DB-backed when available)
 *     description: |
 *       If MongoDB is configured, returns aggregated history from the last persisted records or filters by time range when `from`/`to` are provided.
 *       When parameters are omitted, the default window is the last 60 minutes.
 *       Falls back to in-memory/local JSON aggregation when DB is not available.
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
 *       - $ref: '#/components/parameters/CityParam'
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [points]
 *         description: When set to 'points', returns { format: 'points', points: [{ timestamp, congestion }] } suitable for Recharts line charts
 *     responses:
 *       200:
 *         description: Aggregated history or points format based on query
 *       400:
 *         description: Validation error (e.g., invalid city or invalid timestamps)
 */
router.get('/history', trafficController.history.bind(trafficController));

/**
 * @openapi
 * /api/traffic/predict:
 *   get:
 *     summary: Get short-term traffic predictions (default 30 minutes)
 *     description: |
 *       Returns predicted traffic for the specified horizon in minutes for a given city (default 30).
 *       Horizon must be within 1..120 minutes. City must be one of the allowed enum values.
 *       Response includes timeSeries points per 5-minute steps, each with { timestamp, speedKph, densityVpkm, congestion } for Recharts.
 *     tags: [Traffic]
 *     parameters:
 *       - in: query
 *         name: horizonMinutes
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 120
 *         description: Prediction horizon in minutes (default 15)
 *       - $ref: '#/components/parameters/CityParam'
 *     responses:
 *       200:
 *         description: Predicted traffic snapshot
 *       400:
 *         description: Validation error (e.g., invalid horizon or city)
 */
router.get('/predict', trafficController.predict.bind(trafficController));

module.exports = router;
