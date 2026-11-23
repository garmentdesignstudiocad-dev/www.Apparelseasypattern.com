'use strict';

const { Schema, model } = require('mongoose');

const FreePatternClaimSchema = new Schema({
  email: { type: String, trim: true, lowercase: true },
  claim_email: { type: String },
  claim_phone: { type: String },
  identity_verified: { type: Boolean, default: false },
  policy_version: { type: String },
  phone: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  style_fit_key: {
    type: String,
    required: true,
    trim: true
  },
  product_id: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  product_name: {
    type: String,
    required: true
  },
  claimed_size: {
    type: String,
    required: true
  },
  download_token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  download_expires_at: {
    type: Date,
    required: true,
    index: true
  },
  download_asset: {
    name: { type: String, required: true },
    file: { type: String, required: true }
  },
  download_count: {
    type: Number,
    default: 0
  },
  claimed_at: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Keep historical claims unchanged. Partial unique keys enforce the new overall offer.
FreePatternClaimSchema.index({ claim_email: 1 }, { unique: true, partialFilterExpression: { claim_email: { $type: 'string' } } });
FreePatternClaimSchema.index({ claim_phone: 1 }, { unique: true, partialFilterExpression: { claim_phone: { $type: 'string' } } });
// Preserve the historical index.
FreePatternClaimSchema.index({ phone: 1, style_fit_key: 1 }, { unique: true });

module.exports = model('FreePatternClaim', FreePatternClaimSchema);
