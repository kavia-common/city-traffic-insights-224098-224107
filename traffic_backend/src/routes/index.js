const express = require('express');

const router = express.Router();

/**
 * Root route - redirect to API docs
 */
router.get('/', (req, res) => {
  res.redirect('/api/docs');
});

module.exports = router;
