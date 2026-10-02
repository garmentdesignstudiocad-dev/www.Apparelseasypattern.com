require('../models/mongo/FeatureSettings').findById = () => ({lean: async () => null});
// Isolated HTTP integration tests; no live database writes or payments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ejs = require('ejs');
const mongoose = require('mongoose');
process.env.ADMIN_USERNAME = 'studio-test';
process.env.ADMIN_PASSWORD = 'studio-test-password';
process.env.SITE_URL = 'https://studio.example';
const Lead = require('../models/mongo/Lead');
const Book = require('../models/mongo/Book');
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
      if ('$nin' in value) return !value.$nin.includes(row[key]);
    }
    return String(row[key]) === String(value);
  });
}
function query(items, single = false) {
  let rows = [...items];
  const q = { sort(spec) { const [key, order] = Object.entries(spec)[0]; rows.sort((a,b) => a[key] > b[key] ? order : -order); return q; }, skip(n) { rows = rows.slice(n); return q; }, limit(n) { rows = rows.slice(0,n); return q; }, lean() { return q; }, select() { return q; }, cursor() { return (async function*(){ yield* rows; })(); }, then(resolve,reject) { return Promise.resolve(single ? rows[0] || null : rows).then(resolve,reject); }, catch(reject) { return q.then(v=>v,reject); } };
  return q;
}
for (const Model of [require('../models/mongo/Courier'),Lead, Book, Article, Product, ClassSession, require('../models/mongo/Course'), require('../models/mongo/Webinar'), require('../models/mongo/ProductFile'), require('../models/mongo/Addon'), require('../models/mongo/TaxSettings')]) {
  const rows = []; stores.set(Model, rows);
  Model.find = filter => query(rows.filter(row => matches(row, filter || {})));
  Model.findOne = filter => query(rows.filter(row => matches(row, filter || {})), true);
  Model.findById = id => query(rows.filter(row => String(row._id) === String(id)), true);
  Model.countDocuments = async filter => rows.filter(row => matches(row, filter)).length;
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
  for (const dir of ['routes','models/mongo','services','config','scripts']) for (const file of fs.readdirSync(path.resolve(__dirname,'..',dir))) if (file.endsWith('.js')) execFileSync(process.execPath,['--check',path.resolve(__dirname,'..',dir,file)]);
  execFileSync(process.execPath,['--check',path.resolve(__dirname,'../server.js')]);
  let compiled = 0;
  function compile(dir) { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) compile(file); else if(file.endsWith('.ejs')) { ejs.compile(fs.readFileSync(file,'utf8'),{filename:file}); compiled++; } } }
  compile(path.resolve(__dirname,'../views'));
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
  const jar = {};
  async function request(url, body, who = 'public') {
    const response = await fetch(origin+url, { method:body?'POST':'GET',redirect:'manual',headers:{ ...(jar[who]?{cookie:jar[who]}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}) },body:body?new URLSearchParams(body):undefined });
    const cookie=response.headers.get('set-cookie');if(cookie)jar[who]=cookie.split(';')[0];
    return {status:response.status,location:response.headers.get('location'),html:await response.text()};
  }
  const token = html => html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  try {
    for(const url of ['/','/products','/product/integration-pattern','/courses','/courses/pattern-making','/garment-technology','/consulting','/corporate-training','/contact','/books','/books/studio-book','/updates','/updates/published-insight','/cart','/checkout','/admin/login']) assert.equal((await request(url)).status,200,url);
    for(const url of ['/books/hidden-book','/updates/hidden-insight']) assert.equal((await request(url)).status,404);
    assert.equal((await request('/admin')).location,'/admin/login');
    for(const url of ['/admin/leads','/admin/leads/export.csv','/admin/books','/admin/articles']) assert.equal((await request(url)).location,'/admin/login');
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
    assert.equal((await request('/admin/leads/invalid',null,'admin')).status,404);
    assert.equal((await request('/cart/add',{product_id:String(product._id),quantity:'2',physical_quantity:'1',trial_quantity:'1'})).status,200);
    assert.match((await request('/cart')).html,/Integration Pattern/);
    assert.match((await request('/checkout')).html,/Integration Pattern/);
    assert.match((await request('/cart/count')).html,/"count":2/);
    const paymentRoutes = require('../routes/checkout').stack.filter(layer=>layer.route).map(layer=>layer.route.path);
    for(const url of ['/checkout','/checkout/razorpay-callback','/checkout/payment-method/proceed','/checkout/delivery-charge']) assert.ok(paymentRoutes.includes(url));
    console.log(`PASS: JS syntax, ${compiled} EJS templates, public pages, SEO, private content, admin login/access, lead and corporate submission, validation, CSRF, search/filter/status/CSV, content create/edit/visibility, populated cart/checkout and Razorpay route preservation.`);
    console.log('Persistence is simulated; no live records or payments created.');
  } finally { await new Promise(resolve=>server.close(resolve)); await require('../config/db').db.destroy(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
