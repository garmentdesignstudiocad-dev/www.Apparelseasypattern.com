// Uses a unique test record; never changes the live key: 'default' document.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const SiteSettings = require('../models/mongo/SiteSettings');
const { defaults, content } = require('../config/appearance');
const key = `appearance-test-${randomUUID()}`;
async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URL || process.env.MONGO_URI;
  assert.ok(uri, 'MongoDB URI is required');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 6000 });
    await SiteSettings.findOneAndUpdate({ key }, { $set: { ...defaults, ...content, primary_color: '#123456', store_name: 'Appearance persistence test', address: 'Preserve address' } }, { upsert: true, runValidators: true });
    let stored = await SiteSettings.findOne({ key }).lean();
    assert.equal(stored.primary_color, '#123456');
    assert.equal(stored.main_font, defaults.main_font);
    await assert.rejects(SiteSettings.findOneAndUpdate({ key }, { $set: { primary_color: 'red; color: blue' } }, { runValidators: true }));
    await SiteSettings.findOneAndUpdate({ key }, { $set: defaults }, { runValidators: true });
    stored = await SiteSettings.findOne({ key }).lean();
    for (const field of Object.keys(defaults)) assert.equal(stored[field], defaults[field]);
    assert.equal(stored.store_name, 'Appearance persistence test');
    assert.equal(stored.address, 'Preserve address');
    console.log('PASS: MongoDB save, persisted readback, schema rejection and appearance-only reset.');
  } finally {
    if (mongoose.connection.readyState === 1) {
      await SiteSettings.deleteOne({ key });
      console.log('Temporary appearance test record removed; live settings unchanged.');
    }
    await mongoose.disconnect();
  }
}
run().catch(error => { console.error('MongoDB appearance test failed:', error.name, error.code || ''); process.exitCode = 1; });
