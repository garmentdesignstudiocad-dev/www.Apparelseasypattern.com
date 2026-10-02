// End-to-end regression against temporary MongoDB collections. No real gateway calls.
require('dotenv').config();
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const mongoose=require('mongoose');
const ejs=require('ejs');
const {execFileSync}=require('node:child_process');
const uri=process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URL || process.env.MONGO_URI;
const prefix=`stability_test_${process.pid}_${Date.now()}_`;
const names=['Product','ProductFile','Addon','Customer','Order','Payment','TaxSettings','DeliverySettings','Pincode','SiteSettings','ClassSession','ClassRegistration','Course','Webinar','CourseBooking','WebinarRegistration','Receipt','NotificationLog','NotificationSettings','Courier','FeatureSettings','PaidAccessSettings','ConsultingService','BookPurchase','ConsultationBooking','Lead','Book','Article','Coupon','PricingSettings','DeliveryZone'];
const models={};
for(const name of names) {
  const filename=require.resolve(`../models/mongo/${name}`),original=require(filename),schema=original.schema.clone();
  const refs=part=>part.eachPath((key,type)=>{if(names.includes(type.options.ref))type.options.ref='Stability'+type.options.ref;if(type.schema)refs(type.schema);});refs(schema);
  models[name]=mongoose.model('Stability'+name,schema,prefix+name.toLowerCase());require.cache[filename].exports=models[name];
}
const {Product,ProductFile,Addon,Customer,Order,Payment,TaxSettings,DeliverySettings,Pincode,SiteSettings,ClassSession,ClassRegistration,Book,Course}=models;
const gatewayOrders=[];
const paymentOverrides=new Map();
require('razorpay');require.cache[require.resolve('razorpay')].exports=class{constructor(){this.payments={fetch:async id=>paymentOverrides.get(id) || ({id,order_id:id==='pay_legacy'?'order_legacy':gatewayOrders[0].id,amount:id==='pay_legacy'?10000:gatewayOrders[0].amount,currency:'INR',status:'captured',captured:true})};this.orders={create:async data=>{const row={...data,id:`order_stability${gatewayOrders.length+1}`};gatewayOrders.push(row);await new Promise(resolve=>setTimeout(resolve,40));return row;}};}};
process.env.RAZORPAY_KEY_ID='rzp_test_stability';process.env.RAZORPAY_KEY_SECRET='stability-test-secret';
process.env.ADMIN_USERNAME='stability-owner';process.env.ADMIN_PASSWORD='stability-password';
let server;
async function run(){
  for(const folder of ['routes','controllers','services','middleware','models/mongo','config','scripts'])for(const file of fs.readdirSync(path.resolve(__dirname,'..',folder)))if(file.endsWith('.js'))execFileSync(process.execPath,['--check',path.resolve(__dirname,'..',folder,file)]);
  execFileSync(process.execPath,['--check',path.resolve(__dirname,'../server.js')]);
  let templates=0;function compile(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())compile(file);else if(file.endsWith('.ejs')){ejs.compile(fs.readFileSync(file,'utf8'),{filename:file});templates++;}}}compile(path.resolve(__dirname,'../views'));
  assert.ok(uri,'MongoDB is required for the isolated regression test.');await mongoose.connect(uri,{serverSelectionTimeoutMS:15000,autoIndex:false});
  for(const Model of Object.values(models)){await Model.createCollection();await Model.createIndexes();}
  const product=await Product.create({name:'Regression Pattern',slug:'regression-pattern',base_price:100,physical_price:50,trial_price:80,active:true});
  const other=await Product.create({name:'Other',slug:'other',active:true});
  const file=await ProductFile.create({product_id:product._id,file_name:'DXF',file_type:'DXF',file_price:20,active:true});
  const wrongFile=await ProductFile.create({product_id:other._id,file_name:'Other DXF',file_type:'DXF',file_price:20,active:true});
  const addon=await Addon.create({product_id:product._id,name:'Adjustment',price:10,active:true});
  await TaxSettings.create({key:'default',enabled:true,percentage:18});await DeliverySettings.create({key:'default',enabled:true,default_charge:25});
  await require('../services/deliveryService').configureRegions();
  await models.DeliveryZone.updateOne({_id:'south'},{$set:{states:['karnataka','tamil nadu'],partner_ids:['regression-courier']}});
  await Pincode.create({region_id:'south',pincode:'560001',district:'Bengaluru',state:'Karnataka',delivery_charge:40,active:true});
  await SiteSettings.create({key:'default',store_name:'Regression Studio',main_website_url:'https://example.test/wix'});
  // Missing newer optional fields must render without migrations.
  await Book.collection.insertOne({title:'Older Book',slug:'older-book',active:true});
  await Course.collection.insertOne({name:'Older Course',slug:'older-course',active:true,mode:'Online',price:0});
  const session=await ClassSession.create({title:'Legacy Course',slug:'legacy-course',type:'Course',starts_at:new Date(Date.now()+86400000),ends_at:new Date(Date.now()+90000000),price:100,published:true,registration_open:true,status:'Upcoming'});
  const registration=await ClassRegistration.create({session_id:session._id,name:'Legacy Learner',email:'legacy@example.test',phone:'9876543210',amount:100,payment_status:'paid',registration_status:'confirmed',razorpay_order_id:'order_legacy',razorpay_payment_id:'pay_legacy'});
  const app=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`,jars={};
  async function request(url,body,who='public',json=true,extraHeaders={}){const response=await fetch(origin+url,{method:body!==undefined?'POST':'GET',redirect:'manual',headers:{...extraHeaders,...(jars[who]?{cookie:jars[who]}:{}),...(body!==undefined?{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'}:{}),...extraHeaders},body:body===undefined?undefined:Buffer.isBuffer(body)?body:json?JSON.stringify(body):new URLSearchParams(body)});const cookie=response.headers.get('set-cookie');if(cookie)jars[who]=cookie.split(';')[0];return{status:response.status,location:response.headers.get('location'),html:await response.text()};}
  const cartInput={product_id:String(product._id),files:[String(file._id)],addons:[String(addon._id)],quantity:2};
  assert.equal((await request('/cart/add',{...cartInput,quantity:1.5})).status,400);
  assert.equal((await request('/cart/add',{...cartInput,files:[String(wrongFile._id)]})).status,400);
  assert.equal((await request('/cart/add',cartInput)).status,200);
  assert.match((await request('/cart')).html,/Regression Pattern/);
  assert.equal((await request('/cart/update',{quantity:'NaN'})).status,400);
  const input={customer:{name:'Checkout Learner',email:'checkout@example.test',phone:'9876543210'},items:[{product_id:String(product._id),quantity:2,selected_files:[{id:String(file._id)}],selected_addons:[{id:String(addon._id)}],total:0}],shipping:{address:'Test address',city:'Bengaluru',state:'Karnataka',pincode:'560001'}};
  assert.equal((await request('/checkout',{...input,items:[{...input.items[0],quantity:-1}]})).status,400);
  assert.equal((await request('/checkout',{...input,customer:{...input.customer,email:'invalid'}})).status,400);
  assert.equal((await request('/checkout',input)).status,200);
  assert.equal(await Order.countDocuments(),0);
  const attempts=await Promise.all([request('/checkout/payment-method/proceed',{}),request('/checkout/payment-method/proceed',{})]);assert.ok(attempts.some(r=>r.status===200));assert.equal(gatewayOrders.length,1);
  const first=JSON.parse(attempts.find(r=>r.status===200).html);let order=await Order.findOne();
  assert.equal(order.delivery_charge,undefined);assert.equal(order.subtotal,260);assert.equal(order.tax_amount,46.8);assert.equal(order.grand_total,306.8);assert.equal(order.items[0].quantity,2);assert.equal(first.amount,30680);assert.equal(gatewayOrders[0].amount,Math.round(order.grand_total*100));
  assert.equal((await request('/checkout/payment-method/proceed',{})).status,200);assert.equal(gatewayOrders.length,1);
  const paymentId='pay_regression';const signature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${first.razorpay_order_id}|${paymentId}`).digest('hex');const callback={razorpay_order_id:first.razorpay_order_id,razorpay_payment_id:paymentId,razorpay_signature:signature};
  assert.equal((await request('/checkout/razorpay-callback',{...callback,razorpay_signature:'0'.repeat(64)})).status,400);assert.equal((await Order.findById(order._id)).payment_status,'unpaid');
  const done=await request('/checkout/razorpay-callback',callback);assert.equal(done.status,302);assert.match((await request(done.location)).html,/Order Successful/);assert.match((await request('/cart/count')).html,/"count":0/);
  assert.equal((await Payment.findOne({order_id:order._id})).payment_status,'paid');
  await Order.updateOne({_id:order._id},{$set:{order_status:'delivered'}});
  assert.equal((await request('/checkout/razorpay-callback',callback)).status,302);assert.equal((await Order.findById(order._id)).order_status,'delivered');assert.equal(await Payment.countDocuments({order_id:order._id}),1);
  assert.equal((await request('/checkout/razorpay-callback',{...callback,razorpay_signature:'0'.repeat(64)})).status,400);assert.equal((await Order.findById(order._id)).payment_status,'paid');
  assert.match((await request('/checkout/success',undefined,'outsider')).html,/Check Your Order/);
  assert.ok(!(await request('/checkout/success',undefined,'outsider')).html.includes('Your payment was verified securely'));
  await models.Courier.create({_id:'regression-courier',name:'Regression Courier',active:true,region_ids:['south'],pincodes:['560*']});
  const physical={...input,shipping:{...input.shipping,courier_id:'regression-courier'},items:[{...input.items[0],physical_quantity:2,trial_quantity:1}]};
  assert.equal((await request('/checkout',{...physical,shipping:{...input.shipping,pincode:'abc560001'}})).status,400);
  assert.equal((await request('/checkout',physical)).status,200);const physicalPayment=JSON.parse((await request('/checkout/payment-method/proceed',{})).html);order=await Order.findOne({razorpay_order_id:physicalPayment.razorpay_order_id});
  assert.equal(order.delivery_charge,undefined);assert.equal(order.subtotal,440);assert.equal(order.tax_amount,79.2);assert.equal(order.grand_total,519.2);assert.equal(physicalPayment.amount,51920);assert.equal((await Customer.findOne({email:input.customer.email})).pincode,'560001');
  await TaxSettings.updateOne({key:'default'},{$set:{percentage:5}});assert.equal((await request('/checkout',input)).status,200);const gstPayment=JSON.parse((await request('/checkout/payment-method/proceed',{})).html);assert.equal(gstPayment.amount,30680);
  await TaxSettings.updateOne({key:'default'},{$set:{enabled:false}});assert.equal((await request('/checkout',input)).status,200);assert.equal(JSON.parse((await request('/checkout/payment-method/proceed',{})).html).amount,30680);
  assert.equal((await request('/checkout/delivery-charge?pincode=abc560001')).status,400);
  assert.equal(JSON.parse((await request('/checkout/delivery-info?state=Karnataka')).html).dispatch_location,'Bengaluru');
  assert.equal((await request(`/classes/registration/${registration._id}/verify`,{razorpay_order_id:'order_legacy',razorpay_payment_id:'pay_legacy',razorpay_signature:'0'.repeat(64)},'outsider')).status,400);
  assert.equal((await request(`/classes/registration/${registration._id}`,undefined,'outsider')).status,403);
  const legacySignature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update('order_legacy|pay_legacy').digest('hex');assert.equal((await request(`/classes/registration/${registration._id}/verify`,{razorpay_order_id:'order_legacy',razorpay_payment_id:'pay_legacy',razorpay_signature:legacySignature},'legacy')).status,200);
  assert.equal((await request(`/classes/registration/${registration._id}`,undefined,'legacy')).status,200);
  assert.equal(await models.Receipt.countDocuments({reference_type:'class_registration',reference_id:registration._id}),1);
  const malformed=await fetch(origin+'/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});assert.equal(malformed.status,400);assert.ok(!(await malformed.text()).includes('SyntaxError'));
  assert.equal((await request('/admin',undefined,'public')).location,'/admin/login');
  await request('/cart/add',cartInput,'admin');const oldCookie=jars.admin;
  assert.equal((await request('/admin/login',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD},'admin',false)).status,302);assert.notEqual(jars.admin,oldCookie);
  assert.match((await request('/cart/count',undefined,'admin')).html,/"count":2/);
  assert.equal((await request('/admin/login',undefined,'admin')).location,'/admin');
  const center=await request('/admin',undefined,'admin');assert.equal(center.status,200);assert.match(center.html,/Owner Control Center/);
  for(const [heading,links] of Object.entries(require('../config/adminNavigation'))){
    assert.ok(center.html.includes(heading.replaceAll('&','&amp;')),heading);
    for(const [url] of links){assert.ok(center.html.includes('href="'+url+'"'),url);const page=await request(url,undefined,'admin');assert.equal(page.status,200,url);assert.match(page.html,/href="\/admin">Back to Dashboard/);}
  }
  const routes=['/','/products','/product/regression-pattern','/cart','/checkout','/courses','/courses/older-course','/webinars','/books','/books/older-book','/updates','/consulting','/contact','/classes','/classes/legacy-course','/my-courses','/checkout/cancel','/admin/login','/admin','/admin/dashboard','/admin/products','/admin/courses','/admin/webinars','/admin/course-bookings','/admin/webinar-registrations','/admin/leads','/admin/books','/admin/articles','/admin/orders','/admin/customers','/admin/payments','/admin/settings/appearance','/admin/settings/website','/admin/settings/gst','/admin/settings/delivery','/admin/classes'];
  const queue=[...routes],seen=new Set();
  while(queue.length){const route=queue.shift();if(seen.has(route)||route==='/admin/logout')continue;seen.add(route);const response=await request(route,undefined,route.startsWith('/admin')?'admin':'public');assert.ok([200,302,303].includes(response.status),`${route}: ${response.status}`);if(response.status===200){for(const match of response.html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim()){if(match[0].includes('application/ld+json'))JSON.parse(match[1]);else new vm.Script(match[1],{filename:route});}for(const match of response.html.matchAll(/href="(\/[^"<>]*)"/g)){const link=match[1].replaceAll('&amp;','&');if(!link.startsWith('//')&&!link.startsWith('/css/')&&!link.includes('#')&&!link.includes('?')&&!seen.has(link))queue.push(link);}}}
  if(process.env.TEST_COMMERCE==='true')await require('./commerceAssertions')({models,request,input,gatewayOrders,paymentOverrides});
  if(process.env.TEST_SHIPPING==='true')await require('./shippingAssertions')({models,request,input});
  if(process.env.TEST_LAUNCH==='true')await require('./launchAssertions')({models,request,input,gatewayOrders});
  assert.equal((await request('/admin/products/not-an-id/edit',undefined,'admin')).status,404);
  assert.equal((await request('/admin/products',{name:'Invalid',slug:'invalid',base_price:'-1'},'admin',false)).status,400);
  assert.equal((await request('/admin/settings/gst',{percentage:'NaN'},'admin',false)).status,400);
  const badClass=await request('/admin/classes',{title:'Invalid date',type:'Course',starts_at:'2026-02-30T10:00',ends_at:'2026-02-30T11:00',price:'100'},'admin',false);assert.equal(badClass.status,400);assert.ok(!badClass.html.includes('undefined/edit'));
  assert.equal((await request('/admin/logout',undefined,'admin')).location,'/admin/login');assert.equal((await request('/admin',undefined,'admin')).location,'/admin/login');assert.equal((await request('/admin/products',undefined,'admin')).location,'/admin/login');assert.match((await request('/cart/count',undefined,'admin')).html,/"count":2/);
  const relogin=await request('/admin/login',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD},'admin',false);assert.equal(relogin.location,'/admin');
  console.log('PASS: /admin authentication, control-center links, all controls return 200, Back to Dashboard, logout/session loss and login return to /admin.');
  console.log(`PASS: ${templates} EJS templates, JS syntax, ${seen.size} public/admin routes and links, missing optional fields, form validation, safe errors, login rotation/logout/cart preservation, legacy verification, digital and physical delivery, fixed GST 18%, server-priced gateway amounts, payment records and repeated callbacks.`);
  console.log('All writes were isolated to temporary MongoDB collections. No live payments were charged.');
}
run().catch(error=>{console.error('Stability test failed:',error.name,error instanceof assert.AssertionError?error.message:'Safe diagnostic: '+String(error.code || 'UNKNOWN'));console.error((error.stack || '').split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,3).join('\n'));process.exitCode=1;}).finally(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(mongoose.connection.readyState===1)for(const Model of Object.values(models)){assert.ok(Model.collection.name.startsWith(prefix));await Model.collection.drop().catch(error=>{if(error.code!==26)throw error;});}await mongoose.disconnect();if(require.cache[require.resolve('../config/db')])await require('../config/db').db.destroy();});
