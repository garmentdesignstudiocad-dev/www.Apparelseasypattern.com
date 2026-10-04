const assert=require('node:assert/strict');
module.exports=async({models,request,gatewayOrders})=>{
  const {Product,Lead,SiteSettings}=models;
  const before=await Product.countDocuments();
  const setup=await require('../services/launchSetup').prepare();
  assert.equal(setup.product_id,null);
  assert.equal(await Product.countDocuments(),before,'Launch preparation must not create sample products.');
  assert.equal((await request('/product/basic-shirt-pattern')).status,404);
  assert.equal((await SiteSettings.findOne({key:'default'})).contact_email,'garmentdesignstudiocad@gmail.com');

  let page=await request('/');
  assert.equal(page.status,200);
  assert.match(page.html,/Ready-to-Use Apparel Patterns/);
  assert.match(page.html,/href="\/products"[^>]*>Available Patterns/);
  assert.doesNotMatch(page.html,/href="\/consulting(?:["/])/);
  assert.equal((await request('/courses')).location,'/classes/enquiry');
  assert.equal((await request('/classes')).location,'/classes/enquiry');
  assert.equal((await request('/consulting')).status,404);
  page=await request('/books');
  assert.equal(page.status,200);
  assert.match(page.html,/BOOKS — COMING SOON/);

  page=await request('/classes/enquiry',undefined,'launch-enquirer');
  assert.equal(page.status,200);
  const csrf=page.html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const enquiry={_csrf:csrf,name:'Launch Enquirer',email:'launch@example.test',whatsapp:'+919876543210',profession:'Student',studying:'Fashion design',consent:'on'};
  const ordersBefore=await models.Order.countDocuments(),paymentsBefore=gatewayOrders.length;
  assert.equal((await request('/classes/enquiry',enquiry,'launch-enquirer')).location,'/classes/enquiry/thank-you');
  const lead=await Lead.findOne({email:enquiry.email});
  assert.equal(lead.interest,'Online Classes');
  assert.equal(lead.studying,'Fashion design');
  assert(lead.consent_at);
  assert.equal(await models.Order.countDocuments(),ordersBefore);
  assert.equal(gatewayOrders.length,paymentsBefore,'Enquiry must not create a payment.');
  console.log('PASS: launch setup preserves existing products without inventing samples; pattern-first routes, Books Coming Soon and enquiry-only class requests.');
};
