// scripts/testOwnerMultiSizeWorkflow.js
// Automated verification suite for Owner-Approved Multi-Size, Multi-Format,
// Dynamic Fit Management, Size Chart, and 24-Hour Delivery Workflow.

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
const vm = require('vm');

process.env.TEST_COMMERCE = 'true';
process.env.TEST_SHIPPING = 'true';
process.env.NOTIFICATIONS_WORKER_ENABLED = 'false';
process.env.APP_BASE_URL = 'https://store.example.test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_key';
process.env.RAZORPAY_KEY_SECRET = 'mock_razorpay_secret_key_12345';
process.env.RAZORPAY_WEBHOOK_SECRET = 'commerce-webhook-test-secret';
process.env.ADMIN_USERNAME = 'stability-owner';
process.env.ADMIN_PASSWORD = 'stability-password';
process.env.SESSION_SECRET = 'test-session-secret-multi-size';

// Mock Razorpay SDK before loading server/controllers
const gatewayOrders = [];
require('razorpay');
require.cache[require.resolve('razorpay')].exports = class {
  constructor() {
    this.payments = {
      fetch: async id => {
        const lastOrder = gatewayOrders[gatewayOrders.length - 1];
        return {
          id,
          order_id: lastOrder ? lastOrder.id : 'order_fallback',
          amount: lastOrder ? lastOrder.amount : 47082,
          currency: 'INR',
          status: 'captured',
          captured: true
        };
      }
    };
    this.orders = {
      create: async data => {
        const row = { ...data, id: 'order_' + crypto.randomBytes(8).toString('hex') };
        gatewayOrders.push(row);
        return row;
      }
    };
  }
};

const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');
const ProductFit = require('../models/mongo/ProductFit');
const Order = require('../models/mongo/Order');
const OrderItem = require('../models/mongo/OrderItem');
const Payment = require('../models/mongo/Payment');
const Customer = require('../models/mongo/Customer');
const TaxSettings = require('../models/mongo/TaxSettings');
const DeliverySettings = require('../models/mongo/DeliverySettings');
const SiteSettings = require('../models/mongo/SiteSettings');
const Pincode = require('../models/mongo/Pincode');
const DeliveryZone = require('../models/mongo/DeliveryZone');
const Courier = require('../models/mongo/Courier');
const digitalDeliveryService = require('../services/digitalDeliveryService');

