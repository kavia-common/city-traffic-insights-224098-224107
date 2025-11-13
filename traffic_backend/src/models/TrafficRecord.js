'use strict';

const mongoose = require('mongoose');

/**
 * TrafficRecord schema
 * - segmentId: string (road segment identifier)
 * - location: { type: 'LineString', coordinates: [[lng, lat], [lng, lat]] }
 * - avgSpeed: number (kph)
 * - congestionLevel: number (0..1)
 * - timestamp: Date (indexed, used for history retrieval)
 * - city: optional string for future multi-city support
 */
const TrafficRecordSchema = new mongoose.Schema(
  {
    segmentId: { type: String, required: true, index: true },
    location: {
      type: {
        type: String,
        enum: ['LineString'],
        default: 'LineString',
      },
      coordinates: {
        type: [[Number]],
        required: true,
        validate: {
          validator: function (arr) {
            return Array.isArray(arr) && arr.length >= 2 && arr.every(p => Array.isArray(p) && p.length === 2);
          },
          message: 'location.coordinates must be array of [lng, lat] pairs',
        },
      },
    },
    avgSpeed: { type: Number, required: true, min: 0 },
    congestionLevel: { type: Number, required: true, min: 0, max: 1 },
    timestamp: { type: Date, required: true, index: true },
    city: { type: String, default: 'Bangalore', index: true },
  },
  {
    collection: 'traffic_records',
  }
);

// Geo index for spatial queries (future use)
TrafficRecordSchema.index({ location: '2dsphere' });

const TrafficRecord = mongoose.model('TrafficRecord', TrafficRecordSchema);

module.exports = TrafficRecord;
