const { Schema, model } = require('mongoose');

const ProductFitSchema = new Schema({
  name: { type: String, required: true, trim: true, unique: true },
  slug: { type: String, trim: true },
  department: { type: String, default: 'All' },
  description: { type: String, default: '' },
  active: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 }
}, { timestamps: true });

ProductFitSchema.index({ active: 1, name: 1 });

module.exports = model('ProductFit', ProductFitSchema);
