const { Schema, model } = require('mongoose');
const { defaults } = require('../../config/features');
module.exports = model('FeatureSettings', new Schema({
  _id: { type: String, default: 'default' },
  ...Object.fromEntries(Object.keys(defaults).map(key => [key, { type: Boolean, default: true }])),
}, { timestamps: true }));
