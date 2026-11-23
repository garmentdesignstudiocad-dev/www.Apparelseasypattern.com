// Isolated acceptance fixture, NOT owner-approved product data or live payment evidence.
require('./isolatedTestGuard');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {MongoMemoryServer}=require('mongodb-memory-server');
const mongoose=require('mongoose');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'aep-first-product-'));
Object.assign(process.env,{MONGOMS_RUNTIME_DOWNLOAD:'false',NODE_ENV:'development',PATTERN_FILES_DIR:temporary,NOTIFICATIONS_WORKER_ENABLED:'false',SESSION_SECRET:'isolated-first-product-session',SMTP_HOST:'',SMTP_USER:'',SMTP_PASS:'',SMTP_FROM:'',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',RESEND_API_KEY:'',RAZORPAY_KEY_ID:'rzp_test_fixture',RAZORPAY_KEY_SECRET:'fixture-secret',RAZORPAY_WEBHOOK_SECRET:'fixture-webhook',PUBLIC_BASE_URL:'http://127.0.0.1',APP_BASE_URL:'http://127.0.0.1',SITE_URL:'http://127.0.0.1'});
const gatewayOrders=[];
let captured=false;
require('razorpay');
require.cache[require.resolve('razorpay')].exports=class {
  constructor(){
    this.orders={create:async data=>{const order={...data,id:'order_fixture'+(gatewayOrders.length+1)};gatewayOrders.push(order);return order;}};
    this.payments={fetch:async id=>({id,order_id:gatewayOrders.at(-1).id,amount:gatewayOrders.at(-1).amount,currency:'INR',status:captured?'captured':'authorized',captured})};
  }
};
require('nodemailer').createTransport=()=>({sendMail:async()=>({messageId:'isolated-message'})});
let mongo,server,browser;
async function run(){
  mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
  process.env.MONGODB_URI=mongo.getUri('first_product_acceptance');
  await mongoose.connect(process.env.MONGODB_URI);
  const Product=require('../models/mongo/Product'),ProductFile=require('../models/mongo/ProductFile'),Order=require('../models/mongo/Order');
  const delivery=require('../services/digitalDeliveryService');
  // Deliberately unequal prices catch the former UI/backend pricing disagreement.
  const product=await Product.create({name:'Basic Slim Fit Shirt — ACCEPTANCE FIXTURE',slug:'shirt-acceptance-fixture',base_price:123.45,additional_size_price:17.25,physical_price:50,trial_price:80,mini_marker_price:31.25,available_sizes:['S','M'],pattern_options:{printable:true,physical:true,trial:true},active:true,status:'active',size_information:'Fixture only: owner measurements are not provided.',format_pricing:{dxf:999,hpgl:888,pdf:777,bundle_price:9999,active_bundle:true}});
  const dxf=Buffer.from('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n');
  for(const size of ['S','M'])await delivery.uploadSizeFile(product._id,'dxf',size,'fixture-'+size+'.dxf',dxf);
  const before=await Product.findById(product._id).select('+digital_file_map').lean();
  await delivery.uploadSizeFile(product._id,'dxf','S','replacement-S.dxf',dxf);
  const mapped=await Product.findById(product._id).select('+digital_file_map').lean();
  assert.equal(mapped.digital_file_map.length,2);
  assert.equal(mapped.digital_file_map.find(x=>x.size==='M').file,before.digital_file_map.find(x=>x.size==='M').file);
  assert.notEqual(mapped.digital_file_map.find(x=>x.size==='S').file,before.digital_file_map.find(x=>x.size==='S').file);
  const docBytes=Buffer.from('Fixture private document bytes');
  const docs=[];
  for(const [slot,purpose,price] of [['techpack_pdf','specs',21.5],['measurement_pdf','specs',12.25],['marker_pdf','other',0]]){
    const filename=slot+'.pdf';fs.writeFileSync(path.join(temporary,filename),docBytes);
    docs.push(await ProductFile.create({product_id:product._id,file_name:filename,file_type:'PDF',purpose,upload_slot:slot,file_price:price,active:true,digital_file:filename}));
  }
  for(const slot of ['techpack_zip','basic_measurement_pdf']){
    const filename=slot+'.pdf';fs.writeFileSync(path.join(temporary,filename),docBytes);
    await ProductFile.create({product_id:product._id,file_name:filename,file_type:'PDF',purpose:'specs',upload_slot:slot,file_price:9.5,active:true,digital_file:filename});
  }
  await require('../models/mongo/TaxSettings').create({key:'default',enabled:true,percentage:18});
  const app=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let cookie='';
  async function request(url,body,form=false,authenticated=true){
    const res=await fetch(origin+url,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{...(authenticated&&cookie?{cookie}:{}),...(body===undefined?{}:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'})},body:body===undefined?undefined:form?new URLSearchParams(body):JSON.stringify(body)});
    if(authenticated&&res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    const bytes=Buffer.from(await res.arrayBuffer());return {status:res.status,html:bytes.toString(),bytes,location:res.headers.get('location')};
  }
  const item={product_id:String(product._id),quantity:1,printable_selected:true,selected_sizes:['S','M'],selected_formats:['dxf'],files:docs.map(f=>String(f._id)),addons:[],physical_quantity:0,trial_quantity:0};
  const page=await request('/product/'+product.slug);assert.equal(page.status,200);
  assert.ok(!page.html.includes('data-cm="96"'));
  assert.ok(!mapped.digital_file_map.some(entry=>page.html.includes(entry.file)),'Private names must not be exposed');
  assert.match(page.html,/measurement-file/);
  assert.match(page.html,/measurement_pdf\.pdf/);
  assert.doesNotMatch(page.html,/techpack_pdf\.pdf|techpack_zip\.pdf|basic_measurement_pdf\.pdf/);
  assert.equal((await request('/cart/add',{...item,selected_formats:['pdf']})).status,400);
  assert.equal((await request('/cart/add',{...item,selected_sizes:['XL']})).status,400);
  await Product.updateOne({_id:product._id},{$set:{base_price:0}});
  assert.equal((await request('/cart/add',item)).status,400);
  await Product.updateOne({_id:product._id},{$set:{base_price:123.45}});
  assert.equal((await request('/cart/add',{...item,quantity:0,files:[],printable_selected:false,physical_sizes:['S','M'],physical_quantity:4,trial_quantity:2})).status,200);
  const trialError=await request('/cart/add',{...item,quantity:0,files:[],printable_selected:false,selected_sizes:[],trial_quantity:1});assert.equal(trialError.status,400);
  console.log('PASS real Mongo mapping replacement, unavailable format/size/price rejection, physical and trial cart validation');

  // Use installed browser tooling only; never download a browser or contact a provider.
  const playwrightPath=process.env.AEP_PLAYWRIGHT_MODULE || path.join(process.env.LOCALAPPDATA,'npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
  const {chromium}=require(playwrightPath);
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext();
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const tab=await context.newPage(),errors=[];tab.on('pageerror',e=>errors.push(e.message));
  await tab.goto(origin+'/product/'+product.slug);
  assert.equal(await tab.locator('#formatInputHpgl').isDisabled(),true);
  assert.equal(await tab.locator('#formatInputPdf').isDisabled(),true);
  await tab.locator('#btnSelectAllSoftSizes').click();
  await tab.locator('#techPackCard').click();
  await tab.locator('.measurement-file').check();
  await tab.locator('#miniMarkerOption').check();
  assert.equal(await tab.locator('#sumSubtotal').innerText(),'₹205.7');
  assert.equal(await tab.locator('#pdTotal').innerText(),'₹242.73');
  await tab.locator('#physicalPrintoutCard').click();
  await tab.locator('#btnSelectAllPhysSizes').click();
  await tab.locator('#physical-copies').fill('2');
  await tab.locator('#trialSampleCard').click();
  assert.equal(await tab.locator('#sumSubtotal').innerText(),'₹565.7');
  for(const width of [390,1440]){
    await tab.setViewportSize({width,height:900});
    assert.ok(await tab.locator('#pdBuyNow').isVisible());
    const overflow=await tab.evaluate(()=>Array.from(document.querySelectorAll('main.pd-container *')).filter(el=>el.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(el).position!=='fixed').map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right})).slice(0,15));
    assert.equal(await tab.evaluate(()=>document.querySelector('main.pd-container').scrollWidth<=innerWidth),true,'Product page horizontal overflow at '+width+' '+JSON.stringify(overflow));
  }
  const added=tab.waitForResponse(res=>res.url().endsWith('/cart/add'));
  await tab.locator('#pdAddToCart').click();
  assert.equal((await added).status(),200);
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS actual browser: six choices, unequal prices, 390/1440px layout and real cart submission');

  // A separate digital customer journey exercises checkout and authenticated file bytes.
  cookie='';
  const registration=await request('/account/register');
  const csrf=registration.html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const customer={name:'Acceptance Customer',email:'acceptance@example.test',phone:'9876543210'};
  const registered=await request('/account/register',{...customer,password:'FixturePassword123!',confirm_password:'FixturePassword123!',_csrf:csrf},true);assert.ok([302,303].includes(registered.status));
  assert.equal((await request('/cart/add',item)).status,200);
  const checkout=await request('/checkout',{customer,items:[{...item,selected_files:docs.map(f=>({id:String(f._id)})),selected_addons:[],total:0}],shipping:{}});
  assert.equal(checkout.status,200,checkout.html);
  const proceed=await request('/checkout/payment-method/proceed',{});assert.equal(proceed.status,200,proceed.html);
  const payment=JSON.parse(proceed.html);let order=await Order.findOne();
  assert.equal(order.subtotal,205.7);assert.equal(order.grand_total,242.73);assert.equal(payment.amount,24273);
  assert.equal(await delivery.ensure(order._id),null);
  const payId='pay_fixture';const signature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(payment.razorpay_order_id+'|'+payId).digest('hex');
  const callback={razorpay_order_id:payment.razorpay_order_id,razorpay_payment_id:payId,razorpay_signature:signature};
  assert.equal((await request('/checkout/razorpay-callback',{...callback,razorpay_signature:'0'.repeat(64)})).status,400);
  await request('/checkout/razorpay-callback',callback);
  assert.equal((await Order.findById(order._id)).payment_status,'unpaid');
  assert.equal(await delivery.ensure(order._id),null);
  captured=true;
  assert.equal((await request('/checkout/razorpay-callback',callback)).status,302);
  assert.equal((await request('/checkout/razorpay-callback',callback)).status,302);
  order=await Order.findById(order._id).select('+download_token +download_assets').lean();
  assert.equal(order.payment_status,'paid');assert.ok(order.payment_verified_at);assert.equal(order.download_assets.length,5);
  assert.equal(await require('../models/mongo/Payment').countDocuments({order_id:order._id}),1);
  for(let i=0;i<order.download_assets.length;i++){
    const download=await request('/downloads/'+order.download_token+'/'+i);assert.equal(download.status,200);
    assert.deepEqual(download.bytes,order.download_assets[i].file.endsWith('.dxf')?dxf:docBytes);
  }
  assert.equal((await request('/downloads/'+order.download_token+'/0',undefined,false,false)).status,303);
  await Order.updateOne({_id:order._id},{$set:{download_expires_at:new Date(0)}});
  assert.equal((await request('/downloads/'+order.download_token+'/0')).status,404);
  const missing=await Product.findById(product._id).select('+digital_file_map').lean();fs.unlinkSync(path.join(temporary,missing.digital_file_map[0].file));
  assert.equal((await request('/cart/add',item)).status,400);
  console.log('PASS customer registration → cart → authoritative checkout total → signature/capture gate → idempotent payment → five exact private downloads → expiry and missing-file denial');
  console.log('ISOLATED ACCEPTANCE PASS. Real shirt assets/prices, real payment provider, email delivery and physical dispatch remain unverified.');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  await mongoose.disconnect();if(mongo)await mongo.stop();
  const parent=path.resolve(os.tmpdir()),target=path.resolve(temporary);
  if(path.dirname(target)===parent&&path.basename(target).startsWith('aep-first-product-'))fs.rmSync(target,{recursive:true,force:true});
});
