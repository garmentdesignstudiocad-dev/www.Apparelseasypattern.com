const express=require('express');const adminAuth=require('../middleware/adminAuth');const PricingSettings=require('../models/mongo/PricingSettings');const TaxSettings=require('../models/mongo/TaxSettings');const DeliverySettings=require('../models/mongo/DeliverySettings');const SiteSettings=require('../models/mongo/SiteSettings');const Coupon=require('../models/mongo/Coupon');const Pincode=require('../models/mongo/Pincode');const {clearSiteSettingsCache}=require('../services/siteSettingsService');const router=express.Router();router.use(adminAuth);router.use(require('../middleware/adminInputValidation'));router.param('id',(req,res,next,id)=>/^[a-f\d]{24}$/i.test(id)?next():res.status(404).send('Record not found.')); const text=v=>String(v||'').trim();const number=v=>Math.max(0,Number(v)||0);const checked=v=>v==='on'||v===true;const safeUrl=v=>{const value=text(v);if(!value)return '';try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.toString():''}catch{return ''}};
router.get('/pricing',async(req,res,next)=>{try{res.render('admin/settings_form',{title:'Pricing Settings',section:'pricing',settings:await PricingSettings.findOne({key:'default'}).lean()||{},message:req.query.message||''})}catch(e){next(e)}});router.post('/pricing',async(req,res,next)=>{try{await PricingSettings.findOneAndUpdate({key:'default'},{$set:{soft_copy_price:number(req.body.soft_copy_price),additional_size_price:number(req.body.additional_size_price),physical_pattern_price:number(req.body.physical_pattern_price),trial_sample_price:number(req.body.trial_sample_price)}},{upsert:true,runValidators:true});res.redirect('/admin/settings/pricing?message=Pricing settings saved')}catch(e){next(e)}});
router.get('/gst',async(req,res,next)=>{try{res.render('admin/settings_form',{title:'GST Settings',section:'gst',settings:await TaxSettings.findOne({key:'default'}).lean()||{enabled:true,percentage:18,label:'GST'},message:req.query.message||''})}catch(e){next(e)}});router.post('/gst',async(req,res,next)=>{try{await TaxSettings.findOneAndUpdate({key:'default'},{$set:{enabled:checked(req.body.enabled),percentage:Number(req.body.percentage),label:text(req.body.label)||'GST'}},{upsert:true,runValidators:true});res.redirect('/admin/settings/gst?message=GST settings saved')}catch(e){next(e)}});
router.use('/delivery',require('../middleware/learningForms'));
router.get('/delivery',async(req,res,next)=>{try{
 await require('../services/deliveryService').configureRegions();
 const regions=await require('../models/mongo/DeliveryZone').find({_id:{$in:['south','north']}}).sort({name:1}).lean();
 const partners=await require('../models/mongo/Courier').find().sort({name:1}).lean();
 const normalize=require('../services/deliveryService').normalize;
 const unassignedStates=require('../config/indiaStates').filter(state=>!regions.some(zone=>(zone.states || []).some(value=>normalize(value)===normalize(state))));
 res.render('admin/delivery_settings',{title:'Delivery Zones and Dispatch Hubs',regions,partners,unassignedStates,message:req.query.message || ''});
}catch(e){next(e)}});
router.post('/delivery',async(req,res,next)=>{try{
 const id=text(req.body.region_id),dispatch_location=text(req.body.dispatch_location);
 const normalize=require('../services/deliveryService').normalize;
 const states=[...new Set(text(req.body.states).split(/[,\n]+/).map(normalize).filter(Boolean))];
 const partner_ids=(Array.isArray(req.body.partner_ids)?req.body.partner_ids:[req.body.partner_ids]).filter(Boolean);
 const Zone=require('../models/mongo/DeliveryZone');
 if(!['south','north'].includes(id) || !dispatch_location || dispatch_location.length>200 || states.some(state=>state.length>100) || partner_ids.some(id=>typeof id!=='string') || await require('../models/mongo/Courier').countDocuments({_id:{$in:partner_ids}})!==new Set(partner_ids).size)return res.status(400).send('Choose a zone, dispatch hub, states and configured partners.');
 if(await Zone.exists({_id:{$ne:id},states:{$in:states}}))return res.status(400).send('A state is already assigned to the other zone. Remove it there first.');
 await Zone.findOneAndUpdate({_id:id},{$set:{name:id==='south'?'South':'North',dispatch_location,states,partner_ids,active:checked(req.body.active)}},{upsert:true,runValidators:true});res.redirect('/admin/settings/delivery');
}catch(e){next(e)}});
router.get('/coupons',async(req,res,next)=>{try{res.render('admin/coupons',{title:'Coupons & Discounts',coupons:await Coupon.find().sort({createdAt:-1}).lean(),message:req.query.message||''})}catch(e){next(e)}});router.post('/coupons',async(req,res,next)=>{try{await Coupon.create({code:text(req.body.code).toUpperCase(),discount_type:text(req.body.discount_type),discount_value:number(req.body.discount_value),minimum_order_value:number(req.body.minimum_order_value),expires_at:req.body.expires_at?new Date(req.body.expires_at):undefined,active:checked(req.body.active)});res.redirect('/admin/settings/coupons?message=Coupon created')}catch(e){next(e)}});router.post('/coupons/:id/toggle',async(req,res,next)=>{try{const coupon=await Coupon.findById(req.params.id);if(coupon){coupon.active=!coupon.active;await coupon.save()}res.redirect('/admin/settings/coupons')}catch(e){next(e)}});
router.use('/website',require('../middleware/learningForms'));
router.get('/website',async(req,res,next)=>{try{res.render('admin/settings_form',{title:'Website Settings',section:'website',settings:require('../config/appearance').normalize(await SiteSettings.findOne({key:'default'}).lean()||{}),message:req.query.message||''})}catch(e){next(e)}});router.post('/website',async(req,res,next)=>{try{const fields=['store_name','contact_email','contact_phone','whatsapp_number','support_cta','address','footer_text','homepage_heading','homepage_subheading'];const update={};fields.forEach(k=>update[k]=text(req.body[k]));for(const key of Object.keys(require('../services/seoService').settingsDefaults))if(req.body[key]!==undefined)update[key]=text(req.body[key]);update.logo_url=safeUrl(req.body.logo_url);update.main_website_url=safeUrl(req.body.main_website_url);for(const key of ['linkedin_personal_url','linkedin_business_url']){const value=text(req.body[key]);if(!require('../config/linkedin').validUrl(value))return res.status(400).send('LinkedIn links must use HTTPS on linkedin.com.');update[key]=value;}for(const key of ['linkedin_show_books','linkedin_show_footer'])update[key]=checked(req.body[key]);await SiteSettings.findOneAndUpdate({key:'default'},{$set:update},{upsert:true,runValidators:true});clearSiteSettingsCache();res.redirect('/admin/settings/website?message=Website settings saved')}catch(e){next(e)}});
router.get('/admin',(req,res)=>res.render('admin/settings_form',{title:'Admin Settings',section:'admin',settings:{display_name:req.session.adminUser||'Administrator'},message:''}));
const ProductFit = require('../models/mongo/ProductFit');

