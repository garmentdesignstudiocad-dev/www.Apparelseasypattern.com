const Settings = require('../models/mongo/FeatureSettings');
const { normalize, defaults } = require('../config/features');
async function getSettings() {
  // Read on each request so other server processes also see saves immediately.
  // A database error propagates; it must never silently re-enable hidden sections.
  return normalize(await Settings.findById('default').lean() || defaults);
}
async function saveSettings(body) {
  const values = {};
  for (const key of Object.keys(defaults)) {
    if (body[key] !== undefined && body[key] !== 'on') throw new Error('Invalid feature switch value.');
    values[key] = body[key] === 'on';
  }
  await Settings.findOneAndUpdate({ _id: 'default' }, { $set: values }, { upsert: true, runValidators: true });
}
module.exports = { getSettings, saveSettings };
