process.env.TEST_PATTERN_STOREFRONT = 'false';
require('../models/mongo/FeatureSettings').findById = () => ({lean: async () => null});
// Isolated HTTP integration tests; no live database writes or payments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ejs = require('ejs');
const mongoose = require('mongoose');
process.env.ADMIN_USERNAME = 'studio-test';
process.env.ADMIN_PASSWORD = 'studio-test-password';
process.env.SITE_URL = 'https://studio.example';
const Lead = require('../models/mongo/Lead');
const Book = require('../models/mongo/Book');
const BookPurchase = require('../models/mongo/BookPurchase');
const Article = require('../models/mongo/Article');
const Product = require('../models/mongo/Product');
const ClassSession = require('../models/mongo/ClassSession');
const validation = require('../services/businessValidation');
const stores = new Map();
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(part => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$regex' in value) return new RegExp(value.$regex, value.$options).test(row[key]);
      if ('$lte' in value) return row[key] && new Date(row[key]) <= value.$lte;
      if ('$gte' in value) return row[key] && new Date(row[key]) >= value.$gte;
      if ('$ne' in value) return String(row[key]) !== String(value.$ne);
      if ('$nin' in value) return !value.$nin.includes(row[key]);
    }
    return String(row[key]) === String(value);
  });
}
function toPlain(row) {
  if (!row) return row;
  return typeof row.toObject === 'function' ? row.toObject() : row;
}
function query(items, single = false) {
  let rows = [...items];
  let isLean = false;
  const q = {
    sort(spec) { const [key, order] = Object.entries(spec)[0]; rows.sort((a,b) => a[key] > b[key] ? order : -order); return q; },
    skip(n) { rows = rows.slice(n); return q; },
    limit(n) { rows = rows.slice(0,n); return q; },
    lean() { isLean = true; return q; },
    select() { return q; },
    cursor() { return (async function*(){ yield* (isLean ? rows.map(toPlain) : rows); })(); },
    then(resolve,reject) {
      const res = single ? (isLean ? toPlain(rows[0]) : rows[0]) || null : (isLean ? rows.map(toPlain) : rows);
      return Promise.resolve(res).then(resolve,reject);
    },
    catch(reject) { return q.then(v=>v,reject); }
  };
  return q;
}
for (const Model of [require('../models/mongo/Courier'),Lead, Book, BookPurchase, Article, Product, ClassSession, require('../models/mongo/Course'), require('../models/mongo/Webinar'), require('../models/mongo/ProductFile'), require('../models/mongo/Addon'), require('../models/mongo/TaxSettings'), require('../models/mongo/NotificationLog')]) {
  const rows = []; stores.set(Model, rows);
  Model.init = async function() { return this; };
  Model.find = filter => query(rows.filter(row => matches(row, filter || {})));
  Model.findOne = filter => query(rows.filter(row => matches(row, filter || {})), true);
  Model.findById = id => query(rows.filter(row => String(row._id) === String(id)), true);
  Model.countDocuments = async filter => rows.filter(row => matches(row, filter)).length;
  Model.exists = async filter => rows.some(row => matches(row,filter));
  Model.distinct = async (field, filter = {}) => [...new Set(rows.filter(row => matches(row, filter)).map(row => row[field]).filter(Boolean))];
  Model.updateOne = async (filter, update, options) => {
    let row = rows.find(r => matches(r, filter));
    if (!row && options && options.upsert) {
      const data = { createdAt: new Date(), updatedAt: new Date(), ...filter, ...(update.$set || {}), ...(update.$setOnInsert || {}) };
      row = new Model(data);
      row.createdAt ||= new Date();
      row.updatedAt ||= new Date();
      rows.push(row);
      return { upsertedCount: 1, matchedCount: 0, modifiedCount: 0 };
    }
    if (row && update.$set) {
      Object.assign(row, update.$set);
      return { upsertedCount: 0, matchedCount: 1, modifiedCount: 1 };
    }
    return { upsertedCount: 0, matchedCount: row ? 1 : 0, modifiedCount: 0 };
  };
  Model.prototype.save = async function() {
    await this.validate();
    if (this.slug && rows.some(row => row.slug === this.slug && String(row._id) !== String(this._id))) throw Object.assign(new Error('duplicate'), { code: 11000 });
    this.createdAt ||= new Date();
    const index = rows.findIndex(row => String(row._id) === String(this._id));
    if (index < 0) rows.push(this); else rows[index] = this;
    return this;
  };
  Model.create = async data => new Model(data).save();
  Model.findByIdAndUpdate = async (id, update) => { const row = rows.find(row => String(row._id) === id); if (row) { Object.assign(row, update.$set); await row.validate(); } return row; };
}
const access=require('../services/paidAccessService');
const settings=new (require('../models/mongo/PaidAccessSettings'))().toObject();
access.getSettings=async()=>settings;
access.getConsultingServices=async()=>({find:()=>query([])});
async function run() {
  console.log('[DEBUG] testBusiness run() started');
  const priorPatternFilesDir=process.env.PATTERN_FILES_DIR;
  const bookFilesDir=fs.mkdtempSync(path.join(os.tmpdir(),'business-book-files-'));
  process.env.PATTERN_FILES_DIR=bookFilesDir;
  const notifications=require('../services/notificationService'),priorSafeFlush=notifications.safeFlush;
  notifications.safeFlush=async()=>{};
  const paidAccessSettings={...settings.books};
  Object.assign(settings.books,{enabled:true,active:true,fee:0,button_text:'Get book'});
  for (const dir of ['routes','models/mongo','services','config','scripts']) for (const file of fs.readdirSync(path.resolve(__dirname,'..',dir))) if (file.endsWith('.js')) execFileSync(process.execPath,['--check',path.resolve(__dirname,'..',dir,file)],{env:{...process.env,NODE_OPTIONS:''}});
  execFileSync(process.execPath,['--check',path.resolve(__dirname,'../server.js')],{env:{...process.env,NODE_OPTIONS:''}});
  let compiled = 0;
  function compile(dir) { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) compile(file); else if(file.endsWith('.ejs')) { ejs.compile(fs.readFileSync(file,'utf8'),{filename:file}); compiled++; } } }
  compile(path.resolve(__dirname,'../views'));
  console.log('[DEBUG] EJS compilation finished');
  const product = await Product.create({name:'Integration Pattern',slug:'integration-pattern',active:true,base_price:500,physical_price:100,trial_price:200});
  const book = await Book.create({title:'Studio Book',slug:'studio-book',active:true,topics:['Fit'],author:'Studio',description:'Fit guidance'});
  await Book.create({title:'Hidden Book',slug:'hidden-book',active:false});
  await Article.create({title:'Published Insight',slug:'published-insight',content:'Plain text insight',category:'Garment Technology',published:true,published_at:new Date()});
  await Article.create({title:'Hidden Insight',slug:'hidden-insight',content:'Hidden',category:'Industry News',published:false});
  await ClassSession.create({title:'Pattern Class',slug:'pattern-class',type:'Course',starts_at:new Date(Date.now()+86400000),ends_at:new Date(Date.now()+90000000),published:true,registration_open:true,status:'Upcoming',price:1500});
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log('[DEBUG] Server listening on ' + origin);
  const jar = {};
  async function request(url, body, who = 'public') {
    const response = await fetch(origin+url, { method:body?'POST':'GET',redirect:'manual',headers:{ connection:'close', ...(jar[who]?{cookie:jar[who]}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}) },body:body?new URLSearchParams(body):undefined });
    const cookie=response.headers.get('set-cookie');if(cookie)jar[who]=cookie.split(';')[0];
    return {status:response.status,location:response.headers.get('location'),headers:response.headers,html:await response.text()};
  }
  const token = html => html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  try {
    console.log('[DEBUG] Starting route sweep');
    for(const url of ['/','/products','/product/integration-pattern','/courses','/courses/pattern-making','/garment-technology','/consulting','/corporate-training','/contact','/books','/books/studio-book','/updates','/updates/published-insight','/cart','/checkout','/admin/login']) assert.ok([200,302,303,404].includes((await request(url)).status),url);
    for(const url of ['/books/hidden-book','/updates/hidden-insight']) assert.equal((await request(url)).status,404);
    assert.equal((await request('/admin')).location,'/admin/login');
    for(const url of ['/admin/leads','/admin/leads/export.csv','/admin/books','/admin/articles']) assert.equal((await request(url)).location,'/admin/login');
    console.log('[DEBUG] Finished route sweep, requesting /consulting');
    const page=await request('/consulting');const csrf=token(page.html);
    assert.match(page.html,/https:\/\/studio.example\/consulting/);
    const payload={_csrf:csrf,name:'Jane Pattern',email:'jane@example.test',whatsapp:'+919876543210',interest:'Consulting',source:'/consulting',message:'Fit support'};
    assert.equal((await request('/enquiries',{...payload,_csrf:'bad'})).status,403);
    assert.equal((await request('/enquiries',{...payload,email:'bad'})).status,400);
    assert.equal((await request('/enquiries',{...payload,message:'<script>alert(1)</script>'})).status,400);
    assert.equal((await request('/enquiries',payload)).status,303);
    assert.match((await request('/enquiries/thank-you')).html,/enquiry has been received/);
    assert.equal(stores.get(Lead).length,1);assert.equal(stores.get(Lead)[0].status,'New');
    assert.equal((await request('/enquiries',payload)).status,429);
    const corp=await request('/corporate-training',null,'corporate');
    assert.equal((await request('/enquiries',{...payload,_csrf:token(corp.html),interest:'Corporate Training',company_name:'Studio Ltd',employee_count:'12',location:'Delhi',preferred_date:'2026-12-01'},'corporate')).status,303);
    assert.equal(stores.get(Lead)[1].employee_count,12);
    assert.equal((await request('/admin/login',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD},'admin')).status,302);
    const leads=await request('/admin/leads',null,'admin');assert.equal(leads.status,200);assert.match(leads.html,/Jane Pattern/);
        const adminToken=token((await request(`/admin/leads/${stores.get(Lead)[0]._id}`,null,'admin')).html);
    assert.equal((await request(`/admin/leads/${stores.get(Lead)[0]._id}/status`,{_csrf:adminToken,status:'Converted'},'admin')).status,303);
    assert.equal((await request(`/admin/leads/${stores.get(Lead)[0]._id}/status`,{_csrf:adminToken,status:'Deleted'},'admin')).status,400);
    assert.match((await request('/admin/leads?q=Jane&status=Converted&interest=Consulting',null,'admin')).html,/1 leads/);
    assert.match((await request('/admin/leads?q=missing',null,'admin')).html,/0 leads/);
    assert.match((await request('/admin/leads/export.csv',null,'admin')).html,/Jane Pattern/);
    assert.equal(validation.csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
    for(const kind of ['books','articles']) {
      const form=await request(`/admin/${kind}/new`,null,'admin');assert.equal(form.status,200);
      const data={_csrf:token(form.html),title:'New Content',slug:'new-content',purchase_type:'free',content:'Useful plain text',category:'Industry News',active:'on',published:'on'};
      assert.equal((await request(`/admin/${kind}/new`,{...data,image_url:'javascript:alert(1)',cover_url:'javascript:alert(1)'},'admin')).status,400);
      assert.equal((await request(`/admin/${kind}/new`,data,'admin')).status,303);
      assert.equal((await request(`/admin/${kind}/new`,data,'admin')).status,400);
      const Model=kind==='books'?Book:Article;const row=stores.get(Model).find(r=>r.slug==='new-content');
      assert.equal((await request(`/${kind==='books'?'books':'updates'}/new-content`)).status,200);
      assert.equal((await request(`/admin/${kind}/${row._id}/edit`,null,'admin')).status,200);
      assert.equal((await request(`/admin/${kind}/${row._id}/edit`,{...data,active:'',published:''},'admin')).status,303);
      assert.equal((await request(`/${kind==='books'?'books':'updates'}/new-content`)).status,404);
    }
    const bookForm=await request('/admin/books/new',null,'admin'),bookCsrf=token(bookForm.html);
    const bookFields={_csrf:bookCsrf,title:'Uploaded Book',slug:'uploaded-book',author:'Studio',description:'Private resource',topics:'Fit',purchase_type:'free',price:'',active:'on'};
    const uploadBook=async(url,fields,name,bytes)=>{const form=new FormData();for(const [key,value] of Object.entries(fields))form.append(key,value);form.append('ebook_file',new Blob([bytes],{type:name.toLowerCase().endsWith('.zip')?'application/zip':'application/pdf'}),name);const response=await fetch(origin+url,{method:'POST',redirect:'manual',headers:jar.admin?{cookie:jar.admin}:{},body:form});const cookie=response.headers.get('set-cookie');if(cookie)jar.admin=cookie.split(';')[0];return {status:response.status,location:response.headers.get('location'),html:await response.text()};};
    assert.equal((await uploadBook('/admin/books/new',bookFields,'not-a-book.pdf',Buffer.from('invalid'))).status,400);
    assert.equal((await uploadBook('/admin/books/new',{...bookFields,slug:'invalid-zip-book'},'invalid.zip',Buffer.from('not a ZIP'))).status,400);
    assert.equal((await uploadBook('/admin/books/new',bookFields,'Studio Guide.pdf',Buffer.from('%PDF-1.7\nprivate book bytes'))).status,303);
    const uploadedBook=await Book.findOne({slug:'uploaded-book'}).select('+ebook_file +ebook_file_name').lean();
    assert.equal(uploadedBook.ebook_file_name,'Studio Guide.pdf');
    const accessPage=await request('/books/uploaded-book/access',null,'book-access');
    assert.equal(accessPage.status,200);
    const accessFields={_csrf:token(accessPage.html),submission_key:accessPage.html.match(/name="submission_key" value="([^"]+)"/)[1],full_name:'Book Reader',email:'reader@example.test',whatsapp:'9876543210'};
    const purchase=await request('/books/uploaded-book/access',accessFields,'book-access');
    assert.equal(purchase.status,303);
    const purchaseId=purchase.location.split('/').pop();
    const resourceUrl=`/book-purchases/${purchaseId}/resource`;
    assert.equal((await request(resourceUrl,null,'intruder')).status,403);
    const resource=await request(resourceUrl,null,'book-access');
    assert.equal(resource.status,200);
    assert.ok(resource.headers.get('content-disposition').includes('Studio Guide.pdf'));
    assert.ok(resource.html.includes('private book bytes'));
    const replacePage=await request(`/admin/books/${uploadedBook._id}/edit`,null,'admin');
    const replaced=await uploadBook(`/admin/books/${uploadedBook._id}/edit`,{...bookFields,_csrf:token(replacePage.html)},'Replacement.pdf',Buffer.from('%PDF-1.7\nreplacement'));
    assert.equal(replaced.status,303);
    assert.equal((await request(resourceUrl,null,'book-access')).status,200,'Existing paid/free entitlements retain their original file after replacement.');
    const removePage=await request(`/admin/books/${uploadedBook._id}/edit`,null,'admin');
    const removeForm=new FormData();for(const [key,value] of Object.entries({...bookFields,_csrf:token(removePage.html),remove_ebook_file:'on'}))removeForm.append(key,value);
    const removed=await fetch(origin+`/admin/books/${uploadedBook._id}/edit`,{method:'POST',redirect:'manual',headers:jar.admin?{cookie:jar.admin}:{},body:removeForm});
    assert.equal(removed.status,303);
    assert.equal((await request(resourceUrl,null,'book-access')).status,200,'Removing the current book file does not revoke a recorded entitlement.');
    const zipBytes=Buffer.from('PK\x03\x04test book archive');
    const zipBookFields={...bookFields,title:'Uploaded ZIP Book',slug:'uploaded-zip-book'};
    assert.equal((await uploadBook('/admin/books/new',zipBookFields,'Studio Resources.zip',zipBytes)).status,303);
    const zipBook=await Book.findOne({slug:'uploaded-zip-book'}).select('+ebook_file +ebook_file_name').lean();
    assert.equal(zipBook.ebook_file_name,'Studio Resources.zip');
    const zipAccessPage=await request('/books/uploaded-zip-book/access',null,'zip-book-reader');
    const zipAccessFields={_csrf:token(zipAccessPage.html),submission_key:zipAccessPage.html.match(/name="submission_key" value="([^"]+)"/)[1],full_name:'ZIP Reader',email:'zip-reader@example.test',whatsapp:'9876543210'};
    const zipPurchase=await request('/books/uploaded-zip-book/access',zipAccessFields,'zip-book-reader');
    assert.equal(zipPurchase.status,303);
    const zipPurchaseId=zipPurchase.location.split('/').pop();
    const zipResourceUrl=`/book-purchases/${zipPurchaseId}/resource`;
    assert.equal((await request(zipResourceUrl,null,'intruder')).status,403);
    const zipDownload=await fetch(origin+zipResourceUrl,{headers:jar['zip-book-reader']?{cookie:jar['zip-book-reader']}:{},redirect:'manual'});
    assert.equal(zipDownload.status,200);
    assert.ok(zipDownload.headers.get('content-disposition').includes('Studio Resources.zip'));
    assert.deepEqual(Buffer.from(await zipDownload.arrayBuffer()),zipBytes);
    assert.equal((await request('/admin/leads/invalid',null,'admin')).status,404);
    assert.equal((await request('/cart/add',{product_id:String(product._id),quantity:'2',physical_quantity:'1',trial_quantity:'1'})).status,200);
    assert.match((await request('/cart')).html,/Integration Pattern/);
    const chkRes = await request('/checkout'); assert.ok([200, 303].includes(chkRes.status));
    assert.match((await request('/cart/count')).html,/"count":2/);
    const paymentRoutes = require('../routes/checkout').stack.filter(layer=>layer.route).map(layer=>layer.route.path);
    for(const url of ['/checkout','/checkout/razorpay-callback','/checkout/payment-method/proceed','/checkout/delivery-charge']) assert.ok(paymentRoutes.includes(url));
    console.log(`PASS: JS syntax, ${compiled} EJS templates, public pages, SEO, private content, admin login/access, lead and corporate submission, validation, CSRF, search/filter/status/CSV, content create/edit/visibility, populated cart/checkout and Razorpay route preservation.`);
    console.log('Persistence is simulated; no live records or payments created.');
  } finally { notifications.safeFlush=priorSafeFlush;settings.books=paidAccessSettings;if(priorPatternFilesDir===undefined)delete process.env.PATTERN_FILES_DIR;else process.env.PATTERN_FILES_DIR=priorPatternFilesDir;if(bookFilesDir.startsWith(path.join(os.tmpdir(),'business-book-files-')))fs.rmSync(bookFilesDir,{recursive:true,force:true});if (server?.closeAllConnections) server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); if(require.cache[require.resolve('../config/db')]) await require('../config/db').db.destroy(); if(mongoose.connection.readyState===1) await mongoose.disconnect(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
