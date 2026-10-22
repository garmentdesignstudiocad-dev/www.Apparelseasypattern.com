
const express = require('express');
const crypto = require('crypto');

const adminAuth = require('../middleware/adminAuth');
const SiteSettings = require('../models/mongo/SiteSettings');
const appearance = require('../config/appearance');

const {
  clearSiteSettingsCache
} = require('../services/siteSettingsService');

const router = express.Router();

router.use(adminAuth);

// CSRF protection for Admin Appearance forms
router.use((req, res, next) => {
  if (!req.session.appearanceToken) {
    req.session.appearanceToken =
      crypto.randomBytes(32).toString('hex');
  }

  if (
    req.method === 'POST' &&
    req.body._csrf !== req.session.appearanceToken
  ) {
    return res.status(403).send(
      'This form has expired. Reload Website Appearance and try again.'
    );
  }

  next();
});

// Display Admin Appearance page
function renderPage(req, res, settings, errors = []) {
  const messages = {
    saved: 'Website appearance saved successfully.',
    reset: 'Default theme restored. Branding and text were kept.'
  };

  return res.render('admin/appearance', {
    title: 'Website Appearance',
    settings,
    errors,
    message: messages[req.query.status] || '',
    csrf: req.session.appearanceToken,
    appearance
  });
}

// All fields supported by the appearance configuration
const editableKeys = Object.keys({
  ...appearance.defaults,
  ...appearance.content
});

const editableKeySet = new Set(editableKeys);

// GET /admin/settings/appearance
router.get('/', async (req, res, next) => {
  try {
    const stored = await SiteSettings
      .findOne({ key: 'default' })
      .lean();

    const settings = appearance.normalize({
      main_website_url: appearance.safeUrl(
        process.env.MAIN_WEBSITE_URL
      ),
      ...(stored || {})
    });

    return renderPage(req, res, settings);
  } catch (error) {
    return next(error);
  }
});

// POST /admin/settings/appearance
router.post('/', async (req, res, next) => {
  try {
    // Read current database settings first
    const stored = await SiteSettings
      .findOne({ key: 'default' })
      .lean();

    const currentSettings = appearance.normalize({
      main_website_url: appearance.safeUrl(
        process.env.MAIN_WEBSITE_URL
      ),
      ...(stored || {})
    });

    // Accept only known appearance fields
    const submitted = {};

    for (const key of editableKeys) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) {
        continue;
      }

      // Reject arrays/objects for text settings
      if (typeof req.body[key] !== 'string') {
        return res.status(400).send(
          `Invalid value for ${key}.`
        );
      }

      submitted[key] = req.body[key].trim();
    }

    // Preserve fields not present in the submitted form
    const merged = {
      ...currentSettings,
      ...submitted
    };

    // Run existing appearance validation
    const { values, errors } = appearance.parse(merged);

    if (errors.length > 0) {
      res.status(400);

      return renderPage(
        req,
        res,
        merged,
        errors
      );
    }

    // Save ONLY the fields actually submitted
    const update = {};

    for (const key of Object.keys(submitted)) {
      if (editableKeySet.has(key)) {
        update[key] = values[key];
      }
    }

    // No data change if the form contains no editable fields
    if (Object.keys(update).length === 0) {
      res.status(400);

      return renderPage(
        req,
        res,
        currentSettings,
        ['No editable settings were submitted.']
      );
    }

    // Update MongoDB without overwriting unrelated settings
    await SiteSettings.findOneAndUpdate(
      { key: 'default' },
      { $set: update },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    // Force this server process to reload fresh settings
    clearSiteSettingsCache();

    return res.redirect(
      '/admin/settings/appearance?status=saved'
    );
  } catch (error) {
    return next(error);
  }
});

// POST /admin/settings/appearance/reset
router.post('/reset', async (req, res, next) => {
  try {
    if (req.body.confirm_reset !== 'yes') {
      return res.status(400).send(
        'Please confirm the appearance reset.'
      );
    }

    // Reset theme only.
    // Homepage content, SEO, branding and contact stay unchanged.
    await SiteSettings.findOneAndUpdate(
      { key: 'default' },
      {
        $set: {
          ...appearance.defaults
        }
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    clearSiteSettingsCache();

    return res.redirect(
      '/admin/settings/appearance?status=reset'
    );
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
