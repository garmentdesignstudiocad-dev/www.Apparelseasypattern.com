// Focused Admin regression: blank ProductFile prices preserve their stored state.
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');

Object.assign(process.env,{
  NODE_ENV:'development',
  SESSION_SECRET:'product-file-price-test-only',
  ADMIN_USERNAME:'product-file-price-test',
  ADMIN_PASSWORD:'product-file-price-test-only',
  NOTIFICATIONS_WORKER_ENABLED:'false',
  DB_HOST:'127.0.0.1',
  DB_PORT:'1',
});

async function run(){
  const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
  let server;
  try{
    process.env.MONGODB_URI=mongo.getUri();
    await mongoose.connect(mongo.getUri());
    const Product=require('../models/mongo/Product');
    const ProductFile=require('../models/mongo/ProductFile');
    const product=await Product.create({name:'Price Preservation Fixture',slug:'price-preservation-fixture',category:'test'});
    const nullPrice=await ProductFile.create({product_id:product._id,file_name:'Null price',file_type:'archive',file_price:null,active:false});
    const numericPrice=await ProductFile.create({product_id:product._id,file_name:'Numeric price',file_type:'archive',file_price:37,active:false});
    const missingPriceId=new mongoose.Types.ObjectId();
    await ProductFile.collection.insertOne({
      _id:missingPriceId,
      product_id:product._id,
      file_name:'Missing price',
      file_type:'archive',
      purpose:'other',
      active:false,
      watermark_pdf:false,
    });
    const countBefore=await ProductFile.countDocuments({product_id:product._id});
    server=require('../server').listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    let cookie='';
    async function request(url,body){
      const response=await fetch(origin+url,{
        method:body?'POST':'GET',
        redirect:'manual',
        headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},
        body:body?new URLSearchParams(body):undefined,
      });
      const setCookie=response.headers.get('set-cookie');
      if(setCookie)cookie=setCookie.split(';')[0];
      return response;
    }
    const login=await request('/admin/login',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD});
    assert.equal(login.status,302,'Admin fixture login must succeed.');
    const update=async(id,price)=>request(`/admin/products/${product._id}/files/${id}/edit`,{
      file_name:'Updated DXF',purpose:'dxf',file_type:'DXF',file_price:price,
    });

    assert.equal((await update(nullPrice._id,'')).status,302);
    assert.equal((await ProductFile.collection.findOne({_id:nullPrice._id})).file_price,null,'Blank edit must preserve null.');
    assert.equal((await update(numericPrice._id,'')).status,302);
    assert.equal((await ProductFile.collection.findOne({_id:numericPrice._id})).file_price,37,'Blank edit must preserve an existing number.');
    assert.equal((await update(missingPriceId,'')).status,302);
    assert.equal(Object.hasOwn(await ProductFile.collection.findOne({_id:missingPriceId}),'file_price'),false,'Blank edit must preserve a missing field.');
    assert.equal((await update(nullPrice._id,'0')).status,302);
    assert.equal((await ProductFile.collection.findOne({_id:nullPrice._id})).file_price,0,'An explicit zero must be stored.');
    assert.equal((await update(numericPrice._id,'42')).status,302);
    assert.equal((await ProductFile.collection.findOne({_id:numericPrice._id})).file_price,42,'An entered numeric price must update normally.');
    assert.equal(await ProductFile.countDocuments({product_id:product._id}),countBefore,'Metadata edits must not create ProductFiles.');
    assert.equal((await ProductFile.collection.findOne({_id:nullPrice._id})).active,false);
    assert.equal((await ProductFile.collection.findOne({_id:numericPrice._id})).active,false);
    console.log('PASS: blank preserves null, missing and existing numeric prices; explicit zero and numeric edits work; no ProductFiles created.');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
