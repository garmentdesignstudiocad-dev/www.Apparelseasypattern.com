const {Schema,model}=require('mongoose');
const schema=new Schema({state:{type:String,required:true,maxlength:100},city:{type:String,required:true,maxlength:100},state_key:{type:String,required:true},city_key:{type:String,required:true},hub_id:{type:String,required:true},partner_ids:{type:[String],default:[]},active:{type:Boolean,default:true}},{timestamps:true});
schema.index({state_key:1,city_key:1},{unique:true});
module.exports=model('CityRoute',schema);
