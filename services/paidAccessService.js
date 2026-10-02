const Settings=require('../models/mongo/PaidAccessSettings');
const {createService}=require('./webinarPaymentService');
const purposes={courses:'course_registration',webinars:'webinar_registration',books:'book_purchase',consulting:'consultation_booking'};
async function getSettings() {
  const current=await Settings.findById('default').lean();
  if(current)return current;
  try {return await Settings.findOneAndUpdate({_id:'default'},{$setOnInsert:{_id:'default'}},{upsert:true,new:true,setDefaultsOnInsert:true}).lean();}
  catch(error){if(error.code!==11000)throw error;return Settings.findById('default').lean();}
}
function quote(kind,item,settings) {
  const section=settings[kind];
  const external=kind==='books' && (item.purchase_type || (item.amazon_url?'external':'free'))==='external';
  const free=kind==='books' && (item.purchase_type || (item.amazon_url?'external':'free'))==='free';
  const fee=external || free || !section.enabled ? 0 : (item.price == null ? section.fee : item.price);
  if(!Number.isFinite(fee) || fee<0 || fee>1000000) throw new Error('Invalid access price.');
  return {active:section.active,external,amount_paise:Math.round(fee*100),price:fee,button:section.button_text,currency:'INR'};
}
function snapshot(kind,item,settings) {
  const price=quote(kind,item,settings);
  if(!price.active || price.external) throw Object.assign(new Error('Direct access is unavailable.'),{status:409});
  return {payment_purpose:purposes[kind],amount_paise:price.amount_paise,currency:'INR',payment_status:price.amount_paise?'Pending':'Not Required',registration_status:price.amount_paise?'Payment Pending':'Confirmed'};
}
function paymentService(Model,purpose,options={}) {
  return createService({...options,RegistrationModel:Model,purpose,receiptPrefix:purpose==='course_registration'?'crs':purpose==='book_purchase'?'book':'con',seatBased:false});
}
async function getConsultingServices() {
  const Model=require('../models/mongo/ConsultingService');
  // Preserve the established service catalog on first use; future edits stay owner-controlled.
  if(!await Model.exists({})) {
    const services=require('../config/business').services;
    try {await Model.bulkWrite(services.map(name=>{const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');return {updateOne:{filter:{slug},update:{$setOnInsert:{name,slug,description:'',price:null,active:true}},upsert:true}};}),{ordered:false});}
    catch(error){if(error.code!==11000 || error.writeErrors?.some(e=>e.code!==11000))throw error;}
  }
  return Model;
}
module.exports={getConsultingServices,getSettings,quote,snapshot,paymentService,purposes};
