'use strict';

const logger = require('../logger');
const TrafficRecord = require('../models/TrafficRecord');

/**
 * RealTrafficService integrates with TomTom Traffic Flow API (flowSegmentData)
 * to fetch live traffic speeds for predefined city coordinates and normalize
 * the response to our internal format.
 *
 * It supports a best-effort persistence to MongoDB using the existing TrafficRecord model.
 *
 * Requirements:
 * - TOMTOM_API_KEY must be set in environment (.env) and available to the process.
 * - Rate limits apply as per TomTom API plan. We minimize requests by querying a single
 *   representative coordinate per city.
 */

// Coordinates (lat,lng) representative of central areas
const CITY_COORDS = {
  Bangalore: { lat: 12.9716, lng: 77.5946 },
  Mumbai: { lat: 19.0760, lng: 72.8777 },
  Delhi: { lat: 28.6139, lng: 77.2090 },
};

// TomTom API configuration
const TOMTOM_BASE = 'https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json';

/**
 * Determine congestion level from TomTom relativeSpeed and currentSpeed.
 * - relativeSpeed is current vs free-flow percentage. < 40% implies heavy congestion near 1.0
 * - Returns value in range [0..1]
 */
function inferCongestionLevel(relativeSpeed, currentSpeed) {
  try {
    if (typeof relativeSpeed === 'number') {
      const c = Math.max(0, Math.min(1, (100 - relativeSpeed) / 100));
      // Small adjustment by current speed under 20 kph
      if (typeof currentSpeed === 'number' && currentSpeed < 20) {
        return Math.min(1, c + 0.15);
      }
      return c;
    }
    if (typeof currentSpeed === 'number') {
      if (currentSpeed >= 70) return 0.05;
      if (currentSpeed >= 50) return 0.2;
      if (currentSpeed >= 30) return 0.45;
      if (currentSpeed >= 15) return 0.7;
      return 0.9;
    }
  } catch {
    // ignore and fall through
  }
  return 0.5;
}

/**
 * Map TomTom functional road class (frc) + currentSpeed into a synthetic segment ID.
 */
function buildSegmentId(city, frc, speed) {
  const frcPart = typeof frc === 'string' ? frc : (frc !== undefined ? String(frc) : 'NA');
  const sPart = Number.isFinite(speed) ? Math.round(speed) : 'NA';
  return `tt_${city}_${frcPart}_${sPart}`;
}

/**
 * Fetch flowSegmentData from TomTom for a given city.
 * Returns normalized snapshot:
 * {
 *   city, timestamp, features: [{
 *     id, coordinates: [[lng,lat],[lng,lat]], speedKph, densityVpkm, congestion
 *   }]
 * }
 *
 * Note: TomTom returns a single road segment near the queried point. We wrap it as
 * our features array. densityVpkm is not provided by TomTom; we approximate from speed.
 */
async function fetchRealTimeCity(city) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    const err = new Error('TOMTOM_API_KEY not configured');
    err.code = 'CONFIG_MISSING';
    err.status = 503;
    throw err;
  }

  const coords = CITY_COORDS[city];
  if (!coords) {
    const err = new Error(`Unsupported city ${city}`);
    err.code = 'UNSUPPORTED_CITY';
    err.status = 400;
    throw err;
  }

  const url = `${TOMTOM_BASE}?key=${encodeURIComponent(apiKey)}&point=${coords.lat}%2C${coords.lng}`;

  const started = Date.now();
  let data;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json'
      }
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`TomTom API error: ${res.status} ${res.statusText}`);
      err.status = res.status;
      err.code = 'UPSTREAM_ERROR';
      // Avoid logging API key; mask potential secrets
      logger.warn({ msg: 'TomTom non-OK response', status: res.status, statusText: res.statusText, body: text?.slice(0, 300) });
      throw err;
    }
    data = await res.json();
  } catch (e) {
    logger.error({ msg: 'TomTom fetch failed', error: e.message, durationMs: Date.now() - started });
    e.status = e.status || 502;
    e.code = e.code || 'UPSTREAM_FETCH_FAILED';
    throw e;
  }

  // Expected TomTom fields
  // {
  //   flowSegmentData: {
  //     currentSpeed, freeFlowSpeed, currentTravelTime, freeFlowTravelTime,
  //     confidence, frc, coordinates: { coordinate: [{latitude, longitude}, ...]}
  //   }
  // }
  const now = new Date();
  const seg = data?.flowSegmentData;
  if (!seg) {
    logger.warn({ msg: 'TomTom response missing flowSegmentData', rawKeys: Object.keys(data || {}) });
    const err = new Error('Malformed upstream response');
    err.code = 'UPSTREAM_MALFORMED';
    err.status = 502;
    throw err;
  }

  // coordinates to our [lng, lat] pairs; take first and last to build a simple line
  const coordsArr = Array.isArray(seg.coordinates?.coordinate) ? seg.coordinates.coordinate : [];
  const first = coordsArr[0] || { latitude: coords.lat, longitude: coords.lng };
  const last = coordsArr[coordsArr.length - 1] || first;

  const line = [
    [Number(first.longitude), Number(first.latitude)],
    [Number(last.longitude), Number(last.latitude)],
  ];

  const currentSpeed = Number(seg.currentSpeed);
  const freeFlow = Number(seg.freeFlowSpeed);
  const relative = Number.isFinite(currentSpeed) && Number.isFinite(freeFlow) && freeFlow > 0
    ? (currentSpeed / freeFlow) * 100
    : undefined;

  const congestion = inferCongestionLevel(relative, currentSpeed);

  // Density approximation: inverse of speed on a simple scale (not provided by TomTom)
  const densityVpkm = Number.isFinite(currentSpeed)
    ? Number((80 / Math.max(5, currentSpeed)).toFixed(2))
    : 20;

  const feature = {
    id: buildSegmentId(city, seg.frc, currentSpeed),
    coordinates: line,
    speedKph: Number.isFinite(currentSpeed) ? Number(currentSpeed.toFixed(2)) : null,
    densityVpkm,
    congestion: Number(congestion.toFixed(3)),
  };

  const snapshot = {
    city,
    timestamp: now.toISOString(),
    features: [feature],
    incidents: [], // reserved for future real-incident integration; keep consistent shape
    source: 'tomtom',
    meta: {
      confidence: seg.confidence,
      frc: seg.frc,
    }
  };

  // Persist best-effort to MongoDB using our normalized record (fire-and-forget)
  (async () => {
    try {
      const docs = snapshot.features.map(f => ({
        segmentId: f.id,
        location: { type: 'LineString', coordinates: f.coordinates },
        avgSpeed: f.speedKph ?? 0,
        congestionLevel: f.congestion,
        timestamp: new Date(snapshot.timestamp),
        city: snapshot.city,
      }));
      const inserted = await TrafficRecord.insertMany(docs, { ordered: false });
      logger.info({ msg: 'Persist real snapshot success', city: snapshot.city, timestamp: snapshot.timestamp, insertedCount: inserted?.length ?? docs.length });
    } catch (err) {
      logger.warn({ msg: 'Persist real snapshot failed', city: snapshot.city, error: err.message });
    }
  })();

  logger.info({ msg: 'TomTom snapshot fetched', city, durationMs: Date.now() - started });
  return snapshot;
}

module.exports = {
  fetchRealTimeCity,
  CITY_COORDS,
};
