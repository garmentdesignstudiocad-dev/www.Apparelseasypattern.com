"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectMediaUpdate
} = require("../services/productMediaIntegration");

const existing = {
  images: [
    "https://example.com/main.jpg",
    "https://example.com/gallery.jpg"
  ],
  sample_image_url: "https://example.com/sample.jpg",
  video_url: "https://example.com/video.mp4"
};

const file = ext => ({
  filename:
    "12345678-1234-1234-1234-123456789abc." + ext
});

test("Saving without uploads preserves all media", () => {
  const result = collectMediaUpdate(existing);

  assert.deepEqual(result.images, existing.images);
  assert.equal(
    result.sample_image_url,
    existing.sample_image_url
  );
  assert.equal(result.video_url, existing.video_url);
});

test("Replacing main image preserves gallery", () => {
  const result = collectMediaUpdate(existing, {}, {
    main_image: [file("jpg")]
  });

  assert.equal(result.images.length, 2);
  assert.equal(
    result.images[1],
    existing.images[1]
  );
  assert.match(result.images[0], /^\/uploads\/products\//);
});

test("Gallery upload appends without erasing existing", () => {
  const result = collectMediaUpdate(existing, {}, {
    gallery_images: [file("png")]
  });

  assert.equal(result.images.length, 3);
  assert.equal(result.images[0], existing.images[0]);
  assert.equal(result.images[1], existing.images[1]);
});

test("Video replacement works", () => {
  const result = collectMediaUpdate(existing, {}, {
    product_video: [file("mp4")]
  });

  assert.match(
    result.video_url,
    /^\/uploads\/products\//
  );
});

test("Video removal only clears video reference", () => {
  const result = collectMediaUpdate(existing, {
    remove_video: "on"
  });

  assert.equal(result.video_url, "");
  assert.deepEqual(result.images, existing.images);
});

test("Size-chart PDF can be replaced while preserving its uploaded name", () => {
  const product = {
    ...existing,
    size_chart_pdf: "/uploads/products/12345678-1234-1234-1234-123456789abc.pdf",
    size_chart_pdf_name: "Old chart.pdf"
  };
  const replacement = {
    ...file("pdf"),
    originalname: "Updated chart.pdf"
  };
  const result = collectMediaUpdate(product, {}, {
    size_chart_pdf_file: [replacement]
  });

  assert.equal(result.size_chart_pdf, "/uploads/products/" + replacement.filename);
  assert.equal(result.size_chart_pdf_name, replacement.originalname);
  assert.deepEqual(result.images, product.images);
});

test("Removing a size-chart PDF leaves other product media intact", () => {
  const product = {
    ...existing,
    size_chart_pdf: "/uploads/products/12345678-1234-1234-1234-123456789abc.pdf",
    size_chart_pdf_name: "Chart.pdf"
  };
  const result = collectMediaUpdate(product, { remove_size_chart_pdf: "on" });

  assert.equal(result.size_chart_pdf, "");
  assert.equal(result.size_chart_pdf_name, "");
  assert.deepEqual(result.images, product.images);
});

test("Sample removal preserves images", () => {
  const result = collectMediaUpdate(existing, {
    remove_sample_image: "on"
  });

  assert.equal(result.sample_image_url, "");
  assert.deepEqual(result.images, existing.images);
});

test("Gallery removal preserves main image", () => {
  const result = collectMediaUpdate(existing, {
    remove_gallery_image: ["0"]
  });

  assert.deepEqual(
    result.images,
    [existing.images[0]]
  );
});

test("Invalid uploaded filename rejected", () => {
  assert.throws(() => collectMediaUpdate(
    existing,
    {},
    {
      main_image: [{
        filename: "../../private/secret.pdf"
      }]
    }
  ));
});


test("New product accepts a main photo and multiple gallery photos", () => {
  const result = collectMediaUpdate({}, {}, {main_image:[file('jpg')], gallery_images:[file('png'),file('webp')]});
  assert.deepEqual(result.images.map(url=>url.split('.').pop()), ['jpg','png','webp']);
});

test("Replacing a gallery photo retains the main and unremoved gallery photos", () => {
  const product = {...existing, images:[...existing.images, 'https://example.com/side.jpg']};
  const result = collectMediaUpdate(product, {remove_gallery_image:'0'}, {gallery_images:[file('webp')]});
  assert.deepEqual(result.images.slice(0,2), [product.images[0],product.images[2]]);
  assert.match(result.images[2], /\.webp$/);
  assert.equal(product.images.length,3);
});

test("Public photos exclude legacy pattern PNGs and private or remote technical files", () => {
  const {publicGarmentMedia} = require('../services/productMediaIntegration');
  const valid = '/uploads/products/'+file('jpg').filename;
  const product = {finished_garment_images:[valid],images:['/images/gallery/01_Front_Pattern.png',valid,'/private/pattern.pdf','https://example.com/layout.png','/uploads/products/pattern.svg'],sample_image_url:'/private/chart.pdf'};
  const result = publicGarmentMedia(product);
  assert.deepEqual(result.images, ['',valid]);
  assert.equal(result.sample_image_url,'');
  assert.equal(product.images.length,5);
  assert.equal(publicGarmentMedia({images:[valid]}).images[0],'', 'Legacy uploaded PDF previews are unconfirmed');
  assert.equal(publicGarmentMedia({images:[valid],finished_garment_images:[valid]}).images[0],valid);
});


test("Isolated Admin upload lifecycle, failed-save preservation and public privacy", async () => {
  require('./isolatedTestGuard');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const mongoose = require('mongoose');
  const {MongoMemoryServer} = require('mongodb-memory-server');
  // The module above is already loaded: redirect its filesystem operations to a
  // disposable directory by reloading it before loading the real Admin router.
  const id = 'photo-test-' + Date.now();
  Object.assign(process.env, {AEP_ISOLATED_MEDIA_TEST:'1', AEP_MEDIA_TEST_ID:id,
    MONGOMS_RUNTIME_DOWNLOAD:'false', NODE_ENV:'development', SESSION_SECRET:'isolated-photo-test',
    ADMIN_USERNAME:'photo-test', ADMIN_PASSWORD:'isolated-photo-test', NOTIFICATIONS_WORKER_ENABLED:'false',
    SMTP_HOST:'',SMTP_USER:'',SMTP_PASS:'',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',DB_HOST:'127.0.0.1',DB_PORT:'1'});
  delete require.cache[require.resolve('../middleware/productMediaUpload')];
  delete require.cache[require.resolve('../services/productMediaIntegration')];
  const mongo = await MongoMemoryServer.create({binary:{version:'7.0.14'}});
  let server;
  const root = path.resolve(__dirname,'../private/verification/isolated-media',id);
  process.env.PATTERN_FILES_DIR = path.join(root, 'patterns');
  try {
    process.env.MONGODB_URI = mongo.getUri();
    await mongoose.connect(mongo.getUri());
    const Product = require('../models/mongo/Product');
    await Product.init();
    server = require('../server').listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const origin = 'http://127.0.0.1:'+server.address().port;
    let cookie = '';
    async function request(url, body) {
      const response = await fetch(origin+url,{method:body?'POST':'GET',body,redirect:'manual',headers:cookie?{cookie}:{}});
      const setCookie = response.headers.get('set-cookie');
      if(setCookie)cookie=setCookie.split(';')[0];
      return response;
    }
    assert.equal((await request('/admin/login',new URLSearchParams({username:'photo-test',password:'isolated-photo-test'}))).status,302);
    const html = await (await request('/admin/products/new')).text();
    const csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=','base64');
    function form(slug='photo-fixture') {
      const data = new FormData();
      for(const [key,value] of Object.entries({_csrf:csrf,name:'Photo fixture',slug,admin_action:'activate',base_price:'123'}))data.set(key,value);
      return data;
    }
    function photo(data,field,name='garment.png',bytes=png,type='image/png') {data.append(field,new Blob([bytes],{type}),name);}
    let data=form();photo(data,'main_image');photo(data,'gallery_images','back.png');photo(data,'gallery_images','side.png');
    assert.equal((await request('/admin/products',data)).status,302);
    let product=await Product.findOne({slug:'photo-fixture'}).lean();
    assert.equal(product.images.length,3);
    assert.deepEqual(product.finished_garment_images,product.images);
    const original=[...product.images], edit='/admin/products/'+product._id+'/edit';
    assert.equal((await request(original[0])).status,200);
    data=form();photo(data,'main_image','replacement.png');
    assert.equal((await request(edit,data)).status,302);
    product=await Product.findById(product._id).lean();
    assert.notEqual(product.images[0],original[0]);assert.deepEqual(product.images.slice(1),original.slice(1));
    data=form();data.set('remove_gallery_image','0');photo(data,'gallery_images','detail.png');
    assert.equal((await request(edit,data)).status,302);
    product=await Product.findById(product._id).lean();
    assert.equal(product.images[1],original[2]);assert.equal(product.images.length,3);
    const saved=[...product.images];
    const ProductFile = require('../models/mongo/ProductFile');
    await Product.updateOne({_id:product._id},{$set:{available_sizes:['M']}});
    const uploadDraft = async (format,purpose,size='') => {
      const upload = new FormData();
      for(const [key,value] of Object.entries({_csrf:csrf,stage:'1',format,purpose,size}))upload.set(key,value);
      upload.append('file',new Blob([Buffer.from('%PDF-1.4\nDraft fixture')],{type:'application/pdf'}),'draft.pdf');
      const response = await request('/admin/products/'+product._id+'/direct-file',upload);
      assert.equal(response.status,200);
      return response.json();
    };
    const stagedDocument = await uploadDraft('techpack','tech_pack');
    const stagedPattern = await uploadDraft('pdf','pattern','M');
    assert.equal(await ProductFile.countDocuments({product_id:product._id}),0,'Draft upload does not create a public product file');
    assert.equal((await Product.findById(product._id).select('+digital_file_map').lean()).digital_file_map.length,0);
    const documentPreview = await request('/admin/products/'+product._id+'/document/'+stagedDocument.fileId);
    assert.equal(documentPreview.status,200);
    assert.equal(await documentPreview.text(),'%PDF-1.4\nDraft fixture');
    assert.equal((await fetch(origin+'/admin/products/'+product._id+'/document/'+stagedDocument.fileId,{redirect:'manual'})).status,302);
    assert.equal((await request('/admin/products/'+product._id+'/document/'+stagedPattern.fileId)).status,200);
    data=form();data.set('admin_action','save');data.set('name','தமிழ் draft');data.set('main_image_link','https://example.com/draft.webp');data.set('video_link','https://example.com/fit.webm');
    assert.equal((await request(edit,data)).status,302);
    const drafted = await Product.findById(product._id).select('+editor_draft').lean();
    assert.deepEqual(drafted.images,saved,'Saving a draft must preserve live images');
    assert.equal(drafted.name,'Photo fixture');
    assert.equal(drafted.editor_draft.name,'தமிழ் draft');
    const previewResponse = await request('/admin/products/'+product._id+'/preview');
    assert.equal(previewResponse.status,200);
    const previewHtml = await previewResponse.text();
    assert(previewHtml.includes('தமிழ் draft') && previewHtml.includes('https://example.com/draft.webp') && previewHtml.includes('https://example.com/fit.webm'));
    assert.equal((await fetch(origin+'/admin/products/'+product._id+'/preview',{redirect:'manual'})).status,302);
    assert.equal((await fetch(origin+'/?content_preview=1',{redirect:'manual'})).status,403);
    const appearanceHtml = await (await request('/admin/settings/appearance')).text();
    const appearanceCsrf = appearanceHtml.match(/name="_csrf" value="([^"]+)"/)[1];
    const appearanceForm = new URLSearchParams({_csrf:appearanceCsrf,content_action:'draft',homepage_heading:'தமிழ் draft headline'});
    assert.equal((await request('/admin/settings/appearance',appearanceForm)).status,302);
    assert((await (await request('/?content_preview=1')).text()).includes('தமிழ் draft headline'));
    assert(!(await (await request('/')).text()).includes('தமிழ் draft headline'),'Appearance draft must not leak through the shared settings cache');
    appearanceForm.set('content_action','publish');
    assert.equal((await request('/admin/settings/appearance',appearanceForm)).status,302);
    assert((await (await request('/')).text()).includes('தமிழ் draft headline'));
    const contentHtml = await (await request('/admin/content?page=products.ejs')).text();
    const contentCsrf = contentHtml.match(/name="_csrf" value="([^"]+)"/)[1];
    const entries = require('../services/websiteContent').catalog().filter(entry=>entry.page==='products.ejs');
    const contentForm = new URLSearchParams({_csrf:contentCsrf,page:'products.ejs',action:'save'});
    for (const entry of entries) contentForm.set('text_'+entry.key,entry.value);
    contentForm.set('text_'+entries[0].key,'தமிழ் Z');
    assert.equal((await request('/admin/content',contentForm)).status,302);
    const Content = require('../models/mongo/WebsiteContent');
    let stored = await Content.findOne({key:'default'}).lean();
    assert.equal(stored.draft[entries[0].key],'தமிழ் Z');
    assert.equal(stored.published?.[entries[0].key],undefined);
    contentForm.set('action','publish');
    assert.equal((await request('/admin/content',contentForm)).status,302);
    stored = await Content.findOne({key:'default'}).lean();
    assert.equal(stored.published[entries[0].key],'தமிழ் Z');
    contentForm.set('action','restore');
    assert.equal((await request('/admin/content',contentForm)).status,302);
    stored = await Content.findOne({key:'default'}).lean();
    assert.equal(stored.draft[entries[0].key],entries[0].value);
    assert.equal(stored.published[entries[0].key],'தமிழ் Z','Restore must not publish');
    contentForm.set('_csrf','invalid');
    assert.equal((await request('/admin/content',contentForm)).status,403);
    assert.equal((await request(edit,form())).status,302);
    assert.equal(await ProductFile.countDocuments({product_id:product._id}),1,'Publish applies staged documents');
    assert.equal((await Product.findById(product._id).select('+digital_file_map').lean()).digital_file_map.length,1);
    assert.equal((await Product.findById(product._id).lean()).images[0],'https://example.com/draft.webp','Explicit publish applies saved draft media');
    // Restore the original uploaded reference through the model for subsequent failure-preservation checks.
    await Product.updateOne({_id:product._id},{$set:{images:saved}});
    data=form();photo(data,'main_image','fake.png',Buffer.from('not png'));
    assert.equal((await request(edit,data)).status,400);
    assert.deepEqual((await Product.findById(product._id).lean()).images,saved);
    data=form();photo(data,'main_image','pattern.pdf',Buffer.from('%PDF-1.7'),'application/pdf');
    assert.equal((await request(edit,data)).status,400);
    await Product.create({name:'Duplicate fixture',slug:'duplicate-photo-fixture'});
    data=form('duplicate-photo-fixture');photo(data,'main_image');
    assert.equal((await request(edit,data)).status,400);
    assert.deepEqual((await Product.findById(product._id).lean()).images,saved);
    assert.equal((await request(saved[0])).status,200);
    assert.equal((await Product.findById(product._id).lean()).base_price,123);
    data=form();data.set('_csrf','invalid');photo(data,'main_image');
    assert.equal((await request(edit,data)).status,403);
    await Product.updateOne({_id:product._id},{$set:{active:true,status:'active',images:['/images/gallery/01_Front_Pattern.png','/private/pattern.pdf'],digital_file:'secret-pattern.pdf'}});
    const page=await (await request('/product/photo-fixture')).text();
    assert(page.includes('Finished garment photo coming soon'));
    assert(!page.includes('/images/gallery/')&&!page.includes('secret-pattern.pdf'));
    assert.equal((await request('/images/gallery/01_Front_Pattern.png')).status,404);
    assert.equal((await request('/private/pattern.pdf')).status,404);
    assert.equal((await request('/downloads/invalid')).status,404);
    data=form('unpublished-fixture');data.set('admin_action','save');
    assert.equal((await request('/admin/products',data)).status,302);
    const unpublished = await Product.findOne({slug:'unpublished-fixture'}).lean();
    assert.equal(unpublished.active,false);assert.equal(unpublished.status,'draft');
    assert.equal((await request('/product/unpublished-fixture')).status,404);
    assert.equal((await request('/admin/products/'+unpublished._id+'/preview')).status,200);
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await mongoose.disconnect();await mongo.stop();
    const parent=path.resolve(__dirname,'../private/verification/isolated-media');
    assert(root.startsWith(parent+path.sep));
    await fs.rm(root,{recursive:true,force:true});
  }
});
