const { Schema, model } = require('mongoose');
module.exports = model('Webinar', new Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  description: { type: String, maxlength: 30000, default: '' },
  banner_image: String, speaker: { type: String, maxlength: 200 },
  starts_at: { type: Date, required: true, index: true },
  duration_minutes: { type: Number, required: true, min: 1, max: 1440 },
  mode: { type: String, enum: ['Online', 'Offline', 'Hybrid'], default: 'Online' },
  meeting_platform: { type: String, enum: ['Zoom', 'Google Meet', 'Microsoft Teams', 'Other'], default: 'Zoom' },
  meeting_link: { type: String, default: '', select: false },
  price: { type: Number, min: 0, max: 1000000, default: null },
  max_seats: { type: Number, min: 0, max: 100000, default: 0 },
  registration_open: { type: Boolean, default: false },
  active: { type: Boolean, default: false, index: true },
  // Atomic seat claims include unpaid registrations until the owner cancels them.
  seat_ids: { type: [Schema.Types.ObjectId], default: [], select: false },
}, { timestamps: true }));
