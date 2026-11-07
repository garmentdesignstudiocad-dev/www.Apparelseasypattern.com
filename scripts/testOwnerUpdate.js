// Isolated owner-update regression. No live database, email or payment requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server');
Object.assign(process.env,{NODE_ENV:'development',SESSION_SECRET:'owner-update-test-only',ADMIN_USERNAME:'owner-update-test',ADMIN_PASSWORD:'owner-update-test-only',NOTIFICATIONS_WORKER_ENABLED:'false',SITE_URL:'https://store.example.test',DB_HOST:'127.0.0.1',DB_PORT:'1'});
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-update-'));let server;
 try{
  process.env.MONGODB_URI=mongo.getUri();process.env.PATTERN_FILES_DIR=dir;
  await mongoose.connect(mongo.getUri());
  require('../services/notificationService').safeFlush=async()=>{};
  const Product=require('../models/mongo/Product'),File=require('../models/mongo/ProductFile'),Lead=require('../models/mongo/Lead'),Order=require('../models/mongo/Order');
  await Lead.init();
  const prepared=await require('../services/launchSetup').prepare();
  assert.equal(prepared.product_id,null);
  assert.equal(await Product.countDocuments(),0,'Launch preparation must not invent products.');
  const product=await Product.create({name:'Test Shirt',slug:'test-shirt',category:'shirts',description:'Fixture pattern description',base_price:100,additional_size_price:10,physical_price:50,trial_price:200,available_sizes:['S','M'],size_prices:[{size:'M',price:70}],digital_file:'printable.pdf',pattern_options:{printable:true,physical:true,trial:true}});
  await Product.create([{name:'Test Pants',slug:'test-pants',category:'pants'},{name:'Test Draft',slug:'test-draft',category:'shirts',status:'draft'},{name:'Test Upcoming',slug:'test-upcoming',category:'shirts',status:'coming_soon'}]);
  const files=await File.create([{product_id:product._id,file_name:'DXF',purpose:'dxf',file_type:'DXF',file_price:40,digital_file:'editable.dxf'}, {product_id:product._id,file_name:'Tech pack',purpose:'tech_pack',file_type:'PDF',file_price:30,digital_file:'support.pdf',watermark_pdf:true}, {product_id:product._id,file_name:'Measurements',purpose:'specs',file_type:'PDF',file_price:20,digital_file:'measurements.pdf',watermark_pdf:true}]);
  const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.create();pdf.addPage([400,600]);const master=Buffer.from(await pdf.save());
  for(const name of ['printable.pdf','support.pdf','measurements.pdf'])fs.writeFileSync(path.join(dir,name),master);
  fs.writeFileSync(path.join(dir,'editable.dxf'),'fixture technical master');
  const baseline=JSON.stringify(await Product.find().lean());
  server=require('../server').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+server.address().port,jars={};
  async function request(url,body,who='visitor',json=false){
   const response=await fetch(origin+url,{method:body?'POST':'GET',redirect:'manual',headers:{...(jars[who]?{cookie:jars[who]}:{}),...(body?{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'}:{})},body:body?(json?JSON.stringify(body):new URLSearchParams(body)):undefined});
   const cookie=response.headers.get('set-cookie');if(cookie)jars[who]=cookie.split(';')[0];return {status:response.status,location:response.headers.get('location'),text:await response.text()};
  }
  const token=r=>r.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  let response=await request('/');assert.equal(response.status,200);assert.match(response.text,/Ready-to-Use Apparel Patterns/);assert.match(response.text,/Available Patterns/);assert(!response.text.includes('href="/consulting"'));
  response=await request('/products?category=shirts');assert.equal(response.status,200);assert.match(response.text,/Test Shirt/);assert(!response.text.includes('Test Pants'));assert(!response.text.includes('Test Draft'));assert.match(response.text,/Test Upcoming/);
  assert.equal((await request('/product/test-draft')).status,404);assert.equal((await request('/products?category=%3Cbad%3E')).status,400);
  response=await request('/product/test-shirt');assert.equal(response.status,200);
  for(const label of ['SELECT YOUR FIT BLOCK','Soft Copy','Hard Copy','DXF','Tech pack','Order Trial Sample','Measurement Chart / Basic Specifications','pattern-size','data-protected-content','preview-watermark'])assert(response.text.includes(label),label);
  assert.equal((response.text.match(/<legend>/g)||[]).length,9,'Nine Fit Block groups');
  for(const label of ['1. Fit Category','2. Fit / Style','3. File Format','4. Digital Documents','5. Fabric Width','6. Sizes','7. Pattern Type','8. Additional Options','9. Delivery'])assert.ok(response.text.includes(label));
  assert.match(response.text,/id="pdBuyNow"[^>]*>BUY NOW/);
  assert.ok(!/id="pdBuyNow"[^>]*disabled/.test(response.text));
  // Execute the real purchase script with mock DOM/fetch; this is not browser QA.
  async function purchaseAction(buyNow,selectedSizes=['S','M']){
    const handlers={},elements={},selected={'.pattern-size':selectedSizes.map(value=>({value,checked:true})),'.pattern-file':[{value:String(files[0]._id),checked:true,dataset:{price:'40',fileIndex:'0'}}],'.pattern-addon':[]};
    const form={addEventListener:(event,fn)=>{handlers[event]=fn;},querySelectorAll:selector=>selector.split(', ').flatMap(part=>selected[part]||[]),querySelector:()=>null};
    const config={id:String(product._id),base:100,extra:10,physical:50,trial:200,sizePrices:[{size:'M',price:70}]};
    Object.assign(elements,{'pattern-config':{textContent:JSON.stringify(config)},'pattern-purchase':form,'printable-option':{checked:true},'physical-option':{checked:true},'trial-option':{checked:false},pdAddToCart:{disabled:false},pdBuyNow:{disabled:false,addEventListener:(event,fn)=>{handlers.buy=fn;}}});
    let payload;const location={};
    require('node:vm').runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/js/pattern-product.js'),'utf8'),{document:{getElementById:id=>id==='pattern-sizes'?null:elements[id] ||= {textContent:''}},location,fetch:async(url,options)=>{assert.equal(url,'/cart/add');payload=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true})};}});
    (buyNow?handlers.buy:handlers.submit)({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
    if(!selectedSizes.length){assert.equal(payload,undefined);assert.match(elements['pattern-error'].textContent,/sizes/);return;}
    assert.equal(location.href,buyNow?'/checkout':'/cart');assert.equal(payload.printable_selected,true);assert.equal(payload.physical_quantity,2);assert.deepEqual(payload.selected_sizes,['S','M']);assert.equal(payload.quantity,1);
    assert.equal(elements.pdTotal.textContent,'₹318.60');
    for(const key of ['fit_category','fit_style','fabric_width'])assert.equal(Object.hasOwn(payload,key),false);
  }
  await purchaseAction(false);await purchaseAction(true);await purchaseAction(true,[]);
  for(const secret of ['printable.pdf','editable.dxf','support.pdf','measurements.pdf'])assert(!response.text.includes(secret),'Private filename leaked');
  assert.equal((await request('/private/patterns/printable.pdf')).status,404);
  const pricing=require('../services/orderPricing'),options=require('../services/patternOptions');
  const cases=[ [{quantity:1,selected_sizes:['S','M']},[],110], [{quantity:1,printable_selected:false,selected_sizes:['S']},[files[0]],40], [{quantity:1,printable_selected:false,selected_sizes:['S']},[files[1]],30], [{quantity:0,printable_selected:false,physical_quantity:2,selected_sizes:['S','M']},[],120], [{quantity:0,printable_selected:false,trial_quantity:2,selected_sizes:['S','M']},[],400] ];
  for(const [item,selected,expected] of cases){assert.equal(options.validate(product,selected,item),'');assert.equal(pricing.itemPrice(product,selected,[],item).total,expected);assert.equal((await request('/cart/add',{product_id:String(product._id),...item,files:selected.map(f=>String(f._id))},'visitor',true)).status,200);}
  assert.deepEqual(pricing.totals(150),{subtotal:150,courier:0,tax:27,total:177,amount:17700});
  assert.equal((await request('/cart/add',{product_id:String(product._id),selected_sizes:['BAD']},'visitor',true)).status,400);
  assert.equal((await request('/checkout')).location,'/account/login');
  await Product.updateOne({_id:product._id},{$set:{'pattern_options.physical':false}});
  assert.equal((await request('/cart/add',{product_id:String(product._id),quantity:0,physical_quantity:1,selected_sizes:['S']},'visitor',true)).status,400);
  await Product.updateOne({_id:product._id},{$set:{pattern_options:{printable:true,physical:true,trial:true}}});
  response=await request('/books');assert.equal(response.status,200);assert.match(response.text,/COMING SOON/);assert(!response.text.includes('countdown'));
  for(const [url,body] of [['/books/notify',{email:'notify@example.test'}],['/pattern-updates',{name:'Test Subscriber',email:'updates@example.test',whatsapp:'9876543210'}]]){
   assert.equal((await request(url,{...body,consent:'on',_csrf:'bad'})).status,403);
   const page=await request(url,null,url);assert.equal((await request(url,{...body,consent:'on',_csrf:token(page)},url)).status,200);
   const page2=await request(url,null,'duplicate'+url);assert.equal((await request(url,{...body,consent:'on',_csrf:token(page2)},'duplicate'+url)).status,200);
   assert.equal(await Lead.countDocuments({email:body.email}),1);
  }
  response=await request('/classes/enquiry');assert.equal(response.status,200);assert(!response.text.includes('syllabus'));assert(!response.text.includes('class-price'));
  const classBody={name:'Test Student',email:'student@example.test',whatsapp:'9876543210',profession:'Student',consent:'on',_csrf:token(response)};
  assert.equal((await request('/classes/enquiry',classBody)).status,400);
  classBody._csrf=token(await request('/classes/enquiry'));assert.equal((await request('/classes/enquiry',{...classBody,studying:'Fashion design'})).status,303);
  const lead=await Lead.findOne({email:classBody.email});assert.equal(lead.studying,'Fashion design');assert(lead.consent_at);assert.equal(lead.notification_jobs.length,1);
  assert.equal((await request('/consulting')).status,200);assert.equal((await request('/classes')).location,'/classes/enquiry');
  // Exact paid option entitlements, unverified-payment refusal and immutable PDF masters.
  const customer=new mongoose.Types.ObjectId();
  const order=await Order.create({customer_id:customer,account_customer_id:customer,items:[{product_id:product._id,product_name:product.name,quantity:1,printable_selected:false,selected_files:[{id:String(files[1]._id),name:'Tech pack',price:30}]}],payment_status:'paid'});
  const delivery=require('../services/digitalDeliveryService');assert.equal(await delivery.ensure(order._id),null);
  await Order.updateOne({_id:order._id},{$set:{payment_verified_at:new Date()}});
  const grant=await delivery.ensure(order._id);assert.equal(grant.download_assets.length,1);assert.equal(grant.download_assets[0].file,'support.pdf');assert.equal(grant.download_assets[0].watermark_pdf,true);
  assert.equal((await delivery.ensure(order._id)).download_token,grant.download_token);
  assert.equal((await request('/downloads/'+grant.download_token+'/0')).status,303);
  assert.equal(await delivery.filePath('../support.pdf'),null);
  const marked=await require('../services/pdfWatermark').copy(path.join(dir,'support.pdf'),order._id);assert(!marked.equals(master));assert(fs.readFileSync(path.join(dir,'support.pdf')).equals(master));assert.equal((await PDFDocument.load(marked)).getPageCount(),1);
  // Existing admin remains reachable; no real administrator or database is used.
  assert.equal((await request('/admin/products')).status,302);
  assert.equal((await request('/admin/login',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD},'admin')).status,302);
  response=await request('/admin/products',null,'admin');assert.equal(response.status,200);assert.match(response.text,/Products \/ Patterns/);
  assert.equal((await request('/admin/products/'+product._id+'/files',null,'admin')).status,200);
  assert.equal((await request('/admin/products/'+product._id+'/digital-files',null,'admin')).status,200);
  assert.equal((await request('/admin/leads',null,'admin')).status,200);
  const actual=await Product.find().lean(),before=JSON.parse(baseline);for(let i=0;i<actual.length;i++){delete actual[i].updatedAt;delete before[i].updatedAt;}assert.equal(JSON.stringify(actual),JSON.stringify(before));
  console.log('PASS: owner-update catalogue/categories, five independent options, sizes/pricing/GST, mandatory login, lead consent/CSRF/deduplication, class enquiry, private entitlements, PDF master preservation, Admin compatibility and existing fixture preservation.');
 }finally{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();if(require.cache[require.resolve('../config/db')])await require('../config/db').db.destroy();await mongo.stop();for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
