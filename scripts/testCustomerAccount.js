// Targeted HTTP account integration; temporary MongoDB, mocked gateway/email only.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server');
Object.assign(process.env,{NODE_ENV:'development',SESSION_SECRET:'account-test-session-only',RAZORPAY_KEY_ID:'rzp_test_accounts',RAZORPAY_KEY_SECRET:'account-test-secret',NOTIFICATIONS_WORKER_ENABLED:'false',APP_BASE_URL:'https://store.example.test',ADMIN_NOTIFICATION_EMAIL:'owner@example.test',DB_HOST:'127.0.0.1',DB_PORT:'1'});
const gateway=[];
require('razorpay');require.cache[require.resolve('razorpay')].exports=class{constructor(){this.orders={create:async data=>{const row={...data,id:'order_account'+gateway.length};gateway.push(row);return row;}};this.payments={fetch:async id=>{const order=gateway[Number(id.replace('pay_account',''))];return {id,order_id:order.id,amount:order.amount,currency:'INR',status:'captured',captured:true};}};}};
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-download-'));let server;
 try{
  process.env.MONGODB_URI=mongo.getUri();process.env.PATTERN_FILES_DIR=dir;fs.writeFileSync(path.join(dir,'pattern.pdf'),'private account test');
  await mongoose.connect(mongo.getUri());
  const Customer=require('../models/mongo/Customer'),Order=require('../models/mongo/Order'),Log=require('../models/mongo/NotificationLog');
  await Customer.init();await require('../models/mongo/NotificationSettings').create({_id:'default',email_enabled:true,whatsapp_enabled:false});
  const product=await require('../models/mongo/Product').create({name:'Account Pattern',slug:'account-pattern',base_price:100,physical_price:50,digital_file:'pattern.pdf'});
  server=require('../server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port,jars={};
  async function request(url,body,who='a',json=false){const response=await fetch(origin+url,{method:body?'POST':'GET',redirect:'manual',headers:{...(jars[who]?{cookie:jars[who]}:{}),...(body?{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'}:{})},body:body?(json?JSON.stringify(body):new URLSearchParams(body)):undefined});const cookie=response.headers.get('set-cookie');if(cookie)jars[who]=cookie.split(';')[0];return {status:response.status,location:response.headers.get('location'),text:await response.text()};}
  async function token(url,who){const response=await request(url,null,who);return response.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];}
  const password='Correct password 2026!';
  const registration={name:'Account A',email:'a@example.test',phone:'9876543210',password,confirm_password:password};
  assert.equal((await request('/account')).status,303);
  assert.equal((await request('/checkout',null,'guest')).location,'/account/login');
  for(const url of ['/checkout','/checkout/payment-method/proceed'])assert.equal((await request(url,{},'guest',true)).status,401);
  let csrf=await token('/account/register','a'),oldCookie=jars.a;
  assert.equal((await request('/account/register',{...registration,_csrf:'bad'})).status,403);
  assert.equal((await request('/account/register',{...registration,_csrf:csrf})).status,303);assert.notEqual(jars.a,oldCookie);
  let account=await Customer.findOne({email:registration.email}).select('+password_hash');assert.notEqual(account.password_hash,password);assert.match(account.password_hash,/^scrypt:/);
  assert.equal((await Customer.findById(account._id).lean()).password_hash,undefined);
  assert.equal((await request('/account/register',{...registration,_csrf:await token('/account/register','duplicate')},'duplicate')).status,409);
  await request('/cart/add',{product_id:String(product._id),quantity:1},'a',true);
  const prefill=await request('/checkout');assert.ok(prefill.text.includes('value="Account A"'));assert.ok(prefill.text.includes('value="a@example.test"'));assert.ok(prefill.text.includes('value="9876543210"'));
  assert.equal((await request('/account/logout',{_csrf:await token('/account','a')})).status,303);assert.equal((await request('/account')).status,303);
  csrf=await token('/login','a');assert.equal((await request('/account/login',{email:registration.email,password:'wrong password',_csrf:csrf})).status,401);
  csrf=await token('/login','a');oldCookie=jars.a;assert.equal((await request('/account/login',{email:'A@EXAMPLE.TEST',password,_csrf:csrf})).status,303);assert.notEqual(jars.a,oldCookie);
  await request('/account/register',{...registration,name:'Account B',email:'b@example.test',_csrf:await token('/account/register','b')},'b');
  const Zone=require('../models/mongo/DeliveryZone');await require('../services/deliveryService').configureRegions();
  await require('../models/mongo/Courier').create([{_id:'south-test',name:'South Courier',active:true},{_id:'north-test',name:'North Courier',active:true}]);
  await Zone.updateOne({_id:'south'},{$set:{partner_ids:['south-test']}});await Zone.updateOne({_id:'north'},{$set:{states:['punjab'],partner_ids:['north-test']}});
  const orders=[];
  for(const [who,physical] of [['a',false],['b',false],['a',true],['b',true]]){

   const payload={customer:{name:'Forged buyer',email:'forged@example.test',phone:'9876543211'},items:[{product_id:String(product._id),quantity:1,physical_quantity:physical?1:0}],shipping:physical?{address:'12 Test Street',city:who==='a'?'Tiruppur':'Ludhiana',state:who==='a'?'Tamil Nadu':'Punjab',pincode:'638751',courier_id:who==='a'?'south-test':'north-test'}:{}};
   if(physical)assert.equal((await request('/checkout',{...payload,shipping:{...payload.shipping,courier_id:who==='a'?'north-test':'south-test'}},who,true)).status,400);
   assert.equal((await request('/checkout',payload,who,true)).status,200);
   const paymentPage=await request('/checkout/payment-method',null,who);assert.equal(paymentPage.status,200);assert.ok(paymentPage.text.includes('data.login_url'));
   const payment=JSON.parse((await request('/checkout/payment-method/proceed',{},who,true)).text);const id=payment.order_id;
   let order=await Order.findById(id).lean();assert.equal(String(order.account_customer_id),String((await Customer.findOne({email:who+'@example.test'}))._id));
   assert.equal(order.customer_snapshot.email,who+'@example.test');
   assert.equal(await Log.countDocuments({reference_id:id,event:'order_digital_ready'}),0);
   const paymentId='pay_account'+(gateway.length-1),signature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(payment.razorpay_order_id+'|'+paymentId).digest('hex');
   const callback={razorpay_order_id:payment.razorpay_order_id,razorpay_payment_id:paymentId,razorpay_signature:signature};
   assert.equal((await request('/checkout/razorpay-callback',{...callback,razorpay_signature:'0'.repeat(64)},who,true)).status,400);
   assert.equal(await Log.countDocuments({reference_id:id,event:'order_digital_ready'}),0);
   assert.equal((await request('/checkout/razorpay-callback',callback,who,true)).status,302);
   order=await Order.findById(id).select('+download_token').lean();orders.push(order);
   if(physical){assert.equal(order.dispatch_location,who==='a'?'Bengaluru':'Mumbai');assert.equal(order.courier_name,who==='a'?'South Courier':'North Courier');}
   assert.equal(order.grand_total,physical?177:118);assert.equal(order.tax_amount,physical?27:18);assert.equal(payment.amount,physical?17700:11800);
   assert.ok(order.payment_verified_at);assert.equal(order.payment_status,'paid');
   const log=await Log.findOne({reference_id:id,event:'order_digital_ready',channel:'email'}).lean();assert.equal(log.destination,order.customer_snapshot.email);assert.ok(log.message.includes('/downloads/'+order.download_token));
   let sent=0;await require('../services/notificationService').createDispatcher({email:async()=>{sent++;return 'mock-email';}})(log._id);assert.equal(sent,1);
   assert.equal((await request('/downloads/'+order.download_token+'/0',null,who)).status,200);
  }
  const own=await request('/account/orders');assert.ok(own.text.includes(String(orders[0]._id)));assert.ok(!own.text.includes(String(orders[1]._id)));assert.ok(!own.text.includes(account.password_hash));
  assert.ok(own.text.includes('Secure Downloads'));assert.ok(own.text.includes('Bengaluru'));
  assert.ok(!(await request('/account/orders',null,'b')).text.includes(String(orders[0]._id)));
  assert.equal((await request('/account/orders/'+orders[0]._id+'/download',null,'b')).status,404);
  assert.equal((await request('/account/orders/'+orders[0]._id,null,'b')).status,404);
  assert.equal((await request('/downloads/'+orders[0].download_token+'/0',null,'b')).status,404);
  assert.equal((await request('/downloads/'+orders[0].download_token+'/0',null,'guest')).status,303);
  assert.equal((await request('/account/orders/'+orders[0]._id+'/download')).status,303);
  assert.equal((await request('/account/logout',{_csrf:await token('/account','a')})).status,303);
  assert.equal((await request('/checkout')).location,'/account/login');
  assert.equal((await request('/checkout/payment-method/proceed',{},'a',true)).status,401);
  const returnLogin=await request('/account/login',{email:'a@example.test',password,_csrf:await token('/account/login','a')});assert.equal(returnLogin.location,'/checkout');
  const paid=await Log.findOne({reference_id:orders[1]._id,event:'order_payment_success',channel:'email'});
  await require('../services/notificationService').createDispatcher({email:async()=>{throw new Error('SMTP unavailable');}})(paid._id);
  assert.equal((await Log.findById(paid._id)).status,'failed');assert.equal((await Order.findById(orders[1]._id)).payment_status,'paid');
  console.log('PASS: all 17 mandatory-account integration checks; CSRF/session rotation, duplicate signup, authenticated paid downloads, account ownership/IDOR, scrypt, guest checkout blocked, SMTP failure isolation.');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(require.cache[require.resolve('../config/db')])await require('../config/db').db.destroy();await mongo.stop();fs.unlinkSync(path.join(dir,'pattern.pdf'));fs.rmdirSync(dir);}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
