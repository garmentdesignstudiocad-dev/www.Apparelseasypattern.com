const { Schema, model } = require('mongoose');

const AddonSchema = new Schema({
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  description: String,
  price: { type: Number, default: 0, min: 0, max: 1000000 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = model('Addon', AddonSchema);
