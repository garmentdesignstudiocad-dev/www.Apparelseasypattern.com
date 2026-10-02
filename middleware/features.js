const service = require('../services/featureSettingsService');
const { defaults, helpers } = require('../config/features');
function unavailable(req, res) {
  return res.status(404).render('error', { title: 'Page Not Found', message: 'The requested page could not be found.' });
}
async function load(req, res, next) {
  try {
    // Owner routes stay usable independently of public visibility settings.
    const settings = req.path === '/admin' || req.path.startsWith('/admin/') ? defaults : await service.getSettings();
    res.locals.featureSettings = settings;
    Object.assign(res.locals, helpers(settings, process.env.SITE_URL || `${req.protocol}://${req.get('host')}`));
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) { next(error); }
}
function guard(req, res, next) {
  // Allow signed gateway callbacks to settle payments already in flight.
  if (req.method === 'POST' && req.path === '/checkout/razorpay-callback') return next();
  return res.locals.canVisit(req.path) ? next() : unavailable(req, res);
}
function requireFeatureEnabled(key) {
  return (req, res, next) => req.path === '/admin' || req.path.startsWith('/admin/') || res.locals.featureEnabled(key) ? next() : unavailable(req, res);
}
module.exports = { load, guard, requireFeatureEnabled };
