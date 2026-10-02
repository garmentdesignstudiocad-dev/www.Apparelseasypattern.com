const { Schema, model } = require('mongoose');

const ClassSessionSchema = new Schema({
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  type: { type: String, enum: ['Webinar', 'Course', 'Online Class', 'Workshop'], required: true },
  description: { type: String, default: '' },
  short_description: { type: String, default: '' },
  instructor_name: { type: String, default: '' },
  banner_image: { type: String, default: '' },
  starts_at: { type: Date, required: true, index: true },
  ends_at: { type: Date, required: true },
  duration: { type: String, default: '' },
  mode: { type: String, default: 'Online' },
  meeting_platform: { type: String, enum: ['Google Meet', 'Zoom', 'Other'], default: 'Google Meet' },
  meeting_link: { type: String, default: '', select: false },
  participant_receives: { type: String, default: '' },
  promotional_title: { type: String, default: '' },
  promotional_text: { type: String, default: '' },
  promotional_url: { type: String, default: '' },
  linkedin_post_url: { type: String, default: '' },
  price: { type: Number, default: 0, min: 0 },
  is_free: { type: Boolean, default: false },
  max_seats: { type: Number, default: 0, min: 0 },
  registered_count: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['Draft', 'Upcoming', 'Live', 'Completed', 'Cancelled'], default: 'Draft' },
  registration_open: { type: Boolean, default: false },
  published: { type: Boolean, default: false },
}, { timestamps: true });

ClassSessionSchema.methods.publicStatus = function () {
  if (this.status === 'Draft' || this.status === 'Cancelled') return this.status;
  const now = new Date();
  if (now < this.starts_at) return 'Upcoming';
  if (now <= this.ends_at) return 'Live';
  return 'Completed';
};

module.exports = model('ClassSession', ClassSessionSchema);
