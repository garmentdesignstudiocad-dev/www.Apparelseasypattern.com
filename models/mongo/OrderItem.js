const { Schema, model } = require('mongoose');

const OrderItemSchema = new Schema({
  product_name: String,
  selected_sizes: {type:[String],default:[]},
  additional_size_price:Number,
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  selected_files: { type: [Schema.Types.Mixed], default: [] },
  selected_addons: { type: [Schema.Types.Mixed], default: [] },
  physical_quantity: { type: Number, default: 0 },
  trial_quantity: { type: Number, default: 0 },
  quantity: { type: Number, default: 1, min: 0 },
  unit_price: { type: Number, default: 0 },
  total_price: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = { model: model('OrderItem', OrderItemSchema), schema: OrderItemSchema };
