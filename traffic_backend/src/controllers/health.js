'use strict';
const healthService = require('../services/health');

/**
 * Health controller returns service health info.
 */
class HealthController {
  // PUBLIC_INTERFACE
  check(req, res) {
    /** Returns simple health status payload */
    const healthStatus = healthService.getStatus();
    return res.status(200).json(healthStatus);
  }
}

module.exports = new HealthController();
