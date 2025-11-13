'use strict';

const logger = require('../logger');
const TrafficRecord = require('../models/TrafficRecord');
const { fetchRealTimeCity } = require('./realTrafficService');

/**
 * Supported cities and their rough bounding boxes (used for simulation fallback).
 * Each city's simulated road network is generated once and then reused while live values
 * (avgSpeed, congestion, density) are updated by a background scheduler every 10 seconds.
 */
const CITY_BBOX = {
  Bangalore: { minLat: 12.85, maxLat: 13.12, minLng: 77.45, maxLng: 77.75 },
  Mumbai: { minLat: 18.88, maxLat: 19.30, minLng: 72.75, maxLng: 72.99 },
  Delhi: { minLat: 28.40, maxLat: 28.88, minLng: 76.90, maxLng: 77.40 },
};

const DEFAULT_CITY = 'Bangalore';

/**
 * PUBLIC_INTERFACE
 * normalizeCity
 * Normalize a city input into one of the supported enum values.
 */
function normalizeCity(input) {
  if (!input) return DEFAULT_CITY;
  const v = String(input).trim().toLowerCase();
  if (v === 'bangalore' || v === 'blr') return 'Bangalore';
  if (v === 'mumbai' || v === 'bom') return 'Mumbai';
  if (v === 'delhi' || v === 'ncr') return 'Delhi';
  return DEFAULT_CITY;
}

/**
 * PUBLIC_INTERFACE
 * validateCity
 * Validate raw city input against allowed enum values.
 * Returns { valid: boolean, normalized?: string, error?: string }
 */
function validateCity(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    // Missing means default is allowed
    return { valid: true, normalized: DEFAULT_CITY };
  }
  const normalized = normalizeCity(raw);
  const allowed = ['Bangalore', 'Mumbai', 'Delhi'];
  if (!allowed.includes(normalized)) {
    const msg = 'city must be one of: Bangalore, Mumbai, Delhi';
    return { valid: false, error: msg };
  }
  return { valid: true, normalized };
}

// Build a set of simulated road segments between random nearby coordinates for a city
function generateSegmentsForCity(city, seed = 24) {
  const bbox = CITY_BBOX[city] || CITY_BBOX[DEFAULT_CITY];
  const segments = [];
  const rng = mulberry32(seed);
  const count = 120; // number of segments for decent coverage per city
  for (let i = 0; i < count; i++) {
    const lat1 = lerp(bbox.minLat, bbox.maxLat, rng());
    const lng1 = lerp(bbox.minLng, bbox.maxLng, rng());
    const lat2 = lat1 + (rng() - 0.5) * 0.01; // ~1km variation
    const lng2 = lng1 + (rng() - 0.5) * 0.01;

    const id = `seg_${i}`;
    segments.push({
      id,
      coordinates: [
        [lng1, lat1],
        [lng2, lat2]
      ],
      baseSpeedKph: 30 + Math.floor(rng() * 40), // base speed 30-70
      baseDensity: 10 + Math.floor(rng() * 40), // base vehicles per km
    });
  }
  return segments;
}

// PRNG for deterministic generation
function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }

// In-memory datastore keyed by city for the session
class TrafficStore {
  constructor() {
    this.cities = new Map(); // city -> { segments, history: [], lastSnapshot }
    // Pre-seed supported cities for deterministic segment generation per city
    for (const city of Object.keys(CITY_BBOX)) {
      this._ensureCity(city);
    }

    // Start periodic updater for simulated snapshots every 10 seconds (hard requirement)
    this._tickIntervalMs = 10_000;
    this._startScheduler();
  }

  _ensureCity(city) {
    const normalized = normalizeCity(city);
    if (!this.cities.has(normalized)) {
      const seed = (Date.now() % 100000) + normalized.length * 9973;
      this.cities.set(normalized, {
        segments: generateSegmentsForCity(normalized, seed),
        history: [],
        lastSnapshot: null
      });
    }
    return this.cities.get(normalized);
  }

