const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const Lead = require('../models/mongo/Lead');
const Book = require('../models/mongo/Book');
const Article = require('../models/mongo/Article');
const business = require('../config/business');
const validation = require('../services/businessValidation');
const router = express.Router();
// Let the existing admin router handle login, commerce and settings unchanged.
router.use((req, res, next) => /^\/(leads|books|articles)(\/|$)/.test(req.path) ? next() : next('router'));
router.use(require('../middleware/adminAuth'));
const bookFileUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024,files:1,fields:30,parts:31}});
router.use((req,res,next)=>{
  if(req.method!=='POST' || !/^\/books(?:\/new|\/[a-f\d]{24}\/edit)$/.test(req.path))return next();
  bookFileUpload.single('ebook_file')(req,res,error=>{
    if(!error)return next();
    return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).send(error.code==='LIMIT_FILE_SIZE'?'E-book PDF or ZIP exceeds the 50 MB limit.':'Invalid e-book upload. Select one PDF or ZIP file and try again.');
  });
});
router.use((req, res, next) => {
  req.session.businessToken ||= crypto.randomBytes(32).toString('hex');
  res.locals.csrf = req.session.businessToken;
  res.locals.business = business;
  if (req.method === 'POST' && req.body._csrf !== req.session.businessToken) return res.status(403).send('Form expired. Reload the page and try again.');
  next();
});
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function leadFilter(query) {
  const filter = {};
  if (business.statuses.includes(query.status)) filter.status = query.status;
  if (business.interests.includes(query.interest)) filter.interest = query.interest;
  if(typeof query.interested_course==='string' && query.interested_course.trim())filter.interested_course=query.interested_course.trim().slice(0,300);
  if (typeof query.q === 'string' && query.q.trim()) {
    const search = query.q.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['name', 'email', 'whatsapp','interested_course'].map(key => ({ [key]: { $regex: search, $options: 'i' } }));
  }
  return filter;
}
router.get('/leads', wrap(async (req, res) => {
  const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
  const filter = leadFilter(req.query);
  const [items, total] = await Promise.all([Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean(), Lead.countDocuments(filter)]);
  await require('../services/leadNotifications').statuses(items);
  res.render('admin/business-leads', { title: 'Leads / Enquiries', items, total, page, query: req.query, item: null });
}));
router.get('/leads/export.csv', wrap(async (req, res) => {
  const fields = ['name', 'email', 'whatsapp', 'country', 'location', 'profession', 'interest', 'interested_course', 'experience', 'preferred_timing', 'studying', 'current_role', 'consent_at', 'consent_text', 'message', 'source', 'status', 'company_name', 'employee_count', 'preferred_date', 'createdAt'];
  res.type('text/csv').attachment('leads.csv');
  res.write('\uFEFF' + fields.map(validation.csvCell).join(',') + '\r\n');
  for await (const item of Lead.find(leadFilter(req.query)).sort({ createdAt: -1 }).lean().cursor()) {
    res.write(fields.map(key => validation.csvCell(item[key] instanceof Date ? item[key].toISOString() : item[key])).join(',') + '\r\n');
  }
  res.end();
}));
router.param('id', (req, res, next, id) => /^[a-f\d]{24}$/i.test(id) && mongoose.isValidObjectId(id) ? next() : res.status(404).send('Not found.'));
router.get('/leads/:id', wrap(async (req, res) => {
  const item = await Lead.findById(req.params.id).lean();
  if (!item) return res.status(404).send('Lead not found.');
  await require('../services/leadNotifications').statuses([item]);
  res.render('admin/business-leads', { title: 'Enquiry Details', item });
}));
router.post('/leads/:id/delete', wrap(async (req, res) => {
  const result = await Lead.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).send('Lead not found.');
  res.redirect(303, '/admin/leads');
}));
router.post('/leads/:id/status', wrap(async (req, res) => {
  if (!business.statuses.includes(req.body.status)) return res.status(400).send('Invalid lead status.');
  const result = await Lead.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { runValidators: true });
  if (!result) return res.status(404).send('Lead not found.');
  res.redirect(303, `/admin/leads/${req.params.id}`);
}));
for (const [kind, Model] of [['books', Book], ['articles', Article]]) {
  const title = kind === 'books' ? 'Books' : 'Articles / Updates';
  const form = (res, item, errors = []) => res.render('admin/business-content', { title, kind, item, errors, items: null });
  router.get(`/${kind}`, wrap(async (req, res) => res.render('admin/business-content', { title, kind, items: await Model.find().sort({ createdAt: -1 }).lean(), item: null, errors: [] })));
  router.get(`/${kind}/new`, (req, res) => form(res, {}));
  router.get(`/${kind}/:id/edit`, wrap(async (req, res) => {
    const item = await Model.findById(req.params.id).select(kind==='books'?'+ebook_url +ebook_file +ebook_file_name':'').lean();
    if (!item) return res.status(404).send('Not found.');
    if(kind==='books'){
      item.hasEbookFile=Boolean(item.ebook_file);
      item.ebookFileName=item.ebook_file_name || '';
      delete item.ebook_file;
      delete item.ebook_file_name;
    }
    form(res, item);
  }));
  router.post([`/${kind}/new`, `/${kind}/:id/edit`], wrap(async (req, res, next) => {
    let item = req.params.id ? await Model.findById(req.params.id).select(kind==='books'?'+ebook_file +ebook_file_name':'') : new Model();
    if (!item) return res.status(404).send('Not found.');
    let data;
    try { data = validation.content(req.body, kind); }
    catch (error) { return form(res.status(400), { ...req.body, _id: req.params.id, active: req.body.active === 'on', published: req.body.published === 'on' }, [error.message]); }
    if (kind === 'articles' && data.published && !item.published_at) data.published_at = new Date();
    const oldEbookFile=kind==='books'?item.ebook_file:'';
    let pendingPath='',newEbookFile='';
    try {
      if(kind==='books' && req.file){
        const ext=require('../services/digitalUploadValidation').validate(req.file.originalname,req.file.buffer,'book',req.file.mimetype,50*1024*1024);
        const delivery=require('../services/digitalDeliveryService');
        await fs.mkdir(delivery.root(),{recursive:true});
        const privateRoot=await delivery.privateRoot();
        newEbookFile=crypto.randomBytes(24).toString('hex')+ext;
        pendingPath=path.join(privateRoot,newEbookFile);
        await fs.writeFile(pendingPath,req.file.buffer,{flag:'wx',mode:0o600});
      }
      Object.assign(item, data);
      if(kind==='books'){
        if(req.body.remove_ebook_file==='on' && !newEbookFile){
          item.ebook_file=undefined;
          item.ebook_file_name=undefined;
        }
        if(newEbookFile){
          item.ebook_file=newEbookFile;
          item.ebook_file_name=req.file.originalname;
          item.ebook_url='';
        }
      }
      await item.save();
    }catch(error){
      if(pendingPath)await fs.unlink(pendingPath).catch(cleanupError=>require('../services/safeLog').logError('E-book upload cleanup failed:',cleanupError));
      if(error.status===400)return form(res.status(400),{...data,_id:req.params.id,active:req.body.active==='on'},[error.message]);
      if(error.code===11000 || error.name==='ValidationError')return form(res.status(400),{...data,_id:req.params.id},[error.code===11000?'This slug is already in use. Choose another.':'Check the supplied values.']);
      return next(error);
    }
    if(kind==='books' && oldEbookFile && oldEbookFile!==item.ebook_file){
      const retained=await require('../models/mongo/BookPurchase').exists({ebook_file:oldEbookFile});
      if(!retained){
        const oldPath=await require('../services/digitalDeliveryService').filePath(oldEbookFile);
        if(oldPath)await fs.unlink(oldPath).catch(error=>require('../services/safeLog').logError('Replaced e-book cleanup failed:',error));
      }
    }
    res.redirect(303, `/admin/${kind}`);
  }));
}
module.exports = router;
