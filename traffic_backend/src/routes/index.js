const express = require('express');

const router = express.Router();

/**
 * Root route - redirect to API docs
 */
router.get('/', (req, res) => {
  res.redirect('/api/docs');
});

// Mount self-test also at /api/self-test via parent router usage in app.js
module.exports = router;
