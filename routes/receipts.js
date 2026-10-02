const express=require('express');
const Receipt=require('../models/mongo/Receipt');
const service=require('../services/receiptService');
const router=express.Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const sessions={class_registration:'classRegistrations',product_order:'completedOrderIds',course_registration:'courseBookingIds',webinar_registration:'webinarRegistrationIds',book_purchase:'book-purchases',consultation_booking:'consultation-bookings'};
router.get('/receipts/for/:type/:id',wrap(async(req,res)=>{
  const {type,id}=req.params;
  if(!Object.hasOwn(sessions,type) || !/^[a-f\d]{24}$/i.test(id))return res.sendStatus(404);
  if(!req.session.isAdmin && !req.session[sessions[type]]?.includes(id))return res.status(403).send('Use the registering browser or the private receipt link sent to you.');
  const receipt=await service.ensure(type,id);
  if(!receipt)return res.status(409).send('A paid receipt is available only after successful server payment verification.');
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).redirect(303,`/receipts/${receipt.token}`);
}));
router.get('/receipts/:token',wrap(async(req,res)=>{
  if(!/^[a-f\d]{64}$/.test(req.params.token))return res.sendStatus(404);
  const receipt=await Receipt.findOne({token:req.params.token}).lean();if(!receipt)return res.sendStatus(404);
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"}).render('receipt',{receipt});
}));
module.exports=router;
