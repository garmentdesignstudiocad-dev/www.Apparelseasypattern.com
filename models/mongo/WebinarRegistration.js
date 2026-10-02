const { Schema, model } = require('mongoose');
const schema = new Schema({
  ...require('./communicationFields'),
  payment_purpose: {type:String,default:'webinar_registration'},
  local_reference_id: {type:String,default:function(){return String(this._id);}},
  full_name: { type: String, required: true, trim: true, maxlength: 200 },
  email: { type: String, required: true, lowercase: true, maxlength: 254 },
  whatsapp: { type: String, required: true, maxlength: 30 },
  country: { type: String, maxlength: 200, default: '' },
  city: { type: String, maxlength: 200, default: '' },
  profession: { type: String, maxlength: 200, default: '' },
  experience_level: { type: String, maxlength: 200, default: '' },
  item_name: String,
  webinar_id: { type: Schema.Types.ObjectId, ref: 'Webinar', required: true, index: true },
  registration_status: { type: String, enum: ['Registered', 'Payment Pending', 'Confirmed', 'Attended', 'Cancelled'], default: 'Registered', index: true },
  payment_status: { type: String, enum: ['Not Required', 'Pending', 'Paid', 'Failed'], default: 'Pending', index: true },
  attendance_status: { type: String, enum: ['Not Attended', 'Attended'], default: 'Not Attended' },
  amount_paise: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'INR', enum: ['INR'] },
  razorpay_order_id: { type: String, default: '' },
  razorpay_payment_id: { type: String, default: '' },
  order_creating: { type: Boolean, default: false },
  payment_note: { type: String, default: '' },
}, { timestamps: true });
schema.index({ webinar_id: 1, email: 1 }, { unique: true });
module.exports = model('WebinarRegistration', schema);
