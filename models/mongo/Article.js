const { Schema, model } = require('mongoose');
const { categories } = require('../../config/business');
const schema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  summary: { type: String, maxlength: 1000, default: '' },
  content: { type: String, required: true, maxlength: 50000 },
  image_url: String,
  category: { type: String, enum: categories, required: true },
  seo_title: { type: String, maxlength: 200, default: '' },
  seo_description: { type: String, maxlength: 320, default: '' },
  keywords: [String], published: { type: Boolean, default: false }, published_at: Date,
}, { timestamps: true });
module.exports = model('Article', schema);
