const {Schema,model}=require('mongoose');
const flags={email_enabled:false,whatsapp_enabled:false,payment_confirmation:true,order_updates:true,course_updates:true,webinar_updates:true,book_updates:true,consulting_updates:true,admin_new_order_alert:false};
const events=require('../../config/notificationEvents');
Object.assign(flags,Object.fromEntries(Object.keys(events.labels).map(key=>['event_'+key,true])),Object.fromEntries(Object.keys(events.ownerLabels).filter(key=>key!=='admin_new_order_alert').map(key=>[key,true])));
module.exports=model('NotificationSettings',new Schema({_id:{type:String,default:'default'},...Object.fromEntries(Object.entries(flags).map(([key,value])=>[key,{type:Boolean,default:value}]))},{timestamps:true}));
module.exports.flags=flags;
