const router = require('express').Router();
const service = require('../services/featureSettingsService');
const { definitions } = require('../config/features');
router.use(require('../middleware/adminAuth'), require('../middleware/learningForms'));
router.get('/', async (req, res, next) => {
  try { res.render('admin/features', { title: 'Feature Visibility', definitions, settings: await service.getSettings(), saved: req.query.saved === '1' }); }
  catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try { await service.saveSettings(req.body); res.redirect(303, '/admin/settings/features?saved=1'); }
  catch (error) { next(error); }
});
module.exports = router;
