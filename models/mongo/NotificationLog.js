const {Schema,model}=require('mongoose');
module.exports=model('NotificationLog',new Schema({
  dedupe_key:{type:String,required:true,unique:true},
  channel:{type:String,enum:['email','whatsapp'],required:true},event:{type:String,required:true,index:true},category:String,
  reference_type:String,reference_id:Schema.Types.ObjectId,customer:String,destination:String,
  status:{type:String,enum:['queued','pending','sending','sent','failed','uncertain','skipped'],default:'queued',index:true},
  failure_alert_recorded:{type:Boolean,default:false},
  subject:String,message:String,parameters:[String],schedule_at:Date,
  provider_response_id:{type:String,default:''},error_message:{type:String,default:''},
  sent_at:Date,locked_at:Date,attempts:{type:Number,default:0},
},{timestamps:true}));
