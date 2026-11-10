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
// One immutable private binary per product, format and size. Replacement only
// changes the current mapping; already-issued orders retain their file version.
async function uploadSizeFile(productId,format,size,originalName,bytes) {
  const Product=require('../models/mongo/Product');
  const product=await Product.findById(productId).lean();
  const fail=message=>{throw Object.assign(new Error(message),{status:400});};
  if(!product)fail('Product not found.');
  if(!['dxf','hpgl','plt','pdf'].includes(format) || path.extname(originalName).toLowerCase()!=='.'+format)fail('Choose the actual file for the selected format.');
  if(!product.available_sizes?.includes(size))fail('Choose a saved product size. Save size changes first.');
  if(!Buffer.isBuffer(bytes) || !bytes.length || bytes.length>30*1024*1024)fail('Choose a file up to 30 MB.');
  const head=bytes.subarray(0,4096).toString('latin1');
  if(format==='pdf' && !head.startsWith('%PDF-'))fail('Invalid PDF content.');
  if(format==='dxf' && !head.startsWith('AutoCAD Binary DXF') && !/(?:^|[\r\n])\s*0\s*[\r\n]+\s*SECTION\s*(?:[\r\n]|$)/i.test(head))fail('Invalid DXF content.');
  if(['hpgl','plt'].includes(format) && !/(?:^|[;\s])(?:IN|PU|PD|PA|PR|SP|IP|SC|BP|DF)[-+0-9.,\s]*(?:;|$)/i.test(head))fail('Invalid plotter content.');
  await fs.mkdir(root(),{recursive:true});
  const directory=await privateRoot(),name=crypto.randomBytes(24).toString('hex')+'.'+format;
  await fs.writeFile(path.join(directory,name),bytes,{flag:'wx',mode:0o600});
  try {
    const result=await Product.updateOne({_id:productId,available_sizes:size},[{$set:{digital_file_map:{$concatArrays:[{$filter:{input:{$ifNull:['$digital_file_map',[]]},as:'entry',cond:{$not:[{$and:[{$eq:['$$entry.format',{$literal:format}]},{$eq:['$$entry.size',{$literal:size}]}]}]}}},{$literal:[{format,size,file:name}]}]}}}]);
    if(!result.matchedCount)fail('Product sizes changed. Reload the editor.');
  } catch(error) {await fs.unlink(path.join(directory,name)).catch(()=>{});throw error;}
  return {success:true,mapped:true,format,size,fileName:originalName};
}
async function ensure(id){
  let order=await Order.findById(id).select('+download_token +download_assets').lean();
  if(!order || order.payment_status!=='paid' || !order.payment_verified_at || order.order_status==='cancelled' || !order.items.length)return null;
  if(!order.items.some(item=>Number(item.quantity ?? 1)>0))return null;
  if(order.download_token){
    if(!order.download_assets?.length)return null;
    for(const asset of order.download_assets)if(!await filePath(asset.file))return null;
    return order;
  }
  const assets=[];
  for(const item of order.items){
    if(Number(item.quantity ?? 1)===0)continue;
    const product=await require('../models/mongo/Product').findById(item.product_id).select('+digital_file +digital_file_map').lean();
    const files=[];
    if(item.printable_selected!==false && item.selected_sizes?.length){
      if(!item.selected_formats?.length)return null;
      for(const format of [...new Set(item.selected_formats)])for(const size of [...new Set(item.selected_sizes)]){
        const match=(product?.digital_file_map || []).filter(entry=>entry.format===format && entry.size===size);
        if(match.length!==1 || path.extname(match[0].file)!=='.'+format)return null;
        files.push({name:product.name+' - '+format.toUpperCase()+' - '+size,file:match[0].file});
      }
    }else if(item.printable_selected!==false){
      // Legacy unsized purchases retain their explicitly configured base file.
      if(!product?.digital_file)return null;
      const ext=path.extname(product.digital_file).slice(1).toLowerCase();
      if(item.selected_formats?.length && (item.selected_formats.length!==1 || item.selected_formats[0]!==ext))return null;
      files.push({name:product.name,file:product.digital_file});
    }
    for(const selected of item.selected_files || []){
      const asset=await require('../models/mongo/ProductFile').findOne({_id:selected.id,product_id:item.product_id}).select('+digital_file').lean();
      if(!asset?.digital_file)return null;
      files.push({name:asset.file_name,file:asset.digital_file,watermark_pdf:asset.watermark_pdf===true && ['specs','tech_pack'].includes(asset.purpose) && path.extname(asset.digital_file).toLowerCase()==='.pdf'});
    }
    if(!files.length)return null;
    for(const asset of files){if(!await filePath(asset.file))return null;if(!assets.some(existing=>existing.file===asset.file))assets.push(asset);}
  }
  const issuedAt=new Date();
  const grant={download_token:crypto.randomBytes(32).toString('hex'),digital_delivery_issued_at:issuedAt,download_expires_at:new Date(issuedAt.getTime()+86400000),download_assets:assets};
  await Order.updateOne({_id:id,payment_status:'paid',payment_verified_at:{$ne:null},order_status:{$ne:'cancelled'},download_token:{$exists:false}},{$set:grant,$addToSet:{notification_jobs:{key:'digital-ready',event:'digital_ready',status:'Download ready'}}});
  return Order.findById(id).select('+download_token +download_assets').lean();
}
async function reconcile(){
  for await(const order of Order.find({payment_status:'paid',payment_verified_at:{$ne:null},download_token:{$exists:false},order_status:{$ne:'cancelled'},'items.quantity':{$gt:0}}).select('_id').lean().cursor())await ensure(order._id);
}

async function reissue(id) {
  const order = await ensure(id);
  if (!order?.download_token || !order.download_assets?.length) return null;
  for (const asset of order.download_assets) if (!await filePath(asset.file)) return null;
  const issuedAt = new Date();
  const updated = await Order.findOneAndUpdate({ _id:id, payment_status:'paid', payment_verified_at:{$ne:null}, order_status:{$ne:'cancelled'}, download_token:order.download_token }, {
    $set:{download_token:crypto.randomBytes(32).toString('hex'),download_expires_at:new Date(issuedAt.getTime()+86400000),digital_delivery_issued_at:issuedAt},
    $push:{notification_jobs:{key:crypto.randomUUID(),event:'digital_ready',status:'Download ready'}}
  }, {new:true}).select('+download_token +download_assets').lean();
  if (updated) await require('./notificationService').safeFlush('product_order',id);
  return updated;
}
async function manualGrant(id, customAssets) {
  // Manual delivery cannot extend an order to arbitrary private files.
  const order = await ensure(id);
  if (!order?.download_assets?.length) return null;
  if (customAssets && (!Array.isArray(customAssets) || customAssets.length !== order.download_assets.length || customAssets.some(asset => !order.download_assets.some(purchased => purchased.file === asset.file)))) return null;
  return reissue(id);
}

module.exports={uploadSizeFile,ensure,reconcile,reissue,manualGrant,root,privateRoot,filePath,physical};
