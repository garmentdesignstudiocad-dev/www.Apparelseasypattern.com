const {Schema,model}=require('mongoose');
const schema=new Schema({
  request_key:String,session_owner:String,
  ...require('./accessFields'),
  email:{type:String,required:true,lowercase:true},whatsapp:{type:String,required:true},
  item_id:{type:Schema.Types.ObjectId,ref:'ConsultingService',required:true},item_name:String,
  preferred_date:String,preferred_time:String,notes:{type:String,maxlength:5000},
  status:{type:String,enum:['New','Contacted','Confirmed','Completed','Cancelled'],default:'New'},
  submission_key:{type:String,required:true,unique:true},
},{timestamps:true});
schema.index({request_key:1},{unique:true,partialFilterExpression:{request_key:{$type:'string'}}});
module.exports=model('ConsultationBooking',schema);
