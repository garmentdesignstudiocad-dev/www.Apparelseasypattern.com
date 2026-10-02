const { Schema, model } = require('mongoose');
const schema = new Schema({ key:{type:String,default:'default',unique:true}, soft_copy_price:{type:Number,default:0,min:0}, additional_size_price:{type:Number,default:0,min:0}, physical_pattern_price:{type:Number,default:0,min:0}, trial_sample_price:{type:Number,default:0,min:0} },{timestamps:true});
module.exports=model('PricingSettings',schema);
