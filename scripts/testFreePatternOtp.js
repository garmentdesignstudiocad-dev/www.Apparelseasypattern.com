// Historical filename retained; this now verifies the OTP-free, one-time offer.
'use strict';
require('./isolatedTestGuard');
const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const mongoose=require('mongoose'), {MongoMemoryServer}=require('mongodb-memory-server');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aep-free-claim-'));
 Object.assign(process.env,{MONGOMS_RUNTIME_DOWNLOAD:'false',PATTERN_FILES_DIR:dir,NOTIFICATIONS_WORKER_ENABLED:'false',FREE_PATTERN_REQUIRE_VERIFICATION:'false',SESSION_SECRET:'isolated-claim-test'});
 let mongo,server;
 try {
  mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
  await mongoose.connect(mongo.getUri());
  const Product=require('../models/mongo/Product'),File=require('../models/mongo/ProductFile'),Claim=require('../models/mongo/FreePatternClaim'),service=require('../services/freePatternService');
  const otp=require('../services/otpService'); otp.sendOtp=otp.verifyOtp=async()=>{throw new Error('OTP must not be called');};
  await Claim.init();
  const product=await Product.create({name:'Free fixture',slug:'free-fixture',active:true,status:'active',available_sizes:['M','L'],digital_file:'paid.pdf',digital_file_map:[{format:'pdf',size:'M',file:'paid.pdf'}]});
  fs.writeFileSync(path.join(dir,'paid.pdf'),'%PDF-paid fixture');
  fs.writeFileSync(path.join(dir,'free.pdf'),'%PDF-free fixture');
  await File.create({product_id:product.id,file_name:'Paid chart',file_type:'pdf',upload_slot:'basic_measurement_pdf',digital_file:'paid.pdf'});
  const input={rawPhone:'9876543210',email:' Buyer@Example.com ',productId:product.id,size:'M'};
  assert.equal(await service.findBasicPatternAsset(product,'M'),null);
  assert.match((await service.claimFreePattern(input)).error,/Unavailable/);
  const file=await File.create({product_id:product.id,file_name:'Free M.pdf',file_type:'pdf',upload_slot:'basic_pattern_pdf',free_basic_size:'M',free_basic_approved:false,digital_file:'free.pdf'});
  assert.equal(await service.findBasicPatternAsset(product,'M'),null);
  await File.updateOne({_id:file.id},{$set:{free_basic_approved:true}});
  assert.equal(await service.findBasicPatternAsset(product,'L'),null);
  assert.equal((await service.claimFreePattern({...input,size:'38'})).success,false);
  const granted=await service.claimFreePattern(input);assert.equal(granted.success,true);
  const stored=await Claim.findOne({download_token:granted.download_token}).lean();
  assert.equal(stored.email,'buyer@example.com');assert.equal(stored.phone,'+919876543210');assert.equal(stored.identity_verified,false);
  assert.equal((await service.claimFreePattern({...input,rawPhone:'9876543211',email:'BUYER@example.com'})).success,false);
  const other=await Product.create({name:'Other style',slug:'other-style',active:true,status:'active',available_sizes:['M']});
  assert.equal((await service.claimFreePattern({...input,productId:other.id,rawPhone:'+91 98765 43210',email:'other@example.com'})).success,false);
  assert.equal((await service.getDownload(granted.download_token)).filename,'Free M.pdf');
  assert.equal(await service.getDownload('bad'),null);
  await File.updateOne({_id:file.id},{$set:{free_basic_approved:false}});assert.equal(await service.getDownload(granted.download_token),null);
  await File.updateOne({_id:file.id},{$set:{free_basic_approved:true}});
  await Claim.updateOne({_id:stored._id},{$set:{download_expires_at:new Date(0)}});assert.equal((await service.getDownload(granted.download_token)).expired,true);
  for(const collision of ['email','phone']) {
   const results=await Promise.all(Array.from({length:8},(_,i)=>service.claimFreePattern({...input,email:collision==='email'?'race@example.com':`race${i}@example.com`,rawPhone:collision==='phone'?'9888888888':`977777777${i}`})));
   assert.equal(results.filter(r=>r.success).length,1,collision+' unique index must allow one winner');
  }
  await Claim.create({phone:'+919999999999',style_fit_key:'legacy',product_id:product.id,product_name:'Legacy',claimed_size:'M',download_token:'a'.repeat(64),download_expires_at:new Date(),download_asset:{name:'old.pdf',file:'paid.pdf'}});
  await Claim.create({phone:'+919999999999',style_fit_key:'legacy-other',product_id:product.id,product_name:'Legacy',claimed_size:'L',download_token:'b'.repeat(64),download_expires_at:new Date(),download_asset:{name:'old.pdf',file:'paid.pdf'}});
  assert.equal((await service.claimFreePattern({...input,rawPhone:'9999999999',email:'legacy@example.com'})).success,false);
  assert.equal(await Claim.countDocuments({phone:'+919999999999'}),2);
  const express=require('express'),app=express();app.use(express.json());app.use(require('../routes/freePattern'));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
  const post=(url,body)=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/free-pattern/send-otp',{})).status,410);
  let response=await post('/free-pattern/claim',{phone:'9666666666',email:'http@example.com',product_id:product.id,size:'M'});
  assert.equal(response.status,200);const grant=await response.json();assert.equal(grant.success,true);
  response=await fetch(origin+grant.download_url);assert.equal(response.status,200);assert.equal(await response.text(),'%PDF-free fixture');
  for(let i=0;i<10;i++)response=await post('/free-pattern/claim',{});
  assert.equal(response.status,429);
  fs.unlinkSync(path.join(dir,'free.pdf'));assert.equal(await service.getDownload(grant.download_token),null);
  console.log('PASS: OTP-free HTTP claim/download, normalized duplicate email/phone, cross-style exclusion, concurrent unique indexes, historical claims retained, explicit single-size approval, paid asset exclusion, expiry/revocation/missing-file denial, rate limiting.');
 } finally {if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();if(mongo)await mongo.stop();if(path.dirname(dir)!==os.tmpdir() || !path.basename(dir).startsWith('aep-free-claim-'))throw new Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
