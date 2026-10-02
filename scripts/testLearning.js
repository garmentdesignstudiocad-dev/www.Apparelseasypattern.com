// Real MongoDB integration tests in uniquely named temporary collections.
// Razorpay is a deterministic test double: no gateway orders or payments are sent.
require('dotenv').config();
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const mongoose=require('mongoose');
const ejs=require('ejs');
const prefix=`learning_test_${process.pid}_${Date.now()}_`;
const models={};
const originals={};
for(const name of ['Course','Webinar','CourseBooking','WebinarRegistration','SiteSettings','Receipt','NotificationLog','NotificationSettings','Courier','FeatureSettings','PaidAccessSettings','ConsultingService','BookPurchase','ConsultationBooking']) {
  const filename=require.resolve(`../models/mongo/${name}`);
  const original=require(filename);originals[name]=original;
  models[name]=mongoose.model(`LearningTest${name}`,original.schema.clone(),prefix+name.toLowerCase());
  require.cache[filename].exports=models[name];
}
const {Course,Webinar,CourseBooking:Booking,WebinarRegistration:Registration}=models;
const {createService,failure}=require('../services/webinarPaymentService');
const secret='isolated-webinar-test-secret';
let orderCount=0, failOrder=false;
const orders=new Map(),payments=new Map();
const gateway={orders:{
  create:async data=>{if(failOrder==='rejected')throw Object.assign(new Error('Rejected'),{statusCode:400});orderCount++;const order={...data,id:`order_test${orderCount}`};orders.set(order.id,order);if(failOrder)throw new Error('Ambiguous network timeout');return order;},
  fetch:async id=>orders.get(id),
  fetchPayments:async id=>({items:[...payments.values()].filter(p=>p.order_id===id)}),
},payments:{fetch:async id=>payments.get(id)}};
const service=createService({gateway,WebinarModel:Webinar,RegistrationModel:Registration,secret,key:'rzp_test_isolated'});
require.cache[require.resolve('../services/webinarPaymentService')].exports={createService:()=>service,failure};
process.env.ADMIN_USERNAME='learning-test-owner';process.env.ADMIN_PASSWORD='learning-test-password';
process.env.SITE_URL='https://studio.example';
const uri=process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URL || process.env.MONGO_URI;
let server;
async function run() {
  for(const folder of ['routes','services','middleware','models/mongo','public/js','scripts']) {
    for(const file of fs.readdirSync(path.resolve(__dirname,'..',folder))) if(file.endsWith('.js')) execFileSync(process.execPath,['--check',path.resolve(__dirname,'..',folder,file)]);
  }
  execFileSync(process.execPath,['--check',path.resolve(__dirname,'../server.js')]);
  let compiled=0;
  function compile(dir) {for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())compile(file);else if(file.endsWith('.ejs')){ejs.compile(fs.readFileSync(file,'utf8'),{filename:file});compiled++;}}}
  compile(path.resolve(__dirname,'../views'));
  assert.ok(uri,'MongoDB configuration is required for this isolated integration test.');
  await mongoose.connect(uri,{serverSelectionTimeoutMS:15000,autoIndex:false});
  // Only the isolated models get collections/indexes created by this test.
  for(const Model of Object.values(models)) {await Model.createCollection();await Model.createIndexes();}
  const course=await Course.create({name:'Test Pattern Course',slug:'test-pattern-course',short_description:'Practical pattern making',description:'Course details',trainer:'Test Trainer',duration:'6 weeks',mode:'Online / Offline',price:2500,modules:['Basic Blocks','Grading'],schedule_information:'Weekends',active:true});
  const future=new Date(Date.now()+7*86400000);
  const base={title:'Test Webinar',description:'Webinar details',speaker:'Test Speaker',starts_at:future,duration_minutes:90,mode:'Online',meeting_platform:'Zoom',meeting_link:'https://example.test/private-meeting',active:true,registration_open:true,max_seats:1};
  const free=await Webinar.create({...base,slug:'test-free-webinar',price:0});
  const paid=await Webinar.create({...base,slug:'test-paid-webinar',price:499});
  await Webinar.create({...base,slug:'test-hidden-webinar',active:false});
  const app=require('../server');
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const jars={};
  async function request(url,body,who='visitor') {
    const response=await fetch(origin+url,{method:body?'POST':'GET',redirect:'manual',headers:{...(jars[who]?{cookie:jars[who]}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?new URLSearchParams(body):undefined});
    const cookie=response.headers.get('set-cookie');if(cookie)jars[who]=cookie.split(';')[0];
    return {status:response.status,html:await response.text(),location:response.headers.get('location')};
  }
  const token=html=>html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1] || html.match(/data-csrf="([a-f0-9]+)"/)?.[1];
  const person={full_name:'Learning Test',email:'learner@example.test',whatsapp:'+919876543210',country:'India',city:'Delhi',profession:'Pattern Maker',experience_level:'Beginner'};
  for(const route of ['/courses','/courses/test-pattern-course','/webinars','/webinars/test-free-webinar','/webinars/test-paid-webinar','/books','/updates','/consulting','/cart','/checkout','/admin/login']) assert.equal((await request(route)).status,200,route);
  assert.equal((await request('/webinars/test-hidden-webinar')).status,404);
  const home=await request('/');assert.match(home.html,/Featured Courses/);assert.match(home.html,/Upcoming Webinars/);assert.match(home.html,/Books/);assert.match(home.html,/Latest Fashion Updates/);
  const detail=await request('/webinars/test-free-webinar');assert.ok(!detail.html.includes('private-meeting'));
  for(const route of ['/admin/courses','/admin/webinars','/admin/course-bookings','/admin/webinar-registrations','/admin/webinar-registrations/export.csv']) assert.equal((await request(route)).location,'/admin/login');
  const coursePage=await request('/courses/test-pattern-course',null,'booker');
  const nonce=coursePage.html.match(/name="submission_key" value="([a-f0-9]+)"/)[1];
  const booking={_csrf:token(coursePage.html),submission_key:nonce,name:'Course Learner',email:'booker@example.test',whatsapp:'+919876543210',preferred_date:future.toISOString().slice(0,10),preferred_time:'14:00',mode:'Online',experience_level:'Beginner',notes:'Weekend classes'};
  assert.equal((await request('/courses/test-pattern-course/book',{...booking,_csrf:'wrong'},'booker')).status,403);
  assert.equal((await request('/courses/test-pattern-course/book',{...booking,email:'bad'},'booker')).status,400);
  assert.equal((await request('/courses/test-pattern-course/book',{...booking,preferred_date:'2026-02-30'},'booker')).status,400);
  const bookings=await Promise.all([request('/courses/test-pattern-course/book',booking,'booker'),request('/courses/test-pattern-course/book',booking,'booker')]);
  assert.ok(bookings.some(r=>r.status===303));assert.equal(await Booking.countDocuments(),1);
  const savedBooking=await Booking.findOne();assert.equal(savedBooking.status,'New');
  assert.equal((await request(`/course-bookings/${savedBooking._id}`,null,'booker')).status,200);
  assert.equal((await request(`/course-bookings/${savedBooking._id}`,null,'intruder')).status,403);
  const freePage=await request('/webinars/test-free-webinar',null,'free');
  assert.equal((await request('/webinars/test-free-webinar/register',{...person,_csrf:token(freePage.html),email:'bad'},'free')).status,400);
  const freeResult=await request('/webinars/test-free-webinar/register',{...person,_csrf:token(freePage.html)},'free');assert.equal(freeResult.status,303);
  let freeReg=await Registration.findOne({webinar_id:free._id});assert.equal(freeReg.registration_status,'Confirmed');assert.equal(freeReg.payment_status,'Not Required');
  assert.match((await request(freeResult.location,null,'free')).html,/private-meeting/);
  assert.equal((await request(freeResult.location,null,'intruder')).status,403);
  assert.equal((await request('/webinars/test-free-webinar/register',{...person,_csrf:token(freePage.html)},'free')).status,303);
  assert.equal(await Registration.countDocuments({webinar_id:free._id}),1);
  const dupPage=await request('/webinars/test-free-webinar',null,'duplicate');
  assert.equal((await request('/webinars/test-free-webinar/register',{...person,_csrf:token(dupPage.html)},'duplicate')).status,409);
  assert.equal((await request('/webinars/test-free-webinar/register',{...person,email:'second@example.test',_csrf:token(dupPage.html)},'duplicate')).status,409);
  assert.equal((await Webinar.findById(free._id).select('+seat_ids')).seat_ids.length,1);
  const paidPage=await request('/webinars/test-paid-webinar',null,'paid');
  const paidResult=await request('/webinars/test-paid-webinar/register',{...person,_csrf:token(paidPage.html)},'paid');assert.equal(paidResult.status,303);
  let paidReg=await Registration.findOne({webinar_id:paid._id});assert.equal(paidReg.registration_status,'Payment Pending');
  const paymentPage=await request(paidResult.location,null,'paid');assert.ok(!paymentPage.html.includes('private-meeting'));
  const payToken=token(paymentPage.html);const url=`/webinar-registrations/${paidReg._id}`;
  const orderResults=await Promise.all([request(url+'/order',{_csrf:payToken},'paid'),request(url+'/order',{_csrf:payToken},'paid')]);
  assert.ok(orderResults.some(r=>r.status===200));assert.equal(orderCount,1);
  const order=JSON.parse(orderResults.find(r=>r.status===200).html);assert.equal(order.amount,49900);
  await Webinar.updateOne({_id:paid._id},{$set:{price:999}});
  assert.equal(JSON.parse((await request(url+'/order',{_csrf:payToken},'paid')).html).amount,49900);
  const payment={id:'pay_test1',order_id:order.order_id,amount:49900,currency:'INR',status:'authorized',captured:false};payments.set(payment.id,payment);
  const signature=crypto.createHmac('sha256',secret).update(`${order.order_id}|${payment.id}`).digest('hex');
  const verification={_csrf:payToken,razorpay_order_id:order.order_id,razorpay_payment_id:payment.id,razorpay_signature:signature};
  assert.equal((await request(url+'/verify',{...verification,razorpay_signature:'0'.repeat(64)},'paid')).status,400);
  assert.equal((await request(url+'/verify',verification,'intruder')).status,403);
  assert.equal(JSON.parse((await request(url+'/verify',verification,'paid')).html).confirmed,false);
  payment.status='captured';payment.captured=true;payment.amount=1;
  assert.equal((await request(url+'/verify',verification,'paid')).status,400);
  payment.amount=49900;
  const verifies=await Promise.all([request(url+'/verify',verification,'paid'),request(url+'/verify',verification,'paid')]);
  assert.ok(verifies.every(r=>JSON.parse(r.html).confirmed));
  paidReg=await Registration.findById(paidReg._id);assert.equal(paidReg.payment_status,'Paid');assert.equal(paidReg.registration_status,'Confirmed');
  assert.equal((await Webinar.findById(paid._id).select('+seat_ids')).seat_ids.length,1);
  assert.match((await request(url,null,'paid')).html,/private-meeting/);
  // Real MongoDB atomic claims under concurrent registration.
  const race=await Webinar.create({...base,slug:'test-seat-race',price:0});
  const racers=await Registration.create([1,2].map(i=>({...person,email:`race${i}@example.test`,webinar_id:race._id,amount_paise:0,payment_status:'Not Required'})));
  const claims=await Promise.allSettled(racers.map(row=>service.claimSeat(row)));
  assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await Webinar.findById(race._id).select('+seat_ids')).seat_ids.length,1);
  assert.equal((await request('/admin/login',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD},'admin')).status,302);
  for(const route of ['/admin/courses','/admin/webinars','/admin/course-bookings','/admin/webinar-registrations','/admin/settings/appearance']) assert.equal((await request(route,null,'admin')).status,200,route);
  const adminForm=await request('/admin/courses/new',null,'admin');const adminToken=token(adminForm.html);
  const courseData={_csrf:adminToken,name:'Admin Test Course',slug:'admin-test-course',description:'Plain text',modules:'Module One\nModule Two',price:'1250.50',mode:'Online',schedule_information:'Saturdays',active:'on'};
  assert.equal((await request('/admin/courses/new',{...courseData,price:'-1'},'admin')).status,400);
  assert.equal((await request('/admin/courses/new',{...courseData,description:'<script>alert(1)</script>'},'admin')).status,400);
  assert.equal((await request('/admin/courses/new',courseData,'admin')).status,303);
  assert.equal((await request('/admin/courses/new',courseData,'admin')).status,400);
  const adminCourse=await Course.findOne({slug:courseData.slug});assert.equal(adminCourse.modules.length,2);
  assert.equal((await request(`/admin/courses/${adminCourse._id}/edit`,null,'admin')).status,200);
  assert.equal((await request(`/admin/courses/${adminCourse._id}/edit`,{...courseData,active:'',price:'1450'},'admin')).status,303);
  assert.equal((await request('/courses/admin-test-course')).status,404);
  const webinarData={_csrf:adminToken,title:'Admin Webinar',slug:'admin-webinar',description:'Live session',speaker:'Trainer',date:future.toISOString().slice(0,10),start_time:'15:00',duration_minutes:'60',price:'0',mode:'Online',meeting_platform:'Zoom',meeting_link:'https://example.test/admin-meeting',max_seats:'2',active:'on',registration_open:'on'};
  assert.equal((await request('/admin/webinars/new',{...webinarData,date:'2026-02-30'},'admin')).status,400);
  assert.equal((await request('/admin/webinars/new',{...webinarData,meeting_link:'javascript:alert(1)'},'admin')).status,400);
  assert.equal((await request('/admin/webinars/new',webinarData,'admin')).status,303);
  const adminWebinar=await Webinar.findOne({slug:'admin-webinar'});
  assert.equal((await request(`/admin/webinars/${adminWebinar._id}/edit`,null,'admin')).status,200);
  assert.equal((await request(`/admin/webinars/${adminWebinar._id}/edit`,{...webinarData,registration_open:''},'admin')).status,303);
  const closedPage=await request('/webinars/admin-webinar',null,'closed');
  assert.equal((await request('/webinars/admin-webinar/register',{...person,_csrf:token(paidPage.html)},'paid')).status,409);
  assert.equal((await request(`/admin/course-bookings/${savedBooking._id}`,null,'admin')).status,200);
  assert.equal((await request(`/admin/course-bookings/${savedBooking._id}/status`,{_csrf:adminToken,status:'Confirmed'},'admin')).status,409);
  assert.equal((await request(`/admin/course-bookings/${savedBooking._id}/status`,{_csrf:adminToken,status:'Contacted'},'admin')).status,303);
  assert.match((await request('/admin/course-bookings?q=Course&status=Contacted',null,'admin')).html,/1 records/);
  assert.match((await request(`/admin/webinar-registrations?item=${paid._id}&payment=Paid`,null,'admin')).html,/1 records/);
  const csv=await request(`/admin/webinar-registrations/export.csv?item=${paid._id}`,null,'admin');assert.equal(csv.status,200);assert.match(csv.html,/Learning Test/);assert.ok(!csv.html.includes('private-meeting'));
  assert.equal((await request(`/admin/webinar-registrations/${paidReg._id}/attend`,{_csrf:adminToken},'admin')).status,303);
  assert.equal((await Registration.findById(paidReg._id)).attendance_status,'Attended');
  await service.verify(paidReg._id,verification);assert.equal((await Registration.findById(paidReg._id)).registration_status,'Attended');
  await assert.rejects(()=>service.cancel(paidReg._id),/paid/);
  await service.cancel(paidReg._id,true);assert.equal((await Webinar.findById(paid._id).select('+seat_ids')).seat_ids.length,0);
  await service.verify(paidReg._id,verification);assert.equal((await Registration.findById(paidReg._id)).registration_status,'Cancelled');
  assert.ok(!(await request(url,null,'paid')).html.includes('private-meeting'));
  // Aborted client callback can be recovered from server-side gateway records.
  const recovery=await Webinar.create({...base,slug:'test-payment-recovery',price:100});
  const recoveryReg=await Registration.create({...person,webinar_id:recovery._id,amount_paise:10000,registration_status:'Payment Pending'});
  await service.claimSeat(recoveryReg);const recoveryOrder=await service.order(recoveryReg._id);
  payments.set('pay_recovery',{id:'pay_recovery',order_id:recoveryOrder.order_id,amount:10000,currency:'INR',status:'captured',captured:true});
  assert.equal((await service.reconcile(recoveryReg._id)).confirmed,true);
  // An ambiguous order-creation error is locked, then safely recoverable by its receipt.
  const stuck=await Registration.create({...person,email:'stuck@example.test',webinar_id:recovery._id,amount_paise:10000,registration_status:'Payment Pending'});
  failOrder=true;await assert.rejects(()=>service.order(stuck._id),/setup could not/);failOrder=false;
  const createdCount=orderCount;await assert.rejects(()=>service.order(stuck._id),/already in progress/);assert.equal(orderCount,createdCount);
  await service.recoverOrder(stuck._id,`order_test${orderCount}`);assert.equal((await Registration.findById(stuck._id)).order_creating,false);
  const noOrder=await Registration.create({...person,email:'no-order@example.test',webinar_id:recovery._id,amount_paise:10000,registration_status:'Payment Pending',order_creating:true});
  await assert.rejects(()=>service.resetOrder(noOrder._id,false),/Confirm/);
  await assert.rejects(()=>service.resetOrder(noOrder._id,true),/five minutes/);
  await Registration.updateOne({_id:noOrder._id},{$set:{updatedAt:new Date(Date.now()-6*60000)}},{timestamps:false});
  await service.resetOrder(noOrder._id,true);assert.equal((await Registration.findById(noOrder._id)).order_creating,false);
  failOrder='rejected';await assert.rejects(()=>service.order(noOrder._id),/rejected/);failOrder=false;
  assert.equal((await Registration.findById(noOrder._id)).order_creating,false);
  console.log(`PASS: ${compiled} EJS templates, JS syntax, course CRUD/booking/status/privacy, webinar CRUD/free and paid registrations, real MongoDB unique indexes and concurrent seats, CSRF/auth/validation, captured-payment checks, duplicate callbacks, fee snapshots, recovery, attendance, cancellation and CSV.`);
  console.log(`Tested detail URLs: ${origin}/courses/test-pattern-course ; ${origin}/webinars/test-free-webinar ; ${origin}/webinars/test-paid-webinar`);
  console.log('Razorpay requests were simulated. All learning records used isolated temporary collections.');
}
run().catch(error=>{console.error('Learning tests failed:',error.name,error.code || '',error instanceof assert.AssertionError?error.message:(error.status?error.message:'See the failing test or MongoDB connectivity; credentials are not printed.'));process.exitCode=1;}).finally(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(mongoose.connection.readyState===1) for(const Model of Object.values(models)) {
    assert.ok(Model.collection.name.startsWith(prefix));
    await Model.collection.drop().catch(error=>{if(error.code!==26)throw error;});
  }
  await mongoose.disconnect();
  if(require.cache[require.resolve('../config/db')])await require('../config/db').db.destroy();
});
