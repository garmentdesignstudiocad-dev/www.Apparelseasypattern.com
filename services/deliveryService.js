const Zone=require('../models/mongo/DeliveryZone');

const stateHubs=new Map();
for(const state of ['tamil nadu','karnataka','kerala','andhra pradesh','telangana','puducherry']){
  stateHubs.set(state,{region_id:'south',region:'South India',dispatch_location:'Bengaluru Hub'});
}
for(const state of ['delhi','chandigarh','haryana','himachal pradesh','jammu and kashmir','ladakh','punjab','rajasthan','uttar pradesh','uttarakhand']){
  stateHubs.set(state,{region_id:'north',region:'North India',dispatch_location:'Mumbai Hub'});
}

function normalizeState(value){
  return typeof value==='string'?value.trim().toLowerCase().replace(/&/g,'and').replace(/\s+/g,' '):'';
}

async function configureRegions(){
  const defaults=[
    {_id:'south',name:'South India',dispatch_location:'Bengaluru',states:['tamil nadu','karnataka'],active:true},
    {_id:'north',name:'North India',dispatch_location:'Mumbai',states:[],active:true}
  ];
  for(const item of defaults){
    await Zone.updateOne({_id:item._id},{$setOnInsert:item},{upsert:true});
  }
}

async function destination(input={},legacyCity){
  const state=typeof input==='string'?input:input.state;
  const city=typeof input==='string'?legacyCity:input.city;
  const normalizedState=normalizeState(state);
  const hub=stateHubs.get(normalizedState);
  const cityName=typeof city==='string'?city.trim():'';
  return {
    city:cityName,
    district:cityName,
    state:typeof state==='string'?state.trim():'',
    region_id:hub?.region_id || '',
    region:hub?.region || 'Pending Manual Assignment',
    dispatch_location:hub?.dispatch_location || 'Pending Manual Assignment',
    hub_assignment_status:hub?'assigned':'pending_manual'
  };
}

module.exports={configureRegions,destination,normalizeState,normalize:normalizeState};