router.get('/product-config', async (req, res, next) => {
  try {
    let fits = await ProductFit.find().sort({ sort_order: 1, name: 1 }).lean();
    if (!fits.length) {
      const baseline = [
        { name: 'Slim Fit', department: 'Men', description: 'Close-fitting with minimal ease' },
        { name: 'Regular Fit', department: 'All', description: 'Standard commercial ease' },
        { name: 'Relaxed Fit', department: 'All', description: 'Generous ease for comfort' },
        { name: 'Oversized Fit', department: 'All', description: 'Dropped shoulders, boxy silhouette' },
        { name: 'Tailored Fit', department: 'Men', description: 'Shaped waist and tapered sleeve' },
        { name: 'Custom Fit', department: 'All', description: 'Graded to buyer specifications' }
      ];
      await ProductFit.insertMany(baseline).catch(() => {});
      fits = await ProductFit.find().sort({ sort_order: 1, name: 1 }).lean();
    }
    res.render('admin/product_config', {
      title: 'Product Configuration — Dynamic Fits',
      fits,
      message: req.query.message || '',
      csrf: req.session?.productMediaCsrf || ''
    });
  } catch (e) { next(e); }
});

router.post('/product-config/fit', async (req, res, next) => {
  try {
    const fitName = text(req.body.name);
    if (!fitName) return res.status(400).send('Fit name is required.');
    await ProductFit.findOneAndUpdate(
      { name: fitName },
      {
        $set: {
          name: fitName,
          slug: fitName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          department: text(req.body.department) || 'All',
          description: text(req.body.description) || '',
          active: true
        }
      },
      { upsert: true, runValidators: true }
    );
    res.redirect('/admin/settings/product-config?message=Fit option saved successfully');
  } catch (e) { next(e); }
});

