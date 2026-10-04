const router=require('express').Router(),validation=require('../services/businessValidation');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.use(['/pattern-updates','/books/notify'],require('../middleware/learningForms'));
function render(res,kind,values={},error='',sent=false){return res.render('pattern-updates',{title:kind==='books'?'Book Availability Updates':'Get Pattern Updates',description:kind==='books'?'Receive an email when books become available.':'Get updates as new ready-to-use pattern styles are added.',kind,values,error,sent});}
for(const [url,kind,interest] of [['/pattern-updates','patterns','Digital Patterns'],['/books/notify','books','Books']]){
  router.get(url,(req,res)=>render(res,kind));
  router.post(url,wrap(async(req,res)=>{
    let data;
    try{
      if(req.body.consent!=='on')throw new Error('Please give permission to receive these updates.');
      const email=validation.text(req.body,'email',300,true).toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email address.');
      data=kind==='books'?{email,name:'',whatsapp:'',interest,source:url}:validation.lead({...req.body,email,interest,source:url});
    }catch(error){return render(res.status(400),kind,req.body,error.message);}
    if(req.session.lastPatternLead && Date.now()-req.session.lastPatternLead<30000)return render(res.status(429),kind,req.body,'Please wait 30 seconds before sending another request.');
    await require('../services/patternLeads').save(data);req.session.lastPatternLead=Date.now();
    return render(res,kind,{},'',true);
  }));
}
module.exports=router;
