const express=require('express');
const crypto=require('crypto');
const Course=require('../models/mongo/Course');
const Webinar=require('../models/mongo/Webinar');
const Booking=require('../models/mongo/CourseBooking');
const Registration=require('../models/mongo/WebinarRegistration');
const validation=require('../services/learningValidation');
const access=require('../services/paidAccessService');
const coursePayments=access.paymentService(Booking,'course_registration');
const {createService}=require('../services/webinarPaymentService');
function createRouter(payments=createService()) {
  const router=express.Router();
  router.use((req,res,next)=>/^\/(courses|webinars|course-bookings|webinar-registrations)(\/|$)/.test(req.path)?next():next('router'));
  router.use(require('../middleware/learningForms'));
  router.use((req,res,next)=>access.getSettings().then(settings=>{req.accessSettings=settings;res.locals.accessQuote=(kind,item)=>access.quote(kind,item,settings);next();}).catch(next));
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  const render=(res,kind,item,extra={})=>res.render('learning/detail',{title:kind==='courses'?item.name:item.title,description:item.short_description || item.description?.slice(0,200),kind,item,values:{},error:'',...extra});
  router.param('id',(req,res,next,id)=>/^[a-f\d]{24}$/i.test(id)?next():res.status(404).send('Not found.'));
  for(const [kind,Model] of [['courses',Course],['webinars',Webinar]]) {
    router.get(`/${kind}`,wrap(async(req,res)=>{
      if(!req.accessSettings[kind].active) return res.status(404).send('This section is unavailable.');
      const items=await Model.find({active:true,...(kind==='webinars'?{starts_at:{$gt:new Date()}}:{})}).sort(kind==='courses'?{createdAt:-1}:{starts_at:1}).lean();
      res.render('learning/index',{title:kind==='courses'?'Courses':'Upcoming Webinars',description:kind==='courses'?res.locals.siteSettings.courses_seo_description:'Join live garment technology and pattern making webinars.',kind,items});
    }));
    router.get(`/${kind}/:slug`,wrap(async(req,res,next)=>{
      const item=await Model.findOne({slug:req.params.slug}).lean();
      // Keep the established pattern-making foundation until an owner creates this course.
      if(!item && kind==='courses' && req.params.slug==='pattern-making') return next();
      if(!req.accessSettings[kind].active || !item?.active) return res.status(404).render('error',{title:'Not Found',message:'This course or webinar is unavailable.'});
      req.session.bookingNonce ||= crypto.randomBytes(24).toString('hex');
      render(res,kind,item,{bookingNonce:req.session.bookingNonce});
    }));
  }
  router.post('/courses/:slug/book',wrap(async(req,res)=>{
    const item=await Course.findOne({slug:req.params.slug,active:true}).lean();
    if(!item || !req.accessSettings.courses.active) return res.status(404).send('Course not found.');
    let data;
    try { data=validation.booking(req.body); if(item.mode!=='Online / Offline' && data.mode!==item.mode) throw new Error('Select the mode offered by this course.'); }
    catch(error) { return render(res.status(400),'courses',item,{values:req.body,error:error.message,bookingNonce:req.session.bookingNonce}); }
    if(!req.session.bookingNonce || req.body.submission_key!==req.session.bookingNonce) return res.status(409).send('This booking form was already submitted or expired. Reload the course page.');
    await Booking.init();
    const key=crypto.createHash('sha256').update(`${req.sessionID}|${req.session.bookingNonce}|${item._id}`).digest('hex');
    let row;
    try { row=await Booking.create({...data,...access.snapshot('courses',item,req.accessSettings),full_name:data.name,course_id:item._id,course_name:item.name,submission_key:key}); }
    catch(error) { if(error.code!==11000) throw error; row=await Booking.findOne({submission_key:key}); }
    await Booking.updateOne({_id:row._id},{$set:{local_reference_id:String(row._id)}});
    req.session.courseBookingIds ||= [];
    if(!req.session.courseBookingIds.includes(String(row._id))) req.session.courseBookingIds.push(String(row._id));
    await require('../services/notificationService').safeFlush('course_registration',row._id);
    req.session.bookingNonce=crypto.randomBytes(24).toString('hex');
    res.redirect(303,`/course-bookings/${row._id}`);
  }));
  router.get('/course-bookings/:id',wrap(async(req,res)=>{
    if(!req.session.courseBookingIds?.includes(req.params.id)) return res.status(403).send('Open this booking in the browser used to submit it.');
    const item=await Booking.findById(req.params.id).lean();
    if(!item) return res.sendStatus(404);
    if(!item.payment_purpose) return res.set('Cache-Control','no-store').render('learning/booking',{title:'Course Booking Received',item});
    const confirmed=['Confirmed','Attended'].includes(item.registration_status) && ['Paid','Not Required'].includes(item.payment_status);
    const course=confirmed?await Course.findById(item.course_id).select('+access_url').lean():null;
    res.set('Cache-Control','no-store').render('learning/access-confirmation',{title:'Course Registration',item,itemName:item.course_name,base:'/course-bookings',kind:'courses',privateUrl:course?.access_url || '',confirmed});
  }));
  router.post('/webinars/:slug/register',wrap(async(req,res)=>{
    const item=await Webinar.findOne({slug:req.params.slug,active:true,registration_open:true,starts_at:{$gt:new Date()}}).lean();
    if(!item || !req.accessSettings.webinars.active) return res.status(409).send('Webinar registration is closed.');
    let data;
    try { data=validation.registration(req.body); }
    catch(error) { return render(res.status(400),'webinars',item,{values:req.body,error:error.message}); }
    await Registration.init();
    let row;
    try { row=await Registration.create({...data,item_name:item.title,webinar_id:item._id,...access.snapshot('webinars',item,req.accessSettings),registration_status:'Registered'}); }
    catch(error) {
      if(error.code!==11000) throw error;
      row=await Registration.findOne({webinar_id:item._id,email:data.email});
      if(req.session.webinarRegistrationIds?.includes(String(row._id))) return res.redirect(303,`/webinar-registrations/${row._id}`);
      return render(res.status(409),'webinars',item,{values:req.body,error:'This email is already registered. Use the registering browser or contact the studio.'});
    }
    await Registration.updateOne({_id:row._id},{$set:{local_reference_id:String(row._id)}});
    req.session.webinarRegistrationIds ||= [];
    req.session.webinarRegistrationIds.push(String(row._id));
    try { await payments.claimSeat(row); }
    catch(error) { await Registration.updateOne({_id:row._id},{$set:{registration_status:'Cancelled',payment_note:'No seat available at registration.'}}); return render(res.status(error.status || 500),'webinars',item,{values:req.body,error:error.status?error.message:'Unable to reserve a seat. Contact the studio.'}); }
    await Registration.updateOne({_id:row._id,registration_status:'Registered'},{$set:{registration_status:row.amount_paise>0?'Payment Pending':'Confirmed'}});
    await require('../services/notificationService').safeFlush('webinar_registration',row._id);
    res.redirect(303,`/webinar-registrations/${row._id}`);
  }));
  const owner=(req,res,next)=>req.session.webinarRegistrationIds?.includes(req.params.id)?next():res.status(403).send('Open this registration in the browser used to register.');
  router.get('/webinar-registrations/:id',owner,wrap(async(req,res)=>{
    const item=await Registration.findById(req.params.id).lean();
    if(!item) return res.sendStatus(404);
    const confirmed=['Confirmed','Attended'].includes(item.registration_status) && ['Paid','Not Required'].includes(item.payment_status);
    const webinar=await Webinar.findById(item.webinar_id).select(confirmed?'+meeting_link':'-meeting_link').lean();
    res.set('Cache-Control','no-store').render('learning/registration',{title:'Webinar Registration',item,webinar,confirmed});
  }));
  for(const action of ['order','verify','check']) router.post(`/webinar-registrations/:id/${action}`,owner,wrap(async(req,res)=>{
    try { const result=action==='order'?await payments.order(req.params.id):action==='verify'?await payments.verify(req.params.id,req.body):await payments.reconcile(req.params.id); res.json({...result,redirect:`/webinar-registrations/${req.params.id}`}); }
    catch(error) { if(error.status) return res.status(error.status).json({error:error.message}); res.status(503).json({error:'Payment service is temporarily unavailable. Check payment status before retrying.'}); }
  }));
  for(const action of ['order','verify','check']) router.post(`/course-bookings/:id/${action}`,wrap(async(req,res)=>{
    if(!req.session.courseBookingIds?.includes(req.params.id)) return res.sendStatus(403);
    const row=await Booking.findById(req.params.id);
    if(!row?.payment_purpose) return res.status(409).json({error:'This legacy booking does not use online payment.'});
    try { const result=action==='order'?await coursePayments.order(row._id):action==='verify'?await coursePayments.verify(row._id,req.body):await coursePayments.reconcile(row._id);res.json({...result,redirect:`/course-bookings/${row._id}`}); }
    catch(error){res.status(error.status || 503).json({error:error.status?error.message:'Payment service unavailable. Check status before retrying.'});}
  }));
  return router;
}
module.exports=createRouter();
module.exports.createRouter=createRouter;
