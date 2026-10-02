
const {Schema,model}=require('mongoose');
module.exports=model('DeliveryZone',new Schema({
  _id:{type:String},states:{type:[String],default:[]},partner_ids:{type:[String],default:[]},name:{type:String,required:true,maxlength:100},
  dispatch_location:{type:String,required:true,maxlength:200},active:{type:Boolean,default:true}
},{timestamps:true}));
