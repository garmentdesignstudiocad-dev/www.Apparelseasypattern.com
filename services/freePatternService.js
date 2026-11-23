'use strict';

const crypto = require('node:crypto');
const { normalizeE164 } = require('./phoneNumber');
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const duplicateMessage = 'This email address or mobile number has already claimed the one-time free pattern offer.';
const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');
const FreePatternClaim = require('../models/mongo/FreePatternClaim');

const { filePath } = require('./digitalDeliveryService');
const { slug } = require('./catalogClassification');

function styleFitKey(product) {
  if (!product) return '';
  const dept = slug(product.department || product.category || 'general');
  const type = slug(product.product_type || product.name || 'garment');
  const fit = slug(product.fit || 'standard');
  return `${dept}::${type}::${fit}`;
}

async function checkClaimEligibility(rawPhone, product, countryCode = '91', rawEmail = '') {
  const phone = normalizeE164(rawPhone, countryCode), email = normalizeEmail(rawEmail);
  if (!phone || !product) return { eligible: false, error: 'Invalid phone or product.' };
  // Historical records are retained and count against the overall offer.
  const existing = await FreePatternClaim.findOne({ $or: [{ phone }, ...(email ? [{ email }] : [])] }).lean();
  return existing ? { eligible: false, error: duplicateMessage } : { eligible: true };
}

async function findBasicPatternAsset(product, size) {
  if (!product || !product.available_sizes?.includes(size)) return null;
  const companion = await ProductFile.findOne({ product_id: product._id, active: true,
    upload_slot: 'basic_pattern_pdf', free_basic_approved: true, free_basic_size: size
  }).select('+digital_file').lean();
  if (!companion?.digital_file || !companion.digital_file.toLowerCase().endsWith('.pdf') || !await filePath(companion.digital_file)) return null;
  return { name: companion.file_name, file: companion.digital_file };
}

async function claimFreePattern({ rawPhone, email: rawEmail, productId, size, otp, countryCode = '91' }) {
  const phone = normalizeE164(rawPhone, countryCode);
  if (!phone) {
    return { success: false, error: 'Enter a valid mobile number with country code.' };
  }

  if (!size || typeof size !== 'string') {
    return { success: false, error: 'Please select a valid size for your free pattern.' };
  }

  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { success: false, error: 'Enter a valid email address.' };
  // Opt-in verification remains available; disabled mode never calls a provider.
  if (process.env.FREE_PATTERN_REQUIRE_VERIFICATION === 'true') {
    const result = await require('./otpService').verifyOtp(phone, otp, countryCode);
    if (!result.success) return { success: false, error: result.error };
  }
  if (!require('mongoose').isValidObjectId(productId)) return { success: false, error: 'Invalid product.' };
  const product = await Product.findById(productId).select('+digital_file +digital_file_map').lean();
  if (!product || product.active !== true || product.status !== 'active') {
    return { success: false, error: 'The selected product is not available for claim.' };
  }

  if (!Array.isArray(product.available_sizes) || !product.available_sizes.includes(size)) {
    return { success: false, error: `Size ${size} is not available for this pattern.` };
  }

  const key = styleFitKey(product);

  // Ensure both unique indexes exist before accepting any new claims. Fail closed on index errors.
  await FreePatternClaim.createIndexes();
  const eligibility = await checkClaimEligibility(phone, product, countryCode, email);
  if (!eligibility.eligible) return { success: false, error: duplicateMessage };

  // Verify basic pattern asset exists on disk
  const asset = await findBasicPatternAsset(product, size);
  if (!asset) {
    return {
      success: false,
      error: 'Unavailable: no owner-approved free basic pattern file for this size.'
    };
  }

  // Issue download token valid for 24 hours
  const download_token = crypto.randomBytes(32).toString('hex');
  const download_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    const claim = await FreePatternClaim.create({
      phone, email, claim_email: email, claim_phone: phone,
      identity_verified: false, policy_version: 'one-time-v2',
      style_fit_key: key,
      product_id: product._id,
      product_name: product.name,
      claimed_size: size,
      download_token,
      download_expires_at,
      download_asset: asset
    });

    return {
      success: true,
      message: 'Your free basic pattern has been unlocked successfully!',
      claimed_size: size,
      product_name: product.name,
      download_token: claim.download_token,
      download_url: `/free-pattern/download/${claim.download_token}`,
      expires_at: download_expires_at
    };
  } catch (err) {
    // Atomic uniqueness collision (code 11000)
    if (err.code === 11000 || String(err).includes('E11000')) {
      return {
        success: false,
        error: duplicateMessage
      };
    }
    throw err;
  }
}

async function getDownload(token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    return null;
  }

  const claim = await FreePatternClaim.findOne({ download_token: token }).lean();
  if (!claim) return null;

  if (new Date() > new Date(claim.download_expires_at)) {
    return { expired: true };
  }

  // Recheck approval, size and current product availability, including historical grants.
  const product = await Product.findById(claim.product_id).lean();
  if (!product?.active || product.status !== 'active') return null;
  const approved = await findBasicPatternAsset(product, claim.claimed_size);
  if (!approved || approved.file !== claim.download_asset?.file) return null;
  const diskPath = await filePath(approved.file);
  if (!diskPath) return null;

  await FreePatternClaim.updateOne({ _id: claim._id }, { $inc: { download_count: 1 } });

  return {
    path: diskPath,
    filename: claim.download_asset.name,
    claim
  };
}

module.exports = {
  styleFitKey,
  checkClaimEligibility,
  findBasicPatternAsset,
  claimFreePattern,
  getDownload
};
