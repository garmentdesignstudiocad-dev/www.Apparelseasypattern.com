const express = require('express');
const crypto = require('crypto');
const Lead = require('../models/mongo/Lead');
const Book = require('../models/mongo/Book');
const Article = require('../models/mongo/Article');
const Product = require('../models/mongo/Product');
const Course = require('../models/mongo/Course');
const Webinar = require('../models/mongo/Webinar');
const business = require('../config/business');
const access=require('../services/paidAccessService');
const validation = require('../services/businessValidation');
const router = express.Router();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const published = () => ({ published: true, published_at: { $lte: new Date() } });
router.use((req, res, next) => {
  req.session.leadToken ||= crypto.randomBytes(32).toString('hex');
  Object.assign(res.locals, { business, csrf: req.session.leadToken, values: {}, errors: [], interest: 'Other', source: req.path, corporate: false, sent: false });
  next();
});
function page(res, title, extra = {}) { return res.render('business/page', { title, description: title, mode: 'landing', items: [], ...extra }); }
router.get('/', asyncRoute(async (req, res) => {
  const seo=require('../services/seoService');
  const products=await Product.find(require('../services/patternOptions').publicFilter).sort({featured:-1,createdAt:-1}).limit(4).lean();
  res.render('home',{title:seo.homeTitle,seoTitle:seo.homeTitle,description:seo.homeDescription,products,catalogUnavailable:false});
}));
router.get('/courses/pattern-making', (req, res) => page(res, 'Become a Professional Pattern Maker', { mode: 'pattern', interest: 'Pattern Making Course', description: 'Pattern making course online: learn basic blocks, womenswear, menswear, fit correction, grading and CAD garment patterns.' }));
router.get('/garment-technology', (req, res) => page(res, 'Become a Garment Technology Professional', { mode: 'technology', interest: 'Garment Technology Training', description: 'Garment technology course and training in construction, fit engineering, tech packs, sampling and production quality.' }));
router.get('/consulting', asyncRoute(async(req,res)=>{
  const settings=await access.getSettings();if(!settings.consulting.active)return res.sendStatus(404);
  const Model=await access.getConsultingServices();
  page(res,'Garment Technology & Apparel Technical Consulting',{mode:'consulting',interest:'Consulting',services:await Model.find({active:true}).sort({name:1}).lean(),consultingQuote:item=>access.quote('consulting',item,settings)});
}));
router.get('/corporate-training', (req, res) => page(res, 'Corporate Garment Technology Training', { mode: 'corporate', interest: 'Corporate Training', corporate: true }));
router.get('/custom-block', (req, res) => {
  req.session.leadToken ||= crypto.randomBytes(32).toString('hex');
  res.locals.csrf = req.session.leadToken;
  res.render('custom-block', {
    title: 'Request a Custom Block | Apparel Easy Patterns',
    seoTitle: 'Request a Custom Block | Custom Patternmaking & CAD Fit Blocks',
    description: 'Request custom garment fit blocks, tech packs, fit correction, and production patterns engineered to your brand specifications.',
    values: {},
    errors: []
  });
});
router.get('/contact', (req, res) => page(res, 'Contact the Studio', { mode: 'contact', description: res.locals.siteSettings.contact_seo_description }));
router.get('/books',(req,res)=>res.render('books-coming-soon',{title:'Books - Coming Soon | Apparel Easy Patterns',description:'Practical apparel-industry learning materials. Get notified when books become available.'}));
router.get('/updates', asyncRoute(async (req, res) => page(res, 'Global Fashion & Garment Technology Updates', { mode: 'updates', items: await Article.find(published()).sort({ published_at: -1 }).lean(), description: 'Explore fashion industry updates, market trends and practical garment technology insights.' })));
for (const [route, Model, filter, mode] of [['books', Book, () => ({ active: true }), 'book'], ['updates', Article, published, 'article']]) {
  router.get(`/${route}/:slug`, asyncRoute(async (req, res) => {
    const item = await Model.findOne({ ...filter(), slug: req.params.slug }).lean();
    if (!item) return res.status(404).render('error', { title: 'Not Found', message: 'This content is unavailable.' });
    if(route==='books'){const settings=await access.getSettings();if(!settings.books.active)return res.sendStatus(404);res.locals.accessQuote=(kind,item)=>access.quote(kind,item,settings);}
    return page(res, item.title, { mode, item, seoTitle: item.seo_title || item.title, description: item.seo_description || item.summary || item.description?.slice(0, 200) || item.title });
  }));
}
router.post('/enquiries', asyncRoute(async (req, res, next) => {
  const wantsJson = Boolean(req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || (req.headers.accept && req.headers.accept.includes('application/json')));
  if (req.body._csrf !== req.session.leadToken) {
    if (wantsJson) return res.status(403).json({ success: false, error: 'Form expired. Reload the page and try again.' });
    return res.status(403).send('Form expired. Reload the page and try again.');
  }
  let data;
  try {
    if (req.body.category || req.body.service_type) {
      if (!req.body.category || !req.body.category.trim()) throw new Error('Please select a garment category.');
      if (!req.body.service_type || !req.body.service_type.trim()) throw new Error('Please select a service or request type.');
      const reqText = (req.body.requirements || req.body.message || '').trim();
      if (!reqText) throw new Error('Please enter your detailed requirements.');
      req.body.interest = req.body.interest || 'Fit Blocks';
      req.body.source = req.body.source || '/custom-block';
      req.body.message = `Garment Category: ${req.body.category.trim()}\nService / Request Type: ${req.body.service_type.trim()}\nDetailed Requirements:\n${reqText}`;
    }
    data = validation.lead(req.body);
    if(req.body.marker_services !== undefined) {
      if(!require('../services/commerceValidation').id(req.body.marker_product_id))throw new Error('Choose a valid product.');
      const product=await Product.findOne({_id:req.body.marker_product_id,...require('../services/patternOptions').publicFilter}).lean();
      if(!product || product.status==='coming_soon')throw new Error('Product unavailable.');
      data.message=require('../services/markerOptions').enquiry(product,req.body);
      data.interest='Fit Blocks';
      data.source='/product/'+product.slug+'#custom-marker';
    } if(!res.locals.visibleInterest(data.interest)) throw new Error('This service is currently unavailable. Please choose another interest.'); }
  catch (error) {
    if (wantsJson) return res.status(400).json({ success: false, error: error.message });
    if (req.body.source === '/custom-block' || req.body.category || req.body.service_type) {
      return res.status(400).render('custom-block', {
        title: 'Request a Custom Block | Apparel Easy Patterns',
        seoTitle: 'Request a Custom Block | Custom Patternmaking & CAD Fit Blocks',
        description: 'Request custom garment fit blocks, tech packs, fit correction, and production patterns engineered to your brand specifications.',
        values: req.body,
        errors: [error.message]
      });
    }
    return res.status(400).render('business/page', { title: 'Review Your Enquiry', description: 'Submit your requirement', mode: 'contact', items: [], values: req.body, errors: [error.message], corporate: req.body.interest === 'Corporate Training', interest: req.body.interest, source: typeof req.body.source === 'string' ? req.body.source : '' });
  }
  if (req.session.lastLeadAt && Date.now() - req.session.lastLeadAt < 30000) {
    if (wantsJson) return res.status(429).json({ success: false, error: 'Please wait 30 seconds before sending another enquiry.' });
    return res.status(429).send('Please wait 30 seconds before sending another enquiry.');
  }
  try {
    const signup_key = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const notification_jobs = data.interest === 'Online Classes' ? [{key:'created',event:'created',status:'Enquiry received'}] : [];
    await Lead.init();
    let inserted = false;
    try {
      const result = await Lead.updateOne({signup_key}, {$setOnInsert:{...data,signup_key,notification_jobs}}, {upsert:true,runValidators:true,setDefaultsOnInsert:true});
      inserted = result.upsertedCount === 1;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    // Online Classes keeps its existing notification workflow. New general enquiries use one owner email.
    if (inserted && data.interest !== 'Online Classes') {
      try {
        const lead = await Lead.findOne({signup_key}).lean();
        if (lead) await require('../services/leadNotifications').enqueue(lead,'general_enquiry');
      } catch (notificationError) {
        // The saved enquiry remains valid if its notification cannot be queued immediately.
        require('../services/safeLog').logError('General enquiry notification queue failed:',notificationError);
      }
    }
  } catch (error) {
    if (wantsJson) return res.status(500).json({ success: false, error: 'Internal server error while saving enquiry.' });
    return next(error);
  }
  req.session.lastLeadAt = Date.now();
  req.session.leadSent = true;
  if (wantsJson) {
    const isCustomBlock = req.body.source === '/custom-block' || req.body.category || req.body.service_type;
    return res.json({
      success: true,
      message: isCustomBlock
        ? 'Your custom block request has been submitted successfully. Our patternmaking studio team will review your requirements and reach out promptly.'
        : 'Custom marker specifications saved to studio enquiries. Our technical pattern team will review your repeat measurements.'
    });
  }
  res.redirect(303, '/enquiries/thank-you');
}));
router.get('/enquiries/thank-you', (req, res) => {
  if (!req.session.leadSent) return res.redirect('/contact');
  page(res, 'Thank You', { mode: 'thanks', sent: true });
});
module.exports = router;
