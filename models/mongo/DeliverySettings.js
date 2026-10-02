const { Schema, model } = require('mongoose');
const schema = new Schema({ key:{type:String,default:'default',unique:true}, enabled:{type:Boolean,default:true}, default_charge:{type:Number,default:0,min:0} },{timestamps:true});
schema.add({free_delivery_enabled:{type:Boolean,default:false},free_delivery_threshold:{type:Number,min:0,max:1000000,default:0}});
module.exports=model('DeliverySettings',schema);
