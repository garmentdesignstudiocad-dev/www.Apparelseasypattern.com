const {Schema}=require('mongoose');
const job=new Schema({key:{type:String,required:true},event:{type:String,required:true},status:String,detail:String},{_id:false});
module.exports={
  payment_verified_at:Date,
  notification_jobs:{type:[job],default:()=>[{key:'created',event:'created',status:'Received'}]},
};
