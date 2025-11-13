'use strict';

const logger = require('../logger');
const TrafficRecord = require('../models/TrafficRecord');

// Rough bounding box around Bangalore (approx)
const BBOX = {
  minLat: 12.85,
  maxLat: 13.12,
  minLng: 77.45,
  maxLng: 77.75
};

// Build a set of simulated road segments between random nearby coordinates
function generateSegments(seed = 24) {
  const segments = [];
  const rng = mulberry32(seed);
  const count = 120; // number of segments for decent coverage
  for (let i = 0; i < count; i++) {
    const lat1 = lerp(BBOX.minLat, BBOX.maxLat, rng());
    const lng1 = lerp(BBOX.minLng, BBOX.maxLng, rng());
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

// In-memory datastore for the session
class TrafficStore {
  constructor() {
    this.segments = generateSegments(Date.now() % 100000);
    this.history = []; // { timestamp, features: [...] }
  }

  // Simulate live data based on time-of-day and random noise
  getLiveSnapshot() {
    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();

    // Traffic pattern: peak at 9:00 and 18:00, low at night
    const peak1 = gaussianPeak(minuteOfDay, 9 * 60, 120);
    const peak2 = gaussianPeak(minuteOfDay, 18 * 60, 120);
    const pattern = Math.min(1, peak1 + peak2 + 0.2); // ensure some base flow

    const features = this.segments.map(seg => {
      const noise = (Math.random() - 0.5) * 0.2;
      const density = Math.max(5, seg.baseDensity * (0.6 + pattern + noise)); // vehicles/km
      // Simple speed model inverse to density
      const speed = Math.max(5, seg.baseSpeedKph * (1.2 - 0.6 * (density / (seg.baseDensity + 30))));
      const congestion = Number((density / 80 + (1 - speed / 80)) / 2).toFixed(3); // 0..1 approximate

      return {
        id: seg.id,
        coordinates: seg.coordinates,
        speedKph: Number(speed.toFixed(2)),
        densityVpkm: Number(density.toFixed(2)),
        congestion: Math.max(0, Math.min(1, parseFloat(congestion))),
      };
    });

    const snapshot = {
      city: 'Bangalore',
      timestamp: now.toISOString(),
      features
    };

    // Store in history (keep last 500)
    this.history.push(snapshot);
    if (this.history.length > 500) {
      this.history.splice(0, this.history.length - 500);
    }

    // Best-effort persistence to MongoDB: create one record per segment
    // Non-blocking: do not await the full bulk insert for response path speed; log errors.
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
        // Use insertMany with ordered:false for resilience
        await TrafficRecord.insertMany(docs, { ordered: false });
      } catch (err) {
        logger.warn({ msg: 'Persist live snapshot failed', error: err.message });
      }
    })();

    return snapshot;
  }

  // Return aggregated history in a time range (in-memory fallback)
  getHistory(fromISO, toISO) {
    const from = fromISO ? new Date(fromISO).getTime() : 0;
    const to = toISO ? new Date(toISO).getTime() : Date.now();
    if (Number.isNaN(from) || Number.isNaN(to)) {
      const err = new Error('Invalid from/to timestamps');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }

    const samples = this.history.filter(s => {
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
      city: 'Bangalore',
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      count: samples.length,
      segments: aggregated
    };
  }

  // PUBLIC_INTERFACE
  async getDbHistory({ fromISO, toISO, limit = 50, city = 'Bangalore' } = {}) {
    /**
     * Fetches last N persisted records (or range) from MongoDB and returns a response:
     * { city, from, to, count, segments: [{ id, coordinates, avgSpeedKph, avgCongestion, samples }] }
     */
    const query = { city };
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
      // prefer to keep coordinates as first seen
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
      city,
      from: minT ? new Date(minT).toISOString() : (fromISO || null),
      to: maxT ? new Date(maxT).toISOString() : (toISO || null),
      count: docs.length,
      segments
    };
  }

  // Very simple prediction: trend + time-of-day pattern adjustment
  predictShortTerm(horizonMinutes = 15) {
    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const pattern = Math.min(1, gaussianPeak(minuteOfDay + horizonMinutes, 9 * 60, 120) +
      gaussianPeak(minuteOfDay + horizonMinutes, 18 * 60, 120) + 0.2);

    // last sample or synthetic
    const latest = this.history[this.history.length - 1] || this.getLiveSnapshot();

    const features = latest.features.map(f => {
      // drift a little towards upcoming pattern: more density during peak leads to lower speeds
      const driftDensity = f.densityVpkm * (0.9 + 0.3 * pattern);
      const predictedDensity = Math.max(5, driftDensity + (Math.random() - 0.5) * 2);
      const predictedSpeed = Math.max(5, f.speedKph * (1.05 - 0.3 * pattern) + (Math.random() - 0.5) * 2);
      const congestion = Number((predictedDensity / 80 + (1 - predictedSpeed / 80)) / 2).toFixed(3);

      return {
        id: f.id,
        coordinates: f.coordinates,
        speedKph: Number(predictedSpeed.toFixed(2)),
        densityVpkm: Number(predictedDensity.toFixed(2)),
        congestion: Math.max(0, Math.min(1, parseFloat(congestion))),
      };
    });

    return {
      city: 'Bangalore',
      timestamp: now.toISOString(),
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
};
