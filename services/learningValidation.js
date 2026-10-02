const { safeUrl } = require('../config/appearance');
function text(body, key, max = 200, required = false) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if ((required && !value) || value.length > max || /[<>\u0000-\u0008]/.test(value)) throw new Error(`Enter valid plain text for ${key.replaceAll('_', ' ')} (maximum ${max} characters).`);
  return value;
}
function choice(body, key, options) { const value = text(body, key); if (!options.includes(value)) throw new Error(`Select a valid ${key.replaceAll('_', ' ')}.`); return value; }
function number(body, key, max, integer = false) {
  const raw = text(body, key, 20, true), value = Number(raw);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) throw new Error(`Enter a valid ${key.replaceAll('_', ' ')}.`);
  return value;
}
function url(body, key) { const value = text(body,key,2048); if (value && !safeUrl(value)) throw new Error(`Enter an absolute http or https URL for ${key}.`); return value ? safeUrl(value) : ''; }
function date(body, key) { const value = text(body,key,10,true); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Enter a valid date.'); return value; }
function time(body, key) { const value = text(body,key,5,true); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Enter a valid time.'); return value; }
function contact(body, nameKey) {
  const data = { [nameKey]: text(body,nameKey,200,true), email: text(body,'email',254,true).toLowerCase(), whatsapp: text(body,'whatsapp',30,true) };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || !/^[+\d ()-]{7,30}$/.test(data.whatsapp) || data.whatsapp.replace(/\D/g,'').length < 7) throw new Error('Enter a valid email and WhatsApp number with country code.');
  return data;
}
function booking(body) {
  const data = { ...contact(body,'name'), preferred_date: date(body,'preferred_date'), preferred_time: time(body,'preferred_time'), mode: choice(body,'mode',['Online','Offline']), experience_level: text(body,'experience_level'), notes: text(body,'notes',5000) };
  if (new Date(`${data.preferred_date}T${data.preferred_time}:00+05:30`) <= new Date()) throw new Error('Select a future preferred date and time (India Standard Time).');
  return data;
}
function registration(body) { const data = contact(body,'full_name'); for(const key of ['country','city','profession','experience_level']) data[key] = text(body,key); return data; }
function content(body, kind) {
  const course = kind === 'courses';
  const data = { [course?'name':'title']: text(body,course?'name':'title',200,true), slug: text(body,'slug',200,true), description: text(body,'description',30000), price: body.price==='' || body.price==null ? null : number(body,'price',1000000), active: body.active === 'on' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) throw new Error('Use lowercase letters, numbers and single hyphens for the slug.');
  if (course) {
    Object.assign(data,{access_url:url(body,'access_url'),short_description:text(body,'short_description',1000),image_url:url(body,'image_url'),trainer:text(body,'trainer'),duration:text(body,'duration'),mode:choice(body,'mode',['Online','Offline','Online / Offline']),schedule_information:text(body,'schedule_information',5000)});
    data.modules = text(body,'modules',30000).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (data.modules.length > 100 || data.modules.some(s=>s.length>2000)) throw new Error('Use up to 100 modules, each at most 2000 characters.');
  } else {
    Object.assign(data,{banner_image:url(body,'banner_image'),speaker:text(body,'speaker'),duration_minutes:number(body,'duration_minutes',1440,true),mode:choice(body,'mode',['Online','Offline','Hybrid']),meeting_platform:choice(body,'meeting_platform',['Zoom','Google Meet','Microsoft Teams','Other']),meeting_link:url(body,'meeting_link'),max_seats:number(body,'max_seats',100000,true),registration_open:body.registration_open === 'on'});
    if (!data.duration_minutes) throw new Error('Duration must be at least one minute.');
    data.starts_at = new Date(`${date(body,'date')}T${time(body,'start_time')}:00+05:30`);
    if(data.registration_open && data.starts_at <= new Date()) throw new Error('Registration can only open for a future webinar.');
  }
  return data;
}
module.exports = { text, booking, registration, content, contact, date, time, number };
