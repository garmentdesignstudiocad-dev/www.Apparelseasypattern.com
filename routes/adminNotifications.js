const express=require('express');
const Log=require('../models/mongo/NotificationLog');
const Settings=require('../models/mongo/NotificationSettings');
const service=require('../services/notificationService');
const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const labels={email_enabled:'Enable Email',whatsapp_enabled:'Enable WhatsApp',payment_confirmation:'Payment Confirmation',order_updates:'Order Updates',course_updates:'Course Updates',webinar_updates:'Webinar Updates & Reminders',book_updates:'Book Purchase Updates',consulting_updates:'Consulting Updates',admin_new_order_alert:'Admin New Order Alert (Email)'};
Object.assign(labels,require('../config/notificationEvents').ownerLabels,Object.fromEntries(Object.entries(require('../config/notificationEvents').labels).map(([key,label])=>['event_'+key,label])));
router.use((req,res,next)=>/^\/(notifications|settings\/notifications)(\/|$)/.test(req.path)?next():next('router'));
router.use(require('../middleware/adminAuth'),require('../middleware/learningForms'));
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/settings/notifications',wrap(async(req,res)=>res.render('admin/notification-settings',{title:'Notification Settings',settings:await service.getSettings(),labels,providerReady:{email:Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || ['EMAIL_HOST','EMAIL_PORT','EMAIL_SECURE','EMAIL_USER','EMAIL_PASSWORD','EMAIL_FROM'].every(key=>Boolean(process.env[key])),whatsapp:['WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN','WHATSAPP_API_VERSION','WHATSAPP_TEMPLATE_NAME'].every(key=>Boolean(process.env[key]))}})));
router.post('/settings/notifications',wrap(async(req,res)=>{
  const data=Object.fromEntries(Object.keys(labels).map(key=>[key,req.body[key]==='on']));
  await Settings.findOneAndUpdate({_id:'default'},{$set:data},{upsert:true,runValidators:true});
  res.redirect(303,'/admin/settings/notifications');
}));
router.get('/notifications',wrap(async(req,res)=>{
  const filter={},page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1));
  if(['email','whatsapp'].includes(req.query.channel))filter.channel=req.query.channel;
  if(['queued','pending','sending','sent','failed','uncertain','skipped'].includes(req.query.status))filter.status=req.query.status;
  if(typeof req.query.event==='string' && /^[a-z_]{1,80}$/.test(req.query.event))filter.event=req.query.event;
  const [items,total,events]=await Promise.all([Log.find(filter).sort({createdAt:-1}).skip((page-1)*50).limit(50).lean(),Log.countDocuments(filter),Log.distinct('event')]);
  res.render('admin/notifications',{title:'Notifications',items,total,page,events,query:req.query,notice:typeof req.query.notice==='string'?req.query.notice.slice(0,300):''});
}));
router.post('/notifications/:id/retry',wrap(async(req,res)=>{
  if(!/^[a-f\d]{24}$/i.test(req.params.id))return res.sendStatus(404);
  let notice;
  try{notice=await service.retry(req.params.id,req.body.duplicate_risk_acknowledged==='on')?'Notification queued for retry.':'Only failed or uncertain notifications can be retried.';}catch(error){notice=error.safe?error.message:'Retry could not be queued. Please try again.';}
  res.redirect(303,'/admin/notifications?notice='+encodeURIComponent(notice));
}));
module.exports=router;
