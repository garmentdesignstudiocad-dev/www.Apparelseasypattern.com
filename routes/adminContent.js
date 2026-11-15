const router = require('express').Router();
const Content = require('../models/mongo/WebsiteContent');
const { catalog } = require('../services/websiteContent');
router.use(require('../middleware/adminAuth'), require('../middleware/learningForms'));
router.get('/', async (req, res, next) => {
  try {
    const entries = catalog();
    const pages = [...new Set(entries.map(entry => entry.page))].sort();
    const page = pages.includes(req.query.page) ? req.query.page : pages[0];
    const content = await Content.findOne({ key: 'default' }).lean() || {};
    const settings = await require('../models/mongo/SiteSettings').findOne({ key: 'default' }).lean() || {};
    const values = { ...(content.draft || {}) };
    for (const entry of entries.filter(item => item.setting)) values[entry.key] = settings.appearance_draft?.[entry.setting] ?? settings[entry.setting] ?? entry.value;
    res.render('admin/content-manager', { title: 'Website Content Manager', pages, page,
      entries: entries.filter(entry => entry.page === page), values, message: req.query.message || '' });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const page = String(req.body.page || '');
    const entries = catalog().filter(entry => entry.page === page);
    if (!entries.length || !['save', 'publish', 'restore'].includes(req.body.action)) return res.sendStatus(400);
    const set = {};
    const settingsSet = {}, settingsUnset = {};
    for (const entry of entries) {
      const value = req.body['text_' + entry.key];
      if (typeof value !== 'string' || value.length > 12000 || /\u0000/.test(value)) return res.status(400).send('Text must be at most 12,000 characters.');
      if (entry.setting) {
        const text = req.body.action === 'restore' ? entry.value : value;
        if (!require('../config/appearance').valid(entry.setting, text)) return res.status(400).send('Invalid website text: ' + entry.setting);
        if (req.body.action === 'publish') { settingsSet[entry.setting] = text; settingsUnset['appearance_draft.' + entry.setting] = 1; }
        else settingsSet['appearance_draft.' + entry.setting] = text;
        continue;
      }
      set['draft.' + entry.key] = req.body.action === 'restore' ? entry.value : value;
      if (req.body.action === 'publish') set['published.' + entry.key] = value;
    }
    if (Object.keys(set).length) await Content.findOneAndUpdate({ key: 'default' }, { $set: set }, { upsert: true, runValidators: true });
    if (Object.keys(settingsSet).length) {
      await require('../models/mongo/SiteSettings').findOneAndUpdate({ key: 'default' }, { $set: settingsSet, ...(Object.keys(settingsUnset).length ? { $unset: settingsUnset } : {}) }, { upsert: true, runValidators: true });
      require('../services/siteSettingsService').clearSiteSettingsCache();
    }
    res.redirect('/admin/content?page=' + encodeURIComponent(page) + '&message=' + encodeURIComponent(req.body.action === 'publish' ? 'Page text published.' : 'Draft saved. Live text unchanged.'));
  } catch (error) { next(error); }
});
module.exports = router;