  /**
   * Starts a background scheduler that updates each city's simulated snapshot every 10 seconds.
   * - Randomizes avgSpeed and congestion per segment in a realistic manner.
   * - Persists best-effort to MongoDB (no-fail).
   * - Maintains recent history in-memory for /api/traffic/history fallback.
   */
  _startScheduler() {
    setInterval(() => {
      try {
        Object.keys(CITY_BBOX).forEach((city) => {
          // In real-data mode, don't auto-fetch; we still keep history for any prior snapshots.
          if (process.env.TOMTOM_API_KEY) {
            return;
          }
          const snapshot = this._buildSimulatedSnapshot(city);
          const ctx = this._ensureCity(city);
          ctx.lastSnapshot = snapshot;
          ctx.history.push(snapshot);
          if (ctx.history.length > 500) ctx.history.splice(0, ctx.history.length - 500);

          // Persist best-effort to MongoDB: insert one doc per segment for the tick
          (async () => {
            try {
              const docs = snapshot.features.map(f => ({
                segmentId: f.id,
                location: { type: 'LineString', coordinates: f.coordinates },
                avgSpeed: f.speedKph,
                congestionLevel: f.congestion,
                timestamp: new Date(snapshot.timestamp),
                city: snapshot.city,
              }));
              await TrafficRecord.insertMany(docs, { ordered: false });
            } catch (err) {
              // Do not fail scheduler if DB unavailable
              logger.warn({ msg: 'Persist scheduled snapshot failed', error: err.message });
            }
          })();
        });
      } catch (e) {
        logger.error({ msg: 'Scheduled simulation update error', error: e.message });
      }
    }, this._tickIntervalMs);
  }

  /**
   * Builds a single simulated snapshot for a city with per-segment randomization.
   * Period-of-day pattern drives density and speed, plus short-term randomness (noise).
   */
  _buildSimulatedSnapshot(cityInput) {
    const city = normalizeCity(cityInput);
    const ctx = this._ensureCity(city);

    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();

    // Traffic pattern: peaks near 9:00 and 18:00, low at night
    const peak1 = gaussianPeak(minuteOfDay, 9 * 60, 120);
    const peak2 = gaussianPeak(minuteOfDay, 18 * 60, 120);
    const pattern = Math.min(1, peak1 + peak2 + 0.2); // ensure some base flow

    const features = ctx.segments.map(seg => {
      // Per-tick random variance to keep values changing every 10s
      const noise = (Math.random() - 0.5) * 0.3; // ±0.15 influence
      const density = Math.max(5, seg.baseDensity * (0.6 + pattern + noise)); // vehicles/km
      // Speed inversely related to density with a cap/floor
      const speed = Math.max(5, seg.baseSpeedKph * (1.25 - 0.65 * (density / (seg.baseDensity + 30))));
      // Approximate congestion from density and speed; clamp to [0,1]
      const rawCong = (density / 80 + (1 - speed / 80)) / 2;
      const congestion = Math.max(0, Math.min(1, Number(rawCong.toFixed(3))));

      return {
        id: seg.id,
        coordinates: seg.coordinates,
        speedKph: Number(speed.toFixed(2)),
        densityVpkm: Number(density.toFixed(2)),
        congestion,
      };
    });

    return {
      city,
      timestamp: now.toISOString(),
      features,
      incidents: [],
      source: 'simulated',
    };
  }

