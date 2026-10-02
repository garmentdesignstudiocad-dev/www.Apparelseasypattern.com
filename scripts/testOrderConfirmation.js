// Only order confirmation; isolated MongoDB, mocked Razorpay and SMTP. No .env loaded.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server');
Object.assign(process.env,{RAZORPAY_KEY_ID:'rzp_test_confirmation',RAZORPAY_KEY_SECRET:'test-secret',RAZORPAY_WEBHOOK_SECRET:'test-webhook',APP_BASE_URL:'https://store.example.test',ADMIN_NOTIFICATION_EMAIL:'owner@example.test',NOTIFICATIONS_WORKER_ENABLED:'false'});
const gateway=[];
require('razorpay');require.cache[require.resolve('razorpay')].exports=class{constructor(){this.orders={create:async data=>{const row={...data,id:'order_test'+gateway.length};gateway.push(row);return row;}};this.payments={fetch:async id=>{const order=gateway[Number(id.replace('pay_test',''))];return {id,order_id:order.id,amount:order.amount,currency:'INR',status:'captured',captured:true};}};}};
const controller=require('../controllers/checkoutController'),notifications=require('../services/notificationService');
const Order=require('../models/mongo/Order'),Customer=require('../models/mongo/Customer'),Log=require('../models/mongo/NotificationLog');
async function call(handler,req){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},sendStatus(code){this.code=code;return this;},redirect(url){this.code=302;this.url=url;return this;}};await handler(req,res,error=>{throw error;});return res;}
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'order-confirmation-'));
 try{
  process.env.PATTERN_FILES_DIR=dir;fs.writeFileSync(path.join(dir,'pattern.pdf'),'test asset');
  await mongoose.connect(mongo.getUri(),{dbName:'order_confirmation_test'});
  await require('../models/mongo/NotificationSettings').create({_id:'default',email_enabled:true,whatsapp_enabled:false,admin_successful_payment:true});
  const product=await require('../models/mongo/Product').create({name:'Confirmation Pattern',slug:'confirmation-pattern',base_price:100,physical_price:50,digital_file:'pattern.pdf'});
  await require('../services/deliveryService').configureRegions();
  await require('../models/mongo/Courier').create({_id:'fixture',name:'Fixture Courier',active:true});
  await require('../models/mongo/DeliveryZone').updateOne({_id:'south'},{$set:{partner_ids:['fixture']}});
  const sent=[];
  const email=require('../services/emailService').createEmailService({env:{EMAIL_HOST:'smtp.example.test',EMAIL_PORT:'587',EMAIL_SECURE:'false',EMAIL_USER:'test',EMAIL_PASSWORD:'test',EMAIL_FROM:'store@example.test'},createTransport:()=>({sendMail:async mail=>{sent.push(mail);return {accepted:[mail.to],messageId:mail.messageId};}})});
  const dispatch=notifications.createDispatcher({email,whatsapp:async()=>{throw new Error('Unexpected WhatsApp');}});
  for(const physical of [true,false]){
   const shipping=physical?{address:'12 Test Street',city:'Tiruppur',state:'Tamil Nadu',pincode:'638751',courier_id:'fixture'}:{};
   const result=await call(controller.postCheckout,{createRazorpayOrder:true,session:{},body:{customer:{name:'Order Customer',email:'customer@example.test',phone:'9876543210'},shipping,items:[{product_id:String(product._id),quantity:1,physical_quantity:physical?1:0}]}});
   assert.equal(result.code,200);const id=result.body.order_id;
   let order=await Order.findById(id).lean();assert.equal(order.payment_status,'unpaid');assert.equal(await Log.countDocuments({reference_id:id}),0);
   const paymentId='pay_test'+(gateway.length-1),orderId=result.body.razorpay_order_id;
   const signature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(orderId+'|'+paymentId).digest('hex');
   const body={razorpay_order_id:orderId,razorpay_payment_id:paymentId,razorpay_signature:signature};
   assert.equal((await call(controller.postRazorpayCallback,{body:{...body,razorpay_signature:'0'.repeat(64)}})).code,400);
   assert.equal(await Log.countDocuments({reference_id:id}),0);
   assert.equal((await call(controller.postRazorpayCallback,{body})).code,302);
   const raw=Buffer.from(JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:paymentId,order_id:orderId}}}}));
   const webhook={body:raw,get:()=>crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')};
   await Promise.all([call(controller.postRazorpayCallback,{body}),call(controller.postRazorpayWebhook,webhook),notifications.safeFlush('product_order',id)]);
   order=await Order.findById(id).lean();assert.equal(order.payment_status,'paid');assert.equal(order.order_status,'confirmed');assert.equal(order.payment_reference,paymentId);
   const customer=await Customer.findById(order.customer_id).lean();assert.equal(customer.phone,'9876543210');assert.equal(customer.email,'customer@example.test');
   if(physical){for(const key of ['address','city','state','pincode'])assert.equal(customer[key],shipping[key]);assert.equal(order.courier_name,'Fixture Courier');}
   const rows=await Log.find({reference_id:id,channel:'email',event:{$in:['order_payment_success','admin_successful_payment']}}).lean();assert.equal(rows.length,2);
   const customerMail=rows.find(r=>r.event==='order_payment_success'),ownerMail=rows.find(r=>r.event==='admin_successful_payment');
   assert.equal(customerMail.subject,'Order Confirmed - Garment Pattern Store - '+id);assert.equal(ownerMail.subject,'New Paid Order - '+id);
   assert.equal(ownerMail.destination,'owner@example.test');
   for(const row of rows)for(const value of ['Order Customer','Confirmation Pattern','GST (18%)','Subtotal:','Payment Status: paid'])assert.ok(row.message.includes(value),value);
   assert.ok(ownerMail.message.includes(paymentId));assert.ok(ownerMail.message.includes('9876543210'));
   assert.match(customerMail.message,/https:\/\/store.example.test\/downloads\/[a-f0-9]+/);
   if(physical)for(const value of ['12 Test Street','Tiruppur','Tamil Nadu','638751','South','Bengaluru','Fixture Courier'])assert.ok(ownerMail.message.includes(value));
   else assert.ok(!ownerMail.message.includes('\nDELIVERY\n'));
   for(const row of rows)await Promise.all([dispatch(row._id),dispatch(row._id)]);
   assert.equal(await Log.countDocuments({reference_id:id,channel:'email',status:'sent',event:{$in:['order_payment_success','admin_successful_payment']}}),2);
   const ejs=require('ejs'),strip=file=>fs.readFileSync(file,'utf8').replace(/<%- include\([^%]+%>/g,'');
   const detail=ejs.render(strip('views/admin/order_detail.ejs'),{title:'Order',order,customer,payment:null,learningCsrf:'test',couriers:[],formatCurrency:v=>String(v)});
   assert.ok(detail.includes('mailto:customer@example.test'));assert.ok(detail.includes('tel:9876543210'));
   const html=ejs.render(strip('views/admin/orders.ejs'),{title:'Orders',filters:{},orders:[{id,customer_name:customer.name,customer_email:customer.email,customer_phone:customer.phone,customer_address:physical?'12 Test Street':'',courier_name:order.courier_name,dispatch_location:order.dispatch_location,order_status:order.order_status,payment_status:order.payment_status,grand_total:order.grand_total}],formatCurrency:v=>String(v)});
   assert.ok(html.includes('tel:9876543210'));if(physical){assert.ok(html.includes('Bengaluru'));assert.ok(html.includes('Fixture Courier'));}
  }
  assert.equal(sent.length,4);console.log('PASS: customer confirmation, owner paid-order email, saved contacts/address, Admin contact links, signature gate, callback/webhook deduplication, secure digital links; mocked SMTP accepted exactly four confirmation emails.');
 }finally{await mongoose.disconnect();await mongo.stop();fs.unlinkSync(path.join(dir,'pattern.pdf'));fs.rmdirSync(dir);}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
