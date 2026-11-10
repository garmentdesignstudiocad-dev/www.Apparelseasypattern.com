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
      for(const [key,value] of Object.entries({_csrf:csrf,name:'Photo fixture',slug,admin_action:'save',base_price:'123'}))data.set(key,value);
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
    assert.equal((await request(edit,form())).status,302);
    assert.deepEqual((await Product.findById(product._id).lean()).images,saved);
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
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await mongoose.disconnect();await mongo.stop();
    const parent=path.resolve(__dirname,'../private/verification/isolated-media');
    assert(root.startsWith(parent+path.sep));
    await fs.rm(root,{recursive:true,force:true});
  }
});
