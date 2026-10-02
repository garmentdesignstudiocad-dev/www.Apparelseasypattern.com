// Shared payment snapshot. Amounts are fixed at registration, in paise.
module.exports = {
  ...require('./communicationFields'),
  payment_purpose: String,
  local_reference_id: {type:String,default:function(){return String(this._id);}},
  full_name: String,
  registration_status: { type: String, enum: ['Registered','Payment Pending','Confirmed','Attended','Cancelled'], default: 'Registered', index: true },
  payment_status: { type: String, enum: ['Not Required','Pending','Paid','Failed'], default: 'Pending', index: true },
  amount_paise: { type: Number, min: 0, default: 0 },
  currency: { type: String, enum: ['INR'], default: 'INR' },
  razorpay_order_id: { type: String, default: '' },
  razorpay_payment_id: { type: String, default: '' },
  order_creating: { type: Boolean, default: false },
  payment_note: { type: String, default: '' },
};
