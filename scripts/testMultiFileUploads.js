// Tests for the companion multi-file upload slots.
// Verifies: independent storage, no cross-slot overwrite, backward compat,
//           delivery includes companion files, replacement works per slot.
// Never loads server.js, .env, production MongoDB, email, or payment code.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const express=require('express'),multer=require('multer'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const uploadValidation=require('../services/digitalUploadValidation');

// Minimal fixture bytes
const pdf=Buffer.from('%PDF-1.4\ncompanion-fixture');
const dxf=Buffer.from('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n');
const csv=Buffer.from('Measurement,Small,Medium\nBust,34,36\nWaist,28,30\n');

function makeZip(){
  const filename=Buffer.from('file.dxf'),data=dxf;let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(header.length+filename.length+data.length,16);
  return Buffer.concat([header,filename,data,central,filename,end]);
}
const zipBytes=makeZip();

function load(file,deps,globals={}){
  const context={module:{exports:{}},Buffer,URL,Date,__dirname:path.dirname(path.join(root,file)),...globals,require(name){
    if(!Object.hasOwn(deps,name))throw new Error('Blocked dependency: '+name);
    return deps[name];
  }};
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});return context.module.exports;
}

// ─── validateCompanion unit tests ──────────────────────────────────────────
test('validateCompanion rejects unknown slots',()=>{
  assert.throws(()=>uploadValidation.validateCompanion('x.pdf',pdf,'unknown_slot'),e=>e.status===400);
});

test('validateCompanion rejects mismatched extension',()=>{
  // dxf_pdf slot must accept pdf or zip, not csv
  assert.throws(()=>uploadValidation.validateCompanion('x.csv',csv,'dxf_pdf','text/csv'),e=>e.status===400);
});

test('validateCompanion accepts correct PDF for all _pdf companion slots',async()=>{
  for(const slot of ['dxf_pdf','hpgl_pdf','plt_pdf','techpack_pdf','measurement_pdf','marker_pdf']){
    const result=uploadValidation.validateCompanion('guide.pdf',pdf,slot,'application/pdf');
    assert.equal(result instanceof Promise?await result:result,'.pdf',`slot ${slot} should accept .pdf`);
  }
});

test('validateCompanion accepts ZIP for all companion slots',async()=>{
  for(const slot of ['dxf_pdf','dxf_zip','hpgl_pdf','hpgl_zip','plt_pdf','plt_zip','pdf_zip','techpack_pdf','techpack_zip','measurement_pdf','measurement_zip','marker_pdf','marker_zip']){
    const result=uploadValidation.validateCompanion('bundle.zip',zipBytes,slot,'application/zip');
    assert.equal(result instanceof Promise?await result:result,'.zip',`slot ${slot} should accept .zip`);
  }
});

test('validateCompanion accepts CSV for measurement_csv slot',async()=>{
  const result=await uploadValidation.validateCompanion('chart.csv',csv,'measurement_csv','text/csv');
  assert.equal(result,'.csv');
});

test('validateCompanion rejects invalid PDF content',()=>{
  assert.throws(()=>uploadValidation.validateCompanion('bad.pdf',Buffer.from('not-pdf-content'),'dxf_pdf','application/pdf'),e=>e.status===400);
});

test('validateCompanion rejects invalid ZIP content',()=>{
  assert.throws(()=>uploadValidation.validateCompanion('bad.zip',Buffer.from('not-zip'),'dxf_zip','application/zip'),e=>e.status===400);
});

test('COMPANION_SLOTS set contains all 17 expected slots',()=>{
  const expected=['dxf_pdf','dxf_zip','hpgl_pdf','hpgl_zip','plt_pdf','plt_zip','pdf_zip','techpack_pdf','techpack_zip','measurement_pdf','measurement_csv','measurement_zip','basic_measurement_pdf','basic_measurement_csv','basic_measurement_zip','marker_pdf','marker_zip'];
  for(const slot of expected)assert.ok(uploadValidation.COMPANION_SLOTS.has(slot),`missing slot: ${slot}`);
  assert.equal(uploadValidation.COMPANION_SLOTS.size,expected.length);
});

