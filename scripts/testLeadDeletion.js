// Uses the real router/auth middleware with an in-memory Lead stub. No DB or providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const express = require('express');
const ejs = require('ejs');
const root = path.join(__dirname, '..');
const id = '0123456789abcdef01234567';
const otherId = '1123456789abcdef01234567';
const business = { statuses: ['New', 'Contacted'], interests: ['Training'] };

test('admin-only, CSRF-protected single-enquiry deletion', async () => {
  const rows = new Map([[id, { _id: id }], [otherId, { _id: otherId }]]);
  const deletes = [];
  const Lead = {
    async findByIdAndDelete(value) {
      deletes.push(value);
      if (value === 'eeeeeeeeeeeeeeeeeeeeeeee') throw new Error('Mock storage failure');
      const row = rows.get(value);
      rows.delete(value);
      return row;
    },
    async findByIdAndUpdate(value, update) {
      const row = rows.get(value);
      if (row) Object.assign(row, update.$set);
      return row;
    }
  };
  const dependencies = {
    express, crypto: require('node:crypto'), mongoose: { isValidObjectId: value => /^[a-f\d]{24}$/i.test(value) },
    multer: require('multer'), 'node:fs/promises': require('node:fs/promises'), 'node:path': path,
    '../models/mongo/Lead': Lead, '../models/mongo/Book': {}, '../models/mongo/Article': {},
    '../config/business': business, '../services/businessValidation': {},
    '../middleware/adminAuth': require('../middleware/adminAuth')
  };
  const context = { module: { exports: {} }, require(name) {
    if (!Object.hasOwn(dependencies, name)) throw new Error('Blocked dependency: ' + name);
    return dependencies[name];
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'routes/adminBusiness.js'), 'utf8'), context);
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  // Test-only session fixture; no login, credentials or production server loaded.
  app.use((req, res, next) => { req.session = { isAdmin: req.get('x-test-admin') === 'yes', businessToken: 'fixture-token' }; next(); });
  app.use('/admin', context.module.exports);
  app.use((err, req, res, next) => res.status(500).send('Test error handler'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = (route, { admin = true, csrf = 'fixture-token', method = 'POST', extra = {} } = {}) => fetch(
    `http://127.0.0.1:${server.address().port}/admin/leads/${route}`,
    { method, redirect: 'manual', headers: { 'x-test-admin': admin ? 'yes' : 'no', 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(method === 'POST' ? { body: new URLSearchParams({ _csrf: csrf, ...extra }) } : {}) }
  );
  try {
    const denied = await request(id + '/delete', { admin: false });
    assert.equal(denied.status, 302); assert.equal(denied.headers.get('location'), '/admin/login');
    for (const csrf of ['', 'wrong']) assert.equal((await request(id + '/delete', { csrf })).status, 403);
    assert.equal((await request('invalid/delete')).status, 404);
    assert.equal((await request(id + '/delete', { method: 'GET' })).status, 404);
    assert.equal(deletes.length, 0);
    assert.equal((await request(otherId + '/status', { extra: { status: 'Contacted' } })).status, 303);
    assert.equal(rows.get(otherId).status, 'Contacted');
    const result = await request(id + '/delete', { extra: { id: otherId } });
    assert.equal(result.status, 303); assert.equal(result.headers.get('location'), '/admin/leads');
    assert.deepEqual(deletes, [id]); assert.equal(rows.has(id), false); assert.equal(rows.has(otherId), true);
    assert.equal((await request(id + '/delete')).status, 404);
    assert.equal((await request('eeeeeeeeeeeeeeeeeeeeeeee/delete')).status, 500);
    assert.equal(rows.has(otherId), true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('list and detail render delete forms with confirmation and CSRF', () => {
  const filename = path.join(root, 'views/admin/business-leads.ejs');
  const template = fs.readFileSync(filename, 'utf8');
  const lead = { _id: id, name: '<script>unsafe</script>', status: 'New', createdAt: new Date(), email_status: 'queued' };
  for (const item of [null, lead]) {
    const html = ejs.render(template, { title: 'Enquiries', csrf: 'fixture-token', business, adminNavigation: {}, item, items: [lead], total: 1, page: 1, query: {} },
      { filename });
    const form = html.match(/<form[^>]*action="\/admin\/leads\/[^"]+\/delete"[^>]*>[\s\S]*?<\/form>/)[0];
    assert.ok(form.includes('method="post"'));
    assert.ok(form.includes(`action="/admin/leads/${id}/delete"`));
    assert.ok(form.includes('name="_csrf" value="fixture-token"'));
    assert.ok(form.includes('Delete Enquiry'));
    const handler = form.match(/onsubmit="([^"]+)"/)[1];
    for (const answer of [false, true]) {
      assert.equal(vm.runInNewContext(`(function(){${handler}})()`, { confirm: message => {
        assert.match(message, /Permanently delete this enquiry/); return answer;
      } }), answer);
    }
    assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
    assert.ok(html.includes(item ? 'Save Status' : 'Export matching leads as CSV'));
  }
});
