// HTTP + MongoDB integration tests. Temporary collections and a mocked gateway only.
require('dotenv').config();
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mongoose=require('mongoose');
const prefix=`access_test_${process.pid}_${Date.now()}_`,models={};
const names=['Product','ProductFile','Addon','Customer','Order','Payment','TaxSettings','DeliverySettings','Pincode','SiteSettings','ClassSession','ClassRegistration','Course','Webinar','CourseBooking','WebinarRegistration','Lead','Book','Article','Coupon','PricingSettings','DeliveryZone','Receipt','NotificationLog','NotificationSettings','Courier','FeatureSettings','PaidAccessSettings','ConsultingService','BookPurchase','ConsultationBooking'];
for(const name of names){const filename=require.resolve('../models/mongo/'+name),Original=require(filename);models[name]=mongoose.model('AccessTest'+name,Original.schema.clone(),prefix+name.toLowerCase());require.cache[filename].exports=models[name];}
const orders=new Map(),payments=new Map();let created=0;
const gateway={orders:{create:async data=>{const row={...data,id:`order_access${++created}`};orders.set(row.id,row);return row;},fetch:async id=>orders.get(id),fetchPayments:async id=>({items:[...payments.values()].filter(p=>p.order_id===id)})},payments:{fetch:async id=>payments.get(id)}};
require('razorpay');require.cache[require.resolve('razorpay')].exports=class{constructor(){return gateway;}};
process.env.RAZORPAY_KEY_ID='rzp_test_access';process.env.RAZORPAY_KEY_SECRET='access-test-secret';
process.env.ADMIN_USERNAME='access-owner';process.env.ADMIN_PASSWORD='access-test-password';
let server;
async function run(){
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URL || process.env.MONGO_URI,{serverSelectionTimeoutMS:15000,autoIndex:false});
  for(const Model of Object.values(models)){await Model.createCollection();await Model.createIndexes();}
  if(process.env.TEST_NOTIFICATIONS==='true'){process.env.PUBLIC_BASE_URL='https://studio.example.test';await models.NotificationSettings.create({_id:'default',email_enabled:true,whatsapp_enabled:true});}
  const {Course,Webinar,Book,ConsultingService,CourseBooking,WebinarRegistration,BookPurchase,ConsultationBooking,PaidAccessSettings}=models;
  await Course.create({name:'Access Course',slug:'access-course',active:true,mode:'Online',access_url:'https://example.test/private-course'});
  const future=new Date(Date.now()+7*86400000),webinar={title:'Access Webinar',starts_at:future,duration_minutes:60,active:true,registration_open:true,meeting_link:'https://example.test/private-meeting'};
  await Webinar.create({...webinar,slug:'access-webinar'});
  await Webinar.create({...webinar,slug:'free-webinar',price:0});
  await Book.create({title:'Digital Book',slug:'digital-book',active:true,purchase_type:'direct',ebook_url:'https://example.test/private-book'});
  await Book.create({title:'Amazon Book',slug:'amazon-book',active:true,purchase_type:'external',amazon_url:'https://www.amazon.in/dp/EXAMPLE'});
  await Book.create({title:'Free Book',slug:'free-book',active:true,purchase_type:'free',ebook_url:'https://example.test/free-book'});
  await ConsultingService.create({name:'Fit Consultation',slug:'fit-consultation',active:true});
  const app=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,jars={};
  async function request(url,body,who='visitor'){
    const response=await fetch(origin+url,{method:body?'POST':'GET',redirect:'manual',headers:{...(jars[who]?{cookie:jars[who]}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?new URLSearchParams(body):undefined});
    const cookie=response.headers.get('set-cookie');if(cookie)jars[who]=cookie.split(';')[0];
    const html=await response.text();return {status:response.status,html,location:response.headers.get('location'),json:()=>JSON.parse(html)};
  }
  const token=html=>html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1] || html.match(/data-csrf="([a-f0-9]+)"/)?.[1];
  const nonce=html=>html.match(/name="submission_key" value="([a-f0-9]+)"/)?.[1];
  const person={name:'Access Learner',full_name:'Access Learner',email:'access@example.test',whatsapp:'+919876543210',preferred_date:future.toISOString().slice(0,10),preferred_time:'14:00',mode:'Online',notes:'Fit review required'};
  async function register(path,post,who){const page=await request(path,null,who);assert.equal(page.status,200,path);const result=await request(post,{...person,_csrf:token(page.html),submission_key:nonce(page.html),amount:'1',amount_paise:'1'},who);assert.equal(result.status,303,result.html);return result.location;}
  async function pay(url,Model,who,privateText){
    let page=await request(url,null,who);assert.equal(page.status,200,page.html);if(privateText)assert.ok(!page.html.includes(privateText));
    assert.equal((await request(url,null,'intruder')).status,403);
    const csrf=token(page.html),id=url.split('/').pop();
    assert.equal((await request(url+'/order',{_csrf:'wrong'},who)).status,403);
    const orderResponse=await request(url+'/order',{_csrf:csrf,amount_paise:'1'},who);assert.equal(orderResponse.status,200,orderResponse.html);const order=orderResponse.json();assert.equal(order.amount,19900);
    assert.equal((await request(url+'/order',{_csrf:csrf},who)).json().order_id,order.order_id);
    const paymentId='pay_access'+created;
    const valid={_csrf:csrf,razorpay_order_id:order.order_id,razorpay_payment_id:paymentId,razorpay_signature:crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(order.order_id+'|'+paymentId).digest('hex')};
    payments.set(paymentId,{id:paymentId,order_id:order.order_id,amount:19900,currency:'INR',status:'captured',captured:true});
    assert.equal((await request(url+'/verify',{...valid,razorpay_signature:'0'.repeat(64)},who)).status,400);
    assert.equal((await Model.findById(id)).payment_status,'Pending');
    if(privateText)assert.ok(!(await request(url,null,who)).html.includes(privateText));
    payments.get(paymentId).amount=1;assert.equal((await request(url+'/verify',valid,who)).status,400);payments.get(paymentId).amount=19900;
    payments.get(paymentId).status='authorized';assert.equal((await request(url+'/verify',valid,who)).json().confirmed,false);payments.get(paymentId).status='captured';
    assert.equal((await request(url+'/verify',valid,who)).json().confirmed,true);
    assert.equal((await request(url+'/verify',valid,who)).json().confirmed,true);
    const row=await Model.findById(id);assert.equal(row.payment_status,'Paid');assert.equal(row.registration_status,'Confirmed');assert.equal(row.local_reference_id,id);assert.ok(row.payment_purpose);
    page=await request(url,null,who);assert.match(page.html,/Payment Successful/);if(privateText)assert.ok(page.html.includes(privateText));
    return {url,id,csrf,valid,who,Model};
  }
  assert.ok(!(await request('/courses/access-course')).html.includes('private-course'));
  const course=await pay(await register('/courses/access-course','/courses/access-course/book','course'),CourseBooking,'course','private-course');
  await pay(await register('/webinars/access-webinar','/webinars/access-webinar/register','webinar'),WebinarRegistration,'webinar','private-meeting');
  const freeUrl=await register('/webinars/free-webinar','/webinars/free-webinar/register','free-webinar');assert.ok((await request(freeUrl,null,'free-webinar')).html.includes('private-meeting'));assert.equal((await WebinarRegistration.findById(freeUrl.split('/').pop())).payment_status,'Not Required');
  assert.ok(!(await request('/books/digital-book')).html.includes('private-book'));
  const book=await pay(await register('/books/digital-book/access','/books/digital-book/access','book'),BookPurchase,'book','private-book');
  const amazon=await request('/books/amazon-book');assert.equal(amazon.status,200);assert.match(amazon.html,/https:\/\/www.amazon.in/);assert.ok(!amazon.html.includes('/amazon-book/access'));assert.equal((await request('/books/amazon-book/access')).status,409);
  await pay(await register('/consulting/fit-consultation/access','/consulting/fit-consultation/access','consulting'),ConsultationBooking,'consulting');
  const freeBook=await register('/books/free-book/access','/books/free-book/access','free-book');assert.equal((await BookPurchase.findById(freeBook.split('/').pop())).amount_paise,0);assert.ok((await request(freeBook,null,'free-book')).html.includes('https://example.test/free-book'));
  assert.equal(created,4,'Only the four paid registrations created gateway orders.');
  if(process.env.TEST_CONSULTING_FORMS==='true')await require('./consultingFormAssertions')({models,request,token,nonce,person,gateway});
  assert.equal((await request('/admin/settings/paid-access')).location,'/admin/login');
  const login=await request('/admin/login',null,'admin');
  const loginToken=login.html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  assert.equal((await request('/admin/login',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD,_csrf:loginToken},'admin')).status,302);
  const settingsPage=await request('/admin/settings/paid-access',null,'admin');assert.equal(settingsPage.status,200,settingsPage.html);const adminCsrf=token(settingsPage.html),update={_csrf:adminCsrf};
  for(const kind of ['courses','webinars','books','consulting'])Object.assign(update,{[kind+'_fee']:'299',[kind+'_button']:'Continue '+kind,[kind+'_enabled']:'on',[kind+'_active']:'on'});
  assert.equal((await request('/admin/settings/paid-access',{...update,courses_fee:'-1'},'admin')).status,400);
  assert.equal((await request('/admin/settings/paid-access',update,'admin')).status,303);
  assert.equal((await PaidAccessSettings.findById('default')).courses.fee,299);
  for(const path of ['/courses/access-course','/webinars/access-webinar','/books/digital-book','/consulting'])assert.match((await request(path)).html,/299/);
  assert.equal((await CourseBooking.findById(course.id)).amount_paise,19900,'Existing fee snapshots remain unchanged.');
  await Course.updateOne({slug:'access-course'},{$set:{price:499}});assert.match((await request('/courses/access-course')).html,/499/);
  assert.equal((await request('/admin/access-records?kind=books&q=Access&payment=Paid',null,'admin')).status,200);
  assert.equal((await request('/admin/access-records?kind=consulting',null,'admin')).status,200);
  assert.equal((await request('/admin/consulting',null,'admin')).status,200);
  if(process.env.TEST_NOTIFICATIONS==='true')await require('./notificationAssertions')({models,request,token,course,book,adminCsrf,gateway});
  if(process.env.TEST_FEATURES==='true')await require('./featureAssertions')({models,request,token,book});
  const cancelBase='/admin/access-records/books/'+book.id;
  await request(cancelBase+'/cancel',{_csrf:adminCsrf},'admin');assert.equal((await BookPurchase.findById(book.id)).registration_status,'Confirmed');
  await request(cancelBase+'/cancel',{_csrf:adminCsrf,refund_acknowledged:'on'},'admin');assert.equal((await BookPurchase.findById(book.id)).registration_status,'Cancelled');
  assert.equal((await request(book.url+'/verify',book.valid,book.who)).json().confirmed,false);assert.ok(!(await request(book.url,null,book.who)).html.includes('private-book'));
  const disabled={...update,courses_enabled:'',webinars_active:''};await request('/admin/settings/paid-access',disabled,'admin');assert.match((await request('/courses/access-course')).html,/Free/);assert.equal((await request('/webinars')).status,404);assert.equal((await request('/webinars/access-webinar')).status,404);
  console.log('PASS: A–H paid course/webinar/book/consulting, free webinar/book, Amazon bypass, admin ₹299 updates, overrides, disabled/inactive, CSRF/session ownership, captured amount verification, bad signatures, duplicate callbacks, cancellation privacy and immutable snapshots. No real charges.');
}
run().catch(error=>{console.error('Paid access tests failed:',error.name,error instanceof assert.AssertionError?error.message:'Database or test setup failed; credentials are not printed.');process.exitCode=1;}).finally(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(mongoose.connection.readyState===1)for(const Model of Object.values(models)){assert.ok(Model.collection.name.startsWith(prefix));await Model.collection.drop().catch(error=>{if(error.code!==26)throw error;});}
  await mongoose.disconnect();if(require.cache[require.resolve('../config/db')])await require('../config/db').db.destroy();
});
