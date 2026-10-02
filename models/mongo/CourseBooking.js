const { Schema, model } = require('mongoose');
const schema = new Schema({
  ...require('./accessFields'),
  name: { type: String, required: true, trim: true, maxlength: 200 },
  email: { type: String, required: true, lowercase: true, maxlength: 254 },
  whatsapp: { type: String, required: true, maxlength: 30 },
  course_id: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  course_name: String,
  preferred_date: { type: String, required: true },
  preferred_time: { type: String, required: true },
  mode: { type: String, enum: ['Online', 'Offline'], required: true },
  experience_level: { type: String, maxlength: 200, default: '' },
  notes: { type: String, maxlength: 5000, default: '' },
  status: { type: String, enum: ['New', 'Contacted', 'Confirmed', 'Completed', 'Cancelled'], default: 'New', index: true },
  submission_key: { type: String, required: true, unique: true },
}, { timestamps: true });
module.exports = model('CourseBooking', schema);