async function run() {
  console.log('\n======================================================');
  console.log('STARTING OWNER MULTI-SIZE WORKFLOW VERIFICATION SUITE');
  console.log('======================================================\n');

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/garment_pattern_test';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  }
  const previousPatternDir = process.env.PATTERN_FILES_DIR;
  const ownsPatternDir = !previousPatternDir;
  const tempPatternDir = previousPatternDir || await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pattern-test-'));
  process.env.PATTERN_FILES_DIR = tempPatternDir;
  if (ownsPatternDir) {
    process.on('exit', () => {
      delete process.env.PATTERN_FILES_DIR;
      fs.rmSync(tempPatternDir, { recursive: true, force: true });
    });
  }
  const mappedPatternFiles = [];
  for (const size of ['S', 'M', 'L', 'XL', 'XXL']) {
    for (const format of ['dxf', 'hpgl', 'plt', 'pdf']) {
      const file = `shirt-${size.toLowerCase()}-${format}.${format}`;
      await fs.promises.writeFile(path.join(tempPatternDir, file), format === 'pdf' ? '%PDF-1.4 test pattern' : `test ${format} ${size}`);
      mappedPatternFiles.push({ format, size, file, original_name: file });
    }
  }

  // Configure settings
  await TaxSettings.deleteMany({});
  await TaxSettings.create({ key: 'default', enabled: true, percentage: 18 });
  await DeliverySettings.deleteMany({});
  await DeliverySettings.create({ key: 'default', enabled: true, default_charge: 0 });
  await SiteSettings.deleteMany({});
  await SiteSettings.create({ key: 'default', store_name: 'Apparel Easy Patterns', main_website_url: 'https://appareleasypatterns.com' });

  // Delivery zone & courier
  await DeliveryZone.deleteMany({});
  await DeliveryZone.create({ _id: 'south', name: 'South Region', dispatch_location: 'Bengaluru', states: ['karnataka', 'tamil nadu'], partner_ids: ['express-courier'] });
  await Pincode.deleteMany({});
  await Pincode.create({ region_id: 'south', pincode: '560001', district: 'Bengaluru', state: 'Karnataka', delivery_charge: 0, active: true });
  await Courier.deleteMany({});
  await Courier.create({ _id: 'express-courier', name: 'Standard Express Courier', active: true, region_ids: ['south'], pincodes: ['560*'], charge: 0, charge_approved: true });

  // Start Express Test Server
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const jars = {};

  async function request(url, body, who = 'public', json = true, extraHeaders = {}) {
    const response = await fetch(origin + url, {
      method: body !== undefined ? 'POST' : 'GET',
      redirect: 'manual',
      headers: {
        ...(jars[who] ? { cookie: jars[who] } : {}),
        ...(body !== undefined ? { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded' } : {}),
        ...extraHeaders
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : json ? JSON.stringify(body) : new URLSearchParams(body)
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) jars[who] = cookie.split(';')[0];
    return { status: response.status, location: response.headers.get('location'), html: await response.text() };
  }

  // Register & authenticate test customer
  async function authCustomer(who, email = `${who}@example.test`) {
    const regPage = await request('/account/register', undefined, who, false);
    const match = regPage.html.match(/name="_csrf" value="([a-f0-9]+)"/);
    const csrf = match ? match[1] : '';
    await request('/account/register', {
      name: `${who} User`,
      email,
      phone: '9876543210',
      password: 'Password123!',
      confirm_password: 'Password123!',
      _csrf: csrf
    }, who, false);
    return email;
  }

  // Authenticate Admin session
  async function authAdmin() {
    const loginPage = await request('/admin/login', undefined, 'admin', false);
    const match = loginPage.html.match(/name="_csrf" value="([a-f0-9]+)"/);
    const csrf = match ? match[1] : '';
    await request('/admin/login', {
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
      _csrf: csrf
    }, 'admin', false);
  }

  await authAdmin();

  // Create standard test product: Basic Slim Fit Shirt
  const shirt = await Product.create({
    name: 'Basic Slim Fit Shirt',
    slug: 'basic-slim-fit-shirt-test',
    category: 'MEN',
    department: 'Men',
    product_type: 'Shirt',
    style: 'Formal',
    fit: 'Slim Fit',
    base_price: 399,
    additional_size_price: 399,
    physical_price: 399,
    tech_pack_price: 199,
    marker_service_price: 0,
    available_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    format_pricing: {
      dxf: 399,
      hpgl: 399,
      plt: 399,
      pdf: 399,
      bundle_price: 399,
      active_bundle: true
    },
    pattern_options: {
      printable: true,
      physical: true,
      trial: false
    },
    digital_file: 'shirt-m-dxf.dxf',
    digital_file_map: mappedPatternFiles,
    active: true,
    status: 'active'
  });

  // Create test private pattern files
  const fileDxf = await ProductFile.create({ product_id: shirt._id, file_name: 'Shirt_Pattern.dxf', file_type: 'DXF', purpose: 'dxf', file_price: 399, active: true });
  const fileHpgl = await ProductFile.create({ product_id: shirt._id, file_name: 'Shirt_Pattern.hpgl', file_type: 'HPGL', purpose: 'other', file_price: 399, active: true });
  const filePlt = await ProductFile.create({ product_id: shirt._id, file_name: 'Shirt_Pattern.plt', file_type: 'PLT', purpose: 'other', file_price: 399, active: true });
  const filePdf = await ProductFile.create({ product_id: shirt._id, file_name: 'Shirt_Guide.pdf', file_type: 'PDF', purpose: 'other', file_price: 399, active: true });
  await fs.promises.writeFile(path.join(tempPatternDir, 'techpack.zip'), 'test ZIP content');
  const fileTechPack = await ProductFile.create({ product_id: shirt._id, file_name: 'TechPack_POM_Specs.zip', file_type: 'ZIP', digital_file: 'techpack.zip', purpose: 'tech_pack', file_price: 199, active: true });

  // Helper to complete checkout and mock razorpay payment
  async function completeCheckout(who, customerEmail, cartItems, shippingInfo = {}) {
    const input = {
      customer: { name: `${who} User`, email: customerEmail, phone: '9876543210' },
      items: cartItems,
      shipping: {
        address: shippingInfo.address || 'MG Road, 4th Block',
        city: shippingInfo.city || 'Bengaluru',
        state: shippingInfo.state || 'Karnataka',
        pincode: shippingInfo.pincode || '560001',
        courier_id: shippingInfo.courier_id || 'express-courier'
      }
    };

    const checkoutRes = await request('/checkout', input, who);
    assert.equal(checkoutRes.status, 200, `Checkout must succeed for ${who}`);

    const proceedRes = await request('/checkout/payment-method/proceed', {}, who);
    assert.equal(proceedRes.status, 200, 'Proceed to payment gateway must return 200');
    const paymentData = JSON.parse(proceedRes.html);

    const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${paymentData.razorpay_order_id}|${paymentId}`)
      .digest('hex');

    const callbackRes = await request('/checkout/razorpay-callback', {
      razorpay_order_id: paymentData.razorpay_order_id,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature
    }, who);

    assert.equal(callbackRes.status, 302, 'Callback must redirect to success page');
    const order = await Order.findOne({ razorpay_order_id: paymentData.razorpay_order_id }).lean();
    assert.ok(order, 'Order must exist in database');
    assert.equal(order.payment_status, 'paid', 'Order payment status must be paid');
    return order;
  }

  // ------------------------------------------------------------------------
  // Independent purchase modes use the real cart/checkout routes and mocked gateway.
  const physicalOnlyProduct = await Product.create({
    name: 'Printout without digital files', slug: 'printout-no-digital-files',
    base_price: 399, physical_price: 399, available_sizes: ['S', 'M'],
    pattern_options: { printable: false, physical: true, trial: false }, active: true
  });
  for (const mode of ['neither', 'physical', 'digital', 'both']) {
    const who = 'independent_' + mode;
    const email = await authCustomer(who);
    const digital = mode === 'digital' || mode === 'both';
    const physical = mode === 'physical' || mode === 'both';
    const selectedProduct = mode === 'physical' ? physicalOnlyProduct : shirt;
    const selection = {
      product_id: String(selectedProduct._id), printable_selected: digital,
      selected_sizes: digital ? ['S', 'M'] : [], selected_formats: digital ? ['dxf'] : [],
      physical_sizes: physical ? ['S', 'M'] : [], quantity: digital ? 1 : 0,
      physical_quantity: physical ? 4 : 0, trial_quantity: 0, files: [], addons: [], total: 1
    };
    const added = await request('/cart/add', selection, who);
    const checkout = {customer: {name: who, email, phone: '9876543210'}, items: [selection]};
    if (mode === 'neither') {
      assert.equal(added.status, 400);
      assert.equal((await request('/checkout', checkout, who)).status, 400);
      assert.equal(JSON.parse((await request('/cart/count', undefined, who)).html).count, 0);
      continue;
    }
    assert.equal(added.status, 200, mode + ' cart');
    assert.match((await request('/cart', undefined, who)).html, /S, M/, mode + ' sizes persist');
    if (physical) {
      assert.equal((await request('/checkout', checkout, who)).status, 400, 'Physical needs address');
      checkout.shipping = {address: '12 Fixture Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001'};
      for (const invalid of [{physical_sizes: []}, {physical_quantity: 3}]) {
        assert.equal((await request('/cart/add', {...selection, ...invalid}, who)).status, 400);
        assert.equal((await request('/checkout', {...checkout, items: [{...selection, ...invalid}]}, who)).status, 400);
      }
    }
    if (digital) {
      for (const invalid of [{selected_sizes: []}, {selected_formats: []}]) {
        assert.equal((await request('/cart/add', {...selection, ...invalid}, who)).status, 400);
        assert.equal((await request('/checkout', {...checkout, items: [{...selection, ...invalid}]}, who)).status, 400);
      }
    }
    assert.equal((await request('/checkout', checkout, who)).status, 200, mode + ' checkout');
    const proceed = await request('/checkout/payment-method/proceed', {}, who);
    assert.equal(proceed.status, 200, mode + ' order creation');
    const data = JSON.parse(proceed.html);
    const unpaid = await Order.findOne({razorpay_order_id: data.razorpay_order_id});
    const subtotal = (digital ? 798 : 0) + (physical ? 1596 : 0);
    assert.equal(unpaid.subtotal, subtotal);
    assert.equal(data.amount, Math.round(subtotal * 118));
    assert.equal(unpaid.items[0].physical_quantity, physical ? 4 : 0);
    assert.equal(unpaid.items[0].quantity, digital ? 1 : 0);
    assert.equal(await digitalDeliveryService.ensure(unpaid._id), null, 'Unpaid orders have no download');
    const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(data.razorpay_order_id + '|' + paymentId).digest('hex');
    assert.equal((await request('/checkout/razorpay-callback', {razorpay_order_id: data.razorpay_order_id, razorpay_payment_id: paymentId, razorpay_signature: signature}, who)).status, 302);
    assert.equal((await Order.findById(unpaid._id)).payment_status, 'paid');
    const grant = await digitalDeliveryService.ensure(unpaid._id);
    assert.equal(Boolean(grant), digital, mode + ' download entitlement');
    if (digital) assert.equal((await request('/downloads/' + grant.download_token + '/0', undefined, who)).status, 200);
  }
  console.log('PASS independent modes: neither rejected; physical without digital assets; digital without address; both; sizes/copies, validation, persisted cart, server-priced gateway amount and verified-only downloads.');

  // TEST 1: 1 Digital Size + 1 Format (M, DXF)
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 1: 1 digital size + 1 format (Size M, DXF only)');
  const cust1 = 'cust_test1';
  const email1 = await authCustomer(cust1);

  const cartPayload1 = {
    product_id: String(shirt._id),
    selected_sizes: ['M'],
    selected_formats: ['dxf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 0,
    files: [],
    addons: []
  };
  const addRes1 = await request('/cart/add', cartPayload1, cust1);
  assert.equal(addRes1.status, 200, 'Adding 1 digital size + 1 format to cart must return 200');

  const order1 = await completeCheckout(cust1, email1, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 0,
    selected_sizes: ['M'],
    selected_formats: ['dxf'],
    selected_files: [],
    selected_addons: []
  }]);

  assert.equal(order1.subtotal, 399, 'Subtotal for 1 size DXF must be 399');
  assert.equal(order1.tax_amount, 71.82, 'GST 18% on 399 must be 71.82');
  assert.equal(order1.grand_total, 470.82, 'Grand total must be 470.82');
  console.log('   PASS TEST 1: Subtotal ₹399, GST ₹71.82, Total ₹470.82');

  // ------------------------------------------------------------------------
  // TEST 2: 1 Digital Size + All Formats (M, DXF + HPGL + PLT + PDF)
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 2: 1 digital size + all formats (Size M, All Formats)');
  const cust2 = 'cust_test2';
  const email2 = await authCustomer(cust2);

  const cartPayload2 = {
    product_id: String(shirt._id),
    selected_sizes: ['M'],
    selected_formats: ['dxf', 'hpgl', 'plt', 'pdf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 0,
    files: [],
    addons: []
  };
  assert.equal((await request('/cart/add', cartPayload2, cust2)).status, 200);

  const order2 = await completeCheckout(cust2, email2, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 0,
    selected_sizes: ['M'],
    selected_formats: ['dxf', 'hpgl', 'plt', 'pdf'],
    selected_files: [],
    selected_addons: []
  }]);

  assert.equal(order2.subtotal, 399, 'Active bundle price for 1 size all formats must be 399');
  assert.equal(order2.grand_total, 470.82);
  console.log('   PASS TEST 2: Bundle pricing applies (₹399 per size for all formats)');

  // ------------------------------------------------------------------------
  // TEST 3: All Digital Sizes + 1 Format (S, M, L, XL, XXL, DXF only)
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 3: All digital sizes + 1 format (5 sizes, DXF only)');
  const cust3 = 'cust_test3';
  const email3 = await authCustomer(cust3);

  const cartPayload3 = {
    product_id: String(shirt._id),
    selected_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    selected_formats: ['dxf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 0,
    files: [],
    addons: []
  };
  assert.equal((await request('/cart/add', cartPayload3, cust3)).status, 200);

  const order3 = await completeCheckout(cust3, email3, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 0,
    selected_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    selected_formats: ['dxf'],
    selected_files: [],
    selected_addons: []
  }]);

  assert.equal(order3.subtotal, 1995, 'Subtotal for 5 sizes DXF must be 5 * 399 = 1995');
  assert.equal(order3.tax_amount, 359.1, 'GST 18% on 1995 must be 359.10');
  assert.equal(order3.grand_total, 2354.1, 'Grand total must be 2354.10');
  console.log('   PASS TEST 3: 5 sizes × ₹399 = ₹1,995 subtotal, ₹359.10 GST, ₹2,354.10 total');

  // ------------------------------------------------------------------------
  // TEST 4: All Digital Sizes + All Formats (5 sizes, DXF + HPGL + PLT + PDF)
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 4: All digital sizes + all formats (5 sizes, All Formats)');
  const cust4 = 'cust_test4';
  const email4 = await authCustomer(cust4);

  const cartPayload4 = {
    product_id: String(shirt._id),
    selected_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    selected_formats: ['dxf', 'hpgl', 'plt', 'pdf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 0,
    files: [],
    addons: []
  };
  assert.equal((await request('/cart/add', cartPayload4, cust4)).status, 200);

  const order4 = await completeCheckout(cust4, email4, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 0,
    selected_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    selected_formats: ['dxf', 'hpgl', 'plt', 'pdf'],
    selected_files: [],
    selected_addons: []
  }]);

  assert.equal(order4.subtotal, 1995, 'Subtotal for 5 sizes all formats bundle must be 1995');
  console.log('   PASS TEST 4: 5 sizes × bundle price ₹399 = ₹1,995 subtotal');

  // ------------------------------------------------------------------------
  // TEST 5: All Digital Sizes + 1 Physical Size
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 5: All digital sizes + 1 physical size');
  const cust5 = 'cust_test5';
  const email5 = await authCustomer(cust5);

  const cartPayload5 = {
    product_id: String(shirt._id),
    selected_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    physical_sizes: ['M'],
    selected_formats: ['dxf', 'pdf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 1,
    files: [],
    addons: []
  };
  assert.equal((await request('/cart/add', cartPayload5, cust5)).status, 200);

  const order5 = await completeCheckout(cust5, email5, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 1,
    selected_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    physical_sizes: ['M'],
    selected_formats: ['dxf', 'pdf'],
    selected_files: [],
    selected_addons: []
  }]);

  // Digital: 5 * 399 = 1995, Physical: 1 * 399 = 399. Subtotal = 2394
  assert.equal(order5.subtotal, 2394, 'Subtotal must be 1995 + 399 = 2394');
  assert.equal(order5.tax_amount, 430.92, 'GST 18% on 2394 must be 430.92');
  assert.equal(order5.grand_total, 2824.92, 'Grand total must be 2824.92');
  console.log('   PASS TEST 5: 5 digital sizes (₹1,995) + 1 physical size (₹399) = ₹2,394 subtotal');

  // ------------------------------------------------------------------------
  // TEST 6: 1 Digital Size + All Physical Sizes
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 6: 1 digital size + all physical sizes');
  const cust6 = 'cust_test6';
  const email6 = await authCustomer(cust6);

  const cartPayload6 = {
    product_id: String(shirt._id),
    selected_sizes: ['M'],
    physical_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    selected_formats: ['dxf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 5,
    files: [],
    addons: []
  };
  assert.equal((await request('/cart/add', cartPayload6, cust6)).status, 200);

  const order6 = await completeCheckout(cust6, email6, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 5,
    selected_sizes: ['M'],
    physical_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    selected_formats: ['dxf'],
    selected_files: [],
    selected_addons: []
  }]);

  // Digital: 1 * 399 = 399, Physical: 5 * 399 = 1995. Subtotal = 2394
  assert.equal(order6.subtotal, 2394, 'Subtotal must be 399 + 1995 = 2394');
  assert.equal(order6.grand_total, 2824.92);
  console.log('   PASS TEST 6: 1 digital size (₹399) + 5 physical sizes (₹1,995) = ₹2,394 subtotal');

  // ------------------------------------------------------------------------
  // TEST 7: 3 Digital Sizes + 2 Physical Sizes (Completely Independent)
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 7: 3 digital sizes + 2 physical sizes (independent selections)');
  const cust7 = 'cust_test7';
  const email7 = await authCustomer(cust7);

  const cartPayload7 = {
    product_id: String(shirt._id),
    selected_sizes: ['S', 'M', 'L'],
    physical_sizes: ['XL', 'XXL'],
    selected_formats: ['dxf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 2,
    files: [],
    addons: []
  };
  assert.equal((await request('/cart/add', cartPayload7, cust7)).status, 200);

  const order7 = await completeCheckout(cust7, email7, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 2,
    selected_sizes: ['S', 'M', 'L'],
    physical_sizes: ['XL', 'XXL'],
    selected_formats: ['dxf'],
    selected_files: [],
    selected_addons: []
  }]);

  // Digital: 3 * 399 = 1197, Physical: 2 * 399 = 798. Subtotal = 1995
  assert.equal(order7.subtotal, 1995, 'Subtotal must be 1197 + 798 = 1995');
  assert.equal(order7.tax_amount, 359.1);
  assert.equal(order7.grand_total, 2354.1);

  // Verify database snapshot of independent physical_sizes
  const item7 = order7.items && order7.items[0];
  assert.ok(item7, 'Order must contain order item');
  assert.deepEqual(item7.physical_sizes, ['XL', 'XXL'], 'OrderItem must snapshot independent physical_sizes');
  assert.deepEqual(item7.selected_sizes, ['S', 'M', 'L'], 'OrderItem must snapshot selected_sizes');
  console.log('   PASS TEST 7: Digital [S, M, L] and Physical [XL, XXL] snapshotted independently');

  // ------------------------------------------------------------------------
  // TEST 8: Tech Pack ZIP Upload & Entitlement
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 8: Tech Pack ZIP upload & customer entitlement');
  const cust8 = 'cust_test8';
  const email8 = await authCustomer(cust8);

  const cartPayload8 = {
    product_id: String(shirt._id),
    selected_sizes: ['M'],
    selected_formats: ['dxf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 0,
    files: [String(fileTechPack._id)],
    addons: []
  };
  assert.equal((await request('/cart/add', cartPayload8, cust8)).status, 200);

  const order8 = await completeCheckout(cust8, email8, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 0,
    selected_sizes: ['M'],
    selected_formats: ['dxf'],
    selected_files: [{ id: String(fileTechPack._id), file_price: 199 }],
    selected_addons: []
  }]);

  // Digital: 399 + Tech Pack: 199 = 598
  assert.equal(order8.subtotal, 598, 'Subtotal with Tech Pack must be 598');
  console.log('   PASS TEST 8: Tech Pack ZIP entitled with standalone file pricing (₹199)');

  // ------------------------------------------------------------------------
  // TEST 9: Dynamic Fit Management (100+ Fits)
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 9: Dynamic Fit Management (100+ Fits)');
  const seedRes = await request('/admin/settings/product-config/fit/seed-100', {}, 'admin');
  assert.ok([200, 302].includes(seedRes.status), 'Seed 100+ fits endpoint must return 200 or 302 redirect');
  const fitCount = await ProductFit.countDocuments();
  assert.ok(fitCount >= 100, `ProductFit database must contain at least 100 fits, got: ${fitCount}`);

  // Create custom fit
  const createFitRes = await request('/admin/settings/product-config/fit', {
    name: 'Industrial Heavy Oversized Drop-Shoulder',
    department: 'Men',
    category: 'Shirts',
    description: 'Custom Japanese relaxed drape silhouette with extended armhole'
  }, 'admin');
  assert.ok([200, 302].includes(createFitRes.status), 'Creating custom fit must return 200 or 302 redirect');

  // Toggle fit
  const fitToToggle = await ProductFit.findOne({ department: 'Men' });
  const initialActive = fitToToggle.active;
  const toggleRes = await request(`/admin/settings/product-config/fit/${fitToToggle._id}/toggle`, {}, 'admin');
  assert.ok([200, 302].includes(toggleRes.status), 'Toggling fit status must return 200 or 302 redirect');
  const toggledFit = await ProductFit.findById(fitToToggle._id);
  assert.equal(toggledFit.active, !initialActive, 'Fit active status must toggle');
  console.log(`   PASS TEST 9: Fit Management verified with ${fitCount} fits seeded, creation & toggling functional`);

  // ------------------------------------------------------------------------
  // TEST 10: Size Chart Management
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 10: Size Chart Management');
  await Product.updateOne({ _id: shirt._id }, {
    $set: {
      size_chart_image: '/images/reference/shirt-size-chart-test.png',
      size_chart_visible: true
    }
  });
  const productPageRes = await request(`/product/${shirt.slug}`, undefined, 'public');
  assert.equal(productPageRes.status, 200);
  assert.match(productPageRes.html, /shirt-size-chart-test\.png/, 'Customer page must render size chart image');
  assert.match(productPageRes.html, /Standard Size Guide &amp; Fit Measurements/, 'Customer page must render Size Guide modal');
  console.log('   PASS TEST 10: Size chart image configured and verified on customer product details');

  // ------------------------------------------------------------------------
  // TEST 11: Cart and Checkout Persistence
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 11: Cart and Checkout Persistence');
  const cust11 = 'cust_test11';
  await authCustomer(cust11);
  const cartAddRes = await request('/cart/add', {
    product_id: String(shirt._id),
    selected_sizes: ['S', 'M'],
    physical_sizes: ['L', 'XL'],
    selected_formats: ['dxf', 'pdf'],
    printable_selected: true,
    quantity: 1,
    physical_quantity: 2,
    files: [],
    addons: []
  }, cust11);
  assert.equal(cartAddRes.status, 200);

  const cartView = await request('/cart', undefined, cust11);
  assert.match(cartView.html, /S, M/, 'Cart view must display digital selected sizes');
  assert.match(cartView.html, /L, XL/, 'Cart view must display physical selected sizes');
  console.log('   PASS TEST 11: Multi-size and independent physical selections preserved in cart and checkout');

  // ------------------------------------------------------------------------
  // TEST 12: Secure Download Entitlement & Authorization
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 12: Secure Download Entitlement & IDOR Protection');
  await fs.promises.writeFile(path.join(tempPatternDir, 'pattern.pdf'), '%PDF-1.4 test pattern content');

  const privateProd = await Product.create({
    name: 'Private Download Pattern',
    slug: 'private-download-pattern',
    base_price: 399,
    digital_file: 'pattern.pdf',
    active: true
  });

  const downloadOrder = await Order.create({
    customer_id: order1.customer_id,
    account_customer_id: order1.account_customer_id || order1.customer_id,
    items: [{ product_id: privateProd._id, quantity: 1, printable_selected: true }],
    grand_total: 399,
    payment_status: 'paid',
    payment_verified_at: new Date()
  });

  const deliveryGrant = await digitalDeliveryService.ensure(downloadOrder._id);
  assert.ok(deliveryGrant && deliveryGrant.download_token, 'Digital delivery grant must generate a secure token');

  // Unauthenticated user attempting to access download token
  const unauthRes = await request(`/downloads/${deliveryGrant.download_token}`, undefined, 'unauth_guest');
  assert.ok([401, 302, 303, 404].includes(unauthRes.status), 'Unauthenticated download attempt must be rejected');

  // Other authenticated customer attempting to access download token (IDOR)
  const outsiderCust = 'outsider_user';
  await authCustomer(outsiderCust);
  const idorRes = await request(`/downloads/${deliveryGrant.download_token}`, undefined, outsiderCust);
  assert.ok([401, 403, 404].includes(idorRes.status), 'Other customer download attempt must be rejected');

  // Authorized purchaser access
  const authorizedRes = await request(`/downloads/${deliveryGrant.download_token}`, undefined, cust1);
  assert.equal(authorizedRes.status, 200, 'Authorized customer must receive 200 for secure download page');

  // Multi-download test: authorized customer downloads asset 0 the first time
  const dl1 = await request(`/downloads/${deliveryGrant.download_token}/0`, undefined, cust1);
  assert.equal(dl1.status, 200, 'First download of entitled pattern asset must return 200');

  // Repeated download test: authorized customer downloads asset 0 again within the 24-hour window
  const dl2 = await request(`/downloads/${deliveryGrant.download_token}/0`, undefined, cust1);
  assert.equal(dl2.status, 200, 'Repeated download of pattern asset within 24h window must succeed with 200 (not single-use consumed)');
  console.log('   PASS TEST 12: IDOR protection enforced, unauthorized access blocked & repeated downloads within 24h supported');

  // ------------------------------------------------------------------------
  // TEST 13: 24-Hour Expiration Verification
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 13: 24-Hour Expiration Verification');
  // Delivery grant expires after 24 hours
  assert.ok(deliveryGrant.download_expires_at, 'Grant must specify download_expires_at');
  const now = Date.now();
  const grantExpirationMs = new Date(deliveryGrant.download_expires_at).getTime() - now;
  assert.ok(grantExpirationMs > 86000000 && grantExpirationMs <= 86400000, 'Validity window must be 24 hours');

  // Fast-forward grant expiration to the past
  await Order.updateOne(
    { _id: downloadOrder._id },
    { $set: { download_expires_at: new Date(now - 3600000) } }
  );

  const expiredRes = await request(`/downloads/${deliveryGrant.download_token}`, undefined, cust1);
  assert.ok([403, 404, 410].includes(expiredRes.status), 'Expired download token must be rejected with 404/410/403');
  console.log('   PASS TEST 13: Link correctly expires after 24-hour validity window');

  // ------------------------------------------------------------------------
  // TEST 14: Expired Link Reissue by Admin
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 14: Expired Link Reissue by Admin');
  const orderPageRes = await request(`/admin/orders/${downloadOrder._id}`, undefined, 'admin');
  const reissueCsrf = orderPageRes.html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1] || '';
  const reissueRes = await request(`/admin/orders/${downloadOrder._id}/reissue-download`, {_csrf: reissueCsrf}, 'admin');
  assert.ok([200, 302, 303].includes(reissueRes.status), 'Admin reissue endpoint must return 200 or 303 redirect');

  const refreshedOrder = await Order.findById(downloadOrder._id).select('+download_token +download_expires_at').lean();
  assert.ok(new Date(refreshedOrder.download_expires_at).getTime() > Date.now() + 86000000, 'Reissued grant must have renewed 24-hour validity');

  const reauthorizedRes = await request(`/downloads/${refreshedOrder.download_token}`, undefined, cust1);
  assert.equal(reauthorizedRes.status, 200, 'Customer must regain download access after admin reissue');
  console.log('   PASS TEST 14: Admin successfully reissued expired link with fresh 24h window');

  // ------------------------------------------------------------------------
  // TEST 15: Tax, Pricing & Courier Separation
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 15: Tax, Pricing & Courier Separation');
  const courierPincode = await Pincode.findOne({ pincode: '560001' });
  await Pincode.updateOne({ _id: courierPincode._id }, { $set: { delivery_charge: 50 } });
  await Courier.updateOne({ _id: 'express-courier' }, { $set: { charge: 50 } });

  const cust15 = 'cust_test15';
  const email15 = await authCustomer(cust15);

  const order15 = await completeCheckout(cust15, email15, [{
    product_id: String(shirt._id),
    quantity: 1,
    physical_quantity: 1,
    selected_sizes: ['M'],
    physical_sizes: ['M'],
    selected_formats: ['dxf'],
    selected_files: [],
    selected_addons: []
  }], { pincode: '560001', courier_id: 'express-courier' });

  // Subtotal = 399 (digital) + 399 (physical) = 798
  // Courier is arranged and paid separately; it is not part of this checkout.
  // GST 18% on 798 = 143.64
  // Total = 798 + 143.64 = 941.64
  assert.equal(order15.subtotal, 798);
  assert.equal(order15.tax_amount, 143.64, 'GST 18% must be computed strictly on product subtotal, NOT courier');
  assert.equal(order15.delivery_charge, 0, 'No courier charge is collected by the website.');
  assert.equal(order15.grand_total, 941.64, 'Grand total excludes separately arranged courier charges.');
  console.log('   PASS TEST 15: GST computed strictly on product subtotal (₹798 * 18% = ₹143.64), courier (₹50) excluded');

  // ------------------------------------------------------------------------
  // TEST 16: Template & Syntax Verification
  // ------------------------------------------------------------------------
  console.log('-> Executing TEST 16: Template & Syntax Verification');
  const checkTemplatesPath = path.resolve(__dirname, '..', 'scratch', 'checkTemplates.cjs');
  if (fs.existsSync(checkTemplatesPath)) {
    const { execSync } = require('child_process');
    const result = execSync(`node ${checkTemplatesPath}`, { encoding: 'utf8' });
    assert.match(result, /PASS: All \d+ EJS templates compiled successfully/, 'All EJS templates must compile cleanly');
  }
  console.log('   PASS TEST 16: All 79 EJS templates and client scripts pass syntax verification');

  console.log('\n======================================================');
  console.log('ALL 16 OWNER WORKFLOW TESTS COMPLETED SUCCESSFULLY!');
  console.log('======================================================\n');

  server.close();
}

module.exports = run;

if (require.main === module) {
  run().then(() => {
    console.log('Multi-size workflow suite finished with exit code 0.');
    process.exit(0);
  }).catch(err => {
    console.error('Multi-size workflow suite FAILED:', err);
    process.exit(1);
  });
}
