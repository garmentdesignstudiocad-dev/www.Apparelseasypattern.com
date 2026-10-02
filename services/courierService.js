const Courier=require('../models/mongo/Courier');
async function defaults(){}
// The stored active flag means owner-enabled/store-supported, never live or time-based availability.
async function available(route){
 if(!route?.region_id || !route.dispatch_location)return [];
 return Courier.find({_id:{$in:route.partner_ids || []},active:true}).sort({priority:1,name:1}).lean();
}
function safeUrl(value){if(!value)return true;try{const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password;}catch{return false;}}
function option(row){return {_id:row._id,name:row.name,delivery_min_days:row.delivery_min_days,delivery_max_days:row.delivery_max_days,
  estimated_delivery:row.delivery_min_days && row.delivery_max_days?row.delivery_min_days+' - '+row.delivery_max_days+' Days':'Not configured'};}
module.exports={defaults,available,safeUrl,option};
