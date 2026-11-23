const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

async function run() {
  console.log('--- Starting Custom Block & Product Options Test ---');
  const mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  let server;

  try {
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      NODE_ENV: 'development',
      NOTIFICATIONS_WORKER_ENABLED: 'false',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      LEAD_NOTIFICATION_TO: 'garmentdesignstudiocad@gmail.com',
      ADMIN_NOTIFICATION_EMAIL: 'garmentdesignstudiocad@gmail.com',
      SESSION_SECRET: 'custom-block-test-secret',
      ADMIN_USERNAME: 'admin-tester',
      ADMIN_PASSWORD: 'admin-password',
      DB_HOST: '127.0.0.1',
      DB_PORT: '1'
    });

    await mongoose.connect(mongo.getUri());
    const Lead = require('../models/mongo/Lead');
    const Log = require('../models/mongo/NotificationLog');
    const Product = require('../models/mongo/Product');
    const ProductFile = require('../models/mongo/ProductFile');
    const SiteSettings = require('../models/mongo/SiteSettings');
    await Promise.all([Lead.init(), Log.init(), Product.init(), ProductFile.init(), SiteSettings.init()]);

    // Create SiteSettings with default whatsapp_number
    await SiteSettings.create({
      key: 'default',
      whatsapp_number: '+91 9791753067',
      store_name: 'Apparel Easy Patterns'
    });

    // Create sample product for acceptance test
    const product = await Product.create({
      name: 'Basic Slim Fit Shirt',
      slug: 'basic-slim-fit-shirt',
      description: 'Industrial slim fit shirt pattern',
      category: 'men',
      garment_type: 'Shirt',
      fit_type: 'Slim Fit',
      available_sizes: ['38', '39', '40', '42', '44'],
      size_pricing: [
        { size: '38', price: 499 },
        { size: '39', price: 499 },
        { size: '40', price: 499 },
        { size: '42', price: 499 },
        { size: '44', price: 499 }
      ],
      price: 499,
      published: true,
      trial_sample_price: 1800,
      trial_enabled: true
    });

    // Add Measurement Chart file
    await ProductFile.create({
      product_id: product._id,
      file_type: 'measurement_chart',
      file_name: 'SLIM FIT-JP FORMAL SHIRT PLM(2).pdf',
      file_path: 'mock/measurement.pdf',
      file_price: 150,
      active: true
    });

    // Add Tech Pack file
    await ProductFile.create({
      product_id: product._id,
      file_type: 'tech_pack',
      file_name: 'Basic Construction Tech Pack.pdf',
      file_path: 'mock/techpack.pdf',
      file_price: 250,
      active: true
    });

    // Add CAD Pattern formats
    for (const fmt of ['dxf', 'pdf', 'hpgl']) {
      await ProductFile.create({
        product_id: product._id,
        size: '40',
        file_type: 'cad_pattern',
        format: fmt,
        file_name: `pattern_40.${fmt}`,
        file_path: `mock/pattern_40.${fmt}`,
        file_price: 499,
        active: true
      });
    }

    const app = require('../server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let cookie = '';

    async function req(url, body, headers = {}) {
      const isJson = headers['Content-Type'] === 'application/json';
      const isPost = Boolean(body);
      let payload;
      if (isPost) {
        payload = isJson ? JSON.stringify(body) : new URLSearchParams(body).toString();
      }
      const response = await fetch(origin + url, {
        method: isPost ? 'POST' : 'GET',
        headers: {
          cookie,
          ...(isPost ? { 'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded' } : {}),
          ...headers
        },
        body: payload,
        redirect: 'manual'
      });
      const c = response.headers.get('set-cookie');
      if (c) cookie = c.split(';')[0];
      return response;
    }

    // 1. TEST GET /custom-block WITH ADMIN-CONFIGURED WHATSAPP
    console.log('Testing GET /custom-block with configured WhatsApp...');
    const cbRes = await req('/custom-block');
    assert.equal(cbRes.status, 200, 'GET /custom-block returns 200');
    const cbHtml = await cbRes.text();
    assert.match(cbHtml, /Request a Custom Block/, 'Custom Block title present');
    assert.match(cbHtml, /id="cbName"/, 'Name field present');
    assert.match(cbHtml, /id="cbEmail"/, 'Email field present');
    assert.match(cbHtml, /id="cbWhatsapp"/, 'WhatsApp field present');
    assert.match(cbHtml, /id="cbCategory"/, 'Category dropdown present');
    assert.match(cbHtml, /id="cbServiceType"/, 'Service type dropdown present');
    assert.match(cbHtml, /id="cbRequirements"/, 'Requirements textarea present');
    assert.match(cbHtml, /id="btnContactWhatsapp"/, 'Contact on WhatsApp button present');
    assert.match(cbHtml, /id="btnSubmitCustomBlock"/, 'Submit button present');
    assert.match(cbHtml, /9791753067/, 'Admin-configured WhatsApp digits embedded in client script');
    assert.doesNotMatch(cbHtml, /cb-btn-whatsapp--disabled/, 'WhatsApp button is enabled when number configured');

    // 1b. TEST GET /custom-block WHEN NO WHATSAPP NUMBER CONFIGURED
    console.log('Testing GET /custom-block without configured WhatsApp...');
    await SiteSettings.updateOne({ key: 'default' }, { $set: { whatsapp_number: '' } });
    const { clearSiteSettingsCache } = require('../services/siteSettingsService');
    if (clearSiteSettingsCache) clearSiteSettingsCache();
    const unconfRes = await req('/custom-block');
    const unconfHtml = await unconfRes.text();
    assert.match(unconfHtml, /disabled/, 'WhatsApp button is disabled when unconfigured');
    assert.match(unconfHtml, /Direct WhatsApp contact is currently unconfigured in studio settings/i, 'Clear configuration message shown');
    assert.doesNotMatch(unconfHtml, /ownerNumber\s*=\s*['"]9791753067['"]/, 'No hardcoded fallback number when unconfigured');
    // Restore configured number for subsequent tests
    await SiteSettings.updateOne({ key: 'default' }, { $set: { whatsapp_number: '+91 9791753067' } });
    if (clearSiteSettingsCache) clearSiteSettingsCache();

    const csrfMatch = cbHtml.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(csrfMatch, 'CSRF token is rendered in form');
    const csrfToken = csrfMatch[1];

    // 2. TEST VALIDATION ERRORS
    console.log('Testing /enquiries validation...');
    // Missing category
    const badRes1 = await req('/enquiries', {
      _csrf: csrfToken,
      name: 'Tester',
      email: 'test@example.com',
      whatsapp: '+91 9876543210',
      service_type: 'Custom Fit Block Development',
      requirements: 'Need a custom slim fit block',
      source: '/custom-block'
    }, { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' });
    assert.equal(badRes1.status, 400);
    const badJson1 = await badRes1.json();
    assert.match(badJson1.error, /garment category/i);

    // Missing service type
    const badRes2 = await req('/enquiries', {
      _csrf: csrfToken,
      name: 'Tester',
      email: 'test@example.com',
      whatsapp: '+91 9876543210',
      category: "Men's Wear",
      requirements: 'Need a custom slim fit block',
      source: '/custom-block'
    }, { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' });
    assert.equal(badRes2.status, 400);
    const badJson2 = await badRes2.json();
    assert.match(badJson2.error, /service or request type/i);

    // Missing requirements
    const badRes3 = await req('/enquiries', {
      _csrf: csrfToken,
      name: 'Tester',
      email: 'test@example.com',
      whatsapp: '+91 9876543210',
      category: "Men's Wear",
      service_type: 'Custom Fit Block Development',
      source: '/custom-block'
    }, { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' });
    assert.equal(badRes3.status, 400);
    const badJson3 = await badRes3.json();
    assert.match(badJson3.error, /detailed requirements/i);

    // 3. TEST VALID CUSTOM BLOCK SUBMISSION (JSON/AJAX)
    console.log('Testing valid Custom Block submission...');
    const goodRes = await req('/enquiries', {
      _csrf: csrfToken,
      name: 'Ganesh Technologist',
      email: 'ganesh@textile.com',
      whatsapp: '+91 9876543210',
      category: "Men's Wear",
      service_type: 'Custom Fit Block Development',
      requirements: 'Looking for industrial graded slim fit block in sizes 38-44 with DXF and HPGL.',
      source: '/custom-block'
    }, { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' });

    assert.equal(goodRes.status, 200, 'Valid submission returns 200 JSON');
    const goodJson = await goodRes.json();
    assert.equal(goodJson.success, true);
    assert.match(goodJson.message, /custom block request has been submitted/i);

    // Verify Lead saved in DB
    const savedLead = await Lead.findOne({ email: 'ganesh@textile.com' });
    assert.ok(savedLead, 'Lead is saved in database');
    assert.equal(savedLead.name, 'Ganesh Technologist');
    assert.equal(savedLead.interest, 'Fit Blocks');
    assert.match(savedLead.message, /Garment Category: Men's Wear/);
    assert.match(savedLead.message, /Custom Fit Block Development/);
    assert.match(savedLead.message, /Looking for industrial graded slim fit block/);

    // Verify NotificationLog queued
    const queuedLog = await Log.findOne({ reference_id: savedLead._id });
    assert.ok(queuedLog, 'Owner notification is queued in NotificationLog');
    assert.equal(queuedLog.event, 'admin_lead_enquiry');
    assert.equal(queuedLog.status, 'queued');
    assert.equal(queuedLog.destination, 'garmentdesignstudiocad@gmail.com');
    assert.match(queuedLog.message, /Customer Name: Ganesh Technologist/);
    assert.match(queuedLog.message, /Enquiry Type: Fit Blocks/);

    // 4. TEST HOMEPAGE LINK
    console.log('Testing homepage hero button...');
    const homeRes = await req('/');
    assert.equal(homeRes.status, 200);
    const homeHtml = await homeRes.text();
    assert.match(homeHtml, /href="\/custom-block"/, 'Homepage hero button links directly to /custom-block');
    assert.match(homeHtml, /id="btnRequestCustomBlock"/, 'Homepage hero button has id btnRequestCustomBlock');

    // 5. TEST PRODUCT PAGE OPTION IMAGES
    console.log('Testing product page option images...');
    const prodRes = await req('/product/basic-slim-fit-shirt');
    assert.equal(prodRes.status, 200);
    const prodHtml = await prodRes.text();

    // Check Image 1 & 2 for Soft Copy Bundle
    assert.match(prodHtml, /soft_copy_bundle_cad\.jpg/, 'Image 1 (soft_copy_bundle_cad.jpg) is present in Soft Copy section');
    assert.match(prodHtml, /soft_copy_bundle_roll\.jpg/, 'Image 2 (soft_copy_bundle_roll.jpg) is present in Soft Copy section');

    // Check Image 3 for Measurement Chart
    assert.match(prodHtml, /measurement_chart\.jpg/, 'Image 3 (measurement_chart.jpg) is present in Measurement Chart section');

    // Check Image 4 for Tech Pack
    assert.match(prodHtml, /tech_pack\.jpg/, 'Image 4 (tech_pack.jpg) is present in Tech Pack section');

    // Check Images 5 & 6 are NOT displayed in option cards
    assert.ok(!prodHtml.includes('img5_pattern_hard.jpg'), 'Image 5 is absent from option display');
    assert.ok(!prodHtml.includes('img6_mini_marker.jpg'), 'Image 6 is absent from option display');

    // Check Image 7 for Trial Fit Sample
    assert.match(prodHtml, /trial_fit_sample\.jpg/, 'Image 7 (trial_fit_sample.jpg) is present in Trial Fit Sample section');
    assert.match(prodHtml, /Demo Illustration &mdash; Trial Fit Sample/, 'Trial Fit Sample label is present');
    assert.match(prodHtml, /object-fit:\s*contain/, 'Trial Fit Sample uses object-fit: contain');

    console.log('--- ALL CUSTOM BLOCK & PRODUCT OPTION CHECKS PASSED! ---');
  } finally {
    if (server) server.close();
    await mongoose.disconnect();
    await mongo.stop();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
