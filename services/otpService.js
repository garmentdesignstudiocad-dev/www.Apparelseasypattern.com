'use strict';

const crypto = require('node:crypto');
const { normalizeE164 } = require('./phoneNumber');
const OtpVerification = require('../models/mongo/OtpVerification');

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 3;

// In-memory rate limiting map for phone requests
const recentRequests = new Map();

function cleanOldRequests(phone) {
  const now = Date.now();
  const times = (recentRequests.get(phone) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (times.length > 0) {
    recentRequests.set(phone, times);
  } else {
    recentRequests.delete(phone);
  }
  return times;
}

function hashOtp(otp, phone) {
  const secret = process.env.SESSION_SECRET || 'aep-otp-secret';
  return crypto.createHmac('sha256', secret).update(`${phone}:${otp}`).digest('hex');
}

async function sendOtp(rawPhone, countryCode = '91') {
  const phone = normalizeE164(rawPhone, countryCode);
  if (!phone) {
    return { success: false, error: 'Please enter a valid mobile number with country code.' };
  }

  // Rate limit check
  const times = cleanOldRequests(phone);
  if (times.length >= MAX_REQUESTS_PER_WINDOW) {
    return { success: false, error: 'Too many OTP requests. Please wait a few minutes before trying again.' };
  }

  // Generate 6-digit numeric OTP
  const otp = String(crypto.randomInt(100000, 1000000));
  const otp_hash = hashOtp(otp, phone);
  const expires_at = new Date(Date.now() + OTP_EXPIRY_MS);

  // Upsert OtpVerification record
  await OtpVerification.deleteMany({ phone });
  const record = await OtpVerification.create({
    phone,
    otp_hash,
    attempts: 0,
    verified: false,
    expires_at
  });

  times.push(Date.now());
  recentRequests.set(phone, times);

  const apiKey = process.env.TWOFACTOR_API_KEY;

  if (apiKey) {
    // 2Factor.in SMS provider call
    try {
      const template = process.env.TWOFACTOR_OTP_TEMPLATE || 'AUTOGEN';
      const endpoint = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(phone.replace('+', ''))}/${encodeURIComponent(otp)}/${encodeURIComponent(template)}`;
      const res = await fetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(8000) });
      const data = await res.json().catch(() => ({}));
      if (data.Status !== 'Success') {
        return { success: false, error: 'Failed to send OTP via SMS provider. Please try again.' };
      }
      if (data.Details) {
        await OtpVerification.updateOne({ _id: record._id }, { $set: { session_id: data.Details } });
      }
    } catch (err) {
      return { success: false, error: 'SMS service temporarily unavailable. Please retry shortly.' };
    }
  } else if (process.env.NODE_ENV === 'production') {
    return {
      success: false,
      error: 'SMS OTP provider is not configured on this server. Contact store administration.'
    };
  }

  // In test / dev / isolated preview, return mock flag (mock OTP available in test harness)
  return {
    success: true,
    message: 'OTP has been dispatched to your mobile number.',
    expires_in_seconds: Math.floor(OTP_EXPIRY_MS / 1000),
    mock: !apiKey ? otp : undefined
  };
}

async function verifyOtp(rawPhone, otp, countryCode = '91') {
  const phone = normalizeE164(rawPhone, countryCode);
  if (!phone || !otp) {
    return { success: false, error: 'Enter a valid mobile number and 6-digit OTP.' };
  }

  const trimmedOtp = String(otp).trim();
  if (!/^\d{6}$/.test(trimmedOtp)) {
    return { success: false, error: 'OTP must be exactly 6 digits.' };
  }

  const record = await OtpVerification.findOne({ phone, expires_at: { $gt: new Date() } });
  if (!record) {
    return { success: false, error: 'OTP has expired or was not requested. Please request a new OTP.' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await OtpVerification.deleteOne({ _id: record._id });
    return { success: false, error: 'Too many incorrect attempts. Please request a new OTP.' };
  }

  const expectedHash = hashOtp(trimmedOtp, phone);
  if (record.otp_hash !== expectedHash) {
    await OtpVerification.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    const remaining = MAX_ATTEMPTS - (record.attempts + 1);
    return {
      success: false,
      error: `Incorrect OTP. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'OTP invalidated.'}`
    };
  }

  // Mark verified
  record.verified = true;
  await record.save();

  return { success: true, phone };
}

async function isPhoneVerified(rawPhone, countryCode = '91') {
  const phone = normalizeE164(rawPhone, countryCode);
  if (!phone) return false;
  const record = await OtpVerification.findOne({
    phone,
    verified: true,
    expires_at: { $gt: new Date() }
  });
  return Boolean(record);
}

module.exports = {
  sendOtp,
  verifyOtp,
  isPhoneVerified,
  normalizeE164,
  _resetRateLimits: () => recentRequests.clear()
};
