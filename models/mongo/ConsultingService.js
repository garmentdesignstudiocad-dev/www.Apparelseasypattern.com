const {Schema,model}=require('mongoose');
module.exports=model('ConsultingService',new Schema({
  name:{type:String,required:true,maxlength:200},
  slug:{type:String,required:true,unique:true,match:/^[a-z0-9]+(?:-[a-z0-9]+)*$/},
  description:{type:String,maxlength:5000,default:''},
  price:{type:Number,min:0,max:1000000,default:null},
  active:{type:Boolean,default:true},
},{timestamps:true}));
