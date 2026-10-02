const router=require('express').Router(),Order=require('../models/mongo/Order'),delivery=require('../services/digitalDeliveryService');
router.get('/downloads/:token/:asset?',async(req,res,next)=>{
  try{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
    if(!/^[a-f0-9]{64}$/.test(req.params.token))return res.sendStatus(404);
    const row=await Order.findOne({download_token:req.params.token,payment_status:'paid',payment_verified_at:{$ne:null},order_status:{$ne:'cancelled'},download_expires_at:{$gt:new Date()}}).select('+download_assets').lean();
    if(row?.account_customer_id && !req.session?.customerId)return res.redirect(303,'/account/login');
    if(row?.account_customer_id && req.session?.customerId && String(row.account_customer_id)!==String(req.session.customerId))return res.sendStatus(404);
    if(!row)return res.status(404).send('Download access is unavailable or expired. Contact the studio with your order reference.');
    if(req.params.asset===undefined)return res.render('downloads',{assets:row.download_assets,token:req.params.token,expires:row.download_expires_at});
    if(!/^\d+$/.test(req.params.asset))return res.sendStatus(404);
    const asset=row.download_assets?.[Number(req.params.asset)];if(!asset)return res.sendStatus(404);
    const file=await delivery.filePath(asset.file);if(!file)return res.status(503).send('This file is temporarily unavailable. Contact the studio.');
    res.download(file,(asset.name.replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,80)||'pattern')+require('path').extname(file),error=>{if(error && !res.headersSent)next(error);});
  }catch(error){next(error);}
});
module.exports=router;