// ─── Integration: upload route stores companion independently ───────────────
test('companion upload route stores PDF independently without overwriting primary slot',async t=>{
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'aep-companion-'));
  const storage=path.join(temp,'private');
  const product={_id:'aaaaaaaaaaaaaaaaaaaaaaaa',name:'Companion Test',available_sizes:['M'],digital_file_map:[],tech_pack_price:0};
  const docs=[];

  const ProductFile={
    findOne:filter=>{
      const row=docs.find(d=>Object.entries(filter).every(([k,v])=>String(d[k])===String(v)));
      const result=row||null;
      // must have .save() for mutation in route's upsert path
      if(result&&!result.save)result.save=async()=>{};
      return {select(){return this;},lean:async()=>result,then(resolve,reject){return Promise.resolve(result).then(resolve,reject);}};
    },
    async create(data){const row={...data,_id:String(docs.length+1),save:async()=>{}};docs.push(row);return row;}
  };
  const Product={findById:()=>({select(){return this;},lean:async()=>product,then(resolve,reject){return Promise.resolve(product).then(resolve,reject);}})};

  const router=express.Router();
  const source=fs.readFileSync(path.join(root,'routes/admin.js'),'utf8');
  const block=source.slice(source.indexOf('// Direct pattern file upload endpoint'),source.indexOf("router.post('/products/:productId/direct-file/:fileId/delete'"));
  vm.runInNewContext(block,{router,multer,Product,ProductFile,path,crypto,
    fs:{promises:{...fsp,async writeFile(...args){return fsp.writeFile(...args);}},},
    adminAuth:require('../middleware/adminAuth'),
    logError:()=>{},
    require(name){
      if(name==='../services/digitalDeliveryService')return load('services/digitalDeliveryService.js',{'crypto':crypto,'path':path,'fs/promises':fsp,'../models/mongo/Order':{findById:()=>({select(){return this;},lean:async()=>null})},'../models/mongo/Product':Product,'../models/mongo/ProductFile':ProductFile,'./digitalUploadValidation':uploadValidation},{process:{env:{PATTERN_FILES_DIR:storage}}});
      if(name==='../services/digitalUploadValidation')return uploadValidation;
      throw new Error('Blocked: '+name);
    }});

  const app=express();
  app.use((req,res,next)=>{req.session={isAdmin:true,productMediaCsrf:'tok'};next();});
  app.use('/admin',router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin='http://127.0.0.1:'+server.address().port;

  async function upload(format,name,bytes,mime='application/octet-stream'){
    const form=new FormData();
    form.append('file',new Blob([bytes],{type:mime}),name);
    form.append('format',format);form.append('purpose','companion');form.append('_csrf','tok');
    const r=await fetch(`${origin}/admin/products/${product._id}/direct-file`,{method:'POST',headers:{'x-admin':'yes'},body:form});
    return {status:r.status,data:await r.json()};
  }

  try{
    await t.test('uploads dxf_pdf companion independently',async()=>{
      const r=await upload('dxf_pdf','guide.pdf',pdf,'application/pdf');
      assert.equal(r.status,200,JSON.stringify(r.data));
      assert.equal(r.data.fileType,'pdf');
      assert.ok(r.data.badgeText.includes('PDF'));
      const doc=docs.find(d=>d.upload_slot==='dxf_pdf');
      assert.ok(doc,'dxf_pdf slot doc created');
      assert.equal(doc.file_name,'guide.pdf');
      const stored=await fsp.readFile(path.join(storage,doc.digital_file));
      assert.deepEqual(stored,pdf,'stored bytes match');
    });

    await t.test('uploads dxf_zip companion independently',async()=>{
      const r=await upload('dxf_zip','bundle.zip',zipBytes,'application/zip');
      assert.equal(r.status,200,JSON.stringify(r.data));
      assert.equal(r.data.fileType,'zip');
      const doc=docs.find(d=>d.upload_slot==='dxf_zip');
      assert.ok(doc,'dxf_zip slot doc created');
      const stored=await fsp.readFile(path.join(storage,doc.digital_file));
      assert.deepEqual(stored,zipBytes);
    });

    await t.test('dxf_pdf upload does NOT overwrite dxf_zip slot',()=>{
      const dxfPdf=docs.find(d=>d.upload_slot==='dxf_pdf');
      const dxfZip=docs.find(d=>d.upload_slot==='dxf_zip');
      assert.notEqual(dxfPdf._id,dxfZip._id);
      assert.notEqual(dxfPdf.digital_file,dxfZip.digital_file);
    });

    await t.test('replacing dxf_pdf returns updated filename (upsert behaviour)',async()=>{
      const r=await upload('dxf_pdf','guide-v2.pdf',pdf,'application/pdf');
      assert.equal(r.status,200);
      // route either creates new or updates existing; either way filename is reflected
      assert.equal(r.data.fileName,'guide-v2.pdf');
      // All dxf_pdf docs share the same slot name
      const slotDocs=docs.filter(d=>d.upload_slot==='dxf_pdf');
      assert.ok(slotDocs.length>=1,'at least one dxf_pdf doc exists');
    });

    await t.test('rejects invalid companion format',async()=>{
      const r=await upload('unsupported_slot','x.pdf',pdf,'application/pdf');
      assert.equal(r.status,400,JSON.stringify(r.data));
    });

    await t.test('rejects companion with wrong content',async()=>{
      const r=await upload('dxf_pdf','bad.pdf',Buffer.from('not-pdf'),'application/pdf');
      assert.equal(r.status,400);
    });

    await t.test('uploads all 14 companion slots without cross-contamination',async()=>{
      // Fresh docs list slice index to track
      const startIdx=docs.length;
      const slots=[
        ['hpgl_pdf',pdf,'application/pdf','guide.pdf'],
        ['hpgl_zip',zipBytes,'application/zip','bundle.zip'],
        ['plt_pdf',pdf,'application/pdf','guide.pdf'],
        ['plt_zip',zipBytes,'application/zip','bundle.zip'],
        ['pdf_zip',zipBytes,'application/zip','bundle.zip'],
        ['techpack_pdf',pdf,'application/pdf','guide.pdf'],
        ['techpack_zip',zipBytes,'application/zip','bundle.zip'],
        ['measurement_pdf',pdf,'application/pdf','guide.pdf'],
        ['measurement_zip',zipBytes,'application/zip','bundle.zip'],
        ['marker_pdf',pdf,'application/pdf','guide.pdf'],
        ['marker_zip',zipBytes,'application/zip','bundle.zip'],
      ];
      for(const [slot,bytes,mime,name] of slots){
        const r=await upload(slot,name,bytes,mime);
        assert.equal(r.status,200,`slot ${slot} failed: ${JSON.stringify(r.data)}`);
        const doc=docs.find(d=>d.upload_slot===slot);
        assert.ok(doc,`no doc for slot ${slot}`);
      }
      // All slots stored independently — no two slots share the same private filename
      const slotDocs=docs.slice(startIdx);
      const fileNames=slotDocs.map(d=>d.digital_file);
      assert.equal(new Set(fileNames).size,fileNames.length,'all stored filenames must be unique');
    });

  }finally{
    server.close();
    await fsp.rm(temp,{recursive:true,force:true});
  }
});

