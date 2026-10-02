const crypto=require('crypto');
const Log=require('../models/mongo/NotificationLog');
const Settings=require('../models/mongo/NotificationSettings');
const receiptService=require('./receiptService');
const {createProviders}=require('./notificationProviders');
const categories={course_enquiry:'course_updates',class_registration:'course_updates',product_order:'order_updates',course_registration:'course_updates',webinar_registration:'webinar_updates',book_purchase:'book_updates',consultation_booking:'consulting_updates'};
async function getSettings(){return {...new Settings().toObject(),...await Settings.findById('default').lean()};}
function statusJob(status,detail=''){return {key:crypto.randomUUID(),event:'status_update',status,detail};}
function enabled(settings,log){return settings[log.channel+'_enabled'] && settings[log.category] && settings['event_'+log.event]!==false;}
function eventName(type,event){const prefix={course_enquiry:'course_enquiry',class_registration:'class',product_order:'order',course_registration:'course',webinar_registration:'webinar',book_purchase:'book',consultation_booking:'consulting'}[type];return `${prefix}_${event}`;}
async function enqueue(type,id,job){
  await Log.init();
  const data=await receiptService.context(type,id);if(!data)return;
  const {row,customer,items,amount}=data,settings=await getSettings();
  // Product orders are confirmed only by the payment verifier, never by creation.
  if(type==='product_order' && job.event==='created')return;
  if(type==='product_order' && job.event==='payment_success' && (!row.payment_verified_at || row.payment_status!=='paid'))return;
  const site=await require('./siteSettingsService').getSiteSettings();
  const receipt=row.payment_verified_at?await receiptService.ensure(type,id):null;
  if(job.event==='payment_success' && !receipt)throw new Error('A verified receipt is required.');
  const origin=receiptService.publicOrigin(),receiptLink=receipt && origin?`${origin}/receipts/${receipt.token}`:'';
  const cancelled=row.registration_status==='Cancelled' || row.order_status==='cancelled';
  const status=type==='course_enquiry'?'Enquiry received':job.event==='payment_success'?(cancelled?'Paid — cancelled; contact studio':'Payment Successful'):job.event==='created'?(cancelled?'Cancelled':['Paid','paid'].includes(row.payment_status)?'Received ? payment successful':row.payment_status==='Not Required' && row.registration_status==='Confirmed'?'Confirmed — no payment required':'Received — complete payment if required'):job.status;
  let next=job.detail || (job.event==='payment_success'?'Keep your reference. View your confirmation in the registering browser.':'View your booking/order in the registering browser or contact the studio.');
  if(type==='product_order' && job.event==='digital_ready'){
    const grant=await require('./digitalDeliveryService').ensure(id);
    if(!grant?.download_token || !origin)throw new Error('Digital delivery requires verified access and a configured HTTPS public origin.');
    next=`Your private pattern download link (valid until ${grant.download_expires_at.toISOString().slice(0,10)}): ${origin}/downloads/${grant.download_token}`;
  }
  if(type==='course_enquiry')next='The studio will contact you about your course enquiry. No payment is required.';
  if(job.event==='reminder')next=job.detail;
  const contact=[site.contact_email,site.contact_phone].filter(Boolean).join(' / ');
  next=(next+(contact?' Contact: '+contact:'')).slice(0,700);
  const amountText=type==='course_enquiry'?'Not applicable':'INR '+(amount/100).toFixed(2);
  const event=eventName(type,job.event);let subject=`${site.store_name}: ${event.replaceAll('_',' ')}`;
  let message=`Hello ${customer.name || 'Customer'},\n\n${items.map(item=>item.name).join(', ')}\nReference: ${id}\nAmount: ${amountText}\nStatus: ${status}\n${next}\n${receiptLink?'Receipt: '+receiptLink:receipt?'Your paid receipt is available from your confirmation page.':''}\n\n${site.store_name}`;
  if(type==='product_order'){
    const money=value=>'INR '+Number(value || 0).toFixed(2);
    const detail=row.items.map(item=>[
      item.product_name || 'Pattern',
      'Selected sizes: '+((item.selected_sizes || []).join(', ') || 'As ordered'),
      'Digital quantity: '+Number(item.quantity ?? 1),
      'Digital formats: '+((item.selected_files || []).map(f=>f.file_type || f.file_name).join(', ') || (Number(item.quantity ?? 1)>0?'Base pattern':'None')),
      'Physical Pattern quantity: '+Number(item.physical_quantity || 0),
      'Trial Sample quantity: '+Number(item.trial_quantity || 0),
      'Add-ons: '+((item.selected_addons || []).map(a=>a.name+' ('+money(a.price)+')').join(', ') || 'None'),
      'Item total: '+money(item.total_price)
    ].join('\n')).join('\n\n');
    const physical=require('./digitalDeliveryService').physical(row);
    message=`Hello ${customer.name || 'Customer'},\n\nOrder ID: ${id}\nOrder Date: ${new Date(row.createdAt).toISOString()}\nCustomer: ${customer.name || ''}\nEmail: ${customer.email || ''}\nPhone: ${customer.phone || ''}\n\n${detail}\n\nSubtotal: ${money((row.delivery_flow_version===2 || row.courier_payment_separate)?row.subtotal:Number(row.subtotal || 0)+Number(row.physical_total || 0)+Number(row.trial_total || 0))}\nGST (${row.tax_rate}%): ${money(row.tax_amount)}\nOnline Amount Paid: ${money(row.payment_verified_at && row.payment_status==='paid'?row.grand_total:0)}\nOnline Payment Total: ${money(row.grand_total)}\nPayment Status: ${row.payment_status}\nPhysical delivery required: ${physical?'Yes':'No'}\n`;
    if(physical && row.delivery_flow_version===2)message+=`Destination: ${[row.shipping_address,row.shipping_city,row.shipping_state,row.delivery_pincode].filter(Boolean).join(', ')}\nRegion: ${row.destination_region}\nDispatch From: ${row.dispatch_location}\nCustomer Selected Delivery Partner: ${row.courier_name}\n`;
    if(physical && row.delivery_flow_version!==2)message+=`Delivery Address: ${[row.shipping_address,row.shipping_city,row.shipping_state].filter(Boolean).join(', ')}\nPincode: ${row.delivery_pincode}\nSelected Courier: ${row.courier_name || 'Not recorded'}\nCourier selection is a request, not a confirmed booking.\n`;
    message+=`\n${next}\n${receiptLink?'Receipt: '+receiptLink:''}\n${site.store_name}`;
  }
  let ownerMessage=message;
  if(type==='product_order' && job.event==='payment_success'){
    subject=`Order Confirmed - Garment Pattern Store - ${id}`;
    const physical=require('./digitalDeliveryService').physical(row);
    ownerMessage=`NEW PAID ORDER\n\nCUSTOMER\nName: ${customer.name || ''}\nPhone: ${customer.phone || ''}\nEmail: ${customer.email || ''}\n\nORDER\nRazorpay Payment ID: ${row.payment_reference}\n${message}`;
    if(physical)ownerMessage+=`\nDELIVERY\nAddress: ${row.shipping_address || ''}\nCity: ${row.shipping_city || ''}\nState: ${row.shipping_state || row.delivery_state || ''}\nPincode: ${row.delivery_pincode || ''}\nZone: ${row.destination_region || row.delivery_zone || ''}\nDispatch Hub: ${row.dispatch_location || ''}\nSelected Courier: ${row.courier_name || ''}\n`;
    if(row.items.some(item=>Number(item.quantity ?? 1)>0)){
      const grant=await require('./digitalDeliveryService').ensure(id);
      message+=grant?.download_token && origin?`\nSecure digital download: ${origin}/downloads/${grant.download_token}\nValid until: ${grant.download_expires_at.toISOString()}\n`:'\nYour secure digital download information will be sent when your files are ready.\n';
    }
  }
  const category=job.event==='payment_success' ?'payment_confirmation':categories[type];
  const targets=job.event==='digital_ready'?[{channel:'email',destination:customer.email}]:[{channel:'email',destination:customer.email},{channel:'whatsapp',destination:customer.phone}];
  const ownerEvent=job.event==='payment_success'?'admin_successful_payment':job.event==='created'?{product_order:'admin_new_order_alert',course_enquiry:'admin_course_enquiry',webinar_registration:'admin_webinar_registration',book_purchase:'admin_book_purchase',consultation_booking:'admin_consulting_booking'}[type]:null;
  if(ownerEvent && settings[ownerEvent])targets.push({channel:'email',destination:process.env.ADMIN_NOTIFICATION_EMAIL || site.contact_email,admin:true});
  for(const target of targets){
    const key=crypto.createHash('sha256').update(`${type}|${id}|${job.key}|${target.channel}|${target.admin?'admin':'customer'}`).digest('hex');
    const cat=target.admin?ownerEvent:category;
    const allowed=enabled(settings,{channel:target.channel,category:cat,event:target.admin?ownerEvent:event});
    const payload={dedupe_key:key,channel:target.channel,event:target.admin?ownerEvent:event,category:cat,reference_type:type,reference_id:id,customer:customer.name || 'Customer',destination:target.channel==='whatsapp'?(require('./phoneNumber').normalizeE164(target.destination,process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '91') || target.destination || ''):target.destination || '',status:allowed?'queued':'skipped',error_message:allowed?'':'Disabled in Notification Settings.',subject:target.admin?(type==='product_order' && job.event==='payment_success'?`New Paid Order - ${id}`:`${site.store_name}: ${ownerEvent.replaceAll('_',' ')} ${id}`):subject,message:target.admin?ownerMessage:message,parameters:[customer.name || 'Customer',String(id),amountText,status,next,receiptLink || 'Available in your confirmation page after verified payment.']};
    if(job.schedule_at)payload.schedule_at=job.schedule_at;
    try{await Log.updateOne({dedupe_key:key},{$setOnInsert:payload},{upsert:true,runValidators:true});}catch(error){if(error.code!==11000)throw error;}
  }
}
async function flush(type,id){
  if(type==='product_order')await require('./digitalDeliveryService').ensure(id);
  const Model=require('../models/mongo/'+receiptService.types[type]);
  const row=await Model.findById(id).lean();if(!row)return;
  if(row.payment_verified_at)await receiptService.ensure(type,id);
  for(const job of row.notification_jobs || []){
    await enqueue(type,id,job);
    await Model.updateOne({_id:id},{$pull:{notification_jobs:{key:job.key}}});
  }
}
async function safeFlush(type,id){
  // Embedded jobs survive queue/storage failures; the background worker tries again.
  if(require('mongoose').connection.readyState!==1)return;
  try{await flush(type,id);}catch(error){require('./safeLog').logError('Receipt/notification preparation deferred:',error);}
}
async function failureAlert(row){
  if(row.event.startsWith('admin_'))return; // Never recursively alert on an owner-alert failure.
  const settings=await getSettings();
  const site=await require('./siteSettingsService').getSiteSettings();
  const key=crypto.createHash('sha256').update('notification-failed|'+row._id).digest('hex');
  await Log.updateOne({dedupe_key:key},{$setOnInsert:{dedupe_key:key,channel:'email',event:'admin_notification_failed',category:'admin_notification_failed',reference_type:row.reference_type,reference_id:row.reference_id,destination:process.env.ADMIN_NOTIFICATION_EMAIL || site.contact_email || '',status:enabled(settings,{channel:'email',category:'admin_notification_failed'})?'queued':'skipped',subject:site.store_name+': Notification failed',message:`A ${row.channel} notification (${row.event}) failed or needs review. Reference: ${row.reference_id}. Review /admin/notifications before retrying.`,parameters:[]}}, {upsert:true,runValidators:true});
}
async function safeFailureAlert(row){try{await failureAlert(row);await Log.updateOne({_id:row._id},{$set:{failure_alert_recorded:true}});}catch(error){require('./safeLog').logError('Owner notification alert deferred:',error);}}
function createDispatcher(providers=createProviders()){
  return async function dispatch(id){
    const settings=await getSettings();
    const candidate=await Log.findById(id).lean();if(!candidate || !['queued','pending'].includes(candidate.status))return false;
    if(!enabled(settings,candidate)){await Log.updateOne({_id:id,status:{$in:['queued','pending']}},{$set:{status:'skipped',error_message:'Disabled in Notification Settings.'}});return false;}
    if(candidate.event==='order_digital_ready'){
      const order=await require('../models/mongo/Order').findById(candidate.reference_id).lean();
      if(!order?.payment_verified_at || order.payment_status!=='paid' || order.order_status==='cancelled' || !(order.download_expires_at>new Date())){await Log.updateOne({_id:id,status:{$in:['queued','pending']}},{$set:{status:'skipped',error_message:'Download access is no longer available.'}});return false;}
    }
    if(candidate.event==='webinar_reminder'){
      const registration=await require('../models/mongo/WebinarRegistration').findById(candidate.reference_id).lean();
      const webinar=registration?await require('../models/mongo/Webinar').findById(registration.webinar_id).lean():null;
      if(!webinar?.active || !['Confirmed','Attended'].includes(registration.registration_status) || !['Paid','Not Required'].includes(registration.payment_status) || new Date(webinar.starts_at)<=new Date() || +new Date(webinar.starts_at)!==+new Date(candidate.schedule_at)){
        await Log.updateOne({_id:id,status:{$in:['queued','pending']}},{$set:{status:'skipped',error_message:'The webinar schedule or registration changed; this reminder is no longer applicable.'}});return false;
      }
    }
    const row=await Log.findOneAndUpdate({_id:id,status:{$in:['queued','pending']}},{$set:{status:'sending',locked_at:new Date(),error_message:''},$inc:{attempts:1}},{new:true});if(!row)return false;
    let providerId;
    try{
      providerId=await providers[row.channel](row);
      await Log.updateOne({_id:id,status:'sending'},{$set:{status:'sent',provider_response_id:providerId,sent_at:new Date(),error_message:''}});
      return true;
    }catch(error){
      // A timeout may mean the provider accepted the message. Never automatically resend it.
      await Log.updateOne({_id:id,status:'sending'},{$set:{status:providerId || error.uncertain?'uncertain':'failed',error_message:providerId?'Provider accepted the message but its status could not be saved. Check provider logs.':error.safeMessage || 'Provider send failed. Check provider configuration and retry.'}});
      await safeFailureAlert(row);
      return false;
    }
  };
}
async function retry(id,acknowledge=false){
  const row=await Log.findById(id).lean();if(!row || !['failed','uncertain'].includes(row.status))return false;
  if(row.status==='uncertain' && !acknowledge)throw Object.assign(new Error('Check provider logs and acknowledge the duplicate-send risk before retrying.'),{safe:true});
  const settings=await getSettings();if(!enabled(settings,row))throw Object.assign(new Error('Enable this channel and event in Notification Settings first.'),{safe:true});
  return Boolean(await Log.findOneAndUpdate({_id:id,status:row.status},{$set:{status:'queued',error_message:''}},{new:true}));
}
async function reminders(now=new Date()){
  const Webinar=require('../models/mongo/Webinar'),Registration=require('../models/mongo/WebinarRegistration');
  const upcoming=await Webinar.find({active:true,starts_at:{$gt:now,$lte:new Date(now.getTime()+24*3600000)}}).select('starts_at').lean();
  for(const webinar of upcoming){
    const key='reminder-'+webinar.starts_at.toISOString();
    const registrations=Registration.find({webinar_id:webinar._id,registration_status:{$in:['Confirmed','Attended']},payment_status:{$in:['Paid','Not Required']}}).lean().cursor();
    for await(const row of registrations)await enqueue('webinar_registration',row._id,{key,event:'reminder',schedule_at:webinar.starts_at,status:'Upcoming webinar',detail:`Your webinar starts ${webinar.starts_at.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST. Open your registration in the registering browser for joining details.`});
  }
}
async function tick(){
  await require('./digitalDeliveryService').reconcile();
  for(const [type,name] of Object.entries(receiptService.types)){
    const Model=require('../models/mongo/'+name);
    for await(const row of Model.find({'notification_jobs.0':{$exists:true}}).select('_id').limit(100).lean().cursor())await safeFlush(type,row._id);
  }
  await reminders();
  for await(const row of Log.find({status:{$in:['failed','uncertain']},event:{$not:/^admin_/},failure_alert_recorded:{$ne:true}}).limit(100).lean().cursor())await safeFailureAlert(row);
  await Log.updateMany({status:'sending',locked_at:{$lt:new Date(Date.now()-5*60000)}},{$set:{status:'uncertain',error_message:'Worker stopped before recording the provider response. Check provider logs before retrying.'}});
  const dispatch=createDispatcher();
  for await(const row of Log.find({status:{$in:['queued','pending']}}).sort({createdAt:1}).limit(100).select('_id').lean().cursor())await dispatch(row._id);
}
function startWorker(){
  if(process.env.NOTIFICATIONS_WORKER_ENABLED==='false')return ()=>{};
  let running=false;
  const run=async()=>{if(running || require('mongoose').connection.readyState!==1)return;running=true;try{await tick();}catch(error){require('./safeLog').logError('Notification worker deferred:',error);}finally{running=false;}};
  const timer=setInterval(run,60000);timer.unref();void run();return ()=>clearInterval(timer);
}
module.exports={getSettings,statusJob,enqueue,flush,safeFlush,createDispatcher,retry,reminders,tick,startWorker};
