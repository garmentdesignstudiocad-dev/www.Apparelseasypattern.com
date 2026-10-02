const crypto=require('crypto'),path=require('path'),fs=require('fs/promises');
const Order=require('../models/mongo/Order');
const physical=order=>order.items.some(item=>item.physical_quantity>0 || item.trial_quantity>0);
function root(){const dir=path.resolve(process.env.PATTERN_FILES_DIR || path.join(__dirname,'../private/patterns'));const publicDir=path.resolve(__dirname,'../public');if(dir===publicDir || dir.startsWith(publicDir+path.sep))throw new Error('Pattern files must be outside public.');return dir;}
async function privateRoot(){
  const base=await fs.realpath(root()),publicDir=await fs.realpath(path.join(__dirname,'../public'));
  const relative=path.relative(publicDir,base);
  if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative)))throw new Error('Pattern files must be outside public.');
  return base;
}
async function filePath(file){
  if(typeof file!=='string' || !/^[a-zA-Z0-9_.-]+$/.test(file) || file==='.' || file==='..')return null;
  try{const base=await privateRoot(),actual=await fs.realpath(path.join(base,file));if(!actual.startsWith(base+path.sep) || !(await fs.stat(actual)).isFile())return null;return actual;}catch{return null;}
}
async function ensure(id){
  let order=await Order.findById(id).select('+download_token +download_assets').lean();
  if(!order || order.payment_status!=='paid' || !order.payment_verified_at || order.order_status==='cancelled' || !order.items.length)return null;
  if(!order.items.some(item=>Number(item.quantity ?? 1)>0))return null;
  if(order.download_token)return order;
  const assets=[];
  for(const item of order.items){
    if(Number(item.quantity ?? 1)===0)continue;
    const product=await require('../models/mongo/Product').findById(item.product_id).select('+digital_file').lean();
    const files=[];
    if(product?.digital_file)files.push({name:product.name,file:product.digital_file});
    for(const selected of item.selected_files || []){
      const asset=await require('../models/mongo/ProductFile').findOne({_id:selected.id,product_id:item.product_id}).select('+digital_file').lean();
      if(!asset?.digital_file)return null;
      files.push({name:asset.file_name,file:asset.digital_file});
    }
    if(!files.length)return null;
    for(const asset of files){if(!await filePath(asset.file))return null;if(!assets.some(existing=>existing.file===asset.file))assets.push(asset);}
  }
  const grant={download_token:crypto.randomBytes(32).toString('hex'),download_expires_at:new Date(Date.now()+30*86400000),download_assets:assets};
  await Order.updateOne({_id:id,payment_status:'paid',payment_verified_at:{$ne:null},order_status:{$ne:'cancelled'},download_token:{$exists:false}},{$set:grant,$addToSet:{notification_jobs:{key:'digital-ready',event:'digital_ready',status:'Download ready'}}});
  return Order.findById(id).select('+download_token +download_assets').lean();
}
async function reconcile(){
  for await(const order of Order.find({payment_status:'paid',payment_verified_at:{$ne:null},download_token:{$exists:false},order_status:{$ne:'cancelled'},'items.quantity':{$gt:0}}).select('_id').lean().cursor())await ensure(order._id);
}
module.exports={ensure,reconcile,root,privateRoot,filePath,physical};
