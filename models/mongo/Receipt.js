const {Schema,model}=require('mongoose');
const schema=new Schema({
  reference_type:{type:String,required:true},reference_id:{type:Schema.Types.ObjectId,required:true},
  token:{type:String,required:true,unique:true,select:false},receipt_number:{type:String,required:true,unique:true},
  business_name:String,business_address:String,contact_email:String,contact_phone:String,
  customer_name:String,email:String,phone:String,
  items:[{name:String,quantity:Number,amount_paise:Number}],
  delivery_flow_version:Number,
  courier_separate_paise:Number,
  subtotal_paise:Number,discount_paise:Number,gst_paise:Number,delivery_paise:Number,total_paise:Number,
  currency:{type:String,enum:['INR'],default:'INR'},payment_id:{type:String,required:true},
  payment_status:{type:String,enum:['Paid'],default:'Paid'},paid_at:{type:Date,required:true},
},{timestamps:true});
schema.index({reference_type:1,reference_id:1},{unique:true});
module.exports=model('Receipt',schema);
