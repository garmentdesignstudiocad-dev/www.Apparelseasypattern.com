const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const vm=require('node:vm');
module.exports=async function({models,request,token,nonce,person,gateway}){
  const {ConsultingService,ConsultationBooking:Booking}=models;
  await ConsultingService.create({name:'CAD Pattern Support',slug:'cad-pattern-support',active:true});
  const path='/consulting/cad-pattern-support/access',who='form-tester';
  assert.equal((await request('/consulting',null,who)).status,200);
  const detail=await request('/consulting/cad-pattern-support',null,who);assert.equal(detail.status,302);assert.equal(detail.location,path);
  const a=await request(path,null,who),b=await request(path,null,who);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.notEqual(token(a.html),token(b.html));assert.notEqual(nonce(a.html),nonce(b.html));
  assert.match(a.html,/action="\/consulting\/cad-pattern-support\/access"/);
  const data={...person,email:'cad-flow@example.test',notes:'Preserve this consulting requirement',_csrf:token(a.html),submission_key:nonce(a.html)};
  const before=await Booking.countDocuments();
  const invalid=await request(path,{...data,email:'invalid'},who);assert.equal(invalid.status,400);assert.match(invalid.html,/Preserve this consulting requirement/);assert.notEqual(nonce(invalid.html),nonce(a.html));assert.notEqual(token(invalid.html),token(a.html));assert.equal(await Booking.countDocuments(),before);
  const stale=await request(path,{...data,_csrf:'stale'},who);assert.equal(stale.status,403);assert.ok(token(stale.html));assert.ok(nonce(stale.html));assert.match(stale.html,/Preserve this consulting requirement/);assert.equal(await Booking.countDocuments(),before);
  const wrongNonce=await request(path,{...data,_csrf:token(stale.html),submission_key:'expired'},who);assert.equal(wrongNonce.status,409);assert.ok(nonce(wrongNonce.html));assert.match(wrongNonce.html,/cad-flow@example.test/);
  // Tokens from another browser are not transferable, even if copied verbatim.
  const stolen=await request(path,data,'other-browser');assert.equal(stolen.status,403);assert.equal(await Booking.countDocuments(),before);
  // Cross-service nonces are rejected even with a valid CSRF token.
  const otherPage=await request('/consulting/fit-consultation/access',null,who);
  const wrongService=await request(path,{...data,_csrf:token(otherPage.html),submission_key:nonce(otherPage.html)},who);assert.equal(wrongService.status,409);
  // Two outstanding tabs remain independently valid. Identical submitted data
  // and concurrent clicks converge on the same durable booking, not two charges.
  const submit={...data,_csrf:token(invalid.html),submission_key:nonce(invalid.html)};
  const attempts=await Promise.all([request(path,submit,who),request(path,submit,who)]);
  attempts.forEach(result=>assert.equal(result.status,303,result.html));assert.equal(attempts[0].location,attempts[1].location);assert.equal(await Booking.countDocuments(),before+1);
  const bookingUrl=attempts[0].location,id=bookingUrl.split('/').pop();
  assert.equal((await request(path,submit,who)).location,bookingUrl,'Consumed submission resumes its existing booking.');
  const refreshed=await request(path,null,who);assert.notEqual(nonce(refreshed.html),submit.submission_key);
  assert.equal((await request(path,{...data,_csrf:token(refreshed.html),submission_key:nonce(refreshed.html)},who)).location,bookingUrl,'Fresh form with the same details resumes pending booking.');
  assert.equal(await Booking.countDocuments(),before+1);
  // A definite gateway rejection unlocks the same booking for a safe retry.
  const page=await request(bookingUrl,null,who),csrf=token(page.html);
  const originalCreate=gateway.orders.create;let creations=0;
  gateway.orders.create=async()=>{throw Object.assign(new Error('test gateway rejection'),{statusCode:400});};
  const failed=await request(bookingUrl+'/order',{_csrf:csrf},who);assert.equal(failed.status,503);assert.equal((await Booking.findById(id)).order_creating,false);assert.equal((await Booking.findById(id)).razorpay_order_id,'');
  gateway.orders.create=async data=>{creations++;return originalCreate(data);};
  const retryPage=await request(bookingUrl,null,who);assert.notEqual(token(retryPage.html),csrf);
  // Exercise the real payment browser script against the test HTTP routes.
  let ready,checkout,opened=false;const handlers={},message={textContent:''},pay={disabled:false,addEventListener:(name,fn)=>handlers[name]=fn},check={disabled:false,addEventListener:()=>{}};
  const root={dataset:{id,base:'/consultation-bookings',description:'Consultation Booking',csrf:token(retryPage.html)}};
  const window={location:{assign:value=>{window.redirect=value;}},Razorpay:function(options){checkout=options;this.on=()=>{};this.open=()=>{opened=true;};}};
  const document={addEventListener:(event,fn)=>{ready=fn;},getElementById:key=>({'webinar-payment':root,'webinar-pay':pay,'webinar-check':check,'webinar-payment-message':message}[key])};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/webinar-payment.js'),'utf8'),{window,document,fetch:async(url,options)=>{const result=await request(url,JSON.parse(options.body),who);return {ok:result.status===200,json:async()=>result.json()};}});
  ready();await handlers.click();assert.ok(opened,'Razorpay popup opens after order creation.');assert.equal(checkout.amount,19900);assert.equal(creations,1);
  // Payment window dismissal and retry retain the same Razorpay order.
  checkout.modal.ondismiss();assert.equal(pay.disabled,false);const firstOrder=checkout.order_id;await handlers.click();assert.equal(checkout.order_id,firstOrder);assert.equal(creations,1);
  const orderAgain=await request(bookingUrl+'/order',{_csrf:token(retryPage.html)},who);assert.equal(orderAgain.json().order_id,firstOrder);assert.equal(creations,1);
  const paymentId='pay_cadformtest',originalFetch=gateway.payments.fetch;
  gateway.payments.fetch=async id=>id===paymentId?{id,order_id:firstOrder,amount:19900,currency:'INR',status:'captured',captured:true}:originalFetch(id);
  await checkout.handler({razorpay_order_id:firstOrder,razorpay_payment_id:paymentId,razorpay_signature:crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(firstOrder+'|'+paymentId).digest('hex')});
  assert.equal(window.redirect,bookingUrl);assert.equal((await Booking.findById(id)).registration_status,'Confirmed');assert.equal((await Booking.findById(id)).payment_status,'Paid');
  assert.equal((await request(bookingUrl,null,'other-browser')).status,403);
  gateway.orders.create=originalCreate;gateway.payments.fetch=originalFetch;
  console.log('PASS consulting forms: fresh GET/error tokens, preserved values, stale-CSRF recovery without writes, cross-session/service rejection, multiple tabs, concurrent submissions, pending-booking reuse, rejected gateway retry, one Razorpay order, popup open, verified confirmation.');
  console.log('Tested paths: /consulting ; /consulting/cad-pattern-support ; /consulting/cad-pattern-support/access ; /consultation-bookings/:id (isolated HTTP server).');
};