  /**
   * PUBLIC_INTERFACE
   * getLiveSnapshot
   * Returns the latest snapshot for the given city.
   * - In real mode (TOMTOM_API_KEY set), fetches on demand from TomTom and updates memory/history.
   * - In simulation mode, returns the latest scheduled snapshot (or generates one immediately if none).
   */
  async getLiveSnapshot(cityInput) {
    const city = normalizeCity(cityInput);

    // Real data mode: on-demand fetch, then persist and record history
    if (process.env.TOMTOM_API_KEY) {
      try {
        const tt = await fetchRealTimeCity(city);
        const ctx = this._ensureCity(city);
        ctx.lastSnapshot = tt;
        ctx.history.push(tt);
        if (ctx.history.length > 500) ctx.history.splice(0, ctx.history.length - 500);
        return tt;
      } catch (e) {
        logger.warn({ msg: 'TomTom real data failed, falling back to simulation', city, error: e.message });
      }
    }

    // Simulation mode: serve the most recent scheduled snapshot; if none yet, create one now
    const ctx = this._ensureCity(city);
    if (!ctx.lastSnapshot) {
      const snap = this._buildSimulatedSnapshot(city);
      ctx.lastSnapshot = snap;
      ctx.history.push(snap);
      if (ctx.history.length > 500) ctx.history.splice(0, ctx.history.length - 500);
      // Best-effort persistence for this first immediate snapshot
      (async () => {
        try {
          const docs = snap.features.map(f => ({
            segmentId: f.id,
            location: { type: 'LineString', coordinates: f.coordinates },
            avgSpeed: f.speedKph,
            congestionLevel: f.congestion,
            timestamp: new Date(snap.timestamp),
            city: snap.city,
          }));
          await TrafficRecord.insertMany(docs, { ordered: false });
        } catch (err) {
          logger.warn({ msg: 'Persist initial simulated snapshot failed', error: err.message });
        }
      })();
    }
    return ctx.lastSnapshot;
  }

  // PUBLIC_INTERFACE
  // Return aggregated history in a time range (in-memory fallback) for a city
  /**
   * Returns default aggregated history format:
   * { city, from, to, count, segments: [{ id, coordinates, avgSpeedKph, avgDensityVpkm, avgCongestion, samples }] }
   * Note: format=points is handled at controller level for response shaping; this method always returns the default aggregate.
   */
  getHistory(fromISO, toISO, cityInput) {
    const city = normalizeCity(cityInput);
    const ctx = this._ensureCity(city);
    const from = fromISO ? new Date(fromISO).getTime() : 0;
    const to = toISO ? new Date(toISO).getTime() : Date.now();
    if (Number.isNaN(from) || Number.isNaN(to)) {
      const err = new Error('Invalid from/to timestamps');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }

    const samples = ctx.history.filter(s => {
      const t = new Date(s.timestamp).getTime();
      return t >= from && t <= to;
    });

    // Aggregate by averaging speed and density per segment
    const byId = new Map();
    samples.forEach(s => {
      s.features.forEach(f => {
        const v = byId.get(f.id) || { id: f.id, coordinates: f.coordinates, speedSum: 0, densitySum: 0, congestionSum: 0, n: 0 };
        v.speedSum += f.speedKph;
        v.densitySum += f.densityVpkm;
        v.congestionSum += f.congestion;
        v.n += 1;
        byId.set(f.id, v);
      });
    });

    const aggregated = Array.from(byId.values()).map(v => ({
      id: v.id,
      coordinates: v.coordinates,
      avgSpeedKph: v.n ? Number((v.speedSum / v.n).toFixed(2)) : null,
      avgDensityVpkm: v.n ? Number((v.densitySum / v.n).toFixed(2)) : null,
      avgCongestion: v.n ? Number((v.congestionSum / v.n).toFixed(3)) : null,
      samples: v.n
    }));

    return {
      city,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      count: samples.length,
      segments: aggregated
    };
  }

