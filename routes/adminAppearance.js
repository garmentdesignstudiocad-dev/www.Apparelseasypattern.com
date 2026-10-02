const express = require('express');
const crypto = require('crypto');
const adminAuth = require('../middleware/adminAuth');
const SiteSettings = require('../models/mongo/SiteSettings');
const appearance = require('../config/appearance');
const { clearSiteSettingsCache } = require('../services/siteSettingsService');
const router = express.Router();
router.use(adminAuth);
router.use((req, res, next) => {
  if (!req.session.appearanceToken) req.session.appearanceToken = crypto.randomBytes(32).toString('hex');
  if (req.method === 'POST' && req.body._csrf !== req.session.appearanceToken) {
    return res.status(403).send('This form has expired. Reload Website Appearance and try again.');
  }
  next();
});
function render(req, res, settings, errors = []) {
  res.render('admin/appearance', { title: 'Website Appearance', settings, errors,
    message: { saved: 'Website appearance saved.', reset: 'Default theme restored. Branding and text were kept.' }[req.query.status] || '',
    csrf: req.session.appearanceToken, appearance });
}
router.get('/', async (req, res, next) => {
  try {
    const stored = await SiteSettings.findOne({ key: 'default' }).lean();
    render(req, res, appearance.normalize({ main_website_url: appearance.safeUrl(process.env.MAIN_WEBSITE_URL), ...(stored || {}) }));
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const { values, errors } = appearance.parse(req.body);
    if (errors.length) {
      res.status(400);
      return render(req, res, { ...appearance.normalize(), ...Object.fromEntries(Object.keys({ ...appearance.defaults, ...appearance.content }).map(key => [key, typeof req.body[key] === 'string' ? req.body[key] : ''])) }, errors);
    }
    await SiteSettings.findOneAndUpdate({ key: 'default' }, { $set: values }, { upsert: true, runValidators: true });
    clearSiteSettingsCache();
    res.redirect('/admin/settings/appearance?status=saved');
  } catch (error) { next(error); }
});
router.post('/reset', async (req, res, next) => {
  try {
    if (req.body.confirm_reset !== 'yes') return res.status(400).send('Please confirm the appearance reset.');
    await SiteSettings.findOneAndUpdate({ key: 'default' }, { $set: appearance.defaults }, { upsert: true, runValidators: true });
    clearSiteSettingsCache();
    res.redirect('/admin/settings/appearance?status=reset');
  } catch (error) { next(error); }
});
module.exports = router;