router.post('/product-config/fit/:id/toggle', async (req, res, next) => {
  try {
    const fit = await ProductFit.findById(req.params.id);
    if (fit) {
      fit.active = !fit.active;
      await fit.save();
    }
    res.redirect('/admin/settings/product-config?message=Fit status updated');
  } catch (e) { next(e); }
});

router.post('/product-config/fit/seed-100', async (req, res, next) => {
  try {
    const fits100 = [];
    const depts = ['Men', 'Women', 'Kids', 'All'];
    const styles = ['Slim', 'Regular', 'Relaxed', 'Loose', 'Oversized', 'Tailored', 'Skinny', 'Tapered', 'Straight', 'Bootcut', 'Boxy', 'Athletic', 'Classic', 'Euro', 'Comfort', 'Drop Crotch', 'Wide Leg', 'Cropped', 'Muscle Fit', 'Flared', 'High Rise', 'Low Rise', 'Carrot Fit', 'Paperbag', 'Boyfriend', 'Mom Fit', 'Dad Fit', 'Bermuda', 'Pleated', 'Kimono Cut'];
    const variations = ['Standard', 'Contemporary', 'Vintage', 'Industrial'];

    for (const style of styles) {
      for (const v of variations) {
        fits100.push({
          name: `${v} ${style} Fit`,
          department: depts[fits100.length % depts.length],
          description: `${v} commercial grading block for ${style.toLowerCase()} silhouettes`,
          active: true
        });
      }
    }
    const ops = fits100.map(f => ({
      updateOne: {
        filter: { name: f.name },
        update: { $setOnInsert: f },
        upsert: true
      }
    }));
    await ProductFit.bulkWrite(ops);
    res.redirect('/admin/settings/product-config?message=Successfully populated 100+ industrial garment fit options');
  } catch (e) { next(e); }
});

router.get('/notification-recipient',async(req,res,next)=>{try{const settings=await SiteSettings.findOne({key:'default'}).lean()||{};res.render('admin/settings_form',{title:'Notification Recipient Email',section:'notification-recipient',settings:Object.assign({notification_recipient_email:''},settings),message:req.query.message||''})}catch(e){next(e)}});router.post('/notification-recipient',async(req,res,next)=>{try{const email=String(req.body.notification_recipient_email||'').trim();const emailRegex=/^[^\\s@]+@[^\\s@]+\.[^\\s@]+$/;if(!emailRegex.test(email))return res.redirect('/admin/settings/notification-recipient?message=Invalid+email+format&error=1');await SiteSettings.findOneAndUpdate({key:'default'},{$set: {notification_recipient_email:email}},{upsert:true,runValidators:true});res.redirect('/admin/settings/notification-recipient?message=Notification+recipient+email+saved')}catch(e){next(e)}});module.exports=router;
