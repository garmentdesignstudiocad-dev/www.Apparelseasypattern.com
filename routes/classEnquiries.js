const router=require('express').Router();
const Lead=require('../models/mongo/Lead');
const validation=require('../services/businessValidation');
router.use('/classes/enquiry',require('../middleware/learningForms'));
const render=(res,values={},error='')=>res.render('classes/enquiry',{title:'Online Classes Available',description:'Enquire about online pattern making and garment technology classes. Share your experience, preferred timing and learning interests. No payment required.',values,error});
router.get('/classes/enquiry',(req,res)=>render(res));
router.post('/classes/enquiry',async(req,res,next)=>{
  let data;
  try{
    data=validation.lead({...req.body,interest:'Online Classes',source:'/classes/enquiry'});
    data.interested_course=validation.text(req.body,'interested_course',300,true);
    for(const key of ['location','experience','preferred_timing'])data[key]=validation.text(req.body,key,300,true);
  }catch(error){return render(res.status(400),req.body,error.message);}
  if(req.session.lastClassEnquiry && Date.now()-req.session.lastClassEnquiry<30000)return render(res.status(429),req.body,'Please wait 30 seconds before sending another enquiry.');
  try{const lead=await Lead.create({...data,notification_jobs:[{key:'created',event:'created',status:'Enquiry received'}]});await require('../services/notificationService').safeFlush('course_enquiry',lead._id);req.session.lastClassEnquiry=Date.now();req.session.classEnquirySent=true;req.session.save(error=>error?next(error):res.redirect(303,'/classes/enquiry/thank-you'));}catch(error){next(error);}
});
router.get('/classes/enquiry/thank-you',(req,res)=>{
  if(!req.session.classEnquirySent)return res.redirect('/classes/enquiry');
  res.render('classes/enquiry',{title:'Enquiry Received',description:'Thank you. The studio will contact you about online classes. No payment has been taken.',values:{},error:'',sent:true});
});
module.exports=router;
