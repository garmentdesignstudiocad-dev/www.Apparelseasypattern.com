const assert=require('node:assert/strict');
const {MongoMemoryServer}=require('mongodb-memory-server');
const mongoose=require('mongoose');
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});let server;
 try{
  Object.assign(process.env,{MONGODB_URI:mongo.getUri(),NODE_ENV:'development',NOTIFICATIONS_WORKER_ENABLED:'false',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',LEAD_NOTIFICATION_TO:'garmentdesignstudiocad@gmail.com',ADMIN_NOTIFICATION_EMAIL:'garmentdesignstudiocad@gmail.com',SESSION_SECRET:'isolated-lead-tests',ADMIN_USERNAME:'lead-test',ADMIN_PASSWORD:'lead-test-password',SMTP_HOST:'',SMTP_PORT:'',SMTP_SECURE:'',SMTP_USER:'',SMTP_PASS:'',SMTP_FROM:'',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',EMAIL_HOST:'',EMAIL_PASSWORD:'',WHATSAPP_ACCESS_TOKEN:'',DB_HOST:'127.0.0.1',DB_PORT:'1'});
  await mongoose.connect(mongo.getUri());
  assert.match(mongoose.connection.host,/127.0.0.1/);
  const Lead=require('../models/mongo/Lead'),Log=require('../models/mongo/NotificationLog');await Lead.init();await Log.init();
  const leadService=require('../services/leadNotifications'),notifications=require('../services/notificationService');
  const {createEmailService}=require('../services/emailService');let sent=[];
  const send=createEmailService({env:{SMTP_HOST:'smtp.example.test',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_USER:'mock',SMTP_PASS:'mock',SMTP_FROM:'sender@example.test'},createTransport:options=>{assert.equal(options.requireTLS,true);return {sendMail:async mail=>{sent.push(mail);return {accepted:[mail.to],messageId:mail.messageId};}};}});
  const app=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port;let cookie='',testIp='';
  async function request(url,body){const response=await fetch(origin+url,{method:body?'POST':'GET',headers:{cookie,...(testIp?{'X-Forwarded-For':testIp}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?new URLSearchParams(body):undefined,redirect:'manual'});const c=response.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return response;}
  let html=await (await request('/contact')).text();let csrf=html.match(/name="_csrf" value="([^"]+)"/)[1];
  const data={_csrf:csrf,name:'Test Customer',email:'customer@example.test',whatsapp:'+919876543210',interest:'Other',message:'Pattern consultation',source:'/contact'};
  assert.equal((await request('/enquiries',{...data,email:'invalid'})).status,400);
  assert.equal((await request('/enquiries',{...data,website:'spam'})).status,400);
  assert.equal((await request('/enquiries',data)).status,303);
  assert.equal(await Lead.countDocuments(),1);assert.equal(await Log.countDocuments({event:'admin_lead_enquiry',status:'queued'}),1,'durably saved lead is immediately queued');
  // A new session repeating the same payload still cannot create another lead/email.
  cookie='';html=await (await request('/contact')).text();data._csrf=html.match(/name="_csrf" value="([^"]+)"/)[1];
  assert.equal((await request('/enquiries',data)).status,303);assert.equal(await Lead.countDocuments(),1);
  await Promise.all([leadService.reconcile(),leadService.reconcile()]);assert.equal(await Log.countDocuments({event:leadService.event}),1);
  let log=await Log.findOne({event:leadService.event});
  const dispatch=notifications.createDispatcher({email:send});
  await Promise.all([dispatch(log._id),dispatch(log._id)]);assert.equal(sent.length,1);assert.equal(sent[0].to,'garmentdesignstudiocad@gmail.com');assert.equal(sent[0].subject,'New Customer Enquiry - Apparel Easy Patterns');for(const detail of ['Customer Name: Test Customer','Email Address: customer@example.test','Phone Number: +919876543210','Enquiry Type: Other','Product or Service: Other','Customer Message: Pattern consultation','Enquiry Source: /contact'])assert.ok(sent[0].text.includes(detail),detail);assert.match(sent[0].text,/Submission Date and Time:/);assert.ok(sent[0].text.includes('Reference ID: '+log.reference_id));assert.ok(sent[0].html,'HTML email provided');assert.equal(sent[0].replyTo,'customer@example.test');assert.ok(sent[0].html.includes('Test Customer'));assert.ok(sent[0].html.includes('mailto:customer@example.test'));
  assert.equal(await notifications.retry(log._id),false);
  const second=await Lead.create({name:'Retry Customer',email:'retry@example.test',whatsapp:'+919876543210',interest:'Other',source:'/contact'});await leadService.reconcile();log=await Log.findOne({reference_id:second._id});
  await notifications.createDispatcher({email:createEmailService({env:{}})})(log._id);
  assert.equal((await Log.findById(log._id)).status,'failed');assert.ok(await Lead.findById(second._id));const failedStatus=[await Lead.findById(second._id).lean()];await leadService.statuses(failedStatus);assert.equal(failedStatus[0].email_status,'Email Failed');
  await notifications.retry(log._id);
  const failure=createEmailService({env:{SMTP_HOST:'mock',SMTP_PORT:'465',SMTP_SECURE:'true',SMTP_USER:'mock',SMTP_PASS:'mock',SMTP_FROM:'mock@example.test'},createTransport:()=>({sendMail:async()=>{throw Object.assign(new Error('sensitive provider response'),{code:'EAUTH'});}})});
  await notifications.createDispatcher({email:failure})(log._id);assert.equal((await Log.findById(log._id)).status,'failed');assert.doesNotMatch((await Log.findById(log._id)).error_message,/sensitive/);
  await notifications.retry(log._id);await dispatch(log._id);assert.equal(sent.length,2);
  await Log.updateOne({_id:log._id},{$set:{status:'uncertain'}});await assert.rejects(notifications.retry(log._id),/Check provider logs/);
  let rows=await Lead.find().lean();await leadService.statuses(rows);assert.deepEqual(rows.map(row=>row.email_status),['Email Sent','Needs review']);
  // Admin HTTP visibility and escaped rendering.
  html=await (await request('/admin/login')).text();const token=html.match(/name="_csrf" value="([^"]+)"/);
  const login=await request('/admin/login',{username:'lead-test',password:'lead-test-password',...(token?{_csrf:token[1]}:{})});assert.equal(login.status,302);
  const admin=await request('/admin/leads');assert.equal(admin.status,200);html=await admin.text();assert.match(html,/Test Customer/);assert.match(html,/Email Sent/);assert.match(html,/Needs review/);assert.match(html,/\/contact/);
  // Exercise every currently public lead form with its actual CSRF/consent flow.
  for(const [url,details] of [
    ['/pattern-updates',{name:'Pattern Visitor',email:'patterns@example.test',whatsapp:'+919876543210',consent:'on'}],
    ['/books/notify',{email:'books@example.test',consent:'on'}],
    ['/classes/enquiry',{name:'Class Visitor',email:'classes@example.test',whatsapp:'+919876543210',profession:'Student',studying:'Design',consent:'on',message:'Learn patterns'}],
  ]){
    cookie='';const page=await (await request(url)).text();const formToken=page.match(/name="_csrf" value="([^"]+)"/)[1];
    const response=await request(url,{...details,_csrf:formToken});assert.ok([200,303].includes(response.status),url);
    const row=await Lead.findOne({email:details.email});assert.ok(row,url+' saved');
    await leadService.reconcile();const queued=await Log.findOne({reference_id:row._id,event:leadService.event});assert.ok(queued,url+' queued');
    await dispatch(queued._id);assert.equal((await Log.findById(queued._id)).status,'sent');
    assert.equal(await Log.countDocuments({reference_id:row._id,event:'admin_course_enquiry'}),0,'no legacy duplicate owner email');
  }
  cookie='';html=await (await request('/admin/login')).text();const adminToken=html.match(/name="_csrf" value="([^"]+)"/);assert.equal((await request('/admin/login',{username:'lead-test',password:'lead-test-password',...(adminToken?{_csrf:adminToken[1]}:{})})).status,302);
  // Consultation pages are hidden by current storefront policy; retained booking jobs still notify.
  const Booking=require('../models/mongo/ConsultationBooking');
  const booking=await Booking.create({full_name:'Consultation Visitor',email:'consult@example.test',whatsapp:'+919876543210',item_id:new mongoose.Types.ObjectId(),item_name:'Fit review',notes:'Sleeve fit',submission_key:'isolated-consultation',notification_jobs:[{key:'created',event:'created',status:'Received'}]});
  await notifications.flush('consultation_booking',booking._id);await notifications.flush('consultation_booking',booking._id);
  const consultLog=await Log.findOne({reference_id:booking._id,event:leadService.event});assert.ok(consultLog);assert.match(consultLog.message,/Fit review/);assert.match(consultLog.message,/Email Address: consult@example\.test/);assert.match(consultLog.message,/Reference ID:/);assert.match(consultLog.message,/Enquiry Source: \/consulting/);await dispatch(consultLog._id);
  assert.equal(await Log.countDocuments({reference_id:booking._id,event:leadService.event}),1);
  assert.equal(await Log.countDocuments({reference_id:booking._id,event:'admin_consulting_booking'}),0);
  let adminPage=await request('/admin/access-records?kind=consulting&q=Consultation%20Visitor');assert.equal(adminPage.status,200);assert.match(await adminPage.text(),/Consultation Visitor/);
  const Settings=require('../models/mongo/NotificationSettings');await Settings.updateOne({_id:'default'},{$set:{email_enabled:true,course_updates:true,webinar_updates:true,book_updates:true,admin_course_booking:true,admin_webinar_registration:true,admin_book_purchase:true}},{upsert:true});
  const CourseBooking=require('../models/mongo/CourseBooking');
  const courseBooking=await CourseBooking.create({name:'Course Visitor',email:'course@example.test',whatsapp:'+919876543210',course_id:new mongoose.Types.ObjectId(),course_name:'Pattern Drafting',preferred_date:'2030-01-02',preferred_time:'14:00',mode:'Online',notes:'Weekday class',submission_key:'isolated-course-booking'});
  await notifications.flush('course_registration',courseBooking._id);
  const courseOwner=await Log.findOne({reference_id:courseBooking._id,event:'admin_course_booking'});assert.ok(courseOwner);assert.equal(courseOwner.destination,'garmentdesignstudiocad@gmail.com');assert.match(courseOwner.message,/Customer Email: course@example\.test/);assert.match(courseOwner.message,/Product or Service: Pattern Drafting/);assert.match(courseOwner.message,/Reference ID:/);assert.match(courseOwner.message,/Enquiry Source: \/courses/);await dispatch(courseOwner._id);
  adminPage=await request('/admin/course-bookings?q=Course%20Visitor');assert.equal(adminPage.status,200);assert.match(await adminPage.text(),/Course Visitor/);
  const WebinarRegistration=require('../models/mongo/WebinarRegistration');
  const webinar=await WebinarRegistration.create({full_name:'Webinar Visitor',email:'webinar@example.test',whatsapp:'+919876543210',webinar_id:new mongoose.Types.ObjectId(),item_name:'Pattern Webinar',amount_paise:0});
  await notifications.flush('webinar_registration',webinar._id);
  const webinarOwner=await Log.findOne({reference_id:webinar._id,event:'admin_webinar_registration'});assert.ok(webinarOwner);assert.equal(webinarOwner.destination,'garmentdesignstudiocad@gmail.com');assert.match(webinarOwner.message,/Customer Email: webinar@example\.test/);assert.match(webinarOwner.message,/Pattern Webinar/);await dispatch(webinarOwner._id);
  adminPage=await request('/admin/webinar-registrations?q=Webinar%20Visitor');assert.equal(adminPage.status,200);assert.match(await adminPage.text(),/Webinar Visitor/);
  const BookPurchase=require('../models/mongo/BookPurchase');
  const purchase=await BookPurchase.create({email:'book@example.test',whatsapp:'+919876543210',item_id:new mongoose.Types.ObjectId(),item_name:'Pattern Book',submission_key:'isolated-book-enquiry'});
  await notifications.flush('book_purchase',purchase._id);
  const bookOwner=await Log.findOne({reference_id:purchase._id,event:'admin_book_purchase'});assert.ok(bookOwner);assert.equal(bookOwner.destination,'garmentdesignstudiocad@gmail.com');assert.match(bookOwner.message,/Customer Email: book@example\.test/);assert.match(bookOwner.message,/Pattern Book/);await dispatch(bookOwner._id);
  adminPage=await request('/admin/access-records?kind=books&q=Pattern%20Book');assert.equal(adminPage.status,200);assert.match(await adminPage.text(),/Pattern Book/);
  // Historical rows are not enrolled; persistence survives a queue outage and can be reconciled.
  const historical=await Lead.collection.insertOne({name:'Historical',email:'old@example.test',interest:'Other',createdAt:new Date()});
  await leadService.reconcile();assert.equal(await Log.countDocuments({reference_id:historical.insertedId}),0);
  const deferred=await Lead.create({name:'Deferred',email:'defer@example.test',whatsapp:'+919876543210',interest:'Other'});
  const originalUpdate=Log.updateOne;Log.updateOne=async()=>{throw new Error('simulated queue outage');};
  try{await assert.rejects(leadService.reconcile(),/queue outage/);}finally{Log.updateOne=originalUpdate;}
  assert.equal((await Lead.findById(deferred._id)).business_notification_pending,true);await leadService.reconcile();assert.equal((await Lead.findById(deferred._id)).business_notification_pending,false);
  let pending=await Log.findOne({reference_id:deferred._id});process.env.LEAD_NOTIFICATION_TO='';
  assert.equal(leadService.ownerDestination({},true),process.env.ADMIN_NOTIFICATION_EMAIL,'Missing lead recipient falls back to configured Admin');
  const siteService=require('../services/siteSettingsService'),originalSite=siteService.getSiteSettings,originalAdmin=process.env.ADMIN_NOTIFICATION_EMAIL;
  process.env.ADMIN_NOTIFICATION_EMAIL='';siteService.getSiteSettings=async()=>({contact_email:''});
  try{await dispatch(pending._id);assert.equal((await Log.findById(pending._id)).status,'failed');}
  finally{siteService.getSiteSettings=originalSite;process.env.ADMIN_NOTIFICATION_EMAIL=originalAdmin;}
  process.env.LEAD_NOTIFICATION_TO='new-business@example.test';await notifications.retry(pending._id);await dispatch(pending._id);assert.equal(sent.at(-1).to,'new-business@example.test');
  // Exercise the worker's immediate startup pass with a mocked SMTP transport.
  const nodemailer=require('nodemailer'),originalTransport=nodemailer.createTransport;
  const originalWorkerFlag=process.env.NOTIFICATIONS_WORKER_ENABLED;
  Object.assign(process.env,{SMTP_HOST:'mock',SMTP_PORT:'465',SMTP_SECURE:'true',SMTP_USER:'mock',SMTP_PASS:'mock',SMTP_FROM:'sender@example.test'});
  process.env.NOTIFICATIONS_WORKER_ENABLED='true';
  nodemailer.createTransport=()=>({sendMail:async mail=>({accepted:[mail.to],messageId:mail.messageId})});
  const workerLead=await Lead.create({name:'Worker Startup',email:'worker@example.test',whatsapp:'+919876543210',interest:'Other',source:'/contact',business_notification_pending:true});
  let stopWorker;
  try{
    stopWorker=notifications.startWorker();
    const deadline=Date.now()+3000;let workerLog;
    do{workerLog=await Log.findOne({reference_id:workerLead._id,event:leadService.event});if(workerLog?.status==='sent')break;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<deadline);
    assert.equal(workerLog?.status,'sent','startWorker immediately reconciles and dispatches queued leads');
  }finally{stopWorker?.();nodemailer.createTransport=originalTransport;if(originalWorkerFlag===undefined)delete process.env.NOTIFICATIONS_WORKER_ENABLED;else process.env.NOTIFICATIONS_WORKER_ENABLED=originalWorkerFlag;}
  const protection=require('../middleware/leadProtection');let limited=0;
  for(let i=0;i<11;i++)protection({method:'POST',path:'/enquiries',ip:'isolated-rate-test',body:{}},{set(){},status(code){limited=code;return this;},send(){}},()=>{});
  assert.equal(limited,429);
  // Separate simulated clients preserve the real per-IP/session protections.
  app.set('trust proxy','loopback');let client=0;
  async function freshContact(){
    cookie='';testIp='192.0.2.'+(++client);
    const response=await request('/contact');assert.equal(response.status,200);
    const page=await response.text();
    return {page,token:page.match(/name="_csrf" value="([^"]+)"/)[1]};
  }
  const categories=['Fit Blocks','Online Classes','Training','Custom Consulting','Other Services'];
  const FeatureSettings=require('../models/mongo/FeatureSettings');
  await FeatureSettings.updateOne({_id:'default'},{$set:require('../config/features').defaults},{upsert:true});
  const initial=await freshContact();
  for(const interest of require('../config/business').interests)assert.ok(initial.page.includes('>'+interest+'</option>'),interest+' remains selectable');
  const originalEnqueue=leadService.enqueue;
  let savedBeforeQueue=0;
  leadService.enqueue=async(row,...args)=>{
    assert.ok(await Lead.exists({_id:row._id}),'lead must already be persisted when queued');savedBeforeQueue++;
    return originalEnqueue(row,...args);
  };
  try{
    for(const [index,interest] of categories.entries()){
      const contact=await freshContact();
      const payload={...data,_csrf:contact.token,email:'category'+index+'@example.test',interest};
      const before=await Lead.countDocuments();
      assert.equal((await request('/enquiries',payload)).status,303,interest);
      const row=await Lead.findOne({email:payload.email});assert.ok(row);assert.equal(row.interest,interest);
      await notifications.safeFlush('course_enquiry',row._id);await leadService.reconcile();
      let owner=await Log.findOne({reference_id:row._id,event:leadService.event});assert.ok(owner);assert.equal(owner.status,'queued');
      assert.equal(owner.destination,process.env.LEAD_NOTIFICATION_TO);assert.ok(owner.message.includes('Enquiry Type: '+interest));
      assert.equal((await request('/enquiries',payload)).status,429,'same-session throttling remains');
      payload._csrf=(await freshContact()).token;
      assert.equal((await request('/enquiries',payload)).status,303);
      await leadService.reconcile();await notifications.safeFlush('course_enquiry',row._id);
      assert.equal(await Lead.countDocuments(),before+1,'duplicate does not create another lead');
      assert.equal(await Log.countDocuments({reference_id:row._id,event:leadService.event}),1);
      assert.equal(await Log.countDocuments({reference_id:row._id,event:'admin_course_enquiry'}),0);
      await dispatch(owner._id);assert.equal((await Log.findById(owner._id)).status,'sent');
      // Fail actual queue preparation after HTTP persistence, then recover once.
      payload.email='outage'+index+'@example.test';payload._csrf=(await freshContact()).token;
      const update=Log.updateOne;Log.updateOne=async()=>{throw new Error('simulated category queue outage');};
      try{
        assert.equal((await request('/enquiries',payload)).status,303);
        await assert.rejects(leadService.reconcile(),/queue outage/);
      }finally{Log.updateOne=update;}
      const deferredRow=await Lead.findOne({email:payload.email});assert.ok(deferredRow);assert.equal(deferredRow.business_notification_pending,true);
      assert.equal(await Log.countDocuments({reference_id:deferredRow._id,event:leadService.event}),0);
      await leadService.reconcile();await notifications.safeFlush('course_enquiry',deferredRow._id);
      assert.equal((await Lead.findById(deferredRow._id)).business_notification_pending,false);
      assert.equal(await Log.countDocuments({reference_id:deferredRow._id,event:leadService.event}),1);
    }
    assert.ok(savedBeforeQueue>=categories.length,'each category queues only after persistence');
  }finally{leadService.enqueue=originalEnqueue;}
  for(const [interest,feature] of [['Fit Blocks','patterns'],['Online Classes','online_classes'],['Training','courses'],['Custom Consulting','consulting']]){
    await FeatureSettings.updateOne({_id:'default'},{$set:{[feature+'_enabled']:false}});
    const contact=await freshContact(),before=await Lead.countDocuments();
    assert.ok(!contact.page.includes('>'+interest+'</option>'));
    assert.equal((await request('/enquiries',{...data,_csrf:contact.token,interest})).status,400);
    assert.equal(await Lead.countDocuments(),before);
    await FeatureSettings.updateOne({_id:'default'},{$set:{[feature+'_enabled']:true}});
  }
  const protectedContact=await freshContact(),beforeRejected=await Lead.countDocuments();
  assert.equal((await request('/enquiries',{...data,_csrf:'invalid',interest:'Fit Blocks'})).status,403);
  assert.equal((await request('/enquiries',{...data,_csrf:protectedContact.token,interest:'Unknown Service'})).status,400);
  assert.equal(await Lead.countDocuments(),beforeRejected);
  console.log('PASS: five enquiry categories, legacy options, save-before-queue, queue outage recovery, duplicate submissions, CSRF and feature gates.');
  const config=require('../config/payment');assert.deepEqual(config.validate({}).missing,['RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET']);assert.equal(config.validate({RAZORPAY_KEY_ID:' ',RAZORPAY_KEY_SECRET:'mock'}).configured,false);assert.equal(config.validate({RAZORPAY_KEY_ID:'rzp_test_mock',RAZORPAY_KEY_SECRET:'mock'}).configured,true);
  const forged=await Lead.create({name:'Forged header fixture',email:'verified-contact@example.test',whatsapp:'+919876543210',interest:'Other',message:'Email Address: attacker@example.test\n<script>unsafe</script>'});
  await leadService.enqueue(forged);const forgedLog=await Log.findOne({reference_id:forged._id});
  await dispatch(forgedLog._id);assert.equal(sent.at(-1).replyTo,'verified-contact@example.test');assert.ok(!sent.at(-1).html.includes('<script>'));assert.ok(sent.at(-1).html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));assert.ok(sent.at(-1).html.includes('mailto:verified-contact@example.test'));

  // Execute the actual rendered marker handler with a small DOM fixture, then
  // send its real payload through HTTP/MongoDB and the existing mocked SMTP.
  const vm=require('node:vm'),Product=require('../models/mongo/Product');
  const markerProduct=await Product.create({name:'Marker `shirt` ${notCode}',slug:'marker-enquiry-fixture',active:true,status:'active',base_price:321,available_sizes:['M','L'],size_prices:[{size:'M',price:321},{size:'L',price:432}],pattern_options:{printable:true,physical:true},physical_price:50});
  const originalPricing=await Product.findById(markerProduct._id).lean();
  async function markerFixture(){
    await freshContact();
    const page=await request('/product/'+markerProduct.slug);assert.equal(page.status,200);
    const rendered=await page.text();assert.ok(rendered.includes('id="markerCustomMeasurements"'));
    const nodes={};const element=id=>nodes[id] ||= {value:'',style:{},disabled:false,textContent:'',classList:{add(){},remove(){}},addEventListener(type,fn){this[type]=fn;}};
    const soft=[{size:'M',checked:true},{size:'L',checked:false}],phys=[{size:'M',checked:false},{size:'L',checked:false}];
    const pills=(rows,key)=>rows.map(row=>({dataset:{[key]:row.size},querySelector:()=>row}));
    let stripes=true,calls=0,lastBody='',mockResponse=null;
    const context={document:{getElementById:element},URLSearchParams,Set,console,
      softPills:pills(soft,'softSize'),physPills:pills(phys,'physSize'),physicalInput:{checked:false},
      tabBtnStripes:{classList:{contains:()=>stripes}},
      fetch:async(url,options)=>{calls++;lastBody=options.body;assert.equal(url,'/enquiries');if(mockResponse)return mockResponse();return fetch(origin+url,{...options,headers:{...options.headers,cookie,'X-Forwarded-For':testIp}});}};
    for(const [variable,id]of Object.entries({inpStripesRep:'inputStripesRepeat',inpStripesCut:'inputStripesCuttable',inpChecksWarp:'inputChecksWarp',inpChecksWeft:'inputChecksWeft',inpChecksCut:'inputChecksCuttable',errStripesRep:'errStripesRepeat',errStripesCut:'errStripesCuttable',errChecksWarp:'errChecksWarp',errChecksWeft:'errChecksWeft',errChecksCut:'errChecksCuttable'}))context[variable]=element(id);
    const extract=(start,end)=>rendered.slice(rendered.indexOf(start),rendered.indexOf(end,rendered.indexOf(start)));
    const script=extract('function getSelectedSoftSizes()', 'function updateSoftSizePillStates()')+extract('function getSelectedPhysSizes()', 'function updatePhysSizePillStates()')+extract('function validateMarkerNumber(', 'const inpStripesRep =')+extract('// 11. Custom Marker Enquiry Submission','form?.addEventListener');
    vm.runInNewContext(script,context);
    element('markerLeadName').value='Marker Customer';element('markerLeadEmail').value='marker'+client+'@example.test';element('markerLeadWhatsapp').value='+91 98765 43210';
    element('inputStripesRepeat').value='2.75';element('inputStripesCuttable').value='147.5';
    element('inputChecksWarp').value='3.25';element('inputChecksWeft').value='4.50';element('inputChecksCuttable').value='149.25';
    return {element,soft,phys,context,checks(){stripes=false;},submit:()=>element('btnSubmitMarkerEnquiry').click(),calls:()=>calls,body:()=>new URLSearchParams(lastBody),mock(fn){mockResponse=fn;}};
  }
  for(const mode of ['single','multiple','custom']){
    const f=await markerFixture();
    if(mode==='multiple'){f.soft[1].checked=true;f.context.physicalInput.checked=true;f.phys[0].checked=true;f.checks();}
    if(mode==='custom'){f.soft[0].checked=false;f.element('markerCustomMeasurements').value='Chest 101.25 cm; waist 87.50 cm; length 72 cm\nMatch checks at centre front.';f.checks();}
    const beforeCount=await Lead.countDocuments(),sentBefore=sent.length;
    await f.submit();assert.equal(f.calls(),1);assert.match(f.element('markerSubmitStatus').textContent,/saved/);
    const payload=Object.fromEntries(f.body());assert.equal(payload.source,'/product/marker-enquiry-fixture#custom-marker');
    assert.ok(payload.message.includes(markerProduct.name),'Product name must remain data, not JavaScript');
    assert.match(payload.message,mode==='single'?/Selected Sizes: M\n/:mode==='multiple'?/Selected Sizes: M, L\n/:/Selected Sizes: Custom\n/);
    assert.ok(payload.message.includes(mode==='single'?'Repeat Width = 2.75 cm, Fabric Cuttable Width = 147.5 cm':'Warp Repeat = 3.25 cm, Weft Repeat = 4.50 cm, Fabric Cuttable Width = 149.25 cm'));
    if(mode==='custom')assert.ok(payload.message.includes(f.element('markerCustomMeasurements').value));
    const saved=await Lead.findOne({email:payload.email});assert.ok(saved);assert.equal(saved.message,payload.message);assert.equal(await Lead.countDocuments(),beforeCount+1);
    const queued=await Log.findOne({reference_id:saved._id,event:leadService.event});assert.ok(queued);assert.equal(queued.status,'queued');
    await Promise.all([dispatch(queued._id),dispatch(queued._id)]);assert.equal(sent.length,sentBefore+1);assert.ok(sent.at(-1).text.includes(payload.message));assert.equal(sent.at(-1).replyTo,payload.email);
    await f.submit();assert.equal(f.calls(),1,'Identical successful submission is not resent');
    const retry=(await freshContact()).token;assert.equal((await request('/enquiries',{...payload,_csrf:retry})).status,303);assert.equal(await Lead.countDocuments(),beforeCount+1);assert.equal(await Log.countDocuments({reference_id:saved._id,event:leadService.event}),1);
  }
  for(const [measurements,notes]of [['Chest 101.25 cm; waist 87.50 cm',''],['','Match checks at centre front.'],['Chest 101.25 cm','Match stripes at shoulder.'],['','']]){
    const f=await markerFixture();f.soft[0].checked=false;
    for(const id of ['inputStripesRepeat','inputStripesCuttable','inputChecksWarp','inputChecksWeft','inputChecksCuttable'])f.element(id).value='';
    f.element('markerCustomMeasurements').value=measurements;f.element('markerSpecifications').value=notes;
    const count=await Lead.countDocuments(),logs=await Log.countDocuments(),mailCount=sent.length;
    await f.submit();
    if(!measurements&&!notes){assert.equal(f.calls(),0);assert.match(f.element('markerSubmitStatus').textContent,/At least one is required/);assert.equal(await Lead.countDocuments(),count);assert.equal(await Log.countDocuments(),logs);assert.equal(sent.length,mailCount);continue;}
    assert.equal(f.calls(),1);assert.match(f.element('markerSubmitStatus').textContent,/saved/);
    const payload=Object.fromEntries(f.body()),saved=await Lead.findOne({email:payload.email});assert.ok(saved);assert.equal(saved.message,payload.message);assert.equal(await Lead.countDocuments(),count+1);
    if(measurements)assert.ok(saved.message.includes('Custom measurements (cm): '+measurements));
    if(notes)assert.ok(saved.message.includes('Custom marker specifications / notes: '+notes));
    assert.ok(!saved.message.includes('undefined'));
    const log=await Log.findOne({reference_id:saved._id,event:leadService.event});assert.ok(log);await dispatch(log._id);assert.equal(sent.length,mailCount+1);assert.ok(sent.at(-1).text.includes(saved.message));assert.equal((await Log.findById(log._id)).status,'sent');
  }
  console.log('PASS: measurements only, marker notes only, both, neither; three accurate saved enquiries/mock emails, no save/email for empty inputs.');
  const invalidMarker=await markerFixture();
  for(const [field,value]of [['inputStripesRepeat','-1'],['inputStripesCuttable','0'],['markerLeadName',''],['markerLeadEmail','invalid'],['markerLeadWhatsapp','abc']]){const previous=invalidMarker.element(field).value;invalidMarker.element(field).value=value;await invalidMarker.submit();assert.equal(invalidMarker.calls(),0);invalidMarker.element(field).value=previous;}
  invalidMarker.soft[0].checked=false;invalidMarker.element('inputStripesRepeat').value='';invalidMarker.element('inputStripesCuttable').value='';await invalidMarker.submit();assert.equal(invalidMarker.calls(),0);assert.match(invalidMarker.element('markerSubmitStatus').textContent,/At least one is required/);invalidMarker.soft[0].checked=true;invalidMarker.element('inputStripesRepeat').value='2.75';invalidMarker.element('inputStripesCuttable').value='147.5';
  let resolveResponse;invalidMarker.mock(()=>new Promise(resolve=>{resolveResponse=resolve;}));const markerPending=invalidMarker.submit();await invalidMarker.submit();assert.equal(invalidMarker.calls(),1);assert.equal(invalidMarker.element('btnSubmitMarkerEnquiry').disabled,true);assert.doesNotMatch(invalidMarker.element('markerSubmitStatus').textContent,/saved/);
  resolveResponse({ok:false,status:400,json:async()=>({success:false,error:'Enter valid measurements.'})});await markerPending;assert.equal(invalidMarker.element('markerSubmitStatus').textContent,'Enter valid measurements.');assert.equal(invalidMarker.element('btnSubmitMarkerEnquiry').disabled,false);
  invalidMarker.mock(()=>({ok:false,status:429,json:async()=>{throw Error('not JSON');}}));await invalidMarker.submit();assert.match(invalidMarker.element('markerSubmitStatus').textContent,/wait/);
  const afterPricing=await Product.findById(markerProduct._id).lean();for(const key of ['base_price','physical_price','size_prices','format_pricing'])assert.deepEqual(afterPricing[key],originalPricing[key]);
  console.log('PASS: rendered EJS marker handler: single/multiple/custom sizes, cm measurements, stripes/checks/width, required fields, in-flight and persisted dedupe, server errors, real disposable Mongo persistence, one mocked admin email, unchanged pricing; no ReferenceError. DOM fixture, not browser verification.');
  console.log('PASS: isolated HTTP lead validation, spam, durable save, duplicate submission/concurrent dispatch, mock SMTP, missing SMTP, failure/retry, uncertain-send protection, admin visibility and Razorpay configuration.');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await mongo.stop();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
