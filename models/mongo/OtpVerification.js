'use strict';

const { Schema, model } = require('mongoose');

const OtpVerificationSchema = new Schema({
  phone: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  otp_hash: {
    type: String,
    required: true
  },
  session_id: {
    type: String,
    default: ''
  },
  attempts: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false
  },
  expires_at: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index automatically cleans expired verifications
  }
}, { timestamps: true });

module.exports = model('OtpVerification', OtpVerificationSchema);
