const express=require('express');
const Course=require('../models/mongo/Course');
const Webinar=require('../models/mongo/Webinar');
const Booking=require('../models/mongo/CourseBooking');
const Registration=require('../models/mongo/WebinarRegistration');
const validation=require('../services/learningValidation');
const {csvCell}=require('../services/businessValidation');
const {createService}=require('../services/webinarPaymentService');
const router=express.Router();
const payments=createService();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const bookingStatuses=['New','Contacted','Confirmed','Completed','Cancelled'];
const paymentStatuses=['Not Required','Pending','Paid','Failed'];
router.use((req,res,next)=>/^\/(courses|webinars|course-bookings|webinar-registrations)(\/|$)/.test(req.path)?next():next('router'));
router.use(require('../middleware/adminAuth'),require('../middleware/learningForms'));
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.param('id',(req,res,next,id)=>/^[a-f\d]{24}$/i.test(id)?next():res.status(404).send('Not found.'));
for(const [kind,Model] of [['courses',Course],['webinars',Webinar]]) {
  const title=kind==='courses'?'Courses':'Webinars';
  const form=(res,item,error='')=>res.render('admin/learning-form',{title,kind,item,error});
  router.get(`/${kind}`,wrap(async(req,res)=>res.render('admin/learning-list',{title,kind,items:await Model.find().sort({createdAt:-1}).lean()})));
  router.get(`/${kind}/new`,(req,res)=>form(res,{}));
  router.get(`/${kind}/:id/edit`,wrap(async(req,res)=>{
    const item=await Model.findById(req.params.id).select(kind==='webinars'?'+meeting_link +seat_ids':'+access_url').lean();
    if(!item) return res.sendStatus(404);
    form(res,item);
  }));
  router.post([`/${kind}/new`,`/${kind}/:id/edit`],wrap(async(req,res)=>{
    let data;
    try { data=validation.content(req.body,kind); }
    catch(error) { return form(res.status(400),{...req.body,_id:req.params.id,active:req.body.active==='on',registration_open:req.body.registration_open==='on'},error.message); }
    try {
      if(req.params.id) {
        const previous=await Model.findById(req.params.id).select(kind==='webinars'?'+meeting_link':'').lean();
        const filter={_id:req.params.id};
        if(kind==='webinars' && data.max_seats) filter.$expr={$lte:[{$size:{$ifNull:['$seat_ids',[]]}},data.max_seats]};
        const saved=await Model.findOneAndUpdate(filter,{$set:data},{new:true,runValidators:true});
        if(saved && previous){
          const fields=kind==='webinars'?['starts_at','duration_minutes','mode','meeting_link','active']:['schedule_information','mode','active'];
          if(fields.some(key=>String(previous[key])!==String(saved[key]))){
            const Ref=kind==='webinars'?Registration:Booking;
            const detail=kind==='webinars'?`Schedule update: ${new Date(saved.starts_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST. View your registration for current joining details.`:'Your course schedule or availability has changed. View course details and contact the studio to confirm your schedule.';
            const job=require('../services/notificationService').statusJob(saved.active?'Schedule updated':'Availability changed',detail);
            await Ref.updateMany({[kind==='webinars'?'webinar_id':'course_id']:saved._id,registration_status:{$ne:'Cancelled'}},{$push:{notification_jobs:job}});
          }
        }
        if(!saved) return form(res.status(409),{...data,_id:req.params.id},'Not found, or maximum seats is lower than the current reservations. Refresh and try again.');
      } else await Model.create(data);
    } catch(error) {
      if(error.code===11000 || error.name==='ValidationError') return form(res.status(400),{...data,_id:req.params.id},error.code===11000?'This slug is already in use.':'Check the supplied values.');
      throw error;
    }
    res.redirect(303,`/admin/${kind}`);
  }));
}
function filter(query,kind) {
  const result={};
  const ref=kind==='course-bookings'?'course_id':'webinar_id';
  if(typeof query.item==='string' && /^[a-f\d]{24}$/i.test(query.item)) result[ref]=query.item;
  if(kind==='course-bookings' && bookingStatuses.includes(query.status)) result.status=query.status;
  if(kind==='webinar-registrations' && paymentStatuses.includes(query.payment)) result.payment_status=query.payment;
  if(typeof query.q==='string' && query.q.trim()) {
    const q=query.q.trim().slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    result.$or=[kind==='course-bookings'?'name':'full_name','email','whatsapp'].map(key=>({[key]:{$regex:q,$options:'i'}}));
  }
  return result;
}
for(const [kind,Model,Parent] of [['course-bookings',Booking,Course],['webinar-registrations',Registration,Webinar]]) {
  const title=kind==='course-bookings'?'Course Bookings':'Webinar Registrations';
  const refs=()=>Parent.find().select('name title').sort({createdAt:-1}).lean();
  router.get(`/${kind}`,wrap(async(req,res)=>{
    const page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1));
    const query=filter(req.query,kind);
    const [items,total,parents]=await Promise.all([Model.find(query).sort({createdAt:-1}).skip((page-1)*50).limit(50).lean(),Model.countDocuments(query),refs()]);
    res.render('admin/learning-records',{title,kind,items,total,page,parents,query:req.query,item:null,bookingStatuses,paymentStatuses,error:''});
  }));
  if(kind==='webinar-registrations') router.get(`/${kind}/export.csv`,wrap(async(req,res)=>{
    const fields=['full_name','email','whatsapp','country','city','profession','experience_level','webinar_id','registration_status','payment_status','attendance_status','amount_paise','currency','razorpay_order_id','razorpay_payment_id','payment_note','createdAt'];
    res.type('text/csv').attachment('webinar-registrations.csv');
    res.write('\uFEFF'+fields.map(csvCell).join(',')+'\r\n');
    for await(const item of Model.find(filter(req.query,kind)).sort({createdAt:-1}).lean().cursor()) res.write(fields.map(key=>csvCell(item[key] instanceof Date?item[key].toISOString():item[key])).join(',')+'\r\n');
    res.end();
  }));
  router.get(`/${kind}/:id`,wrap(async(req,res)=>{
    const item=await Model.findById(req.params.id).lean();
    if(!item) return res.sendStatus(404);
    res.set('Cache-Control','no-store').render('admin/learning-records',{title,kind,item,parents:await refs(),bookingStatuses,paymentStatuses,error:typeof req.query.notice==='string'?req.query.notice.slice(0,500):''});
  }));
}
router.post('/course-bookings/:id/status',wrap(async(req,res)=>{
  if(!bookingStatuses.includes(req.body.status)) return res.status(400).send('Select a valid booking status.');
  const existing=await Booking.findById(req.params.id);
  if(!existing)return res.sendStatus(404);
  if(existing.payment_purpose && req.body.status==='Cancelled')return res.status(409).send('Cancel paid-access bookings using Registrations & Access Payments, so payment and refund checks run.');
  if(existing.payment_purpose && ['Confirmed','Completed'].includes(req.body.status) && (existing.registration_status!=='Confirmed' || !['Paid','Not Required'].includes(existing.payment_status)))return res.status(409).send('Access payment must be confirmed first.');
  const item=await Booking.findByIdAndUpdate(req.params.id,{$set:{status:req.body.status},...(existing.status!==req.body.status?{$push:{notification_jobs:require('../services/notificationService').statusJob(req.body.status)}}:{})},{runValidators:true});
  if(!item) return res.sendStatus(404);
  await require('../services/notificationService').safeFlush('course_registration',req.params.id);
  res.redirect(303,`/admin/course-bookings/${req.params.id}`);
}));
router.post('/webinar-registrations/:id/attend',wrap(async(req,res)=>{
  const item=await Registration.findOneAndUpdate({_id:req.params.id,registration_status:{$in:['Confirmed','Attended']},payment_status:{$in:['Paid','Not Required']}},{$set:{registration_status:'Attended',attendance_status:'Attended'}},{new:true,runValidators:true});
  if(!item) return res.status(409).send('Only confirmed registrations can be marked attended.');
  res.redirect(303,`/admin/webinar-registrations/${req.params.id}`);
}));
for(const action of ['check','cancel','recover-order','reset-order']) router.post(`/webinar-registrations/:id/${action}`,wrap(async(req,res)=>{
  let message;
  try {
    if(action==='check') message=(await payments.reconcile(req.params.id)).message;
    else if(action==='recover-order') { await payments.recoverOrder(req.params.id,req.body.order_id); message='Verified gateway order linked. Check payment status to reconcile.'; }
    else if(action==='reset-order') { await payments.resetOrder(req.params.id,req.body.no_order_acknowledged==='on'); message='Payment setup unlocked after owner review.'; }
    else { await payments.cancel(req.params.id,req.body.refund_acknowledged==='on'); message='Registration cancelled. Any refund must be handled separately in Razorpay.'; }
  } catch(error) { message=error.status?error.message:'Gateway unavailable. No confirmation was issued; retry the status check shortly.'; }
  res.redirect(303,`/admin/webinar-registrations/${req.params.id}?notice=${encodeURIComponent(message)}`);
}));
module.exports=router;
