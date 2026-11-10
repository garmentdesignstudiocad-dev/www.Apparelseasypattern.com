
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const multer = require('multer');

const adminAuth = require('../middleware/adminAuth');
const SiteSettings = require('../models/mongo/SiteSettings');
const appearance = require('../config/appearance');

const {
  clearSiteSettingsCache
} = require('../services/siteSettingsService');

const router = express.Router();

router.use(adminAuth);

// Ensure upload directories exist
const APPEARANCE_UPLOAD_ROOT = path.resolve(__dirname, '../public/uploads/appearance');
const APPEARANCE_STAGING_ROOT = path.resolve(__dirname, '../private/appearance-upload-staging');
const PRIVATE_PROMOTIONAL_ROOT = path.resolve(__dirname, '../private/patterns/promotional');

try {
  fs.mkdirSync(APPEARANCE_UPLOAD_ROOT, { recursive: true });
  fs.mkdirSync(APPEARANCE_STAGING_ROOT, { recursive: true });
  fs.mkdirSync(PRIVATE_PROMOTIONAL_ROOT, { recursive: true });
} catch (e) {}

// Multer storage for appearance media uploads
const appearanceStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, APPEARANCE_STAGING_ROOT);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  }
});

const appearanceUpload = multer({
  storage: appearanceStorage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max for video
  },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isVideo = file.fieldname === 'upload_home_video_path';
    const isShowcase = file.fieldname === 'upload_home_showcase_image_path';

    if (isVideo) {
      if (['video/mp4', 'video/webm'].includes(file.mimetype) || ['.mp4', '.webm'].includes(ext)) {
        return cb(null, true);
      }
      return cb(new Error('Hero video must be MP4 or WebM format.'));
    }

    if (isShowcase) {
      if (['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf'].includes(file.mimetype) ||
          ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.pdf'].includes(ext)) {
        return cb(null, true);
      }
      return cb(new Error('Showcase accepts JPG, PNG, WebP, SVG, or promotional PDF.'));
    }

    if (['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype) ||
        ['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext)) {
      return cb(null, true);
    }
    return cb(new Error('Upload must be a JPG, PNG, or WebP image.'));
  }
}).fields([
  { name: 'upload_home_image_path', maxCount: 1 },
  { name: 'upload_home_video_path', maxCount: 1 },
  { name: 'upload_home_showcase_image_path', maxCount: 1 },
  { name: 'upload_home_men_image_path', maxCount: 1 },
  { name: 'upload_home_women_image_path', maxCount: 1 },
  { name: 'upload_home_kids_image_path', maxCount: 1 }
]);

async function cleanStagedFiles(req) {
  if (!req.files) return;
  for (const fileList of Object.values(req.files)) {
    for (const file of fileList) {
      if (file && file.path) {
        await fsp.unlink(file.path).catch(() => {});
      }
    }
  }
}

// CSRF protection for Admin Appearance forms
router.use((req, res, next) => {
  if (!req.session.appearanceToken) {
    req.session.appearanceToken =
      crypto.randomBytes(32).toString('hex');
  }

  // For multipart/form-data, csrf will be validated after multer extracts body
  if (req.method === 'POST') {
    const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data');
    if (!isMultipart && req.body._csrf !== req.session.appearanceToken) {
      return res.status(403).send(
        'This form has expired. Reload Website Appearance and try again.'
      );
    }
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
  ...appearance.content,
  ...appearance.headerFooter
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

// POST /admin/settings/appearance (Handles urlencoded & direct multipart file uploads)
router.post('/', (req, res, next) => {
  const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data');
  if (isMultipart) {
    appearanceUpload(req, res, async err => {
      if (err) {
        await cleanStagedFiles(req);
        return res.status(400).send('Upload error: ' + err.message);
      }
      if (req.body._csrf !== req.session.appearanceToken) {
        await cleanStagedFiles(req);
        return res.status(403).send('This form has expired. Reload Website Appearance and try again.');
      }
      handleAppearanceSave(req, res, next);
    });
  } else {
    handleAppearanceSave(req, res, next);
  }
});

async function handleAppearanceSave(req, res, next) {
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

    // Process direct uploaded files if any
    const mediaFieldMap = {
      upload_home_image_path: 'home_image_path',
      upload_home_video_path: 'home_video_path',
      upload_home_showcase_image_path: 'home_showcase_image_path',
      upload_home_men_image_path: 'home_men_image_path',
      upload_home_women_image_path: 'home_women_image_path',
      upload_home_kids_image_path: 'home_kids_image_path'
    };

    if (req.files) {
      for (const [uploadField, targetKey] of Object.entries(mediaFieldMap)) {
        const fileList = req.files[uploadField];
        if (fileList && fileList.length > 0) {
          const file = fileList[0];
          const ext = path.extname(file.originalname || '').toLowerCase();

          // If PDF uploaded for showcase, store in private location and keep safe visual preview
          if (targetKey === 'home_showcase_image_path' && (file.mimetype === 'application/pdf' || ext === '.pdf')) {
            const privateDest = path.join(PRIVATE_PROMOTIONAL_ROOT, file.filename);
            await fsp.rename(file.path, privateDest);
            // Never expose technical PDF directly to public; set safe promotional preview
            req.body[targetKey] = '/images/basic-shirt-pattern.svg';
          } else {
            // Move from staging to public appearance uploads
            const publicDest = path.join(APPEARANCE_UPLOAD_ROOT, file.filename);
            await fsp.rename(file.path, publicDest);
            req.body[targetKey] = '/uploads/appearance/' + file.filename;
          }
        }
      }
    }

    // Accept only known appearance fields
    const submitted = {};

    for (const key of editableKeys) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) {
        continue;
      }

      // Reject arrays/objects for text settings
      if (typeof req.body[key] !== 'string') {
        await cleanStagedFiles(req);
        return res.status(400).send(
          `Invalid value for ${key}.`
        );
      }

      const val = req.body[key].trim();
      // If a media field was submitted empty, preserve the existing value
      if (Object.values(mediaFieldMap).includes(key) && !val) {
        submitted[key] = currentSettings[key] || '';
      } else {
        submitted[key] = val;
      }
    }

    // Preserve fields not present in the submitted form
    const merged = {
      ...currentSettings,
      ...submitted
    };

    // Run existing appearance validation
    const { values, errors } = appearance.parse(merged);

    if (errors.length > 0) {
      await cleanStagedFiles(req);
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
      await cleanStagedFiles(req);
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
    await cleanStagedFiles(req);
    return next(error);
  }
}

// POST /admin/settings/appearance/reset
router.post('/reset', async (req, res, next) => {
  try {
    if (req.body.confirm_reset !== 'yes') {
      return res.status(400).send(
        'Please confirm the appearance reset.'
      );
    }

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
