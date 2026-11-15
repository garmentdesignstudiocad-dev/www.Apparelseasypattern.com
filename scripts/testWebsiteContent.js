require('./isolatedTestGuard');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');
const content = require('../services/websiteContent');
test('static text supports single letters, Tamil and escaped input without touching code or values', () => {
  const filename = path.resolve('views/content-test.ejs');
  const source = '<h1>Hello</h1><p><%= product.name %></p><input value="Fixed"><script>const x="Hello";</script><style>.a{color:red}</style>';
  const template = content.transform(source, filename);
  const key = content.catalog().find(entry => entry.page === 'content-test.ejs').key;
  for (const value of ['H', 'தமிழ்', '<img src=x onerror=alert(1)>', '']) {
    const html = ejs.render(template, { product: { name: 'Product untouched' }, contentText: content.textRenderer({ [key]: value }) });
    assert(html.includes('<h1>' + ejs.escapeXML(value) + '</h1>'));
    assert(html.includes('value="Fixed"'));
    assert(html.includes('const x="Hello";'));
    assert(html.includes('Product untouched'));
  }
  assert.equal(content.transform(source, path.resolve('views/checkout.ejs')), source);
});
test('all public templates compile with content editing', () => {
  for (const page of new Set(content.catalog().map(entry => entry.page))) {
    const filename = path.resolve('views', page);
    if (fs.existsSync(filename)) ejs.compile(content.transform(fs.readFileSync(filename, 'utf8'), filename), { filename });
  }
});
test('direct HTTPS media validation, gallery order, public rendering and removals', () => {
  const { collectMediaUpdate, publicGarmentMedia, mediaLink } = require('../services/productMediaIntegration');
  for (const value of ['http://example.com/a.jpg', 'javascript:alert(1)', 'https://user:pass@example.com/a.jpg', 'https://example.com/a.svg', 'https://example.com/a.pdf']) assert.throws(() => mediaLink(value));
  const media = collectMediaUpdate({}, { main_image_link: 'https://example.com/main.jpg', gallery_image_links: 'https://example.com/one.png\nhttps://example.com/two.webp', video_link: 'https://example.com/demo.mp4' });
  assert.deepEqual(publicGarmentMedia(media).images, media.images);
  assert.equal(media.video_url, 'https://example.com/demo.mp4');
  const reordered = collectMediaUpdate(media, { gallery_order: '1,0' });
  assert.deepEqual(reordered.images, [media.images[0], media.images[2], media.images[1]]);
  assert.throws(() => collectMediaUpdate(media, { gallery_order: '0,0' }));
  assert.equal(collectMediaUpdate(media, { remove_video: 'on' }).video_url, '');
});
