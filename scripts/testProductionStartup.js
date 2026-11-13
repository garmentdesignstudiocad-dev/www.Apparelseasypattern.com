// Production startup smoke test with temporary MongoDB and the notification worker enabled.
const assert=require('node:assert/strict'),net=require('node:net'),{spawn}=require('node:child_process'),mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
 let child,output='';
 try{
  await mongoose.connect(mongo.getUri());
  await require('../models/mongo/Product').create({name:'SEO Smoke Test Shirt',slug:'seo-smoke-test-shirt',description:'PDF shirt pattern for startup testing.',images:['/uploads/products/12345678-1234-1234-1234-123456789abc.jpg'],finished_garment_images:['/uploads/products/12345678-1234-1234-1234-123456789abc.jpg'],base_price:250,active:true});
  await mongoose.disconnect();
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_OPTIONS:'--require '+JSON.stringify(require('node:path').join(__dirname,'isolatedTestGuard.js')),SMTP_HOST:'',SMTP_PORT:'',SMTP_SECURE:'',SMTP_USER:'',SMTP_PASS:'',SMTP_FROM:'',LEAD_NOTIFICATION_TO:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:'',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',EMAIL_HOST:'',EMAIL_PASSWORD:'',WHATSAPP_ACCESS_TOKEN:'',NODE_ENV:'production',PORT:String(port),MONGODB_URI:mongo.getUri(),SESSION_SECRET:require('node:crypto').randomBytes(32).toString('hex'),ADMIN_USERNAME:'startup-test',ADMIN_PASSWORD:'startup-test-only',APP_BASE_URL:'https://store.example.test',SITE_URL:'https://store.example.test',DB_HOST:'127.0.0.1',DB_PORT:'1'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const until=Date.now()+30000;
  while(!output.includes('MongoDB connected successfully.') && Date.now()<until){if(child.exitCode!==null)throw new Error('Production process exited');await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(output.includes('MongoDB connected successfully.'));
  for(const route of ['/','/products','/about','/product/seo-smoke-test-shirt','/login','/account/register','/cart','/checkout','/admin/login']){
   const response=await fetch(`http://127.0.0.1:${port}${route}`);assert.equal(response.status,200,route);
   if(['/login','/account/register','/cart','/checkout','/admin/login'].includes(route))assert.match(response.headers.get('x-robots-tag')||'',/noindex/i,route+' must be noindex');
   if(route==='/')assert.match(await response.text(),/<title>Ready-to-Use Apparel Patterns \| Apparel Easy Patterns<\/title>/);
   if(route==='/products'){
    const html=await response.text();assert.ok(html.includes('<title>'+require('../services/seoService').pageDefaults.products[0]+'</title>'));
    assert.ok(html.includes('<meta name="description" content="'+require('../services/seoService').pageDefaults.products[1]+'">'));
    assert.equal((html.match(/<meta name="description"/g)||[]).length,1);
    assert.equal((html.match(/rel="canonical"/g)||[]).length,1);
   }
   if(route==='/about'){
    const html=await response.text();assert.match(html,/<title>About Apparels Easy Pattern \| Garment Pattern Store<\/title>/);
    assert.match(html,/Learn about Apparels Easy Pattern and its garment pattern formats/);
   }
   if(route==='/product/seo-smoke-test-shirt'){
    const html=await response.text();assert.match(html,/<title>SEO Smoke Test Shirt \| Garment Pattern \| Apparel Easy Patterns<\/title>/);
    assert.match(html,/<link rel="canonical" href="https:\/\/store\.example\.test\/product\/seo-smoke-test-shirt">/);
    assert.equal((html.match(/rel="canonical"/g)||[]).length,1);
    assert.equal((html.match(/<meta name="description"/g)||[]).length,1);
    assert.match(html,/"@type":"Product"/);assert.match(html,/"price":"250\.00"/);
   }
  }
  // Exercise production Mongo-backed sessions through a simulated HTTPS proxy.
  const login=await fetch('http://127.0.0.1:'+port+'/admin/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Forwarded-Proto':'https'},body:new URLSearchParams({username:'startup-test',password:'startup-test-only'})});
  assert.equal(login.status,302);
  const cookie=login.headers.get('set-cookie');assert.ok(cookie);
  for(const flag of [/HttpOnly/i,/Secure/i,/SameSite=Lax/i])assert.match(cookie,flag);
  const dashboard=await fetch('http://127.0.0.1:'+port+'/admin',{redirect:'manual',headers:{cookie:cookie.split(';')[0],'X-Forwarded-Proto':'https'}});
  assert.equal(dashboard.status,200);
  await mongoose.connect(mongo.getUri());
  const persisted=await mongoose.connection.db.collection('aep_sessions').findOne({'session.isAdmin':true});
  assert.ok(persisted && persisted.expiresAt>new Date(),'Authenticated session must persist in MongoDB with expiry');
  const indexes=await mongoose.connection.db.collection('aep_sessions').indexes();assert.ok(indexes.some(index=>index.expireAfterSeconds===0));
  await mongoose.disconnect();
  const robots=await fetch(`http://127.0.0.1:${port}/robots.txt`);assert.equal(robots.status,200);assert.match(await robots.text(),/Sitemap: https:\/\/store\.example\.test\/sitemap\.xml/);
  const sitemap=await fetch(`http://127.0.0.1:${port}/sitemap.xml`);assert.equal(sitemap.status,200);const xml=await sitemap.text();assert.match(xml,/https:\/\/store\.example\.test\/products/);assert.match(xml,/https:\/\/store\.example\.test\/product\/seo-smoke-test-shirt/);assert.doesNotMatch(xml,/\/(?:admin|checkout|cart|account|downloads|receipts)(?:\/|<)/);
  assert.equal(child.exitCode,null);
  console.log('PASS: production startup, homepage/product SEO, robots/sitemap, private noindex headers, secure Mongo-backed admin sessions/TTL, and store/Admin routes.');
  if(output.includes('MemoryStore'))console.log('PRODUCTION BLOCKER: express-session MemoryStore is not a persistent production session store.');
 }finally{if(mongoose.connection.readyState)await mongoose.disconnect();if(child && child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}await mongo.stop();}
}
run().catch(error=>{console.error('FAIL: production startup',error.message);process.exitCode=1;});
