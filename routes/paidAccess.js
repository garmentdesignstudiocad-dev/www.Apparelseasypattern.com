const express=require('express');
const Book=require('../models/mongo/Book');
const Service=require('../models/mongo/ConsultingService');
const Purchase=require('../models/mongo/BookPurchase');
const Booking=require('../models/mongo/ConsultationBooking');
const access=require('../services/paidAccessService');
const validation=require('../services/learningValidation');
const forms=require('../middleware/learningForms');
const tokens=require('../services/sessionFormTokens');
const router=express.Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const saveSession=req=>new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
async function renderForm(req,res,kind,item,fee,{status=200,error='',values={}}={}){
  forms.fresh(req,res);
  const nonce=tokens.issue(req,`${kind}/${item._id}`);
  await saveSession(req);
  return res.status(status).render('learning/access-form',{title:status===200?(kind==='books'?'Buy / Access Book':'Book Consultation'):'Review Your Details',kind,item,fee,nonce,error,values});
}
router.use((req,res,next)=>/^\/(books\/[^/]+\/access|consulting(?:\/|$)|book-purchases(?:\/|$)|consultation-bookings(?:\/|$))/.test(req.path)?next():next('router'));
router.use(forms.withRecovery(async(req,res)=>{
  // Reject the stale POST without creating anything, then give the customer a
  // usable fresh form. Never silently replay an unverified request.
  const match=req.path.match(/^\/(books|consulting)\/([^/]+)\/access\/?$/);
  if(!match)return forms.reject(req,res);
  const kind=match[1],Parent=kind==='books'?Book:Service;
  const item=await Parent.findOne({slug:decodeURIComponent(match[2]),active:true}).lean();
  if(!item)return res.sendStatus(404);
  const fee=access.quote(kind,item,await access.getSettings());
  if(!fee.active || fee.external)return res.status(409).send('Direct access is unavailable.');
  return renderForm(req,res,kind,item,fee,{status:403,error:'Your form or browser session expired. Your details are preserved below. Review them and continue again.',values:req.body});
}));
router.param('id',(req,res,next,id)=>/^[a-f\d]{24}$/i.test(id)?next():res.sendStatus(404));
for(const [kind,Parent,Model,base] of [['books',Book,Purchase,'book-purchases'],['consulting',Service,Booking,'consultation-bookings']]) {
  const payments=access.paymentService(Model,access.purposes[kind]);
  const form=async(req,res,next)=>{
    const item=await Parent.findOne({slug:req.params.slug,active:true}).lean();
    if(!item) return res.sendStatus(404);
    const settings=await access.getSettings(),fee=access.quote(kind,item,settings);
    if(!fee.active || fee.external) return res.status(409).send('Direct access is unavailable.');
    req.accessItem=item;req.accessSettings=settings;req.accessFee=fee;next();
  };
  if(kind==='consulting')router.get('/consulting/:slug',wrap(form),(req,res)=>res.redirect(302,`/consulting/${encodeURIComponent(req.accessItem.slug)}/access`));
  router.get(`/${kind}/:slug/access`,wrap(form),wrap((req,res)=>renderForm(req,res,kind,req.accessItem,req.accessFee)));
  router.post(`/${kind}/:slug/access`,wrap(form),wrap(async(req,res)=>{
    const item=req.accessItem,scope=`${kind}/${item._id}`;
    if(!tokens.valid(req,scope,req.body.submission_key))return renderForm(req,res,kind,item,req.accessFee,{status:409,error:'This booking form expired. Your details are preserved. Review them and continue again.',values:req.body});
    let data;
    try {
      data=validation.contact(req.body,'full_name');
      if(kind==='consulting') {
        Object.assign(data,{preferred_date:validation.date(req.body,'preferred_date'),preferred_time:validation.time(req.body,'preferred_time'),notes:validation.text(req.body,'notes',5000,true)});
        if(new Date(`${data.preferred_date}T${data.preferred_time}:00+05:30`)<=new Date()) throw new Error('Choose a future preferred date and time (IST).');
      }
    } catch(error) { return renderForm(req,res,kind,item,req.accessFee,{status:400,error:error.message,values:req.body}); }
    const submission_key=tokens.digest(req,scope,req.body.submission_key);
    const request_key=tokens.digest(req,scope,JSON.stringify(data));
    await Model.init();
    let row;
    // Consumption is durable: a successful insert consumes the submission key.
    // A fresh form with identical validated details also resumes the same booking.
    row=await Model.findOne({$or:[{submission_key},{request_key}]});
    if(!row){
      try {row=await Model.create({...data,...access.snapshot(kind,item,req.accessSettings),item_id:item._id,item_name:item.title || item.name,purchase_type:item.purchase_type,submission_key,request_key,session_owner:tokens.owner(req)});}
      catch(error){if(error.code!==11000)throw error;row=await Model.findOne({$or:[{submission_key},{request_key}]});if(!row)throw error;}
    }
    await Model.updateOne({_id:row._id},{$set:{local_reference_id:String(row._id)}});
    req.session[base] ||= [];
    if(!req.session[base].includes(String(row._id)))req.session[base].push(String(row._id));
    await require('../services/notificationService').safeFlush(access.purposes[kind],row._id);
    await saveSession(req);
    res.redirect(303,`/${base}/${row._id}`);
  }));
  const owner=wrap(async(req,res,next)=>req.session[base]?.includes(req.params.id) || await Model.exists({_id:req.params.id,session_owner:tokens.owner(req)})?next():res.status(403).send('Use the browser used to register, or contact the studio with your reference.'));
  router.get(`/${base}/:id`,owner,wrap(async(req,res)=>{
    const item=await Model.findById(req.params.id).lean();if(!item)return res.sendStatus(404);
    const confirmed=['Confirmed','Attended'].includes(item.registration_status) && ['Paid','Not Required'].includes(item.payment_status);
    const parent=confirmed && kind==='books'?await Parent.findById(item.item_id).select('+ebook_url').lean():null;
    res.set('Cache-Control','no-store').render('learning/access-confirmation',{title:kind==='books'?'Book Purchase':'Consultation Booking',item,itemName:item.item_name,kind,base:`/${base}`,confirmed,privateUrl:parent?.ebook_url || ''});
  }));
  for(const action of ['order','verify','check']) router.post(`/${base}/:id/${action}`,owner,wrap(async(req,res)=>{
    try {const result=action==='order'?await payments.order(req.params.id):action==='verify'?await payments.verify(req.params.id,req.body):await payments.reconcile(req.params.id);res.json({...result,redirect:`/${base}/${req.params.id}`});}
    catch(error){res.status(error.status || 503).json({error:error.status?error.message:'Payment service unavailable. Check status before retrying.'});}
  }));
}
module.exports=router;
