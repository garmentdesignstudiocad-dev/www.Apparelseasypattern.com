
const { Schema, model } = require('mongoose');

const { defaults, content, valid } = require('../../config/appearance');

const schema = new Schema({
  key: {
    type: String,
    default: 'default',
    unique: true,
  },

  store_name: {
    type: String,
    default: 'Apparel Easy Patterns',
  },

  logo_url: String,
  main_website_url: String,
  contact_email: String,
  contact_phone: String,
  whatsapp_number: String,
  address: String,
  footer_text: String,
  homepage_heading: String,
  homepage_subheading: String,

  launch_contacts_version: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

for (const [key, value] of Object.entries({
  ...defaults,
  ...content,
})) {
  const type = key === 'base_font_size' ? Number : String;

  const definition = {
    type,
    default: value,
    validate: {
      validator: input => valid(key, input),
      message: `Invalid ${key}`,
    },
  };

  if (schema.path(key)) {
    continue;
  }

  schema.add({
    [key]: definition,
  });
}

const linkedin = require('../../config/linkedin');

for (const [key, value] of Object.entries(linkedin.defaults)) {
  schema.add({
    [key]: {
      type: typeof value === 'boolean' ? Boolean : String,
      default: value,
      ...(typeof value === 'string'
        ? { validate: linkedin.validUrl }
        : {}),
    },
  });
}

// Add notification recipient email field
schema.add({
  notification_recipient_email: {
    type: String,
    default: '',
  },
});

module.exports = model('SiteSettings', schema);
