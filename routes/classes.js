const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const ClassSession = require('../models/mongo/ClassSession');
const ClassRegistration = require('../models/mongo/ClassRegistration');
const paymentConfig = require('../config/payment');
const router = express.Router();
router.param('id',(req,res,next,id)=>/^[a-f\d]{24}$/i.test(id)?next():res.status(404).send('Registration not found.'));

const razorpay = paymentConfig.razorpayConfigured ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null;
const clean = value => String(value || '').trim();
function publicQuery() { return { published: true, status: { $nin: ['Draft', 'Cancelled'] } }; }
function seatsAvailable(session) { return !session.max_seats || session.registered_count < session.max_seats; }

router.get('/classes', async (req, res, next) => {
  try {
    const sessions = await ClassSession.find({ ...publicQuery(), ends_at: { $gte: new Date() } }).sort({ starts_at: 1 }).lean();
    res.render('classes/index', { title: 'Online Classes Available', sessions });
  } catch (error) { next(error); }
});

router.get('/classes/:slug', async (req, res, next) => {
  try {
    const session = await ClassSession.findOne({ ...publicQuery(), slug: req.params.slug }).lean();
    if (!session) return res.status(404).render('error', { title: 'Session Not Found', message: 'This session is unavailable.' });
    res.render('classes/detail', { title: session.title, session, available: seatsAvailable(session), razorpayKeyId: process.env.RAZORPAY_KEY_ID || '' });
  } catch (error) { next(error); }
});

router.post('/classes/:slug/register', async (req, res, next) => {
  try {
    const session = await ClassSession.findOne({ ...publicQuery(), slug: req.params.slug });
    if (!session || !session.registration_open || !seatsAvailable(session)) return res.status(409).json({ error: 'Registration is not currently available.' });
    const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), phone = clean(req.body.phone);
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !/^[0-9+() -]{7,18}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid name, email and phone number.' });
    let registration = await ClassRegistration.findOne({ session_id: session._id, email });
    if (registration?.registration_status === 'confirmed') return res.status(409).json({ error: 'This email is already registered.' });
    registration ||= new ClassRegistration({ session_id: session._id, name, email, phone });
    Object.assign(registration, { name, phone, amount: session.is_free ? 0 : session.price });
    if (session.is_free || Number(session.price) <= 0) return res.status(409).json({ error: 'A valid course fee must be configured before enrollment can open.' });
    if (!razorpay) return res.status(503).json({ error: 'Live class payment is not configured yet. Registration has not been confirmed.' });
    const order = await razorpay.orders.create({ amount: Math.round(session.price * 100), currency: 'INR', receipt: `class_${registration._id}`, notes: { registration_id: String(registration._id), session_id: String(session._id) } });
    registration.payment_status = 'pending'; registration.registration_status = 'pending'; registration.razorpay_order_id = order.id; await registration.save();
    await require('../services/notificationService').safeFlush('class_registration',registration._id);
    res.json({ ok: true, payment_required: true, key: process.env.RAZORPAY_KEY_ID, amount: order.amount, currency: order.currency, razorpay_order_id: order.id, registration_id: String(registration._id), customer: { name, email, phone } });
  } catch (error) { if (error.code === 11000) return res.status(409).json({ error: 'This email is already registered.' }); next(error); }
});

router.post('/classes/registration/:id/verify', async (req, res, next) => {
  try {
    if (!razorpay) return res.status(503).json({ error: 'Payment verification is unavailable.' });
    const registration = await ClassRegistration.findById(req.params.id);
    if (!registration || registration.razorpay_order_id !== clean(req.body.razorpay_order_id)) return res.status(404).json({ error: 'Registration not found.' });
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${registration.razorpay_order_id}|${clean(req.body.razorpay_payment_id)}`).digest('hex');
    const supplied = clean(req.body.razorpay_signature);
    if (!supplied || expected.length !== supplied.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) { return res.status(400).json({ error: 'Payment verification failed. Please try again.' }); }
    const paymentId=clean(req.body.razorpay_payment_id);
    if(!/^pay_[a-zA-Z0-9]+$/.test(paymentId))return res.status(400).json({error:'Invalid payment reference.'});
    const captured=await razorpay.payments.fetch(paymentId);
    if(captured.order_id!==registration.razorpay_order_id || captured.amount!==Math.round(registration.amount*100) || captured.currency!=='INR' || captured.status!=='captured' || captured.captured!==true || Number(captured.amount_refunded || 0)>0)return res.status(409).json({error:'A matching captured payment is required. Check payment status before paying again.'});
    const confirmed = await ClassRegistration.findOneAndUpdate({ _id: registration._id, registration_status: { $ne: 'confirmed' } }, { $set: { payment_status: 'paid', registration_status: 'confirmed', razorpay_payment_id: clean(req.body.razorpay_payment_id) } }, { new: true });
    if (confirmed) await ClassSession.updateOne({ _id: registration.session_id }, { $inc: { registered_count: 1 } });
    await ClassRegistration.updateOne({_id:registration._id},{$set:{payment_verified_at:registration.payment_verified_at || new Date()},$addToSet:{notification_jobs:{key:'paid',event:'payment_success',status:'Paid'}}});
    await require('../services/notificationService').safeFlush('class_registration',registration._id);
    req.session.classRegistrations ||= []; if(!req.session.classRegistrations.includes(String(registration._id))) req.session.classRegistrations.push(String(registration._id));
    res.json({ ok: true, redirect: `/classes/registration/${registration._id}` });
  } catch (error) { next(error); }
});

router.get('/classes/registration/:id', async (req, res, next) => {
  try {
    if (!req.session.classRegistrations?.includes(req.params.id)) return res.status(403).render('error', { title: 'Access Restricted', message: 'Registration access is available only in the registering browser session.' });
    const registration = await ClassRegistration.findById(req.params.id).populate({ path: 'session_id', select: '+meeting_link' }).lean();
    if (!registration || !registration.session_id || registration.registration_status !== 'confirmed') return res.status(404).render('error', { title: 'Registration Not Confirmed', message: 'This registration is not confirmed.' });
    res.render('classes/confirmation', { title: 'Registration Confirmed', registration, session: registration.session_id });
  } catch (error) { next(error); }
});

router.get('/my-courses', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.session.classRegistrations) ? req.session.classRegistrations : [];
    const registrations = await ClassRegistration.find({ _id: { $in: ids }, registration_status: 'confirmed', payment_status: 'paid' }).populate({ path: 'session_id', select: '+meeting_link' }).sort({ createdAt: -1 }).lean();
    res.render('classes/my_courses', { title: 'My Courses', registrations: registrations.filter(row=>row.session_id) });
  } catch (error) { next(error); }
});

module.exports = router;
