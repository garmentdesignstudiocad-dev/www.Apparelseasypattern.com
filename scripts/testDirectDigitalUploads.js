// Actual multipart middleware/routes and disk I/O; models are strictly in-memory.
// Never loads server.js, .env, MongoDB, email or payment providers.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const express=require('express'),multer=require('multer'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),uploadValidation=require('../services/digitalUploadValidation'),validate=uploadValidation.validate;
const pdf=Buffer.from('%PDF-1.4\nfixture'),dxf=Buffer.from('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n');
const csv=Buffer.from('Measurement,Small,Medium\nBust,34,36\nWaist,28,30\n');
// Valid stored ZIP entries, including typical macOS metadata; no unzip library used.
function zip(names){
  const local=[],central=[];let offset=0;
  for(const name of names){
    const filename=Buffer.from(name),data=dxf;let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,data);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);central.push(directory,filename);
    offset+=header.length+filename.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
const archives=[zip(['pattern.dxf','__MACOSX/._pattern.dxf','.DS_Store']),zip(['Windows pattern.dxf'])];
function load(file,deps,globals={}){
  const context={module:{exports:{}},Buffer,URL,Date,__dirname:path.dirname(path.join(root,file)),...globals,require(name){
    if(!Object.hasOwn(deps,name))throw new Error('Blocked dependency: '+name);
    return deps[name];
  }};
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});return context.module.exports;
}

test('content, MIME and slot validation without archive extraction',()=>{
  for(const format of ['techpack','measurement','marker','pdf'])assert.equal(validate('document.PDF',pdf,format,'application/pdf'),'.pdf');
  for(const format of ['dxf','hpgl','plt','pdf','techpack','measurement','marker']){
    for(const mime of ['application/zip','application/x-zip-compressed','application/octet-stream','']){
      for(const bytes of archives)assert.equal(validate('package.ZIP',bytes,format,mime),'.zip');
    }
  }
  assert.equal(validate('pattern.dxf',dxf,'dxf','application/dxf'),'.dxf');
  for(const format of ['hpgl','plt'])assert.equal(validate('pattern.'+format,Buffer.from('IN;PU0,0;PD10,10;'),format,'text/plain'),'.'+format);
  for(const args of [['fake.pdf',Buffer.from('bad'),'techpack'],['fake.zip',pdf,'marker'],['wrong.dxf',dxf,'marker'],['x.pdf',pdf,'techpack','text/html'],['x.exe',pdf,'techpack']])assert.throws(()=>validate(...args),error=>error.status===400);
  assert.throws(()=>validate('x.pdf',pdf,'pdf','',2),error=>error.status===413);
});

test('measurement CSV validation enforces chart structure and a bounded file size',async()=>{
  assert.equal(await uploadValidation.validateMeasurement('measurements.csv',csv,'text/csv'),'.csv');
  for(const [name,bytes,mime] of [
    ['empty.csv',Buffer.alloc(0),'text/csv'],
    ['binary.csv',Buffer.from([0,1,2]),'text/csv'],
    ['one-column.csv',Buffer.from('Measurement\nBust\n'),'text/csv'],
    ['header-only.csv',Buffer.from('Measurement,Medium\n'),'text/csv'],
    ['ragged.csv',Buffer.from('Measurement,Medium\nBust,34,36\n'),'text/csv'],
    ['wrong-type.csv',csv,'text/html']
  ])await assert.rejects(uploadValidation.validateMeasurement(name,bytes,mime),error=>error.status===400);
  await assert.rejects(uploadValidation.validateMeasurement('large.csv',Buffer.alloc(10*1024*1024+1),'text/csv'),error=>error.status===413);
});

test('editor template and upload scripts compile; all slots advertise ZIP',()=>{
  const template=fs.readFileSync(path.join(root,'views/admin/product-editor.ejs'),'utf8');
  require('ejs').compile(template);
  for(const format of ['dxf','hpgl','plt','pdf','techpack','measurement','marker']){
    const input=template.match(new RegExp('<input[^>]+data-format="'+format+'"[^>]*>'))[0];
    assert.match(input,/accept="[^"]*\.zip/);
  }
  const measurementInput=template.match(/<input[^>]+data-format="measurement"[^>]*>/)[0];
  assert.match(measurementInput,/accept="[^"]*\.csv/);
  for(const [,script] of template.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script.replace(/<%[=-][\s\S]*?%>/g,'null').replace(/<%[\s\S]*?%>/g,''));
});

