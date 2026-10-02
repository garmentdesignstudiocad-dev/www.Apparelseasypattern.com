const { Schema, model } = require('mongoose');
const schema = new Schema({ key:{type:String,default:'default',unique:true}, enabled:{type:Boolean,default:true}, percentage:{type:Number,default:18,min:0,max:100}, label:{type:String,default:'GST',trim:true} },{timestamps:true});
module.exports=model('TaxSettings',schema);
