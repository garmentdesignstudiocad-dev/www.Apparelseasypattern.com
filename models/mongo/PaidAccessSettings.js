const {Schema,model}=require('mongoose');
const section=new Schema({
  enabled:{type:Boolean,default:true}, active:{type:Boolean,default:true},
  fee:{type:Number,min:0,max:1000000,default:199},
  currency:{type:String,enum:['INR'],default:'INR'},
  button_text:{type:String,maxlength:80,default:''},
},{_id:false});
module.exports=model('PaidAccessSettings',new Schema({
  _id:{type:String,default:'default'},
  courses:{type:section,default:()=>({button_text:'Join Course'})},
  webinars:{type:section,default:()=>({button_text:'Register Webinar'})},
  books:{type:section,default:()=>({button_text:'Buy / Access Book'})},
  consulting:{type:section,default:()=>({button_text:'Book Consultation'})},
},{timestamps:true}));
