// Explicit, idempotent default setup. Never imports credentials or creates transactions.
const mongoose=require('mongoose');
async function seed(){
 for(const name of ['SiteSettings','TaxSettings','DeliverySettings','FeatureSettings','NotificationSettings','PaidAccessSettings','PricingSettings']){
  const Model=require('../models/mongo/'+name),filter=['FeatureSettings','NotificationSettings','PaidAccessSettings'].includes(name)?{_id:'default'}:{key:'default'};
  await Model.updateOne(filter,{$setOnInsert:filter},{upsert:true,setDefaultsOnInsert:true,runValidators:true});
 }
 await require('../models/mongo/TaxSettings').updateOne({key:'default'},{$set:{enabled:true,percentage:18}});
 await require('../models/mongo/DeliverySettings').updateOne({key:'default'},{$set:{enabled:false,default_charge:0}});
 const Zone=require('../models/mongo/DeliveryZone'),Courier=require('../models/mongo/Courier');
 for(const [id,name,hub] of [['south','South','Bengaluru'],['north','North','Mumbai']])
  await Zone.updateOne({_id:id},{$set:{name,dispatch_location:hub,active:true},$setOnInsert:{states:id === 'south' ? ['tamil nadu'] : [],partner_ids:[]}},{upsert:true,runValidators:true});
 const rows=[...require('./seedCourierCatalog').catalog,{_id:'delhivery',name:'Delhivery',website_url:'https://www.delhivery.com/'}];
 const normalize=value=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
 for(const row of rows){
  const names=[row.name,...(row.aliases||[])].map(normalize);
  const existing=(await Courier.find().lean()).find(item=>item._id===row._id || names.includes(normalize(item.name)));
  const id=existing?._id||row._id;
  await Courier.updateOne({_id:id},{$set:{active:true},$setOnInsert:{name:row.name,website_url:row.website_url}},{upsert:true,runValidators:true});
  await Zone.updateMany({_id:{$in:['south','north']}},{$addToSet:{partner_ids:id}});
 }
 console.log('Default settings and enabled hub partners seeded. Existing products/users/transactions untouched.');
}
module.exports={seed};
if(require.main===module){require('dotenv').config();(async()=>{try{
 const uri=process.env.MONGODB_URI||process.env.MONGODB_URL||process.env.MONGO_URL||process.env.MONGO_URI;
 if(!uri)throw new Error('MongoDB configuration missing');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:15000,autoIndex:false});await seed();
}catch(error){console.error('Default seed failed:',error.name);process.exitCode=1;}finally{await mongoose.disconnect();}})();}

