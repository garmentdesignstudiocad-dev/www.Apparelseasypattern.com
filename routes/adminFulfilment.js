const router=require('express').Router(),crypto=require('crypto'),fs=require('fs/promises'),path=require('path');
const Courier=require('../models/mongo/Courier'),Order=require('../models/mongo/Order'),Product=require('../models/mongo/Product');
const couriers=require('../services/courierService'),digital=require('../services/digitalDeliveryService');
const forms=require('../middleware/learningForms');
router.use((req,res,next)=>/^\/(settings\/couriers|orders\/[^/]+\/fulfilment|products\/[^/]+\/digital-files)(\/|$)/.test(req.path)?next():next('router'));
router.use(require('../middleware/adminAuth'));
router.use(require('express').raw({type:'application/octet-stream',limit:'30mb'}));
router.use((req,res,next)=>{
  if(req.is('application/octet-stream')){
    if(!require('../services/sessionFormTokens').valid(req,'learning-csrf',req.get('x-csrf-token')))return res.sendStatus(403);
    return next();
  }return forms(req,res,next);
});
const text=(body,key,max=300)=>{if(body[key]!==undefined && typeof body[key]!=='string')throw new Error('Invalid '+key);const value=(body[key]||'').trim();if(value.length>max)throw new Error('Invalid '+key);return value;};
router.param('id',(req,res,next,id)=>/^[a-f0-9]{24}$/i.test(id)?next():res.sendStatus(404));
router.get('/settings/couriers',async(req,res)=>{
  await require('../services/deliveryService').configureRegions();res.render('admin/couriers',{title:'Delivery Partner Settings',regions:await require('../models/mongo/DeliveryZone').find().lean(),items:await Courier.find().sort({priority:1,name:1}).lean()});
});
router.post('/settings/couriers',async(req,res)=>{
  try{
    const name=text(req.body,'name',100),website_url=text(req.body,'website_url',2048),tracking_url=text(req.body,'tracking_url',2048),contact=text(req.body,'contact'),id=text(req.body,'courier_id',100)||crypto.randomBytes(12).toString('hex');


    const delivery_min_days=req.body.delivery_min_days?Number(req.body.delivery_min_days):null,delivery_max_days=req.body.delivery_max_days?Number(req.body.delivery_max_days):null;
    if((delivery_min_days!==null || delivery_max_days!==null) && (!Number.isInteger(delivery_min_days) || !Number.isInteger(delivery_max_days) || delivery_min_days<1 || delivery_max_days<delivery_min_days || delivery_max_days>365))return res.status(400).send('Enter both delivery estimates, from 1 to 365 days, with maximum at least minimum.');
    const priority=Number(req.body.priority);
    const hubIds=[...new Set((Array.isArray(req.body.hub_ids)?req.body.hub_ids:[req.body.hub_ids]).filter(Boolean))];
    if(hubIds.some(id=>!['south','north'].includes(id)))return res.status(400).send('Choose Bengaluru or Mumbai.');
    if(!name || !/^[a-z0-9-]+$/.test(id) || !couriers.safeUrl(website_url) || !couriers.safeUrl(tracking_url) || !Number.isInteger(priority) || priority<0 || priority>10000)return res.status(400).send('Check name, HTTPS URLs, priority.');
    await Courier.findOneAndUpdate({_id:id},{$set:{delivery_min_days,delivery_max_days,name,website_url,tracking_url,contact,priority,active:(req.body.enabled ?? req.body.active)==='on'}},{upsert:true,runValidators:true});
    await require('../services/deliveryService').configureRegions();
    const Zone=require('../models/mongo/DeliveryZone');
    for(const hubId of ['south','north'])await Zone.updateOne({_id:hubId},hubIds.includes(hubId)?{$addToSet:{partner_ids:id}}:{$pull:{partner_ids:id}});
    res.redirect(303,'/admin/settings/couriers');
  }catch(error){if(error.name==='Error')return res.status(400).send(error.message);throw error;}
});
router.post('/orders/:id/fulfilment',async(req,res)=>{
  const row=await Order.findById(req.params.id).lean();if(!row)return res.sendStatus(404);
  if(!digital.physical(row))return res.status(409).send('This is a digital-only order.');
  try{
    const status=text(req.body,'shipping_status'),tracking_number=text(req.body,'tracking_number',100),dispatch=text(req.body,'dispatch_date'),courier_id=text(req.body,'courier_id',100);
    if(row.customer_selected_courier && courier_id!==row.courier_id)return res.status(409).send('Keep the customer selected courier.');
    const courier=courier_id?await Courier.findById(courier_id).lean():null;
    let tracking_url=text(req.body,'tracking_url',2048);
    if(courier_id && !courier)return res.status(400).send('Select a configured courier.');
    if(!tracking_url && courier?.tracking_url)tracking_url=courier.tracking_url.replaceAll('{awb}',encodeURIComponent(tracking_number));
    if(!['Confirmed','Preparing','Ready to Dispatch','Shipped','Delivered','Cancelled','Pending','Packed','In Transit','Returned'].includes(status) || !couriers.safeUrl(tracking_url) || (dispatch && (!/^\d{4}-\d{2}-\d{2}$/.test(dispatch) || !Number.isFinite(Date.parse(dispatch)) || new Date(dispatch).toISOString().slice(0,10)!==dispatch)))return res.status(400).send('Check status, dispatch date and HTTPS tracking URL.');
    if(['Shipped','In Transit','Delivered'].includes(status) && (!courier || !tracking_number || !dispatch || row.payment_status!=='paid' || !row.payment_verified_at))return res.status(409).send('Verify payment and enter courier, tracking number and dispatch date before shipping.');
    const update={$set:{courier_id,courier_name:row.customer_selected_courier?row.courier_name:(courier?.name||''),tracking_number,tracking_url,dispatch_date:dispatch?new Date(dispatch):null,shipping_status:status,order_status:status==='Cancelled'?'cancelled':status==='Delivered'?'delivered':['Shipped','In Transit'].includes(status)?'shipped':row.order_status},$inc:{shipping_version:1}};
    if(status==='Shipped'){
      const key='shipped-'+crypto.createHash('sha256').update([courier_id,tracking_number,dispatch,tracking_url].join('|')).digest('hex');
      if(!row.shipping_notification_keys?.includes(key))update.$addToSet={shipping_notification_keys:key,notification_jobs:{key,event:'shipped',status:'Shipped',detail:`Order ${row._id}; Courier: ${courier.name}; Tracking number: ${tracking_number}; Tracking link: ${tracking_url || 'Contact the studio for tracking.'}`}};
    }
    const filter={_id:row._id,...(row.shipping_version===undefined?{$or:[{shipping_version:0},{shipping_version:{$exists:false}}]}:{shipping_version:row.shipping_version})};
    if(!(await Order.updateOne(filter,update,{runValidators:true})).modifiedCount)return res.status(409).send('This order changed. Refresh and try again.');
    await require('../services/notificationService').safeFlush('product_order',row._id);
    res.redirect(303,'/admin/orders/'+row._id);
  }catch(error){if(error.name==='Error')return res.status(400).send(error.message);throw error;}
});
router.get('/products/:id/digital-files',async(req,res)=>{
  const product=await Product.findById(req.params.id).select('+digital_file').lean();if(!product)return res.sendStatus(404);
  const files=await require('../models/mongo/ProductFile').find({product_id:product._id}).select('+digital_file').lean();
  res.render('admin/digital-files',{title:'Private Pattern Files',product,files});
});
router.post('/products/:id/digital-files/:fileId?',async(req,res)=>{
  if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).send('Upload a file.');
  const ext=path.extname(decodeURIComponent(req.get('x-file-name')||'')).toLowerCase();
  if(!['.aama','.astm','.pdf','.zip','.dxf','.dwg','.ai','.eps','.plt'].includes(ext))return res.status(400).send('Use DXF, AAMA, ASTM, PDF, ZIP, DWG, AI, EPS or PLT.');
  if(req.params.fileId && !/^[a-f0-9]{24}$/i.test(req.params.fileId))return res.sendStatus(404);
  const Model=req.params.fileId?require('../models/mongo/ProductFile'):Product,filter=req.params.fileId?{_id:req.params.fileId,product_id:req.params.id}:{_id:req.params.id};
  if(!await Model.exists(filter))return res.sendStatus(404);
  const name=crypto.randomBytes(24).toString('hex')+ext;
  await fs.mkdir(digital.root(),{recursive:true});await fs.writeFile(path.join(await digital.privateRoot(),name),req.body,{flag:'wx',mode:0o600});
  await Model.updateOne(filter,{$set:{digital_file:name}});
  res.json({saved:true});
});
module.exports=router;
