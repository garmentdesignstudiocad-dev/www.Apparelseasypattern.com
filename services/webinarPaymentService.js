const crypto = require('crypto');
const Razorpay = require('razorpay');
const Webinar = require('../models/mongo/Webinar');
const Registration = require('../models/mongo/WebinarRegistration');
function failure(message,status=409) { return Object.assign(new Error(message),{status}); }
function createService({ gateway, WebinarModel = Webinar, RegistrationModel = Registration, purpose = 'webinar_registration', receiptPrefix = 'web', seatBased = true, secret = process.env.RAZORPAY_KEY_SECRET, key = process.env.RAZORPAY_KEY_ID } = {}) {
  const client = () => {
    if(gateway) return gateway;
    if(!key || !secret) throw failure('Payment is not configured. Please contact the studio.',503);
    gateway = new Razorpay({key_id:key,key_secret:secret}); return gateway;
  };
  async function claimSeat(registration) {
    const webinar = await WebinarModel.findOneAndUpdate({
      _id:registration.webinar_id,active:true,registration_open:true,starts_at:{$gt:new Date()},
      $or:[{seat_ids:registration._id},{$expr:{$or:[{$eq:[{$ifNull:['$max_seats',0]},0]},{$lt:[{$size:{$ifNull:['$seat_ids',[]]}},{$ifNull:['$max_seats',0]}]}]}}],
    },{$addToSet:{seat_ids:registration._id}},{new:true});
    if(!webinar) throw failure('Registration is closed or the webinar is full.');
    return webinar;
  }
  async function order(id) {
    let row = await RegistrationModel.findById(id);
    if(!row || row.registration_status === 'Cancelled') throw failure('Registration is unavailable.');
    if(row.amount_paise === 0 || row.payment_status === 'Paid') return {confirmed:true};
    const api=client();
    if(!row.razorpay_order_id) {
      const locked = await RegistrationModel.findOneAndUpdate({_id:id,order_creating:false,razorpay_order_id:'',registration_status:'Payment Pending'},{$set:{order_creating:true}},{new:true});
      if(!locked) throw failure('Payment setup is already in progress. Reload in a moment; if it persists, contact the studio.');
      try {
        const created = await api.orders.create({amount:locked.amount_paise,currency:locked.currency,receipt:`${receiptPrefix}_${locked._id}`,notes:{webinar_registration_id:String(locked._id),payment_purpose:purpose,local_reference_id:String(locked._id)}});
        // Keep the gateway order even if an admin cancelled while it was created.
        await RegistrationModel.updateOne({_id:id},{$set:{razorpay_order_id:created.id,order_creating:false}});
      } catch(error) {
        if([400,401,403,404,422].includes(Number(error.statusCode))) {
          await RegistrationModel.updateOne({_id:id},{$set:{order_creating:false,payment_note:'Gateway rejected payment setup. Correct the gateway configuration or request details before retrying.'}});
          throw failure('Payment setup was rejected by the gateway. Contact the studio before retrying.',503);
        }
        // An ambiguous network failure could have created an order. Do not issue a second one.
        await RegistrationModel.updateOne({_id:id},{$set:{payment_note:'Payment order creation needs review. Check Razorpay receipt before retrying.'}});
        throw failure('Payment setup could not be completed. Contact the studio with your registration reference.',503);
      }
      row = await RegistrationModel.findById(id);
    }
    if(row.registration_status === 'Cancelled') throw failure('Registration was cancelled. Contact the studio.');
    return {key,order_id:row.razorpay_order_id,amount:row.amount_paise,currency:row.currency,name:row.full_name,email:row.email,contact:row.whatsapp};
  }
  async function applyPayment(row,payment) {
    if(payment.order_id !== row.razorpay_order_id || payment.amount !== row.amount_paise || payment.currency !== row.currency) throw failure('Payment details do not match this registration.',400);
    if(payment.status !== 'captured' || payment.captured !== true || Number(payment.amount_refunded || 0) > 0) return {confirmed:false,message:'Payment is not captured yet. Check payment status again shortly.'};
    await RegistrationModel.updateOne({_id:row._id},{$set:{payment_status:'Paid',razorpay_payment_id:payment.id,payment_verified_at:row.payment_verified_at || new Date()},$addToSet:{notification_jobs:{key:'paid',event:'payment_success',status:'Paid'}}});
    // Conditional transition prevents callbacks from undoing cancellation or attendance.
    await RegistrationModel.updateOne({_id:row._id,registration_status:{$in:['Registered','Payment Pending']}},{$set:{registration_status:'Confirmed',payment_note:''}});
    if(!seatBased) await RegistrationModel.updateOne({_id:row._id,registration_status:'Confirmed',status:{$in:['New','Contacted']}},{$set:{status:'Confirmed'}});
    await require('./notificationService').safeFlush(purpose,row._id);
    const fresh=await RegistrationModel.findById(row._id);
    if(fresh.registration_status === 'Cancelled') {
      await RegistrationModel.updateOne({_id:row._id},{$set:{payment_note:'Payment received for a cancelled registration. Owner must review and arrange any refund in Razorpay.'}});
      return {confirmed:false,message:'Payment received for a cancelled registration. Contact the studio for review.'};
    }
    return {confirmed:true,message:'Registration confirmed.'};
  }
  async function verify(id,body) {
    const row=await RegistrationModel.findById(id);
    if(!row || !row.razorpay_order_id) throw failure('Payment order not found.',404);
    if(typeof body.razorpay_payment_id !== 'string' || !/^pay_[a-zA-Z0-9]+$/.test(body.razorpay_payment_id) || body.razorpay_order_id !== row.razorpay_order_id || !/^[a-f0-9]{64}$/i.test(body.razorpay_signature || '')) throw failure('Invalid payment verification.',400);
    client();
    const expected=crypto.createHmac('sha256',secret).update(`${row.razorpay_order_id}|${body.razorpay_payment_id}`).digest('hex');
    if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(body.razorpay_signature,'hex'))) throw failure('Payment signature verification failed.',400);
    return applyPayment(row,await client().payments.fetch(body.razorpay_payment_id));
  }
  async function reconcile(id) {
    const row=await RegistrationModel.findById(id);
    if(!row) throw failure('Registration not found.',404);
    if(!row.amount_paise) return {confirmed:row.registration_status !== 'Cancelled',message:'No payment required.'};
    if(!row.razorpay_order_id) return {confirmed:false,message:'No payment order has been created yet.'};
    const result=await client().orders.fetchPayments(row.razorpay_order_id);
    const paid=result.items.find(p=>p.status==='captured' && Number(p.amount_refunded || 0)===0);
    if(paid) return applyPayment(row,paid);
    if(result.items.some(p=>p.status==='failed')) await RegistrationModel.updateOne({_id:id,payment_status:{$ne:'Paid'}},{$set:{payment_status:'Failed'}});
    return {confirmed:false,message:'No captured payment found. You can retry payment or check again shortly.'};
  }
  async function cancel(id,acknowledgePaid=false) {
    let row=await RegistrationModel.findById(id);
    if(!row) throw failure('Registration not found.',404);
    if(row.razorpay_order_id) { await reconcile(id); row=await RegistrationModel.findById(id); }
    if(row.payment_status==='Paid' && !acknowledgePaid) throw failure('This registration is paid. Confirm that any refund will be handled separately in Razorpay.');
    // A concurrent captured payment must not bypass the explicit paid-cancellation confirmation.
    const cancelled=await RegistrationModel.findOneAndUpdate({_id:id,...(!acknowledgePaid?{payment_status:{$ne:'Paid'}}:{})},{$addToSet:{notification_jobs:{key:'cancelled',event:'status_update',status:'Cancelled'}},$set:{registration_status:'Cancelled',...(!seatBased?{status:'Cancelled'}:{}),attendance_status:'Not Attended',payment_note:row.payment_status==='Paid'?'Cancelled by owner; any refund must be handled separately in Razorpay.':row.payment_note}},{new:true});
    if(!cancelled) throw failure('Payment status changed. Refresh before cancelling.');
    if(seatBased) await WebinarModel.updateOne({_id:row.webinar_id},{$pull:{seat_ids:row._id}});
    await require('./notificationService').safeFlush(purpose,id);
    return cancelled;
  }
  async function recoverOrder(id,orderId) {
    if(typeof orderId!=='string' || !/^order_[a-zA-Z0-9]+$/.test(orderId)) throw failure('Enter a valid Razorpay order ID.',400);
    const row=await RegistrationModel.findById(id);
    if(!row || row.razorpay_order_id) throw failure('Registration already has an order or does not exist.');
    const found=await client().orders.fetch(orderId);
    if(found.receipt!==`${receiptPrefix}_${row._id}` || found.amount!==row.amount_paise || found.currency!==row.currency || String(found.notes?.webinar_registration_id)!==String(row._id)) throw failure('Gateway order does not match this registration.',400);
    const updated=await RegistrationModel.findOneAndUpdate({_id:id,razorpay_order_id:''},{$set:{razorpay_order_id:found.id,order_creating:false,payment_note:''}},{new:true});
    if(!updated) throw failure('Order changed. Refresh the registration.');
    return updated;
  }
  async function resetOrder(id,acknowledged) {
    if(!acknowledged) throw failure('Confirm that no order exists for this registration receipt in Razorpay.');
    const row=await RegistrationModel.findOneAndUpdate({_id:id,order_creating:true,razorpay_order_id:'',registration_status:'Payment Pending',updatedAt:{$lt:new Date(Date.now()-5*60000)}},{$set:{order_creating:false,payment_note:'Owner reviewed Razorpay and confirmed no matching order exists. Payment setup can be retried.'}},{new:true});
    if(!row) throw failure('Wait at least five minutes after payment setup, then refresh. An existing order cannot be reset.');
    return row;
  }
  return {claimSeat,order,verify,reconcile,cancel,recoverOrder,resetOrder};
}
module.exports = {createService,failure};
