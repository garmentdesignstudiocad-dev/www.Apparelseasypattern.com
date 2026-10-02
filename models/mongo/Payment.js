const { Schema, model } = require('mongoose');

const PaymentSchema = new Schema({
  payment_purpose: {type:String,default:'product_order'},
  local_reference_id: {type:String,default:function(){return this.order_id?String(this.order_id):undefined;}},
  razorpay_order_id: String,
  razorpay_payment_id: String,
  order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  payment_provider: String,
  payment_id: String,
  payment_status: String,
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'INR' },
}, { timestamps: true });

module.exports = model('Payment', PaymentSchema);
