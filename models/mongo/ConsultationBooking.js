const {Schema,model}=require('mongoose');
const schema=new Schema({
  request_key:String,session_owner:String,
  ...require('./accessFields'),
  email:{type:String,required:true,lowercase:true},whatsapp:{type:String,required:true},
  item_id:{type:Schema.Types.ObjectId,ref:'ConsultingService',required:true},item_name:String,
  preferred_date:String,preferred_time:String,notes:{type:String,maxlength:5000},
  // No default: absent means a historical booking, whose existing state is preserved.
  scheduling_status:{type:String,enum:['Pending','Approved','Proposed','Accepted','Declined']},
  scheduled_date:String,scheduled_time:String,
  scheduling_decided_at:Date,alternative_accepted_at:Date,
  status:{type:String,enum:['New','Contacted','Confirmed','Completed','Cancelled'],default:'New'},
  submission_key:{type:String,required:true,unique:true},
},{timestamps:true});
schema.index({request_key:1},{unique:true,partialFilterExpression:{request_key:{$type:'string'}}});
schema.statics.schedulingReady=function(row){
  return !row.scheduling_status || ['Approved','Accepted'].includes(row.scheduling_status);
};
schema.statics.confirmScheduled=async function(id){
  // Both gates are checked in the same write, including when payment races a decision.
  return this.findOneAndUpdate({_id:id,scheduling_status:{$in:['Approved','Accepted']},
    registration_status:{$in:['Registered','Payment Pending']},
    $or:[{payment_status:'Paid',payment_verified_at:{$type:'date'}},{payment_status:'Not Required',amount_paise:0}]},
    {$set:{registration_status:'Confirmed',status:'Confirmed'},$addToSet:{notification_jobs:{key:'schedule-confirmed',event:'status_update',status:'Booking confirmed'}}},{new:true,runValidators:true});
};
schema.statics.decideSchedule=async function(id,action,body={}){
  const fail=(message,status=409)=>Object.assign(new Error(message),{status});
  if(!['approve','propose','decline','accept','reject'].includes(action))throw fail('Invalid scheduling action.',400);
  const row=await this.findById(id);
  if(!row)throw fail('Booking not found.',404);
  const customerResponse=['accept','reject'].includes(action);
  const expected=customerResponse?'Proposed':'Pending';
  if(row.scheduling_status!==expected || row.registration_status==='Cancelled')throw fail('This request has changed. Reload before continuing.');
  if(customerResponse && body.proposal!==row.scheduling_decided_at?.toISOString())throw fail('This proposal has changed. Reload before responding.');
  let date=row.preferred_date,time=row.preferred_time;
  if(action==='propose'){
    const validation=require('../../services/learningValidation');
    try {date=validation.date(body,'scheduled_date');time=validation.time(body,'scheduled_time');}
    catch(error){throw fail(error.message,400);}
    if(date===row.preferred_date && time===row.preferred_time)throw fail('Approve the requested time instead.',400);
  }else if(action==='accept'){date=row.scheduled_date;time=row.scheduled_time;}
  if(!['decline','reject'].includes(action) && !(new Date(`${date}T${time}:00+05:30`)>new Date()))throw fail('Choose a future date and time (Asia/Kolkata).',400);
  const state={approve:'Approved',propose:'Proposed',decline:'Declined',accept:'Accepted',reject:'Proposed'}[action];
  const now=new Date(),set={scheduling_status:state};
  if(action==='accept')set.alternative_accepted_at=now;
  else if(!customerResponse)set.scheduling_decided_at=now;
  if(['decline','reject'].includes(action))Object.assign(set,{registration_status:'Cancelled',status:'Cancelled'});
  else Object.assign(set,{scheduled_date:date,scheduled_time:time});
  const detail=action==='decline'?'Request declined. Any paid refund requires separate studio review.':`${date} ${time} Asia/Kolkata (UTC+05:30). ${action==='propose'?'Customer acceptance is required; this is not a confirmed appointment.':'Confirmation also requires verified payment if a fee applies.'}`;
  const job=action==='reject'?{key:'schedule-rejected',event:'status_update',status:'Customer rejected proposed time — booking cancelled',detail:`Customer rejected ${row.scheduled_date} ${row.scheduled_time} Asia/Kolkata (UTC+05:30) at ${now.toISOString()}. Any paid refund requires separate studio review.`}:{key:'schedule-'+state.toLowerCase(),event:'status_update',status:'Scheduling '+state.toLowerCase(),detail};
  const changed=await this.findOneAndUpdate({_id:id,scheduling_status:expected,registration_status:{$ne:'Cancelled'},...(customerResponse?{scheduling_decided_at:row.scheduling_decided_at}:{})},{$set:set,$addToSet:{notification_jobs:job}},{new:true,runValidators:true});
  if(!changed)throw fail('This request has already been handled. Reload before continuing.');
  await this.confirmScheduled(id);
  return this.findById(id);
};
module.exports=model('ConsultationBooking',schema);
