const {Schema,model}=require('mongoose');
const schema=new Schema({
  request_key:String,session_owner:String,
  ...require('./accessFields'),
  email:{type:String,required:true,lowercase:true},whatsapp:{type:String,required:true},
  item_id:{type:Schema.Types.ObjectId,ref:'Book',required:true},item_name:String,
  purchase_type:{type:String,enum:['direct','free']},
  submission_key:{type:String,required:true,unique:true},
},{timestamps:true});
schema.index({request_key:1},{unique:true,partialFilterExpression:{request_key:{$type:'string'}}});
module.exports=model('BookPurchase',schema);