test('multipart upload, private storage, replacement and authorized download',async t=>{
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'aep-upload-'));
  const storage=path.join(temp,'new-private-directory');
  const product={_id:'0123456789abcdef01234567',name:'Fixture',available_sizes:['M','L'],digital_file_map:[],tech_pack_price:125};
  const docs=[],logs=[];let dbFailure=false,storageFailure=false,order;
  const lean=value=>({select(){return this;},lean:async()=>value,then(resolve,reject){return Promise.resolve(value).then(resolve,reject);}});
  const Product={findById:()=>lean(product),async updateOne(filter,pipeline){
    if(dbFailure)throw new Error('private-db-detail');
    const entry=pipeline[0].$set.digital_file_map.$concatArrays[1].$literal[0];
    product.digital_file_map=product.digital_file_map.filter(row=>row.format!==entry.format || row.size!==entry.size).concat(entry);
    return {matchedCount:1};
  }};
  const ProductFile={findOne:filter=>lean(docs.find(row=>Object.entries(filter).every(([key,value])=>String(row[key])===String(value)))),async create(data){
    if(dbFailure)throw new Error('private-db-detail');
    const row={...data,_id:String(docs.length+1),async save(){if(dbFailure)throw new Error('private-db-detail');}};docs.push(row);return row;
  }};
  const Order={findById:()=>lean(order),findOne:filter=>{
    assert.equal(filter.payment_status,'paid');assert.equal(filter.order_status.$ne,'cancelled');assert.equal(filter.payment_verified_at.$ne,null);
    return lean(order && order.download_token===filter.download_token && order.payment_status==='paid' && order.payment_verified_at && order.order_status!=='cancelled' && order.download_expires_at>filter.download_expires_at.$gt?order:null);
  },async updateOne(filter,update){Object.assign(order,update.$set);}};
  const delivery=load('services/digitalDeliveryService.js',{'crypto':crypto,'path':path,'fs/promises':fsp,'../models/mongo/Order':Order,'../models/mongo/Product':Product,'../models/mongo/ProductFile':ProductFile,'./digitalUploadValidation':{validate}}, {process:{env:{PATTERN_FILES_DIR:storage}}});
  const router=express.Router();
  const source=fs.readFileSync(path.join(root,'routes/admin.js'),'utf8');
  const block=source.slice(source.indexOf('// Direct pattern file upload endpoint'),source.indexOf("router.post('/products/:productId/direct-file/:fileId/delete'"));
  // Run actual route code with explicit dependencies; fail closed on other imports.
  vm.runInNewContext(block,{router,multer,Product,ProductFile,path,crypto,fs:{promises:{...fsp,async writeFile(...args){if(storageFailure)throw Object.assign(new Error('private-path'),{code:'EACCES'});return fsp.writeFile(...args);}}},adminAuth:require('../middleware/adminAuth'),logError:(context,error)=>logs.push([context,error.code || error.name]),require(name){
    if(name==='../services/digitalDeliveryService')return delivery;
    if(name==='../services/digitalUploadValidation')return uploadValidation;
    throw new Error('Blocked dependency: '+name);
  }});
  const download=load('routes/downloads.js',{'express':express,'../models/mongo/Order':Order,'../services/digitalDeliveryService':delivery,'../services/safeLog':{logError(){}},'node:path':path,'path':path});
  const app=express();
  app.use((req,res,next)=>{req.session={isAdmin:req.get('x-admin')==='yes',productMediaCsrf:'fixture-token',customerId:req.get('x-customer')};next();});
  app.use('/admin',router);app.use(download);
  app.use((err,req,res,next)=>res.status(500).json({error:'Fixture unexpected error'}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin='http://127.0.0.1:'+server.address().port;
  async function upload(format,name,bytes,{purpose=['dxf','hpgl','plt','pdf'].includes(format)?'pattern':format,csrf='fixture-token',admin=true,size='M',mime='application/octet-stream',field='file'}={}){
    const form=new FormData();form.append(field,new Blob([bytes],{type:mime}),name);form.append('format',format);form.append('purpose',purpose);form.append('size',size);form.append('_csrf',csrf);
    const response=await fetch(origin+'/admin/products/'+product._id+'/direct-file',{method:'POST',redirect:'manual',headers:{'x-admin':admin?'yes':'no'},body:form});
    return {status:response.status,data:response.headers.get('content-type')?.includes('json')?await response.json():null};
  }
  try{
    await t.test('auth, CSRF and multipart rejection do not create files',async()=>{
      assert.equal((await upload('techpack','x.pdf',pdf,{admin:false})).status,302);
      assert.equal((await upload('techpack','x.pdf',pdf,{csrf:'bad'})).status,403);
      assert.equal((await upload('techpack','x.pdf',pdf,{field:'unexpected'})).status,400);
      assert.equal(fs.existsSync(storage),false);
    });
    await t.test('document slots store unchanged ZIP/PDF bytes and original Unicode names',async()=>{
      for(const format of ['techpack','measurement','marker'])for(const [ext,bytes,mime] of [['pdf',pdf,'application/pdf'],['zip',archives[0],'application/zip']]){
        const result=await upload(format,'Café measurements.'+ext,bytes,{mime});
        assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.fileType,ext);assert.equal(result.data.fileName,'Café measurements.'+ext);
        const row=docs.find(row=>row.upload_slot===format);assert.deepEqual(await fsp.readFile(path.join(storage,row.digital_file)),bytes);
        assert.ok(result.data.badgeText.endsWith(ext.toUpperCase()));
      }
      const csvResult=await upload('measurement','Café measurement chart.csv',csv,{mime:'text/csv'});
      assert.equal(csvResult.status,200,JSON.stringify(csvResult.data));assert.equal(csvResult.data.fileName,'Café measurement chart.csv');
      const csvDocument=docs.find(row=>row.upload_slot==='measurement');
      assert.equal(csvDocument.file_type,'csv');assert.deepEqual(await fsp.readFile(path.join(storage,csvDocument.digital_file)),csv);
      assert.equal(docs.length,3,'identical filenames must not replace another slot');
      assert.equal(docs[0].file_price,125);
    });
    await t.test('native patterns and ZIP replacements stay scoped to format and size',async()=>{
      for(const [format,bytes] of [['pdf',pdf],['dxf',dxf],['hpgl',Buffer.from('IN;PU0,0;')],['plt',Buffer.from('IN;PD1,1;')]]){
        assert.equal((await upload(format,'native.'+format,bytes)).status,200);
        const previous=product.digital_file_map.find(row=>row.format===format).file;
        assert.equal((await upload(format,'Windows pattern.zip',archives[1])).status,200);
        assert.deepEqual(await fsp.readFile(path.join(storage,previous)),bytes,'issued versions must remain available');
        const entry=product.digital_file_map.find(row=>row.format===format);assert.equal(path.extname(entry.file),'.zip');assert.deepEqual(await fsp.readFile(path.join(storage,entry.file)),archives[1]);
      }
      assert.equal(product.digital_file_map.length,4);
      assert.equal((await upload('dxf','size L.zip',archives[0],{size:'L'})).status,200);
      assert.equal(product.digital_file_map.length,5);
      assert.equal((await upload('dxf','x.zip',archives[0],{size:'unknown'})).status,400);
      assert.equal(await delivery.validateSelection(product,[],{quantity:1,selected_sizes:['M'],selected_formats:['dxf']}),'');
      assert.match(await delivery.validateSelection(product,[],{quantity:1,selected_sizes:['XXL'],selected_formats:['dxf']}),/not available for download/);
      assert.match(await delivery.validateSelection(product,[{digital_file:'missing.pdf'}],{quantity:1,printable_selected:false}),/not available for download/);
    });
    await t.test('purchased document ZIP uses the private asset and retains its filename',async()=>{
      const document=docs.find(row=>row.upload_slot==='techpack');
      document.watermark_pdf=true; // ZIP packages must never enter PDF conversion.
      order={_id:'document-order',payment_status:'paid',payment_verified_at:new Date(),order_status:'received',account_customer_id:'buyer',items:[{product_id:product._id,quantity:1,printable_selected:false,selected_files:[{id:document._id}]}]};
      await delivery.ensure(order._id);
      assert.equal(order.download_assets.length,1);assert.equal(order.download_assets[0].file,document.digital_file);
      assert.equal(order.download_assets[0].watermark_pdf,false);
      const response=await fetch(origin+'/downloads/'+order.download_token+'/0',{headers:{'x-customer':'buyer'}});
      assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),archives[0]);
      assert.ok(response.headers.get('content-disposition').includes('measurements.zip'));
    });
    await t.test('purchased measurement CSV downloads original private bytes to its authorized customer',async()=>{
      const document=docs.find(row=>row.upload_slot==='measurement');
      order={_id:'measurement-order',payment_status:'paid',payment_verified_at:new Date(),order_status:'received',account_customer_id:'buyer',items:[{product_id:product._id,quantity:1,printable_selected:false,selected_files:[{id:document._id}]}]};
      await delivery.ensure(order._id);
      assert.equal(order.download_assets.length,1);assert.equal(order.download_assets[0].name,'Café measurement chart.csv');
      const url=origin+'/downloads/'+order.download_token+'/0';
      assert.equal((await fetch(url,{headers:{'x-customer':'other'}})).status,404);
      const response=await fetch(url,{headers:{'x-customer':'buyer'}});
      assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),csv);
      assert.ok(decodeURIComponent(response.headers.get('content-disposition')).includes('Café measurement chart.csv'));
    });
    await t.test('errors are useful and failed persistence cleans unreferenced binaries',async()=>{
      const before=await fsp.readdir(storage);dbFailure=true;
      const failed=await upload('techpack','failure.pdf',pdf);assert.equal(failed.status,500);assert.ok(!JSON.stringify(failed).includes('private-db-detail'));
      assert.deepEqual(await fsp.readdir(storage),before);dbFailure=false;
      storageFailure=true;assert.equal((await upload('marker','failure.pdf',pdf)).status,503);storageFailure=false;
      assert.equal((await upload('marker','fake.zip',pdf)).status,400);
      assert.equal((await upload('marker','fake.pdf',pdf,{mime:'text/html'})).status,400);
      assert.equal((await upload('measurement','invalid.csv',Buffer.from('not,a,chart\n'),'text/csv')).status,400);
      assert.equal((await upload('techpack','huge.zip',Buffer.alloc(50*1024*1024+1))).status,413);
      assert.equal((await upload('dxf','huge.zip',Buffer.alloc(30*1024*1024+1))).status,413);
    });
    await t.test('purchased ZIP mapping grants only selected assets; customer authorization remains enforced',async()=>{
      order={_id:'fixture-order',payment_status:'paid',payment_verified_at:new Date(),order_status:'received',account_customer_id:'buyer',items:[{product_id:product._id,quantity:1,selected_sizes:['M'],selected_formats:['dxf'],selected_files:[]}]};
      await delivery.ensure(order._id);assert.equal(order.download_assets.length,1);assert.equal(order.download_assets[0].name,'Windows pattern.zip');
      const url=origin+'/downloads/'+order.download_token+'/0';
      assert.equal((await fetch(url,{redirect:'manual'})).status,303);
      assert.equal((await fetch(url,{headers:{'x-customer':'other'}})).status,404);
      const response=await fetch(url,{headers:{'x-customer':'buyer'}});assert.equal(response.status,200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),archives[1]);assert.ok(response.headers.get('content-disposition').includes('Windows pattern.zip'));
      assert.equal((await fetch(url.replace('/0','/1'),{headers:{'x-customer':'buyer'}})).status,404);
      order.payment_status='pending';assert.equal((await fetch(url,{headers:{'x-customer':'buyer'}})).status,404);order.payment_status='paid';
      order.download_expires_at=new Date(0);assert.equal((await fetch(url,{headers:{'x-customer':'buyer'}})).status,404);
      assert.equal(await delivery.filePath('../outside.zip'),null);
    });
  }finally{
    await new Promise(resolve=>server.close(resolve));
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'aep-upload-'));
    await fsp.rm(temp,{recursive:true,force:true});
  }
});
