require('./isolatedTestGuard');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

(async () => {
  let mongod, server;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-bundle-sec-'));
  Object.assign(process.env, {
    MONGOMS_RUNTIME_DOWNLOAD: 'false',
    NODE_ENV: 'development',
    PATTERN_FILES_DIR: temporary,
    NOTIFICATIONS_WORKER_ENABLED: 'false',
    SESSION_SECRET: 'isolated-bundle-sec-session',
    RAZORPAY_KEY_ID: 'rzp_test_bundle',
    RAZORPAY_KEY_SECRET: 'bundle-secret',
    RAZORPAY_WEBHOOK_SECRET: 'bundle-webhook',
    PUBLIC_BASE_URL: 'http://127.0.0.1',
    APP_BASE_URL: 'http://127.0.0.1',
    SITE_URL: 'http://127.0.0.1'
  });

  const gatewayOrders = [];
  let captured = false;
  require('razorpay');
  require.cache[require.resolve('razorpay')].exports = class {
    constructor() {
      this.orders = { create: async data => { const order = { ...data, id: 'order_bundle_' + (gatewayOrders.length + 1) }; gatewayOrders.push(order); return order; } };
      this.payments = { fetch: async id => ({ id, order_id: gatewayOrders.at(-1).id, amount: gatewayOrders.at(-1).amount, currency: 'INR', status: captured ? 'captured' : 'authorized', captured }) };
    }
  };
  require('nodemailer').createTransport = () => ({ sendMail: async () => ({ messageId: 'isolated-message' }) });

  try {
    mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
    await mongoose.connect(mongod.getUri());

    const Product = require('../models/mongo/Product');
    const ProductFile = require('../models/mongo/ProductFile');
    const Order = require('../models/mongo/Order');
    const delivery = require('../services/digitalDeliveryService');
    const pricing = require('../services/orderPricing');

    // Create 3 pattern files for size M: DXF, HPGL, and PDF (PLT is omitted / unavailable)
    const dxfFile = 'shirt_m.dxf';
    const hpglFile = 'shirt_m.hpgl';
    const pdfFile = 'shirt_m.pdf';
    fs.writeFileSync(path.join(temporary, dxfFile), Buffer.from('SECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n'));
    fs.writeFileSync(path.join(temporary, hpglFile), Buffer.from('IN;SP1;PA0,0;'));
    fs.writeFileSync(path.join(temporary, pdfFile), Buffer.from('%PDF-1.4\n%EOF\n'));

    // Separate paid Measurement Chart and Tech Pack files
    const measFile = 'meas.pdf';
    const techFile = 'tech.pdf';
    fs.writeFileSync(path.join(temporary, measFile), Buffer.from('%PDF-1.4\n%EOF\n'));
    fs.writeFileSync(path.join(temporary, techFile), Buffer.from('%PDF-1.4\n%EOF\n'));

    const product = await Product.create({
      name: 'Server Bundle Test Shirt',
      slug: 'server-bundle-test-shirt',
      base_price: 399,
      additional_size_price: 99,
      physical_price: 499,
      trial_price: 299,
      available_sizes: ['M'],
      pattern_options: { printable: true, physical: true, trial: true },
      active: true,
      status: 'active',
      digital_file_map: [
        { format: 'dxf', size: 'M', file: dxfFile, original_name: 'shirt_m.dxf' },
        { format: 'hpgl', size: 'M', file: hpglFile, original_name: 'shirt_m.hpgl' },
        { format: 'pdf', size: 'M', file: pdfFile, original_name: 'shirt_m.pdf' }
      ]
    });

    await ProductFile.create({
      product_id: product._id,
      file_name: 'measurement_chart.pdf',
      file_type: 'PDF',
      purpose: 'specs',
      upload_slot: 'measurement_pdf',
      file_price: 149,
      active: true,
      digital_file: measFile
    });

    await ProductFile.create({
      product_id: product._id,
      file_name: 'tech_pack.pdf',
      file_type: 'PDF',
      purpose: 'tech_pack',
      upload_slot: 'techpack_pdf',
      file_price: 249,
      active: true,
      digital_file: techFile
    });

    await require('../models/mongo/TaxSettings').create({ key: 'default', enabled: true, percentage: 18 });

    const app = require('../server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let cookie = '';

    async function request(url, body, form = false) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
      const res = await fetch(origin + url, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'manual',
        headers,
        body: body === undefined ? undefined : (form ? new URLSearchParams(body).toString() : JSON.stringify(body))
      });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      const text = await res.text();
      return { status: res.status, text };
    }

    // 1. Available bundle formats helper check
    const bundleFormats = await delivery.availableBundleFormats(product, ['M']);
    assert.deepEqual(bundleFormats.sort(), ['dxf', 'hpgl', 'pdf'].sort(), 'Server must detect all 3 available formats for size M');
    console.log('PASS: Server correctly identifies all 3 available formats for size M: DXF, HPGL, PDF.');

    // 2. Manipulated request with unavailable format (PLT not on disk) must be rejected
    const resPlt = await request('/cart/add', {
      product_id: String(product._id),
      quantity: 1,
      printable_selected: true,
      selected_sizes: ['M'],
      selected_formats: ['plt']
    });
    assert.equal(resPlt.status, 400, 'Must reject unavailable format PLT');
    console.log('PASS: Rejects manipulated client requesting unavailable PLT format.');

    // 3. Manipulated request with unauthorized string
    const resHacked = await request('/cart/add', {
      product_id: String(product._id),
      quantity: 1,
      printable_selected: true,
      selected_sizes: ['M'],
      selected_formats: ['hacked_format']
    });
    assert.equal(resHacked.status, 400, 'Must reject unauthorized format string');
    console.log('PASS: Rejects unauthorized format string.');

    // 4. Manipulated client sends ONLY DXF when DXF, HPGL, and PDF are available
    // Register customer
    cookie = '';
    const regRes = await request('/account/register');
    const csrf = regRes.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const customer = { name: 'Bundle Customer', email: 'bundle@example.test', phone: '9876543210' };
    const regPost = await request('/account/register', { ...customer, password: 'BundlePassword123!', confirm_password: 'BundlePassword123!', _csrf: csrf }, true);
    assert.ok([302, 303].includes(regPost.status));

    const addRes = await request('/cart/add', {
      product_id: String(product._id),
      quantity: 1,
      printable_selected: true,
      selected_sizes: ['M'],
      selected_formats: ['dxf'], // Manipulated client sends DXF alone
      files: []
    });
    assert.equal(addRes.status, 200, 'Cart add succeeds');

    // Submit checkout
    const checkoutRes = await request('/checkout', {
      customer,
      items: [{
        product_id: String(product._id),
        quantity: 1,
        printable_selected: true,
        selected_sizes: ['M'],
        selected_formats: ['dxf'], // Manipulated client sends DXF alone
        selected_files: [],
        selected_addons: []
      }],
      shipping: {}
    });
    assert.equal(checkoutRes.status, 200);

    const proceedRes = await request('/checkout/payment-method/proceed', {});
    assert.equal(proceedRes.status, 200);
    const payment = JSON.parse(proceedRes.text);

    let order = await Order.findOne({ 'customer_snapshot.email': customer.email });
    assert.ok(order, 'Order created');
    assert.equal(order.subtotal, 399, 'Single size M soft copy charged once at base price 399');

    // Order item format verification: Server must have bundled all 3 authorized formats
    const orderItem = order.items[0];
    assert.deepEqual(orderItem.selected_formats.sort(), ['dxf', 'hpgl', 'pdf'].sort(), 'Order item must include full server bundle');
    console.log('PASS: Order item includes full server-determined bundle (DXF, HPGL, PDF) despite client sending DXF alone.');

    // Complete mock payment
    captured = true;
    const payId = 'pay_bundle_test';
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(payment.razorpay_order_id + '|' + payId).digest('hex');
    await request('/checkout/razorpay-callback', {
      razorpay_order_id: payment.razorpay_order_id,
      razorpay_payment_id: payId,
      razorpay_signature: signature
    });

    await Order.updateOne({ _id: order._id }, { $set: { payment_status: 'paid', payment_verified_at: new Date() } });

    // 5. Entitlement verification: Server MUST deliver all 3 pattern formats
    const entitledOrder = await delivery.ensure(order._id);
    assert.ok(entitledOrder.download_token, 'Download token issued');
    assert.equal(entitledOrder.download_assets.length, 3, 'Must deliver exactly 3 pattern files: DXF, HPGL, PDF');

    const assetFiles = entitledOrder.download_assets.map(a => a.file).sort();
    assert.deepEqual(assetFiles, [dxfFile, hpglFile, pdfFile].sort(), 'Must deliver DXF, HPGL and PDF files');
    console.log('PASS: Entitlements include DXF, HPGL, and PDF. Client manipulation to DXF alone did not restrict customer delivery.');

    // Verify all 3 files can be downloaded
    for (let i = 0; i < entitledOrder.download_assets.length; i++) {
      const dl = await request('/downloads/' + entitledOrder.download_token + '/' + i);
      assert.equal(dl.status, 200, 'Asset ' + i + ' downloads successfully');
    }
    console.log('PASS: Customer successfully downloads all 3 bundled pattern formats.');

    // 6. Verify Measurement Chart and Tech Pack are NOT included in soft copy bundle
    assert.ok(!assetFiles.includes(measFile), 'Measurement chart must not be included');
    assert.ok(!assetFiles.includes(techFile), 'Tech pack must not be included');
    console.log('PASS: Separate paid Measurement Chart and Tech Pack remain excluded from soft copy bundle.');


    // 7. Multi-size bundle where different sizes have different available formats
    // Size S has DXF, HPGL, and PDF (3 formats)
    // Size M has DXF and HPGL (2 formats, PDF is absent for M)
    const dxfS = 'shirt_s.dxf';
    const hpglS = 'shirt_s.hpgl';
    const pdfS = 'shirt_s.pdf';
    fs.writeFileSync(path.join(temporary, dxfS), Buffer.from("SECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n"));
    fs.writeFileSync(path.join(temporary, hpglS), Buffer.from('IN;SP1;PA0,0;'));
    fs.writeFileSync(path.join(temporary, pdfS), Buffer.from('%PDF-1.4\n%EOF\n'));

    const multiSizeProduct = await Product.create({
      name: 'Multi-Size Asymmetric Bundle Shirt',
      slug: 'multi-size-asymmetric-shirt',
      base_price: 399,
      additional_size_price: 99,
      available_sizes: ['S', 'M'],
      pattern_options: { printable: true, physical: true, trial: true },
      active: true,
      status: 'active',
      digital_file_map: [
        { format: 'dxf', size: 'S', file: dxfS, original_name: 'shirt_s.dxf' },
        { format: 'hpgl', size: 'S', file: hpglS, original_name: 'shirt_s.hpgl' },
        { format: 'pdf', size: 'S', file: pdfS, original_name: 'shirt_s.pdf' },
        { format: 'dxf', size: 'M', file: dxfFile, original_name: 'shirt_m.dxf' },
        { format: 'hpgl', size: 'M', file: hpglFile, original_name: 'shirt_m.hpgl' }
      ]
    });

    const multiSizePrice = pricing.itemPrice(multiSizeProduct, [], [], { quantity: 1, printable_selected: true, selected_sizes: ['S', 'M'] });
    assert.equal(multiSizePrice.digital, 498, 'One charge per selected size (399 + 99 = 498) regardless of asymmetric formats');

    const addMulti = await request('/cart/add', {
      product_id: String(multiSizeProduct._id),
      quantity: 1,
      printable_selected: true,
      selected_sizes: ['S', 'M'],
      selected_formats: ['dxf', 'hpgl', 'pdf'],
      files: []
    });
    assert.equal(addMulti.status, 200, 'Cart add succeeds for multi-size asymmetric bundle');

    const checkoutMulti = await request('/checkout', {
      customer,
      items: [{
        product_id: String(multiSizeProduct._id),
        quantity: 1,
        printable_selected: true,
        selected_sizes: ['S', 'M'],
        selected_formats: ['dxf'], // Manipulated client sends DXF alone
        selected_files: [],
        selected_addons: []
      }],
      shipping: {}
    });
    assert.equal(checkoutMulti.status, 200);

    const proceedMulti = await request('/checkout/payment-method/proceed', {});
    assert.equal(proceedMulti.status, 200);
    const paymentMulti = JSON.parse(proceedMulti.text);

    let multiOrder = await Order.findOne({ razorpay_order_id: paymentMulti.razorpay_order_id });
    assert.ok(multiOrder, 'Multi-size order created');
    assert.equal(multiOrder.subtotal, 498);

    const sigMulti = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(paymentMulti.razorpay_order_id + '|pay_multi_1').digest('hex');
    await request('/checkout/razorpay-callback', {
      razorpay_order_id: paymentMulti.razorpay_order_id,
      razorpay_payment_id: 'pay_multi_1',
      razorpay_signature: sigMulti
    });

    await Order.updateOne({ _id: multiOrder._id }, { $set: { payment_status: 'paid', payment_verified_at: new Date() } });

    const entitledMulti = await delivery.ensure(multiOrder._id);
    assert.ok(entitledMulti.download_token, 'Download token issued for multi-size order');
    // Size S has 3 files (DXF, HPGL, PDF); Size M has 2 files (DXF, HPGL) -> Exactly 5 files!
    assert.equal(entitledMulti.download_assets.length, 5, 'Must deliver exactly 5 pattern files across sizes S and M');

    const multiAssetFiles = entitledMulti.download_assets.map(a => a.file).sort();
    assert.deepEqual(multiAssetFiles, [dxfS, hpglS, pdfS, dxfFile, hpglFile].sort(), 'Must grant authorized files for each respective size');
    console.log('PASS: Asymmetric multi-size bundle delivers all 3 formats for S and all 2 formats for M (5 files total). Every file verified on disk.');

    for (let i = 0; i < entitledMulti.download_assets.length; i++) {
      const dl = await request('/downloads/' + entitledMulti.download_token + '/' + i);
      assert.equal(dl.status, 200, 'Multi-size asset ' + i + ' downloads successfully');
    }
    console.log('PASS: All 5 multi-size asymmetric pattern assets downloaded successfully by customer.');

    // Clean up temporary files
    fs.rmSync(temporary, { recursive: true, force: true });
    console.log('ALL CANONICAL SERVER-SIDE FORMAT BUNDLE TESTS PASSED!');
  } finally {
    if (server) server.close();
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
})();
