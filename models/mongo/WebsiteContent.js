const { Schema, model } = require('mongoose');
module.exports = model('WebsiteContent', new Schema({
  key: { type: String, unique: true, default: 'default' },
  draft: { type: Map, of: String, default: {} },
  published: { type: Map, of: String, default: {} },
}, { timestamps: true }));
