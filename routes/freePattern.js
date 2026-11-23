'use strict';

const express = require('express');
const router = express.Router();
const freePatternService = require('../services/freePatternService');
const attempts = new Map();
function claimLimit(req, res, next) {
  const now = Date.now();
  for (const [key, row] of attempts) if (row.until <= now) attempts.delete(key);
  const key = req.ip, row = attempts.get(key) || { count: 0, until: now + 10 * 60 * 1000 };
  attempts.set(key, row);
  if (++row.count > 10) return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
  next();
}
// No SMS/WhatsApp dispatch while the offer uses unverified contact details.
router.post('/free-pattern/send-otp', (req, res) => res.status(410).json({ success: false, error: 'OTP dispatch is disabled.' }));

// POST /free-pattern/claim
router.post('/free-pattern/claim', claimLimit, async (req, res) => {
  try {
    const { phone, email, product_id, size, otp, country_code = '91' } = req.body;
    if (!phone || !product_id || !size || !email) {
      return res.status(400).json({
        success: false,
        error: 'Email, mobile number, product and size are required.'
      });
    }

    const result = await freePatternService.claimFreePattern({
      rawPhone: phone,
      email,
      productId: product_id,
      size,
      otp,
      countryCode: country_code
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal error processing free pattern claim.' });
  }
});

// GET /free-pattern/download/:token
router.get('/free-pattern/download/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const download = await freePatternService.getDownload(token);

    if (!download) {
      return res.status(404).render('error', {
        title: 'Download Not Found',
        message: 'The requested pattern download link is invalid or has expired.'
      });
    }

    if (download.expired) {
      return res.status(410).render('error', {
        title: 'Download Expired',
        message: 'Free pattern download links expire 24 hours after claim. Please contact support if you need assistance.'
      });
    }

    res.download(download.path, download.filename);
  } catch (err) {
    res.status(500).render('error', {
      title: 'Download Error',
      message: 'Could not deliver the requested file.'
    });
  }
});

module.exports = router;
