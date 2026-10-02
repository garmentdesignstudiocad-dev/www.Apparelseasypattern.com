// Store-supported catalog explicitly requested by the owner.
const catalog = [
  { _id:'blue-dart', name:'Blue Dart', website_url:'https://www.bluedart.com/', sources:['https://www.bluedart.com/factsheet'] },
  { _id:'dtdc', name:'DTDC', website_url:'https://www.dtdc.com/', sources:['https://www.dtdc.com/csr/','https://www.dtdc.com/personal-courier/'] },
  { _id:'india-post', name:'India Post / Speed Post', website_url:'https://www.indiapost.gov.in/', aliases:['India Post','Speed Post'] }
];
async function seed() {
  const Courier=require('../models/mongo/Courier'),Zone=require('../models/mongo/DeliveryZone');
  const delivery=require('../services/deliveryService');
  await delivery.configureRegions();
  const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  const existing=await Courier.find().lean();
  for(const row of catalog){
    const names=[row.name,...(row.aliases || [])].map(normalize);
    const match=existing.find(p=>names.includes(normalize(p.name)) || p._id===row._id);
    const id=match?._id || row._id;
    await Courier.updateOne({_id:id},{$set:{name:row.name,website_url:row.website_url,active:true}},{upsert:true,runValidators:true});
    await Zone.updateMany({_id:{$in:['south','north']}},{$addToSet:{partner_ids:id}});
  }
  const service=require('../services/courierService');
  for(const zone of await Zone.find({_id:{$in:['south','north']}}).lean()){
    const partners=await service.available({...zone,region_id:zone._id});
    console.log(JSON.stringify({hub:zone.dispatch_location,count:partners.length,partners:partners.map(p=>p.name)}));
  }
}
module.exports={catalog,seed};
if(require.main===module){
  require('dotenv').config();const mongoose=require('mongoose');
  (async()=>{try{
    await mongoose.connect(process.env.MONGODB_URI||process.env.MONGODB_URL||process.env.MONGO_URL||process.env.MONGO_URI,{serverSelectionTimeoutMS:15000,autoIndex:false});
    await seed();
  }catch(error){console.error('Catalog seed failed:',error.name);process.exitCode=1;}finally{await mongoose.disconnect();}})();
}
