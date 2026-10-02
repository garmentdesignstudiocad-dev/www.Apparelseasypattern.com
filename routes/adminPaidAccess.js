const express=require('express');
const access=require('../services/paidAccessService');
const Settings=require('../models/mongo/PaidAccessSettings');
const Service=require('../models/mongo/ConsultingService');
const validation=require('../services/learningValidation');
const models={courses:require('../models/mongo/CourseBooking'),webinars:require('../models/mongo/WebinarRegistration'),books:require('../models/mongo/BookPurchase'),consulting:require('../models/mongo/ConsultationBooking')};
const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.use((req,res,next)=>/^\/(settings\/paid-access|access-records|consulting)(\/|$)/.test(req.path)?next():next('router'));
router.use(require('../middleware/adminAuth'),require('../middleware/learningForms'));
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.param('id',(req,res,next,id)=>/^[a-f\d]{24}$/i.test(id)?next():res.sendStatus(404));
router.get('/settings/paid-access',wrap(async(req,res)=>res.render('admin/paid-access',{title:'Paid Access Settings',settings:await access.getSettings(),error:''})));
router.post('/settings/paid-access',wrap(async(req,res)=>{
  const data={};
  try {for(const kind of Object.keys(models)) data[kind]={enabled:req.body[kind+'_enabled']==='on',active:req.body[kind+'_active']==='on',fee:validation.number(req.body,kind+'_fee',1000000),currency:'INR',button_text:validation.text(req.body,kind+'_button',80,true)};}
  catch(error){return res.status(400).render('admin/paid-access',{title:'Paid Access Settings',settings:await access.getSettings(),error:error.message});}
  await Settings.findOneAndUpdate({_id:'default'},{$set:data},{upsert:true,runValidators:true});
  res.redirect(303,'/admin/settings/paid-access');
}));
router.get('/consulting',wrap(async(req,res)=>res.render('admin/consulting',{title:'Consulting',items:await (await access.getConsultingServices()).find().sort({name:1}).lean(),item:{},error:''})));
router.get('/consulting/:id/edit',wrap(async(req,res)=>{
  const item=await Service.findById(req.params.id).lean();if(!item)return res.sendStatus(404);
  res.render('admin/consulting',{title:'Consulting',items:[],item,error:''});
}));
router.post(['/consulting','/consulting/:id/edit'],wrap(async(req,res)=>{
  let data;
  try {
    data={name:validation.text(req.body,'name',200,true),slug:validation.text(req.body,'slug',200,true),description:validation.text(req.body,'description',5000),price:req.body.price===''?null:validation.number(req.body,'price',1000000),active:req.body.active==='on'};
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) throw new Error('Use lowercase letters, numbers and hyphens for the slug.');
    if(req.params.id){if(!await Service.findByIdAndUpdate(req.params.id,{$set:data},{runValidators:true}))return res.sendStatus(404);}else await Service.create(data);
  } catch(error){if(error.code===11000 || error.name==='ValidationError' || !data || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug))return res.status(400).render('admin/consulting',{title:'Consulting',items:[],item:{...req.body,_id:req.params.id,active:req.body.active==='on'},error:error.code===11000?'Slug already exists.':error.message});throw error;}
  res.redirect(303,'/admin/consulting');
}));
router.get('/access-records',wrap(async(req,res)=>{
  const kind=Object.hasOwn(models,req.query.kind)?req.query.kind:'courses',Model=models[kind],filter={};
  const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,100):'';
  if(q){const search=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=['full_name','name','email','whatsapp','item_name','course_name'].map(key=>({[key]:{$regex:search,$options:'i'}}));}
  if(['Paid','Pending','Failed','Not Required'].includes(req.query.payment))filter.payment_status=req.query.payment;
  if(['Registered','Payment Pending','Confirmed','Attended','Cancelled'].includes(req.query.status))filter.registration_status=req.query.status;
  const page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1));
  const [items,total]=await Promise.all([Model.find(filter).sort({createdAt:-1}).skip((page-1)*50).limit(50).lean(),Model.countDocuments(filter)]);
  res.render('admin/access-records',{title:'Registrations & Paid Access Payments',kind,items,total,page,query:req.query,error:typeof req.query.notice==='string'?req.query.notice.slice(0,500):''});
}));
router.post('/access-records/:kind/:id/:action',wrap(async(req,res)=>{
  const {kind,id,action}=req.params;if(!Object.hasOwn(models,kind))return res.sendStatus(404);
  const Model=models[kind],row=await Model.findById(id);if(!row)return res.sendStatus(404);
  if(!row.payment_purpose && kind!=='webinars')return res.status(409).send('Manage this legacy booking in Course Bookings.');
  const payments=kind==='webinars'?require('../services/webinarPaymentService').createService():access.paymentService(Model,access.purposes[kind]);
  let notice='Saved.';
  try {
    if(action==='check')notice=(await payments.reconcile(id)).message;
    else if(action==='cancel'){await payments.cancel(id,req.body.refund_acknowledged==='on');notice='Cancelled. Any refund must be arranged separately in Razorpay.';}
    else if(action==='recover-order'){await payments.recoverOrder(id,req.body.order_id);notice='Order recovered. Check payment status.';}
    else if(action==='reset-order'){await payments.resetOrder(id,req.body.no_order_acknowledged==='on');notice='Payment setup unlocked.';}
    else if(action==='status' && kind==='consulting'){
      if(!['New','Contacted','Confirmed','Completed'].includes(req.body.status))return res.sendStatus(400);
      const filter={_id:id,registration_status:{$ne:'Cancelled'}};
      if(['Confirmed','Completed'].includes(req.body.status)){filter.registration_status='Confirmed';filter.payment_status={$in:['Paid','Not Required']};}
      if(!await Model.findOneAndUpdate(filter,{$set:{status:req.body.status},...(row.status!==req.body.status?{$push:{notification_jobs:require('../services/notificationService').statusJob(req.body.status)}}:{})},{runValidators:true}))return res.status(409).send('Payment and access must be confirmed first.');
    }else return res.sendStatus(404);
  }catch(error){notice=error.status?error.message:'Gateway unavailable. Check payment status before retrying.';}
  await require('../services/notificationService').safeFlush(access.purposes[kind],id);
  res.redirect(303,`/admin/access-records?kind=${kind}&notice=${encodeURIComponent(notice)}`);
}));
module.exports=router;
