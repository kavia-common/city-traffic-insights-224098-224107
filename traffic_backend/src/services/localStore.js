'use strict';

/**
 * Local JSON store fallback when MongoDB is not configured.
 * Persists snapshots per city to a small rolling file under data/local_traffic_<city>.json
 * Provides append and query (range) operations.
 *
 * Files are kept small by truncating to last MAX_RECORDS entries per city.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MAX_RECORDS = 1200; // enough for ~2-3 hours at 10s intervals

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch {
    // ignore
  }
}

function fileForCity(city) {
  ensureDir();
  const safe = city.replace(/[^a-z0-9_-]/gi, '_');
  return path.join(DATA_DIR, `local_traffic_${safe}.json`);
}

/**
 * Append a snapshot to local JSON file for a city (best effort).
 * Snapshot shape expected:
 * {
 *   city, timestamp, features: [{ id, coordinates, speedKph, densityVpkm, congestion }]
 * }
 */
function appendSnapshot(snapshot) {
  try {
    if (!snapshot || !snapshot.city || !snapshot.timestamp) return;
    const file = fileForCity(snapshot.city);
    let entries = [];
    if (fs.existsSync(file)) {
      try {
        entries = JSON.parse(fs.readFileSync(file, 'utf8')) || [];
      } catch {
        entries = [];
      }
    }
    entries.push(snapshot);
    if (entries.length > MAX_RECORDS) {
      entries = entries.slice(entries.length - MAX_RECORDS);
    }
    fs.writeFileSync(file, JSON.stringify(entries));
  } catch {
    // best effort only
  }
}

/**
 * Query snapshots by [from, to] ISO for a city.
 * Returns array of raw snapshots within the time window.
 */
function querySnapshots(city, fromISO, toISO) {
  try {
    const file = fileForCity(city);
    if (!fs.existsSync(file)) return [];
    const entries = JSON.parse(fs.readFileSync(file, 'utf8')) || [];
    const from = fromISO ? new Date(fromISO).getTime() : 0;
    const to = toISO ? new Date(toISO).getTime() : Date.now();
    if (Number.isNaN(from) || Number.isNaN(to)) return [];
    return entries.filter(e => {
      const t = new Date(e.timestamp).getTime();
      return t >= from && t <= to;
    });
  } catch {
    return [];
  }
}

module.exports = {
  appendSnapshot,
  querySnapshots,
};
