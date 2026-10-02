const Customer=require('../models/mongo/Customer');
module.exports=async(req,res,next)=>{try{
 res.set('Cache-Control','no-store');
 const id=req.session?.customerId;
 const customer=id && /^[a-f0-9]{24}$/i.test(id)?await Customer.findById(id).lean():null;
 if(!customer){
  if(req.session){delete req.session.customerId;req.session.customerReturnTo='/checkout';}
  if(req.method!=='GET' && req.is('application/json'))return res.status(401).json({error:'Sign in before checkout.',login_url:'/account/login'});
  return res.redirect(303,'/account/login');
 }
 req.accountCustomer=customer;next();
}catch(error){next(error);}};
