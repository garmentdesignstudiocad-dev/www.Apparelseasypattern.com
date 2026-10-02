const { Schema, model } = require('mongoose');

const ClassRegistrationSchema = new Schema({
  ...require('./communicationFields'),
  session_id: { type: Schema.Types.ObjectId, ref: 'ClassSession', required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  amount: { type: Number, default: 0 },
  payment_status: { type: String, enum: ['not_required', 'pending', 'paid', 'failed'], default: 'pending' },
  registration_status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' },
  razorpay_order_id: { type: String, default: '', index: true, sparse: true },
  razorpay_payment_id: { type: String, default: '' },
}, { timestamps: true });

ClassRegistrationSchema.index({ session_id: 1, email: 1 }, { unique: true });
module.exports = model('ClassRegistration', ClassRegistrationSchema);
