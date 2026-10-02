const { Schema, model } = require('mongoose');

const ProductFileSchema = new Schema({
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  file_name: { type: String, required: true },
  file_type: { type: String, required: true },
  file_price: { type: Number, default: 0, min: 0, max: 1000000 },
  active: { type: Boolean, default: true },
  digital_file:{type:String,select:false},
}, { timestamps: true });

module.exports = model('ProductFile', ProductFileSchema);
