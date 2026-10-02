const assert = require('node:assert/strict');
const { defaults, helpers } = require('../config/features');
module.exports = async function ({ models, request, token, book }) {
  const allOn = Object.fromEntries(Object.keys(defaults).map(key => [key, 'on']));
  assert.equal((await request('/admin/settings/features')).status, 302);
  let page = await request('/admin/settings/features', null, 'admin');
  assert.equal(page.status, 200);
  assert.equal((await request('/admin/settings/features', { ...allOn, _csrf: 'bad' }, 'admin')).status, 403);
  async function save(off = []) {
    page = await request('/admin/settings/features', null, 'admin');
    const body = { ...allOn, _csrf: token(page.html) };
    off.forEach(key => delete body[key + '_enabled']);
    const result = await request('/admin/settings/features', body, 'admin');
    assert.equal(result.status, 303, result.html);
    const stored = await models.FeatureSettings.findById('default').lean();
    for (const key of Object.keys(defaults)) assert.equal(stored[key], !off.includes(key.replace(/_enabled$/, '')));
  }
  const cases = [
    ['books', '/books', '/books/digital-book', '/admin/books', models.Book],
    ['webinars', '/webinars', '/webinars/access-webinar', '/admin/webinars', models.Webinar],
    ['consulting', '/consulting', '/consulting/fit-consultation/access', '/admin/consulting', models.ConsultingService],
    ['patterns', '/products', '/product/feature-pattern', '/admin/products', models.Product],
    ['online_classes', '/classes', '/classes/feature-class', '/admin/classes', models.ClassSession],
    ['courses', '/courses', '/courses/access-course', '/admin/courses', models.Course],
    ['updates', '/updates', '/updates/feature-test', '/admin/articles', models.Article],
  ];
  await models.Article.create({ title: 'Feature Test Article', slug: 'feature-test', category: require('../config/business').categories[0], published: true, published_at: new Date(), content: 'Visibility test content' });
  await models.Product.create({name:'Feature Pattern',slug:'feature-pattern',active:true});
  await models.ClassSession.create({title:'Feature Class',slug:'feature-class',type:'Online Class',published:true,status:'Upcoming',starts_at:new Date(Date.now()+86400000),ends_at:new Date(Date.now()+90000000),promotional_title:'Book promotion',promotional_url:'/books/digital-book'});
  for (const [key, index, detail, admin, Model] of cases) {
    const before = JSON.stringify(await Model.find().sort({ _id: 1 }).lean());
    await save([key]);
    for (const path of [index, detail, index.toUpperCase()]) assert.equal((await request(path)).status, 404, path);
    const home = await request('/'); assert.equal(home.status, 200);
    assert.ok(!home.html.includes('href="' + index), key + ' links hidden');
    for(const path of ['/contact','/about','/login',...(key==='online_classes'?[]:['/classes/feature-class'])]){
      const response=await request(path); assert.equal(response.status,200,path);
      const policy=helpers({...defaults,[key+'_enabled']:false});
      for(const match of response.html.matchAll(/href="([^"]+)"/g)) assert.ok(policy.canVisit(match[1]),path+' leaked '+match[1]);
    }
    assert.equal((await request(admin, null, 'admin')).status, 200, admin);
    for (const path of ['/products', '/classes'].filter(path => helpers({...defaults,[key+'_enabled']:false}).canVisit(path))) assert.equal((await request(path)).status, 200, path);
    assert.equal(JSON.stringify(await Model.find().sort({ _id: 1 }).lean()), before, 'No content mutation');
    await save();
    for (const path of [index, detail]) assert.equal((await request(path)).status, 200, path);
    assert.ok((await request('/')).html.includes('href="' + index));
  }
  await save(['paid_access']);
  for (const path of ['/books/digital-book/access', '/consulting/fit-consultation/access', '/courses/access-course/book', '/webinars/access-webinar/register', book.url + '/order']) {
    assert.equal((await request(path, { _csrf: 'ignored' })).status, 404, path);
  }
  assert.equal((await request(book.url, null, book.who)).status, 200, 'Existing paid confirmation retained');
  assert.ok(!(await request('/courses/access-course')).html.includes('action="/courses/access-course/book"'));
  assert.ok(!(await request('/books/digital-book')).html.includes('href="/books/digital-book/access"'));
  await save(['leads']);
  const contact = await request('/contact'); assert.equal(contact.status, 200);
  assert.ok(!contact.html.includes('action="/enquiries"'));
  assert.equal((await request('/enquiries', {})).status, 404);
  await save(['patterns', 'online_classes', 'courses', 'homepage_services', 'homepage_catalogs', 'linkedin']);
  for (const path of ['/products', '/patterns', '/product/example', '/cart', '/checkout', '/classes', '/my-courses', '/courses', '/garment-technology']) assert.equal((await request(path)).status, 404, path);
  assert.equal((await request('/admin/products', null, 'admin')).status, 200);
  const home = await request('/'); assert.equal(home.status, 200);
  assert.ok(!home.html.includes('<h2>Our Services</h2>'));
  assert.ok(!home.html.includes('<h2>New Patterns</h2>'));
  await save();
  // The same database read observes external/process saves without cache invalidation.
  await models.FeatureSettings.updateOne({ _id: 'default' }, { $set: { books_enabled: false } });
  assert.equal((await request('/books')).status, 404);
  await save();
  const hidden = helpers({ ...defaults, books_enabled: false });
  assert.equal(hidden.canVisit('/%62ooks/digital-book'), false);
  assert.equal(hidden.canVisit('/BOOKS'), false);
  assert.equal(hidden.canVisit('/admin/books'), true);
  console.log('PASS: Feature Visibility MongoDB saves, OFF/ON public routes/navigation, admin retained, records unchanged, patterns/classes available, paid-access/lead guards, homepage switches, immediate uncached reads and CSRF.');
};