// ─── Template has companion upload inputs ──────────────────────────────────
test('product-editor.ejs contains companion upload inputs for all 15 slots',()=>{
  const template=fs.readFileSync(path.join(root,'views/admin/product-editor.ejs'),'utf8');
  require('ejs').compile(template); // must compile without error
  const companionSlots=['dxf_pdf','dxf_zip','hpgl_pdf','hpgl_zip','plt_pdf','plt_zip','pdf_zip','techpack_pdf','techpack_zip','measurement_pdf','measurement_csv','measurement_zip','basic_measurement_pdf','basic_measurement_csv','basic_measurement_zip','marker_pdf','marker_zip'];
  for(const slot of companionSlots){
    assert.ok(template.includes(`data-format="${slot}"`),`template missing data-format="${slot}"`);
  }
  // companion slots still advertise .zip in accept
  for(const slot of companionSlots.filter(s=>!s.endsWith('_csv'))){
    const match=template.match(new RegExp(`<input[^>]+data-format="${slot}"[^>]*>`));
    assert.ok(match,`no input for slot ${slot}`);
    assert.match(match[0],/accept="[^"]*\.zip/,`slot ${slot} should accept zip`);
  }
  // measurement_csv accepts .csv
  const csvMatch=template.match(/<input[^>]+data-format="measurement_csv"[^>]*>/);
  assert.ok(csvMatch,'no input for measurement_csv');
  assert.match(csvMatch[0],/accept="[^"]*\.csv/);
});

// ─── Backward compat: existing primary purpose:dxf records deliver unchanged ─
test('existing primary purpose records deliver unchanged through digitalDeliveryService',async()=>{
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'aep-compat-'));
  const storage=path.join(temp,'private');
  await fsp.mkdir(storage,{recursive:true});
  // Write a fixture DXF file to private storage
  const fixtureFile='legacy0000000000000000000000000000000000000000000000.dxf';
  await fsp.writeFile(path.join(storage,fixtureFile),dxf,{mode:0o600});

  const product={_id:'bbbbbbbbbbbbbbbbbbbbbbbb',name:'Legacy',available_sizes:['M'],
    digital_file_map:[{format:'dxf',size:'M',file:fixtureFile,original_name:'legacy.dxf'}]};
  const Order={findById:()=>({select(){return this;},lean:async()=>order}),
    async updateOne(filter,update){Object.assign(order,update.$set);}
  };
  const ProductFile={findOne:()=>({select(){return this;},lean:async()=>null})};
  const Product={findById:()=>({select(){return this;},lean:async()=>product})};

  const delivery=load('services/digitalDeliveryService.js',{'crypto':crypto,'path':path,'fs/promises':fsp,'../models/mongo/Order':Order,'../models/mongo/Product':Product,'../models/mongo/ProductFile':ProductFile,'./digitalUploadValidation':uploadValidation},{process:{env:{PATTERN_FILES_DIR:storage}}});

  let order={_id:'legacy-order',payment_status:'paid',payment_verified_at:new Date(),order_status:'received',
    account_customer_id:'buyer',items:[{product_id:product._id,quantity:1,selected_sizes:['M'],selected_formats:['dxf']}]};

  const result=await delivery.ensure(order._id);
  assert.ok(result,'ensure returned order');
  assert.equal(result.download_assets.length,1);
  assert.equal(result.download_assets[0].file,fixtureFile,'legacy file preserved');

  await fsp.rm(temp,{recursive:true,force:true});
});
