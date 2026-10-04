const router=require('express').Router();
const validation=require('../services/businessValidation');
router.use('/classes/enquiry',require('../middleware/learningForms'));
const render=(res,values={},error='',sent=false)=>res.render('classes/enquiry',{title:sent?'Enquiry Received':'Become a Professional Pattern Maker',description:sent?'Thank you. We will review your enquiry and respond separately.':'Learn pattern making online with practical guidance from experienced professionals, wherever you are. Build your skills through focused online learning and practical pattern development.',values,error,sent});
router.get('/classes/enquiry',(req,res)=>render(res));
router.post('/classes/enquiry',async(req,res,next)=>{
  let data;
  try{
    if(req.body.consent!=='on')throw new Error('Please allow us to contact you about this enquiry.');
    data=validation.lead({...req.body,interest:'Online Classes',source:'/classes/enquiry'});
    if(!['Student','Working Professional','Business Owner','Other'].includes(data.profession))throw new Error('Select your profession / current status.');
    data.interested_course='Online Pattern Making';
    data.studying=validation.text(req.body,'studying',300,data.profession==='Student');
    data.current_role=validation.text(req.body,'current_role',300,['Working Professional','Business Owner'].includes(data.profession));
    if(['Working Professional','Business Owner'].includes(data.profession) && (!/^\d{1,2}(?:\.\d)?$/.test(data.experience) || Number(data.experience)>80))throw new Error('Enter years of experience from 0 to 80.');
    if(data.profession==='Student'){data.current_role='';data.experience='';}else{data.studying='';}
  }catch(error){return render(res.status(400),req.body,error.message);}
  if(req.session.lastClassEnquiry && Date.now()-req.session.lastClassEnquiry<30000)return render(res.status(429),req.body,'Please wait 30 seconds before sending another enquiry.');
  try{
    const lead=await require('../services/patternLeads').save({...data,notification_jobs:[{key:'created',event:'created',status:'Enquiry received'}]});
    await require('../services/notificationService').safeFlush('course_enquiry',lead._id);
    req.session.lastClassEnquiry=Date.now();req.session.classEnquirySent=true;
    req.session.save(error=>error?next(error):res.redirect(303,'/classes/enquiry/thank-you'));
  }catch(error){next(error);}
});
router.get('/classes/enquiry/thank-you',(req,res)=>req.session.classEnquirySent?render(res,{},'',true):res.redirect('/classes/enquiry'));
module.exports=router;
