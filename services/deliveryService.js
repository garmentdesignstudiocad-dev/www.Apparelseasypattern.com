const Zone=require('../models/mongo/DeliveryZone');
const normalize=value=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toLowerCase():'';
async function configureRegions(){
 for(const row of [{_id:'south',name:'South',dispatch_location:'Bengaluru',states:['tamil nadu']},{_id:'north',name:'North',dispatch_location:'Mumbai',states:[]}])await Zone.updateOne({_id:row._id},{$setOnInsert:row},{upsert:true});
}
async function destination(state,city=''){
 const state_key=normalize(state),city_key=normalize(city);
 if(!state_key || state_key.length>100 || typeof city!=='string' || city_key.length>100)throw Object.assign(new Error('Enter a valid state and city/town.'),{statusCode:400});
 await configureRegions();
 const configured=await Zone.find({_id:{$in:['south','north']}}).lean();
 const zones=configured.filter(zone=>(zone.states || []).some(value=>normalize(value)===state_key));
 // Ambiguous or disabled mappings must never fall back to another hub.
 const zone=zones.length===1 && zones[0].active?zones[0]:null;
 return {district:city.trim(),city:city.trim(),state:state.trim(),region_id:zone?._id || '',region:zone?._id==='south'?'South':zone?._id==='north'?'North':'',dispatch_location:zone?.dispatch_location || '',partner_ids:zone?.partner_ids || []};
}
module.exports={configureRegions,destination,normalize};
