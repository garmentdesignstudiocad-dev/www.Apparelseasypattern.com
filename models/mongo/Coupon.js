const { Schema, model } = require('mongoose');
const schema = new Schema({ code:{type:String,required:true,unique:true,uppercase:true,trim:true}, discount_type:{type:String,enum:['percentage','fixed'],required:true}, discount_value:{type:Number,required:true,min:0}, minimum_order_value:{type:Number,default:0,min:0}, expires_at:{type:Date}, active:{type:Boolean,default:true} },{timestamps:true});
module.exports=model('Coupon',schema);
