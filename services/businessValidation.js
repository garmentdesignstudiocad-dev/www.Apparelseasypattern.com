const { interests, categories } = require('../config/business');
const { safeUrl } = require('../config/appearance');
function text(body, key, max = 300, required = false) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if ((required && !value) || value.length > max || /[<>\u0000]/.test(value)) throw new Error(`Enter valid plain text for ${key.replaceAll('_', ' ')} (maximum ${max} characters).`);
  return value;
}
function lead(body) {
  const data = {};
  for (const key of ['name', 'email', 'whatsapp', 'country', 'location', 'profession', 'experience', 'preferred_timing', 'source', 'company_name']) data[key] = text(body, key, 300, ['name', 'email', 'whatsapp'].includes(key));
  data.email = data.email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('Enter a valid email address.');
  if (!/^[+\d ()-]{7,30}$/.test(data.whatsapp) || data.whatsapp.replace(/\D/g, '').length < 7) throw new Error('Enter a valid WhatsApp number with country code.');
  data.interest = text(body, 'interest');
  if (!interests.includes(data.interest)) throw new Error('Select a valid interest.');
  data.message = text(body, 'message', 5000);
  if (data.interest === 'Corporate Training') {
    if (!data.company_name || !data.location || !data.message) throw new Error('Enter company name, location and training requirement.');
    data.employee_count = Number(body.employee_count);
    if (!Number.isInteger(data.employee_count) || data.employee_count < 1 || data.employee_count > 1000000) throw new Error('Enter a valid number of employees.');
    const date = text(body, 'preferred_date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Enter a valid preferred date.');
    data.preferred_date = new Date(date);
  }
  return data;
}
function content(body, kind) {
  const data = { title: text(body, 'title', 200, true), slug: text(body, 'slug', 200, true) };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) throw new Error('Use lowercase letters, numbers and single hyphens for the slug.');
  const fields = kind === 'books' ? { author: 200, description: 30000, who_should_read: 5000 } : { summary: 1000, content: 50000, category: 100, seo_title: 200, seo_description: 320 };
  for (const [key, max] of Object.entries(fields)) data[key] = text(body, key, max, key === 'content');
  for (const key of kind === 'books' ? ['cover_url', 'amazon_url', 'ebook_url'] : ['image_url']) {
    const value = text(body, key, 2048);
    if (value && !safeUrl(value)) throw new Error(`Enter an absolute http or https URL for ${key}.`);
    data[key] = value ? safeUrl(value) : '';
  }
  const list = kind === 'books' ? 'topics' : 'keywords';
  data[list] = text(body, list, 2000).split(',').map(s => s.trim()).filter(Boolean);
  if (kind === 'books') {
    data.active = body.active === 'on';
    data.purchase_type = body.purchase_type || 'external';
    if(!['external','direct','free'].includes(data.purchase_type)) throw new Error('Select a valid purchase type.');
    data.price = body.price==null || body.price==='' ? null : require('./learningValidation').number(body,'price',1000000);
    if(data.purchase_type==='external' && !data.amazon_url) throw new Error('Enter the external Amazon purchase URL.');
    data.pages = body.pages ? Number(body.pages) : undefined;
    if (data.pages !== undefined && (!Number.isInteger(data.pages) || data.pages < 1 || data.pages > 100000)) throw new Error('Enter a valid page count.');
  } else {
    if (!categories.includes(data.category)) throw new Error('Select a valid article category.');
    data.published = body.published === 'on';
  }
  return data;
}
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
module.exports = { lead, content, csvCell, text };
