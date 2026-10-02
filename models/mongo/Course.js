const { Schema, model } = require('mongoose');
module.exports = model('Course', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  short_description: { type: String, maxlength: 1000, default: '' },
  description: { type: String, maxlength: 30000, default: '' },
  image_url: String, trainer: { type: String, maxlength: 200 },
  duration: { type: String, maxlength: 200 },
  mode: { type: String, enum: ['Online', 'Offline', 'Online / Offline'], default: 'Online' },
  price: { type: Number, min: 0, max: 1000000, default: null },
  access_url: {type:String,default:'',select:false},
  modules: [{ type: String, maxlength: 2000 }],
  schedule_information: { type: String, maxlength: 5000, default: '' },
  active: { type: Boolean, default: false, index: true },
}, { timestamps: true }));
