require('./isolatedTestGuard');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const templatePath = path.join(__dirname, '../views/product.ejs');
const templateStr = fs.readFileSync(templatePath, 'utf8');

const { collectMediaUpdate } = require('../services/productMediaIntegration');

test('Product EJS compiles cleanly', () => {
  assert.doesNotThrow(() => {
    ejs.compile(templateStr);
  });
});

test('collectMediaUpdate handles how_to_measure_pdf uploads and links', () => {
  const existing = {
    images: ['https://example.com/front.jpg', 'https://example.com/back.jpg'],
    size_chart_pdf: '/uploads/products/chart.pdf',
    size_chart_pdf_name: 'Chart.pdf',
    how_to_measure_pdf: '/uploads/products/old-measure.pdf',
    how_to_measure_pdf_name: 'OldMeasure.pdf'
  };

  // 1. Upload replacement
  const replacementFile = {
    filename: '12345678-1234-1234-1234-123456789abc.pdf',
    originalname: 'New-Measure-Guide.pdf'
  };
  const updated = collectMediaUpdate(existing, {}, {
    how_to_measure_pdf_file: [replacementFile]
  });
  assert.equal(updated.how_to_measure_pdf, '/uploads/products/' + replacementFile.filename);
  assert.equal(updated.how_to_measure_pdf_name, 'New-Measure-Guide.pdf');
  assert.equal(updated.size_chart_pdf, existing.size_chart_pdf);

  // 2. Removal
  const removed = collectMediaUpdate(existing, { remove_how_to_measure_pdf: 'on' });
  assert.equal(removed.how_to_measure_pdf, '');
  assert.equal(removed.how_to_measure_pdf_name, '');

  // 3. Link
  const linked = collectMediaUpdate({}, { how_to_measure_pdf_link: 'https://example.com/guide.pdf' });
  assert.equal(linked.how_to_measure_pdf, 'https://example.com/guide.pdf');
  assert.equal(linked.how_to_measure_pdf_name, 'How to measure guide');
});

test('Customer product page renders Measurement Size Chart section', () => {
  const product = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Basic Slim Fit Shirt',
    base_price: 399,
    available_sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    size_chart_visible: true,
    size_chart_pdf: '/uploads/products/size-chart-test.pdf',
    size_chart_pdf_name: 'Shirt-Specs.pdf',
    how_to_measure_pdf: '/uploads/products/how-to-measure.pdf',
    how_to_measure_pdf_name: 'Measure-Guide.pdf',
    images: ['/uploads/products/front.jpg', '/uploads/products/back.jpg'],
    mini_marker_price: 150
  };

  const html = ejs.render(templateStr, {
    product,
    siteSettings: {},
    site: {},
    themeVariables: {},
    headerContact: {},
    user: null,
    cartCount: 0,
    canVisit: () => true,
    visibleLinks: links => links,
    featureEnabled: () => false,
    seoTitle: 'Basic Slim Fit Shirt',
    title: 'Basic Slim Fit Shirt',
    description: 'Shirt description',
    canonicalUrl: '',
    ogImage: '',
    productStructuredData: null,
    jsonLd: () => '{}',
    configuredGstRate: 18,
    files: [
      { _id: '507f1f77bcf86cd799439099', upload_slot: 'marker_pdf', file_name: 'shirt_marker.pdf', file_type: 'pdf', file_price: 0 }
    ],
    adminPreviewProduct: undefined
  }, {
    filename: templatePath,
    root: path.join(__dirname, '..')
  });

  // 1. Check Measurement Size Chart section exists and is clearly visible
  assert.ok(html.includes('id="measurement-size-chart-section"'), 'Measurement Size Chart section must be present');
  assert.ok(html.includes('Measurement Size Chart'), 'Heading must be Measurement Size Chart');
  assert.ok(html.includes('Standard Sizing Reference'), 'Must clarify standard sizing reference');
  assert.ok(html.includes('Distinct from the optional downloadable <strong>Basic Measurement Chart</strong>'), 'Must be distinct from Basic Measurement Chart');

  // 2. Check Size Chart PDF controls
  assert.ok(html.includes('href="/uploads/products/size-chart-test.pdf"'), 'Size Chart PDF link present');
  assert.ok(html.includes('Shirt-Specs.pdf'), 'Size Chart PDF name present');
  assert.ok(html.includes('View PDF'), 'View PDF button present');
  assert.ok(html.includes('Download PDF'), 'Download PDF button present');

  // 3. Check "How to Measure" PDF viewing option
  assert.ok(html.includes('How to Measure'), 'How to Measure subcard present');
  assert.ok(html.includes('href="/uploads/products/how-to-measure.pdf"'), 'How to Measure PDF link present');
  assert.ok(html.includes('Measure-Guide.pdf'), 'How to Measure PDF name present');

  // 4. Check Front & Back view photo badges and full-screen lightbox
  assert.ok(html.includes('id="viewBadgeBar"'), 'Front and Back view badge bar present');
  assert.ok(html.includes('Front View'), 'Front view badge present');
  assert.ok(html.includes('Back View'), 'Back view badge present');
  assert.ok(html.includes('id="imageLightboxModal"'), 'Lightbox modal present');
  assert.ok(html.includes('id="prevLightboxBtn"'), 'Previous image button in lightbox present');
  assert.ok(html.includes('id="nextLightboxBtn"'), 'Next image button in lightbox present');
  assert.ok(html.includes('id="lightboxThumbsBar"'), 'Thumbnail strip in lightbox present');

  // 5. Check Mini Marker option displays configured price
  assert.ok(html.includes('id="miniMarkerOption"'), 'Mini marker checkbox present');
  assert.ok(html.includes('data-price="150"'), 'Mini marker configured price 150 present on dataset');
  assert.ok(html.includes('INR 150.00'), 'Mini marker price INR 150.00 displayed to customer');

  // 6. Security: Private pattern files must never be exposed as public preview links
  assert.ok(!html.includes('/private/patterns/'), 'Private pattern directory must not appear in public HTML');
  assert.ok(!html.includes('shirt_marker.pdf" target="_blank"'), 'Private CAD marker binary must not have public preview link');
});
