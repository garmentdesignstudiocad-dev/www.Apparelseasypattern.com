const assert=require('node:assert/strict');
const delivery=require('../services/deliveryService');
const pricing=require('../services/orderPricing');

async function run(){
  const south=['Tamil Nadu','Karnataka','Kerala','Andhra Pradesh','Telangana','Puducherry'];
  const north=['Delhi','Chandigarh','Haryana','Himachal Pradesh','Jammu and Kashmir','Ladakh','Punjab','Rajasthan','Uttar Pradesh','Uttarakhand'];
  for(const state of south){
    const route=await delivery.destination({state,city:'Any City'});
    assert.equal(route.dispatch_location,'Bengaluru Hub',state);
    assert.equal(route.hub_assignment_status,'assigned',state);
  }
  for(const state of north){
    const route=await delivery.destination({state,city:'Any City'});
    assert.equal(route.dispatch_location,'Mumbai Hub',state);
    assert.equal(route.hub_assignment_status,'assigned',state);
  }
  const normalized=await delivery.destination({state:'  TAMIL   NADU  ',city:'Tiruppur'});
  assert.equal(normalized.dispatch_location,'Bengaluru Hub');
  assert.equal((await delivery.destination({state:'Jammu & Kashmir'})).dispatch_location,'Mumbai Hub');
  const unknown=await delivery.destination({state:'Other Region',city:'Unknown City'});
  assert.equal(unknown.dispatch_location,'Pending Manual Assignment');
  assert.equal(unknown.hub_assignment_status,'pending_manual');
  assert.deepEqual(pricing.totals(1000,0),{subtotal:1000,courier:0,tax:180,total:1180,amount:118000});
  console.log('PASS: confirmed state routing, manual fallback, city-independent hub assignment, and zero courier charge in totals.');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
