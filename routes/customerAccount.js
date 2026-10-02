const router=require('express').Router(),Customer=require('../models/mongo/Customer'),Order=require('../models/mongo/Order');
const passwords=require('../services/customerPasswords'),tokens=require('../services/sessionFormTokens');
const attempts=new Map();
const email=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validEmail=value=>value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
router.use((req,res,next)=>{if(req.path==='/login' || req.path.startsWith('/account')){req.session.customerForms=true;res.set('Cache-Control','no-store');}res.locals.customerSignedIn=Boolean(req.session.customerId);res.locals.customerCsrf=tokens.issue(req,'customer-account');next();});
const page=(req,res,mode,error='',status=200)=>res.status(status).render('customer_auth',{title:mode==='register'?'Create Account':'Sign In',mode,error,csrf:tokens.issue(req,'customer-account')});
async function establish(req,id){const cart=req.session.cart,target=['/checkout','/cart'].includes(req.session.customerReturnTo)?req.session.customerReturnTo:'/account';await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));req.session.customerId=String(id);req.session.cart=cart;await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));return target;}
function form(req,res,next){res.set('Cache-Control','no-store');if(!tokens.valid(req,'customer-account',req.body._csrf))return res.status(403).send('Form expired. Reload and try again.');next();}
function limit(req,res,next){const now=Date.now(),key=req.ip;let row=attempts.get(key);if(!row || row.until<now){row={count:0,until:now+15*60000};attempts.set(key,row);}if(attempts.size>10000)for(const [ip,value] of attempts)if(value.until<now)attempts.delete(ip);if(++row.count>30)return res.status(429).send('Too many attempts. Please try again later.');next();}
router.get(['/login','/account/login'],(req,res)=>page(req,res,'login'));
router.get('/account/register',(req,res)=>page(req,res,'register'));
router.post('/account/register',form,limit,async(req,res,next)=>{try{
 const name=typeof req.body.name==='string'?req.body.name.trim():'',mail=email(req.body.email),phone=typeof req.body.phone==='string'?req.body.phone.trim():'';
 const password=req.body.password;
 if(!name || name.length>200 || !validEmail(mail) || !/^\d{10}$/.test(phone) || typeof password!=='string' || password.length<12 || password.length>128 || password!==req.body.confirm_password)return page(req,res,'register','Enter valid details and matching passwords of 12–128 characters.',400);
 const password_hash=await passwords.hash(password);
 // A guest contact can gain credentials, but historical orders are NEVER claimed by email.
 let customer=await Customer.findOneAndUpdate({email:mail,password_hash:{$exists:false}},{$set:{name,phone,password_hash}},{new:true});
 if(!customer){if(await Customer.exists({email:mail}))return page(req,res,'register','An account already exists. Please sign in.',409);customer=await Customer.create({name,email:mail,phone,password_hash});}
 res.redirect(303,await establish(req,customer._id));
}catch(error){if(error.code===11000)return page(req,res,'register','An account already exists. Please sign in.',409);next(error);}});
router.post('/account/login',form,limit,async(req,res,next)=>{try{
 const mail=email(req.body.email),password=req.body.password;
 if(!validEmail(mail) || typeof password!=='string' || password.length>128)return page(req,res,'login','Invalid email or password.',400);
 const customer=await Customer.findOne({email:mail}).select('+password_hash');
 if(!await passwords.verify(password,customer?.password_hash))return page(req,res,'login','Invalid email or password.',401);
 res.redirect(303,await establish(req,customer._id));
}catch(error){next(error);}});
router.post('/account/logout',form,(req,res,next)=>req.session.destroy(error=>{if(error)return next(error);res.clearCookie('connect.sid');res.redirect(303,'/login');}));
router.use('/account',async(req,res,next)=>{try{res.set('Cache-Control','no-store');if(!req.session.customerId)return res.redirect(303,'/login');const customer=await Customer.findById(req.session.customerId).lean();if(!customer)return res.redirect(303,'/login');req.accountCustomer=customer;next();}catch(e){next(e);}});
router.get(['/account','/account/orders'],async(req,res,next)=>{try{
 const orders=await Order.find({account_customer_id:req.accountCustomer._id}).sort({createdAt:-1}).lean();res.render('customer_account',{title:'My Account',customer:req.accountCustomer,orders});
}catch(e){next(e);}});
router.get('/account/orders/:id/download',async(req,res,next)=>{try{
 if(!/^[a-f0-9]{24}$/i.test(req.params.id))return res.sendStatus(404);
 const order=await Order.findOne({_id:req.params.id,account_customer_id:req.accountCustomer._id,payment_status:'paid',payment_verified_at:{$ne:null},order_status:{$ne:'cancelled'},download_expires_at:{$gt:new Date()}}).select('+download_token').lean();
 if(!order?.download_token)return res.sendStatus(404);res.redirect(303,'/downloads/'+order.download_token);
}catch(e){next(e);}});
module.exports=router;
