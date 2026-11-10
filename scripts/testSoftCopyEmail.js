const mongoose = require('mongoose');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function run() {
  console.log('--- Starting Soft Copy Email & Format+Size Delivery Verification ---');
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI);
  }

  process.env.APP_BASE_URL = 'http://localhost:3000';

  const Order = require('../models/mongo/Order');
  const Product = require('../models/mongo/Product');
  const ProductFile = require('../models/mongo/ProductFile');
  const Customer = require('../models/mongo/Customer');
  const NotificationLog = require('../models/mongo/NotificationLog');
  const digitalDeliveryService = require('../services/digitalDeliveryService');
  const notificationService = require('../services/notificationService');

  // 1. Create Customer and Product with digital_file_map (format+size entries)
  const customer = await Customer.create({
    name: 'Rohan Sharma',
    email: 'rohan.sharma@example.com',
    phone: '9876543210'
  });

  const privDir = digitalDeliveryService.root();
  if (!fs.existsSync(privDir)) fs.mkdirSync(privDir, { recursive: true });

  // Write fake private files for the per-format-size delivery test
  const files = {
    'dxf-S': 'test-shirt-dxf-S.dxf',
    'dxf-M': 'test-shirt-dxf-M.dxf',
    'pdf-M': 'test-shirt-pdf-M.pdf',
    'pdf-L': 'test-shirt-pdf-L.pdf',
  };
  for (const fname of Object.values(files)) {
    fs.writeFileSync(path.join(privDir, fname), 'FAKE CAD CONTENT ' + fname);
  }

  // Create product with digital_file_map entries: dxf for S,M and pdf for M,L
  const product = await Product.create({
    name: 'Basic Slim Fit Shirt',
    slug: 'basic-slim-fit-shirt-softcopy-test-' + Date.now(),
    category: 'men',
    department: 'Men',
    base_price: 399,
    status: 'active',
    available_sizes: ['S', 'M', 'L', 'XL'],
    digital_file_map: [
      { format: 'dxf', size: 'S', file: files['dxf-S'] },
      { format: 'dxf', size: 'M', file: files['dxf-M'] },
      { format: 'pdf', size: 'M', file: files['pdf-M'] },
      { format: 'pdf', size: 'L', file: files['pdf-L'] },
    ],
    format_pricing: { dxf: 399, hpgl: 399, plt: 399, pdf: 399, bundle_price: 999, active_bundle: true }
  });

  // TEST 1: DXF format + sizes S,M delivery
  console.log('-> TEST 1: DXF format selected for sizes S and M...');
  const orderDxf = await Order.create({
    customer_id: customer._id,
    account_customer_id: customer._id,
    order_status: 'confirmed',
    payment_status: 'paid',
    payment_verified_at: new Date(),
    payment_reference: 'pay_test_dxf_sm',
    subtotal: 798,
    tax_rate: 18,
    tax_amount: 143.64,
    grand_total: 941.64,
    items: [{
      product_id: product._id,
      product_name: 'Basic Slim Fit Shirt',
      selected_formats: ['dxf'],
      selected_sizes: ['S', 'M'],
      quantity: 1,
      printable_selected: true,
      selected_files: [],
      price: 798,
      total_price: 798
    }]
  });

  const grantDxf = await digitalDeliveryService.ensure(orderDxf._id);
  assert(grantDxf, 'DXF digital grant must be created for sizes S,M');
  assert(grantDxf.download_token, 'DXF download token must exist');
  assert.equal(grantDxf.download_assets.length, 2, 'Must have 2 assets: dxf/S and dxf/M');
  assert(grantDxf.download_assets.some(a => a.name.includes('DXF') && a.name.includes('S')), 'Must have DXF/S asset');
  assert(grantDxf.download_assets.some(a => a.name.includes('DXF') && a.name.includes('M')), 'Must have DXF/M asset');
  console.log('   PASS: DXF delivery for S,M: 2 assets created correctly.');

  // TEST 2: PDF format + sizes M,L delivery
  console.log('-> TEST 2: PDF format selected for sizes M and L...');
  const orderPdf = await Order.create({
    customer_id: customer._id,
    account_customer_id: customer._id,
    order_status: 'confirmed',
    payment_status: 'paid',
    payment_verified_at: new Date(),
    payment_reference: 'pay_test_pdf_ml',
    subtotal: 798,
    tax_rate: 18,
    tax_amount: 143.64,
    grand_total: 941.64,
    items: [{
      product_id: product._id,
      product_name: 'Basic Slim Fit Shirt',
      selected_formats: ['pdf'],
      selected_sizes: ['M', 'L'],
      quantity: 1,
      printable_selected: true,
      selected_files: [],
      price: 798,
      total_price: 798
    }]
  });

  const grantPdf = await digitalDeliveryService.ensure(orderPdf._id);
  assert(grantPdf, 'PDF digital grant must be created for sizes M,L');
  assert(grantPdf.download_token, 'PDF download token must exist');
  assert.equal(grantPdf.download_assets.length, 2, 'Must have 2 assets: pdf/M and pdf/L');
  assert(grantPdf.download_assets.some(a => a.name.includes('PDF') && a.name.includes('M')), 'Must have PDF/M asset');
  assert(grantPdf.download_assets.some(a => a.name.includes('PDF') && a.name.includes('L')), 'Must have PDF/L asset');
  console.log('   PASS: PDF delivery for M,L: 2 assets created correctly.');

  // TEST 3: Missing format file → returns null (Pending Availability, not fake link)
  console.log('-> TEST 3: Missing file (XL not uploaded) must stay Pending Availability...');
  const orderMissing = await Order.create({
    customer_id: customer._id,
    account_customer_id: customer._id,
    order_status: 'confirmed',
    payment_status: 'paid',
    payment_verified_at: new Date(),
    payment_reference: 'pay_test_missing_xl',
    subtotal: 399,
    tax_rate: 18,
    tax_amount: 71.82,
    grand_total: 470.82,
    items: [{
      product_id: product._id,
      product_name: 'Basic Slim Fit Shirt',
      selected_formats: ['dxf'],
      selected_sizes: ['XL'],  // XL not uploaded to digital_file_map
      quantity: 1,
      printable_selected: true,
      selected_files: [],
      price: 399,
      total_price: 399
    }]
  });

  const grantMissing = await digitalDeliveryService.ensure(orderMissing._id);
  assert.strictEqual(grantMissing, null, 'Missing file (XL) must return null — Pending Availability, no fake download link');
  console.log('   PASS: Missing file correctly returns null (Pending Availability).');

  // TEST 4: 24-hour token expiry
  console.log('-> TEST 4: 24-hour token expiry...');
  const diffHours = (new Date(grantDxf.download_expires_at).getTime() - Date.now()) / (1000 * 60 * 60);
  assert(diffHours >= 23.9 && diffHours <= 24.1, `Expiry must be ~24 hours, got ${diffHours}h`);
  console.log(`   PASS: Expiry correctly set to 24 hours (${diffHours.toFixed(2)}h).`);

  // TEST 5: Email delivery — digital_ready event
  console.log('-> TEST 5: Email notification for digital_ready event...');
  await notificationService.flush('product_order', orderDxf._id);

  const emailLog = await NotificationLog.findOne({
    reference_id: orderDxf._id,
    event: 'order_digital_ready',
    channel: 'email'
  }).lean();

  assert(emailLog, 'Email notification log must exist for digital_ready event');
  assert.strictEqual(emailLog.subject, 'Your Apparel Easy Patterns Files Are Ready', 'Subject must match');
  const body = emailLog.message;
  assert(body.includes('Rohan Sharma'), 'Email must include customer name');
  assert(body.includes(orderDxf._id.toString()), 'Email must include order number');
  assert(body.includes('Basic Slim Fit Shirt'), 'Email must include product name');
  assert(body.includes('S, M'), 'Email must include purchased sizes');
  assert(body.includes('DXF'), 'Email must include purchased format');
  assert(body.includes(`/downloads/${grantDxf.download_token}`), 'Email must include download link');
  assert(body.includes('24 hours only'), 'Email must include 24-hour notice');
  assert(body.includes('EXACT EXPIRY DATE & TIME:'), 'Email must include exact expiry timestamp');
  console.log('   PASS: Email body contains all required owner items: name, order#, product, sizes, format, link, expiry, 24h notice.');

  // TEST 6: Admin reissue generates a fresh 24h token
  console.log('-> TEST 6: Admin reissue generates fresh 24-hour token...');
  const reissued = await digitalDeliveryService.reissue(orderDxf._id);
  assert(reissued, 'Reissue must succeed');
  assert(reissued.download_token !== grantDxf.download_token, 'New token must differ from original');
  const reissueDiff = (new Date(reissued.download_expires_at).getTime() - Date.now()) / (1000 * 60 * 60);
  assert(reissueDiff >= 23.9 && reissueDiff <= 24.1, 'Reissued expiry must be fresh 24 hours');
  console.log('   PASS: Admin reissue provides fresh 24-hour window.');

  // TEST 7: Gallery and category image assets exist
  console.log('-> TEST 7: Verifying gallery and category image assets...');
  const galleryFront = path.join(__dirname, '../public/images/reference/01_Front_Pattern.png');
  const galleryBack = path.join(__dirname, '../public/images/reference/02_Back_Pattern.png');
  const menCollection = path.join(__dirname, '../public/images/collections/men-collection.jpg');
  const womenCollection = path.join(__dirname, '../public/images/collections/women-collection.jpg');
  const kidsCollection = path.join(__dirname, '../public/images/collections/kids-collection.jpg');
  assert(fs.existsSync(galleryFront), 'Front CAD pattern exists');
  assert(fs.statSync(galleryFront).size > 50000, 'Front CAD pattern is high-res (>50KB)');
  assert(fs.existsSync(galleryBack), 'Back CAD pattern exists');
  assert(fs.existsSync(menCollection), 'Men collection photo exists');
  assert(fs.existsSync(womenCollection), 'Women collection photo exists');
  assert(fs.existsSync(kidsCollection), 'Kids collection photo exists');
  console.log('   PASS: High-resolution CAD pattern gallery and category photos verified.');

  console.log('\n--- ALL SOFT COPY EMAIL & FORMAT+SIZE DELIVERY TESTS PASSED (7/7)! ---');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