  /**
   * PUBLIC_INTERFACE
   * getDbHistory
   * Fetches last N persisted records (or range) from MongoDB and returns a default aggregated response:
   * { city, from, to, count, segments: [{ id, coordinates, avgSpeedKph, avgCongestion, samples }] }
   * The controller may transform this to format=points on request; this method always returns the default aggregate.
   */
  async getDbHistory({ fromISO, toISO, limit = 50, city = DEFAULT_CITY } = {}) {
    const normalized = normalizeCity(city);
    const query = { city: normalized };
    if (fromISO || toISO) {
      query.timestamp = {};
      if (fromISO) query.timestamp.$gte = new Date(fromISO);
      if (toISO) query.timestamp.$lte = new Date(toISO);
    }

    const cursor = TrafficRecord.find(query)
      .sort({ timestamp: -1 })
      .limit(limit);

    const docs = await cursor.exec();

    // Aggregate by segmentId
    const byId = new Map();
    let minT = null;
    let maxT = null;
    for (const d of docs) {
      const id = d.segmentId;
      const ts = d.timestamp.getTime();
      if (minT === null || ts < minT) minT = ts;
      if (maxT === null || ts > maxT) maxT = ts;

      const v = byId.get(id) || {
        id,
        coordinates: d.location?.coordinates || [],
        speedSum: 0,
        congestionSum: 0,
        n: 0,
      };
      v.speedSum += d.avgSpeed;
      v.congestionSum += d.congestionLevel;
      v.n += 1;
      byId.set(id, v);
    }

    const segments = Array.from(byId.values()).map(v => ({
      id: v.id,
      coordinates: v.coordinates,
      avgSpeedKph: v.n ? Number((v.speedSum / v.n).toFixed(2)) : null,
      avgCongestion: v.n ? Number((v.congestionSum / v.n).toFixed(3)) : null,
      samples: v.n
    }));

    return {
      city: normalized,
      from: minT ? new Date(minT).toISOString() : (fromISO || null),
      to: maxT ? new Date(maxT).toISOString() : (toISO || null),
      count: docs.length,
      segments
    };
  }

  /**
   * PUBLIC_INTERFACE
   * predictShortTerm
   * Very simple prediction: trend + time-of-day pattern adjustment with slight random drift.
   */
  predictShortTerm(horizonMinutes = 15, cityInput) {
    const city = normalizeCity(cityInput);
    const ctx = this._ensureCity(city);
    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const pattern = Math.min(1, gaussianPeak(minuteOfDay + horizonMinutes, 9 * 60, 120) +
      gaussianPeak(minuteOfDay + horizonMinutes, 18 * 60, 120) + 0.2);

    // last sample for the city or synthetic
    const latest = ctx.history[ctx.history.length - 1] || null;

    const baseSnapshot = latest;
    const features = (baseSnapshot?.features || ctx.segments.map(seg => ({
      id: seg.id,
      coordinates: seg.coordinates,
      speedKph: seg.baseSpeedKph,
      densityVpkm: seg.baseDensity,
      congestion: 0.3,
    }))).map(f => {
      // drift a little towards upcoming pattern: more density during peak leads to lower speeds
      const driftDensity = f.densityVpkm * (0.9 + 0.3 * pattern);
      const predictedDensity = Math.max(5, driftDensity + (Math.random() - 0.5) * 2);
      const predictedSpeed = Math.max(5, f.speedKph * (1.05 - 0.3 * pattern) + (Math.random() - 0.5) * 2);
      const rawCong = (predictedDensity / 80 + (1 - predictedSpeed / 80)) / 2;
      const congestion = Math.max(0, Math.min(1, Number(rawCong.toFixed(3))));

      return {
        id: f.id,
        coordinates: f.coordinates,
        speedKph: Number(predictedSpeed.toFixed(2)),
        densityVpkm: Number(predictedDensity.toFixed(2)),
        congestion,
      };
    });

    return {
      city,
      timestamp: new Date().toISOString(),
      horizonMinutes,
      features
    };
  }
}

// Gaussian-like peak function
function gaussianPeak(x, center, width) {
  const diff = x - center;
  return Math.exp(-(diff * diff) / (2 * width * width));
}

const store = new TrafficStore();

module.exports = {
  store,
  getDbHistory: store.getDbHistory.bind(store),
  normalizeCity,
  DEFAULT_CITY,
  validateCity,
};
