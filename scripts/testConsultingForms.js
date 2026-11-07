// Disposable loopback MongoDB + real HTTP routes; no .env, provider calls or delivery.
require('./isolatedTestGuard');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
require('nodemailer').createTransport=()=>{throw new Error('SMTP forbidden in scheduling tests');};
let captured,orderCount=0;
const gateway={orders:{create:async data=>({...data,id:'order_fixture'+(++orderCount)}),fetchPayments:async()=>({items:captured?[captured]:[]})},payments:{fetch:async()=>captured}};
require('razorpay');require.cache[require.resolve('razorpay')].exports=class{constructor(){return gateway;}};
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'},instance:{ip:'127.0.0.1'}});let server;
 try{
  Object.assign(process.env,{MONGODB_URI:mongo.getUri(),NODE_ENV:'development',NOTIFICATIONS_WORKER_ENABLED:'false',SESSION_SECRET:'isolated-consultation-test',ADMIN_USERNAME:'fixture-owner',ADMIN_PASSWORD:'fixture-password',RAZORPAY_KEY_ID:'rzp_test_fixture',RAZORPAY_KEY_SECRET:'fixture-secret',PUBLIC_BASE_URL:'https://example.test',LEAD_NOTIFICATION_TO:'owner@example.test',DB_HOST:'127.0.0.1',DB_PORT:'1',SMTP_HOST:'',SMTP_USER:'',SMTP_PASS:''});
  await mongoose.connect(mongo.getUri());
  const Booking=require('../models/mongo/ConsultationBooking'),Service=require('../models/mongo/ConsultingService'),Log=require('../models/mongo/NotificationLog');
  await require('../models/mongo/NotificationSettings').create({_id:'default',email_enabled:true,consulting_updates:true,payment_confirmation:true});
  await Service.create({name:'Consultation fixture',slug:'consultation-fixture',price:12.34,active:true});
  await Service.create({name:'Free fixture',slug:'free-fixture',price:0,active:true});
  const app=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const jars={},origin='http://127.0.0.1:'+server.address().port;
  async function request(url,body,who='customer'){
   const response=await fetch(origin+url,{method:body?'POST':'GET',redirect:'manual',headers:{...(jars[who]?{cookie:jars[who]}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?new URLSearchParams(body):undefined});
   const cookie=response.headers.get('set-cookie');if(cookie)jars[who]=cookie.split(';')[0];
   return {status:response.status,html:await response.text(),location:response.headers.get('location')};
  }
  const token=html=>html.match(/name="_csrf" value="([^"]+)"/)?.[1] || html.match(/data-csrf="([^"]+)"/)?.[1];
  const nonce=html=>html.match(/name="submission_key" value="([^"]+)"/)?.[1];
  const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const person={full_name:'Fixture Customer',email:'customer@example.test',whatsapp:'+919876543210',preferred_date:date,preferred_time:'14:00',notes:'Fit consultation fixture'};
  async function book(slug='consultation-fixture',who='customer'){
   const path='/consulting/'+slug+'/access',page=await request(path,null,who);
   assert.equal(page.status,200);assert.match(page.html,/Submit Booking Request/);
   const body={...person,_csrf:token(page.html),submission_key:nonce(page.html)};
   const posted=await request(path,body,who);assert.equal(posted.status,303,posted.html);
   return {url:posted.location,id:posted.location.split('/').pop(),path,body,who};
  }
  const main=await book();
  assert.equal((await request(main.path,main.body)).location,main.url,'Duplicate submission reuses durable booking');
  assert.equal(await Booking.countDocuments(),1);
  let page=await request(main.url),csrf=token(page.html);
  assert.match(page.html,/request has been received/);assert.doesNotMatch(page.html,/Your booking is confirmed/);
  assert.equal((await request(main.url,null,'intruder')).status,403);
  assert.equal((await request(main.url+'/accept-alternative',{_csrf:'bad',proposal:'bad'})).status,403);
  const adminBase='/admin/access-records/consulting/'+main.id;
  assert.equal((await request(adminBase+'/approve',{_csrf:csrf})).location,'/admin/login');
  const login=await request('/admin/login',null,'admin');
  assert.equal((await request('/admin/login',{username:'fixture-owner',password:'fixture-password',_csrf:token(login.html)},'admin')).status,302);
  const adminPage=await request('/admin/access-records?kind=consulting',null,'admin');assert.equal(adminPage.status,200);assert.match(adminPage.html,/Approve Requested/);
  const adminCsrf=token(adminPage.html);
  assert.equal((await request(adminBase+'/approve',{_csrf:'wrong'},'admin')).status,403);
  assert.equal((await request(adminBase+'/status',{_csrf:adminCsrf,status:'Confirmed'},'admin')).status,409);
  // Verified payment first must preserve scheduling Pending.
  const order=JSON.parse((await request(main.url+'/order',{_csrf:csrf})).html);
  assert.equal(order.amount,1234);
  captured={id:'pay_fixture',order_id:order.order_id,amount:1234,currency:'INR',status:'captured',captured:true};
  const valid={_csrf:csrf,razorpay_order_id:order.order_id,razorpay_payment_id:captured.id,razorpay_signature:crypto.createHmac('sha256','fixture-secret').update(order.order_id+'|'+captured.id).digest('hex')};
  assert.equal((await request(main.url+'/verify',{...valid,razorpay_signature:'0'.repeat(64)})).status,400);
  assert.equal(JSON.parse((await request(main.url+'/verify',valid)).html).confirmed,false);
  let row=await Booking.findById(main.id);assert.equal(row.payment_status,'Paid');assert.equal(row.registration_status,'Payment Pending');assert.ok(row.payment_verified_at);
  assert.equal((await request(main.url+'/order',{_csrf:csrf})).status,409,'Paid pending booking must not offer another checkout');
  assert.equal((await request(adminBase+'/propose',{_csrf:adminCsrf,scheduled_date:'2000-01-01',scheduled_time:'10:00'},'admin')).status,400);
  assert.equal((await request(adminBase+'/propose',{_csrf:adminCsrf,scheduled_date:date,scheduled_time:'16:45'},'admin')).status,303);
  row=await Booking.findById(main.id);assert.equal(row.scheduling_status,'Proposed');assert.equal(row.registration_status,'Payment Pending');assert.ok(row.scheduling_decided_at);assert.equal(row.alternative_accepted_at,undefined);
  assert.equal(JSON.parse((await request(main.url+'/verify',valid)).html).confirmed,false,'Payment callback cannot accept proposal');
  assert.equal((await request(adminBase+'/approve',{_csrf:adminCsrf},'admin')).status,409);
  page=await request(main.url);csrf=token(page.html);assert.match(page.html,/16:45 Asia\/Kolkata/);
  const proposal=row.scheduling_decided_at.toISOString();
  assert.equal((await request(main.url+'/accept-alternative',{_csrf:csrf,proposal:'stale'})).status,409);
  const outsider=await request('/consulting/free-fixture/access',null,'intruder');
  assert.equal((await request(main.url+'/accept-alternative',{_csrf:token(outsider.html),proposal},'intruder')).status,403);
  const results=await Promise.all([request(main.url+'/accept-alternative',{_csrf:csrf,proposal}),request(main.url+'/accept-alternative',{_csrf:csrf,proposal})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[303,409]);
  row=await Booking.findById(main.id);assert.equal(row.scheduling_status,'Accepted');assert.ok(row.alternative_accepted_at);assert.equal(row.registration_status,'Confirmed');assert.equal(row.amount_paise,1234);
  assert.match((await request(main.url)).html,/Your booking is confirmed/);
  const queued=await Log.find({reference_id:main.id}).lean();
  assert.ok(queued.some(l=>l.event==='admin_lead_enquiry' && l.message.includes(date+' 14:00 Asia/Kolkata')));
  assert.ok(queued.some(l=>l.event==='consulting_status_update' && l.message.includes('16:45 Asia/Kolkata') && l.message.includes('Scheduling proposed')));
  assert.equal(queued.filter(l=>l.event==='consulting_status_update' && l.message.includes('Scheduling accepted')).length,2,'One accepted job per email/WhatsApp channel');
  assert.ok(queued.every(l=>l.status!=='sent'));assert.ok(queued.some(l=>l.channel==='email' && l.status==='queued'));
  // Free request: approval required, no payment order or fabricated price.
  const free=await book('free-fixture','free');
  assert.equal((await Booking.findById(free.id)).registration_status,'Registered');
  const freeBase='/admin/access-records/consulting/'+free.id;
  const approved=await Promise.all([request(freeBase+'/approve',{_csrf:adminCsrf},'admin'),request(freeBase+'/approve',{_csrf:adminCsrf},'admin')]);
  assert.deepEqual(approved.map(r=>r.status).sort(),[303,409]);
  row=await Booking.findById(free.id);assert.equal(row.scheduling_status,'Approved');assert.equal(row.registration_status,'Confirmed');assert.equal(row.scheduled_time,'14:00');assert.ok(row.scheduling_decided_at);
  // Decline retains the durable record and queues a customer notification.
  const decline=await book('free-fixture','decline'),declineBase='/admin/access-records/consulting/'+decline.id;
  assert.equal((await request(declineBase+'/decline',{_csrf:adminCsrf},'admin')).status,303);
  assert.equal((await request(declineBase+'/approve',{_csrf:adminCsrf},'admin')).status,409);
  assert.equal((await Booking.findById(decline.id)).scheduling_status,'Declined');
  assert.ok(await Log.exists({reference_id:decline.id,message:/Scheduling declined/,channel:'email',status:'queued'}));
  // Invalid date, past time and honeypot rejected without inserting bookings.
  const count=await Booking.countDocuments(),form=await request(main.path);
  const validationBody={...person,_csrf:token(form.html),submission_key:nonce(form.html)};
  for(const invalid of [{preferred_date:'2000-01-01'},{preferred_date:'2030-02-30'},{preferred_time:'24:00'},{website:'spam'}])assert.equal((await request(main.path,{...validationBody,...invalid})).status,400);
  assert.equal(await Booking.countDocuments(),count);
  assert.equal(new Date(date+'T14:00:00+05:30').toISOString().slice(11,16),'08:30');
  // Approval before payment and durable jobs through queue outage.
  const pending=await Booking.create({...person,item_id:row.item_id,item_name:'Fixture',submission_key:'fixture-pending',scheduling_status:'Pending',registration_status:'Payment Pending',payment_status:'Pending',amount_paise:1234,payment_purpose:'consultation_booking'});
  await Booking.decideSchedule(pending.id,'approve');
  assert.equal((await Booking.findById(pending.id)).registration_status,'Payment Pending');
  const notifications=require('../services/notificationService'),originalUpdate=Log.updateOne;
  Log.updateOne=async()=>{throw new Error('Fixture queue outage');};
  try{await notifications.safeFlush('consultation_booking',pending.id);}finally{Log.updateOne=originalUpdate;}
  assert.ok((await Booking.findById(pending.id)).notification_jobs.length);
  await notifications.safeFlush('consultation_booking',pending.id);
  assert.equal((await Booking.findById(pending.id)).notification_jobs.length,0);
  await Booking.updateOne({_id:pending.id},{$set:{razorpay_order_id:'order_approved'}});
  captured={...captured,order_id:'order_approved'};
  const paymentService=require('../services/paidAccessService').paymentService(Booking,'consultation_booking',{gateway});
  assert.equal((await paymentService.reconcile(pending.id)).confirmed,true);
  // Historical records do not acquire scheduling defaults or lose confirmation.
  const legacy=await Booking.create({...person,item_id:row.item_id,submission_key:'fixture-legacy',registration_status:'Confirmed',payment_status:'Not Required',amount_paise:0});
  assert.equal(legacy.scheduling_status,undefined);assert.equal((await paymentService.reconcile(legacy.id)).confirmed,true);
  await assert.rejects(Booking.decideSchedule(legacy.id,'approve'),e=>e.status===409);
  // All owner lifecycle alerts use configured addresses and durable dedupe keys.
  for(const [id,status] of [[main.id,'Scheduling proposed'],[main.id,'Scheduling accepted'],[free.id,'Scheduling approved'],[decline.id,'Scheduling declined']]){
   const log=await Log.findOne({reference_id:id,event:'admin_consulting_booking',message:{$regex:status}});
   assert.ok(log,status);assert.equal(log.destination,'owner@example.test');assert.equal(log.status,'queued');
   assert.match(log.message,/customer@example.test/);assert.match(log.message,/Asia\/Kolkata/);
  }
  assert.equal(await Log.countDocuments({reference_id:main.id,event:'admin_successful_payment'}),1);
  const rejected=await book('free-fixture','rejector'),rejectBase='/admin/access-records/consulting/'+rejected.id;
  assert.equal((await request(rejectBase+'/propose',{_csrf:adminCsrf,scheduled_date:date,scheduled_time:'18:00'},'admin')).status,303);
  const proposed=await Booking.findById(rejected.id),rejectPage=await request(rejected.url,null,'rejector');
  assert.match(rejectPage.html,/Reject Proposed Time and Cancel Request/);
  const rejectBody={_csrf:token(rejectPage.html),proposal:proposed.scheduling_decided_at.toISOString()};
  assert.equal((await request(rejected.url+'/reject-alternative',{...rejectBody,_csrf:'invalid'},'rejector')).status,403);
  assert.equal((await request(rejected.url+'/reject-alternative',{...rejectBody,proposal:'stale'},'rejector')).status,409);
  assert.equal((await request(rejected.url+'/reject-alternative',{...rejectBody,_csrf:token(outsider.html)},'intruder')).status,403);
  const responses=await Promise.all([request(rejected.url+'/reject-alternative',rejectBody,'rejector'),request(rejected.url+'/accept-alternative',rejectBody,'rejector')]);
  // Both responses target the same proposal; only one may win.
  assert.deepEqual(responses.map(r=>r.status).sort(),[303,409]);
  let rejectedRow=await Booking.findById(rejected.id);
  if(rejectedRow.registration_status!=='Cancelled'){
   // Deterministically cover rejection as well if acceptance won the race.
   const fixture=await Booking.create({...person,item_id:row.item_id,submission_key:'reject-fixture',scheduling_status:'Proposed',scheduled_date:date,scheduled_time:'18:00',scheduling_decided_at:new Date(),registration_status:'Registered',payment_status:'Not Required',amount_paise:0});
   await Booking.decideSchedule(fixture.id,'reject',{proposal:fixture.scheduling_decided_at.toISOString()});await notifications.safeFlush('consultation_booking',fixture.id);rejectedRow=await Booking.findById(fixture.id);
  }
  assert.equal(rejectedRow.registration_status,'Cancelled');assert.equal(rejectedRow.alternative_accepted_at,undefined);
  assert.equal(await Log.countDocuments({reference_id:rejectedRow._id,event:'admin_consulting_booking',message:/Customer rejected proposed time/}),1);
  assert.ok(await Log.exists({reference_id:rejectedRow._id,event:'consulting_status_update',channel:'email',message:/Customer rejected proposed time/}));
  assert.equal((await request(freeBase+'/cancel',{_csrf:adminCsrf},'admin')).status,303);
  assert.equal((await request(freeBase+'/cancel',{_csrf:adminCsrf},'admin')).status,303);
  assert.equal(await Log.countDocuments({reference_id:free.id,event:'admin_consulting_booking',message:/Status: Cancelled/}),1);
  // New unpaid product orders notify only the owner; they never unlock or confirm anything.
  const Settings=require('../models/mongo/NotificationSettings'),Order=require('../models/mongo/Order');
  await Settings.updateOne({_id:'default'},{$set:{admin_new_order_alert:true}});
  const orderFixture=await Order.create({customer_id:new mongoose.Types.ObjectId(),customer_snapshot:{name:'Order Customer',email:'order@example.test',phone:'+919876543210'},grand_total:12.34,items:[]});
  await Promise.all([notifications.safeFlush('product_order',orderFixture.id),notifications.safeFlush('product_order',orderFixture.id)]);
  assert.equal(await Log.countDocuments({reference_id:orderFixture.id}),1);
  const orderLog=await Log.findOne({reference_id:orderFixture.id,event:'admin_new_order_alert'});
  assert.equal(orderLog.destination,'owner@example.test');assert.match(orderLog.message,/NOT A PAYMENT CONFIRMATION/);assert.match(orderLog.message,/order@example.test/);
  assert.equal((await Order.findById(orderFixture.id)).payment_status,'unpaid');assert.equal((await Order.findById(orderFixture.id)).order_status,'pending');
  await notifications.enqueue('product_order',orderFixture.id,{key:'paid',event:'payment_success'});
  assert.equal(await Log.countDocuments({reference_id:orderFixture.id,event:'admin_successful_payment'}),0,'Unverified paid events cannot notify payment success');
  await Order.updateOne({_id:orderFixture.id},{$set:{payment_status:'paid',payment_verified_at:new Date(),payment_reference:'pay_orderfixture'}});
  await notifications.enqueue('product_order',orderFixture.id,{key:'paid',event:'payment_success'});
  await notifications.enqueue('product_order',orderFixture.id,{key:'paid',event:'payment_success'});
  assert.equal(await Log.countDocuments({reference_id:orderFixture.id,event:'admin_successful_payment'}),1);
  assert.equal(await Log.countDocuments({reference_id:orderFixture.id,event:'admin_new_order_alert'}),1);
  let mockSends=0;const dispatch=notifications.createDispatcher({email:async()=>{mockSends++;return 'fixture-message';},whatsapp:async()=>{throw Error('Unexpected channel');}});
  await Promise.all([dispatch(orderLog.id),dispatch(orderLog.id)]);assert.equal(mockSends,1,'One worker claims a queued email');
  const totalLogs=await Log.countDocuments();await notifications.safeFlush('product_order',orderFixture.id);assert.equal(await Log.countDocuments(),totalLogs);
  await Settings.updateOne({_id:'default'},{$set:{admin_new_order_alert:false}});
  const disabledOrder=await Order.create({customer_id:new mongoose.Types.ObjectId(),customer_snapshot:{name:'Disabled alert',email:'order@example.test'},items:[]});
  await notifications.safeFlush('product_order',disabledOrder.id);
  assert.equal((await Log.findOne({reference_id:disabledOrder.id,event:'admin_new_order_alert'})).status,'skipped');
  const destination=require('../services/leadNotifications').ownerDestination;
  process.env.ADMIN_NOTIFICATION_EMAIL='admin@example.test';assert.equal(destination(),'admin@example.test');assert.equal(destination({},true),'owner@example.test');
  delete process.env.ADMIN_NOTIFICATION_EMAIL;delete process.env.LEAD_NOTIFICATION_TO;assert.equal(destination({contact_email:'site@example.test'}),'site@example.test');assert.equal(destination(), '');
  console.log('PASS: owner lifecycle/payment/new-order alerts, explicit customer rejection, accept/reject race, cancellation dedupe, recipient fallback, disabled event preservation and concurrent mock dispatch.');
  assert.equal(orderCount,1,'Only one mocked gateway order, no real provider');
  console.log('PASS: HTTP submission/deduplication, CSRF/ownership/Admin authorization, future date/time and Asia/Kolkata, payment-before-approval, alternative explicit acceptance and stale/concurrent protection, free approval, decline, decision timestamps, immutable fee, approval-before-payment, durable queue outage/retry, queued customer/Admin messages, legacy compatibility. No SMTP or live gateway calls.');
 }finally{
  if(server)await new Promise(r=>server.close(r));
  await mongoose.disconnect();await mongo.stop();
  if(require.cache[require.resolve('../config/db')])await require('../config/db').db.destroy();
 }
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
