const { safeUrl } = require('../config/appearance');
module.exports=(req,res,next)=>{
  if(req.method!=='POST')return next();
  const body=req.body || {};
  try { require('../services/productMetadata').parse(body); } catch(error){return res.status(400).send(error.message);}
  const numeric=/^(?:price|.*_price|percentage|default_charge|delivery_charge|free_delivery_threshold|discount_value|minimum_order_value|max_seats)$/;
  for(const [key,value] of Object.entries(body)) {
    if(numeric.test(key) && value!=='' && (typeof value!=='string' || !/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value)>1000000)) return res.status(400).send('Enter valid non-negative prices and numeric values.');
    if(['logo_url','main_website_url','banner_image','meeting_link','promotional_url','linkedin_post_url'].includes(key) && value && !safeUrl(value)) return res.status(400).send('Use a valid http or https link.');
  }
  if(body.percentage!==undefined && Number(body.percentage)>100)return res.status(400).send('GST percentage must be between 0 and 100.');
  if(body.discount_type==='percentage' && Number(body.discount_value)>100)return res.status(400).send('Percentage discounts cannot exceed 100.');
  if(body.expires_at && (!/^\d{4}-\d{2}-\d{2}$/.test(body.expires_at) || !Number.isFinite(Date.parse(body.expires_at)) || new Date(body.expires_at).toISOString().slice(0,10)!==body.expires_at))return res.status(400).send('Enter a valid expiry date.');
  if(body.pincode!==undefined && !/^(?:\d{6}|\d{1,5}\*)$/.test(String(body.pincode).trim())) return res.status(400).send('Enter a valid 6-digit pincode.');
  next();
};
