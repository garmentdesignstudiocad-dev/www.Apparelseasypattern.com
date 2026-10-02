const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {publicOrigin}=require('../services/receiptService');
async function run(){
  const saved={...process.env};
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'private-pattern-security-'));
  try{
    process.env.NODE_ENV='production';process.env.PUBLIC_BASE_URL='https://legacy.example.test';delete process.env.APP_BASE_URL;
    assert.equal(publicOrigin(),'','Production requires APP_BASE_URL explicitly');
    for(const value of ['http://store.example.test','https://localhost','https://127.0.0.1','https://user:password@store.example.test','https://store.example.test/path','https://store.example.test?x=1','not a URL']){
      process.env.APP_BASE_URL=value;assert.equal(publicOrigin(),'',value);
    }
    process.env.APP_BASE_URL='https://store.example.test/';assert.equal(publicOrigin(),'https://store.example.test');
    process.env.NODE_ENV='development';process.env.APP_BASE_URL='http://localhost:3000';assert.equal(publicOrigin(),'http://localhost:3000');
    const digital=require('../services/digitalDeliveryService');process.env.PATTERN_FILES_DIR=dir;
    await fs.writeFile(path.join(dir,'p.dxf'),'test-only pattern');assert.equal(await digital.filePath('p.dxf'),path.join(dir,'p.dxf'));
    for(const file of ['../p.dxf','..','/p.dxf','p.dxf/other','missing.dxf'])assert.equal(await digital.filePath(file),null);
    const link=path.join(dir,'public-link');await fs.symlink(path.resolve(__dirname,'../public'),link,'junction');
    process.env.PATTERN_FILES_DIR=link;await assert.rejects(digital.privateRoot,/outside public/);
    await fs.unlink(link);
    process.env.PATTERN_FILES_DIR=path.resolve(__dirname,'../public/patterns');assert.throws(digital.root,/outside public/);
    const pricing=require('../services/orderPricing');assert.deepEqual(pricing.totals(2000),{subtotal:2000,tax:360,total:2360,amount:236000});
    console.log('PASS: explicit production APP_BASE_URL, HTTPS enforcement, no localhost/credential/path URLs, local development URL, private storage, traversal/junction rejection, and integer-paise GST totals.');
  }finally{
    for(const key of ['NODE_ENV','APP_BASE_URL','PUBLIC_BASE_URL','PATTERN_FILES_DIR']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
    await fs.unlink(path.join(dir,'p.dxf'));await fs.rmdir(dir);
  }
}
run().catch(error=>{console.error(error.name,error.message);process.exitCode=1;});
