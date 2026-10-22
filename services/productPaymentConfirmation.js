const Order = require('../models/mongo/Order');
const Payment = require('../models/mongo/Payment');

function conflict() {
  const error = new Error('This order already has a different payment reference. Contact the studio.');
  error.status = 409;
  return error;
}

module.exports = async function confirmProductPayment(order, savedOrderId, paymentId) {
  // Only this atomic transition chooses the winning gateway payment. Pipeline
  // conditions use current database state, not the callback's stale order copy.
  await Order.updateOne({
    _id: order._id, payment_verified_at: null, grand_total: order.grand_total,
    $or: [{ razorpay_order_id: savedOrderId }, { payment_reference: savedOrderId }],
  }, [{ $set: {
    payment_status: 'paid', payment_reference: paymentId,
    razorpay_order_id: savedOrderId, payment_verified_at: new Date(),
    order_status: { $cond: [{ $eq: ['$order_status', 'pending'] }, 'confirmed', '$order_status'] },
    shipping_status: { $cond: [{ $eq: ['$shipping_status', 'Pending'] },
      { $cond: [{ $eq: ['$order_status', 'cancelled'] }, 'Cancelled', 'Confirmed'] }, '$shipping_status'] },
    notification_jobs: { $setUnion: [{ $ifNull: ['$notification_jobs', []] },
      [{ key: 'paid', event: 'payment_success', status: 'Paid' }]] },
  } }]);

  const verified = await Order.findById(order._id).lean();
  if (!verified?.payment_verified_at || verified.payment_status !== 'paid' ||
      verified.payment_reference !== paymentId || verified.razorpay_order_id !== savedOrderId) throw conflict();

  // Keep legacy Payment IDs. Other checkout modules are deliberately excluded.
  const scope = { order_id: verified._id,
    $or: [{ payment_purpose: 'product_order' }, { payment_purpose: { $exists: false } }] };
  const existing = await Payment.find(scope).limit(2).lean();
  if (existing.length > 1) throw conflict(); // Never silently repair ambiguous legacy data.
  const prior = existing[0];
  if (prior && ((prior.razorpay_payment_id && prior.razorpay_payment_id !== paymentId) ||
      (prior.payment_status === 'paid' && prior.payment_id !== paymentId))) throw conflict();
  // MongoDB's existing unique _id index serializes concurrent missing-record
  // upserts. No order_id index, transaction, or shared-model migration is needed.
  const recordId = prior?._id || verified._id;
  const values = { payment_purpose: 'product_order', local_reference_id: String(verified._id),
    order_id: verified._id, razorpay_order_id: savedOrderId, razorpay_payment_id: paymentId,
    payment_provider: 'razorpay', payment_id: paymentId, payment_status: 'paid',
    amount: verified.grand_total, currency: 'INR' };
  try {
    await Payment.findOneAndUpdate({ _id: recordId, ...scope,
      $and: [
        { $or: [{ razorpay_payment_id: null }, { razorpay_payment_id: paymentId }] },
        { $or: [{ payment_status: { $ne: 'paid' } }, { payment_id: paymentId }] },
      ],
    }, { $set: values }, { upsert: true, runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await Payment.findById(recordId).lean();
    if (!winner || Object.entries(values).some(([key, value]) => String(winner[key]) !== String(value))) throw conflict();
  }
  // On a persistence failure, the paid order and its durable job remain intact.
  // The same callback/webhook can repair the Payment record and flush safely.
  await require('./notificationService').safeFlush('product_order', verified._id);
};
