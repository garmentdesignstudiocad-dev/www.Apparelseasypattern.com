const {Schema,model}=require('mongoose');
module.exports=model('Courier',new Schema({
  _id:{type:String},name:{type:String,required:true,maxlength:100},
  charge:{type:Number,min:0,max:1000000,default:null},
  region_ids:{type:[String],default:[]},
  delivery_min_days:{type:Number,min:1,max:365,default:null},
  delivery_max_days:{type:Number,min:1,max:365,default:null},
  website_url:{type:String,default:''},tracking_url:{type:String,default:''},contact:{type:String,default:'',maxlength:300},
  pincodes:{type:[String],default:[]},priority:{type:Number,default:100,min:0,max:10000},active:{type:Boolean,default:false},
},{timestamps:true}));
