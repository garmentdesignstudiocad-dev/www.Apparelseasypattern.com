const crypto=require('crypto');
const Receipt=require('../models/mongo/Receipt');
const types={course_enquiry:'Lead',class_registration:'ClassRegistration',product_order:'Order',course_registration:'CourseBooking',webinar_registration:'WebinarRegistration',book_purchase:'BookPurchase',consultation_booking:'ConsultationBooking'};
const paise=value=>Math.round(Number(value || 0)*100);
async function context(type,id){
  if(!Object.hasOwn(types,type))throw new Error('Unknown reference type.');
  const row=await require('../models/mongo/'+types[type]).findById(id).lean();if(!row)return null;
  let customer,items;
  if(type==='course_enquiry')return {row,customer:{name:row.name,email:row.email,phone:row.whatsapp},items:[{name:row.interested_course || row.interest,quantity:1,amount_paise:0}],amount:0};
  if(type==='product_order'){
    customer=row.customer_snapshot?.email ? row.customer_snapshot : await require('../models/mongo/Customer').findById(row.customer_id).lean();
    items=await Promise.all(row.items.map(async item=>({name:item.product_name || (await require('../models/mongo/Product').findById(item.product_id).select('name').lean())?.name || 'Product',quantity:item.quantity || 1,amount_paise:paise(item.total_price)})));
  }else if(type==='class_registration'){
    customer={name:row.name,email:row.email,phone:row.phone};
    const session=await require('../models/mongo/ClassSession').findById(row.session_id).select('title').lean();
    items=[{name:session?.title || 'Class Registration',quantity:1,amount_paise:paise(row.amount)}];
  }else{
    customer={name:row.full_name || row.name,email:row.email,phone:row.whatsapp};
    let name=row.item_name || row.course_name;
    if(!name && type==='webinar_registration')name=(await require('../models/mongo/Webinar').findById(row.webinar_id).select('title').lean())?.title;
    items=[{name:name || 'Registration',quantity:1,amount_paise:row.amount_paise || 0}];
  }
  return {row,customer:customer || {},items,amount:type==='product_order'?paise(row.grand_total):type==='class_registration'?paise(row.amount):row.amount_paise || 0};
}
async function ensure(type,id){
  await Receipt.init();
  const existing=await Receipt.findOne({reference_type:type,reference_id:id}).select('+token').lean();if(existing)return existing;
  const data=await context(type,id);if(!data)return null;
  const {row,customer,items,amount}=data;
  // Only verifier-written timestamps qualify. A manual paid label is insufficient.
  if(!row.payment_verified_at || !['paid','Paid'].includes(row.payment_status))return null;
  const paymentId=type==='product_order'?row.payment_reference:row.razorpay_payment_id;
  if(!/^pay_[a-zA-Z0-9]+$/.test(paymentId || ''))return null;
  const site=await require('./siteSettingsService').getSiteSettings();
  const gst=type==='product_order'?paise(row.tax_amount):0,delivery=type==='product_order'?(row.courier_payment_separate?0:paise(row.delivery_charge)):0,discount=type==='product_order'?paise(row.discount_amount):0;
  const snapshot={delivery_flow_version:row.delivery_flow_version,courier_separate_paise:row.courier_payment_separate?paise(row.delivery_charge):undefined,reference_type:type,reference_id:id,token:crypto.randomBytes(32).toString('hex'),receipt_number:'R-'+String(id).toUpperCase(),business_name:site.store_name,business_address:site.address,contact_email:site.contact_email,contact_phone:site.contact_phone,customer_name:customer.name,email:customer.email,phone:customer.phone,items,subtotal_paise:amount-gst-delivery+discount,discount_paise:discount,gst_paise:gst,delivery_paise:delivery,total_paise:amount,currency:'INR',payment_id:paymentId,paid_at:row.payment_verified_at};
  try{return (await Receipt.create(snapshot)).toObject();}catch(error){if(error.code!==11000)throw error;return Receipt.findOne({reference_type:type,reference_id:id}).select('+token').lean();}
}
function publicOrigin(){
  // Production email links have one explicit source; never fall back to a request Host header.
  const value=process.env.APP_BASE_URL || (process.env.NODE_ENV==='production'?'':process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '');
  try{
    const url=new URL(value),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.username || url.password || url.search || url.hash || url.pathname!=='/')return '';
    if(process.env.NODE_ENV==='production' && local)return '';
    if(url.protocol!=='https:' && !(process.env.NODE_ENV!=='production' && local && url.protocol==='http:'))return '';
    return url.origin;
  }catch{return '';}
}
module.exports={types,context,ensure,publicOrigin};
