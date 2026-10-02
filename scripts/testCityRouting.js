const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MongoMemoryServer}=require('mongodb-memory-server'),mongoose=require('mongoose');
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
 try{
 await mongoose.connect(mongo.getUri());
 const Hub=require('../models/mongo/DeliveryZone'),Route=require('../models/mongo/CityRoute'),Partner=require('../models/mongo/Courier');
 const delivery=require('../services/deliveryService'),couriers=require('../services/courierService');
 await Hub.create([{_id:'bengaluru',name:'Bengaluru',dispatch_location:'Bengaluru'},{_id:'mumbai',name:'Mumbai',dispatch_location:'Mumbai'}]);
 await Partner.create([{_id:'test-one',name:'Test partner one',active:true},{_id:'test-two',name:'Test partner two',active:true},{_id:'inactive',name:'Inactive test',active:false}]);
 await Route.create([{state:'Tamil Nadu',city:'Tiruppur',state_key:'tamil nadu',city_key:'tiruppur',hub_id:'bengaluru',partner_ids:['test-one','inactive']},{state:'Delhi',city:'Delhi',state_key:'delhi',city_key:'delhi',hub_id:'mumbai',partner_ids:['test-two']}]);
 await delivery.configureRegions();
 await Hub.updateOne({_id:'south'},{$set:{states:['tamil nadu'],partner_ids:['test-one','inactive']}});await Hub.updateOne({_id:'north'},{$set:{states:['delhi'],partner_ids:['test-two']}});
 const south=await delivery.destination(' TAMIL  NADU ','tiruppur');assert.equal(south.dispatch_location,'Bengaluru');assert.deepEqual((await couriers.available(south)).map(p=>p._id),['test-one']);
 const north=await delivery.destination('Delhi','Delhi');assert.equal(north.dispatch_location,'Mumbai');assert.deepEqual((await couriers.available(north)).map(p=>p._id),['test-two']);
 assert.deepEqual((await couriers.available(await delivery.destination('Tamil Nadu','Unknown'))).map(p=>p._id),['test-one']);
 assert.deepEqual(await couriers.available(await delivery.destination('Wrong state','Tiruppur')),[]);
 await assert.rejects(delivery.destination({},'Tiruppur'));assert.equal((await delivery.destination('Tamil Nadu','')).region_id,'south');
 await Hub.updateOne({_id:'south'},{$set:{active:false}});assert.deepEqual(await couriers.available(await delivery.destination('Tamil Nadu','Tiruppur')),[]);
 await Hub.updateOne({_id:'south'},{$set:{active:true}});await Route.updateOne({city_key:'tiruppur'},{$set:{active:false}});assert.deepEqual((await couriers.available(await delivery.destination('Tamil Nadu','Tiruppur'))).map(p=>p._id),['test-one']);
 const controller=fs.readFileSync(path.join(__dirname,'../controllers/checkoutController.js'),'utf8');assert.ok(controller.includes('destination(state,city)'));assert.ok(controller.includes('courierOptions.find(row=>row._id===courierId)'));assert.ok(!controller.includes('destination(pincode)'));
 const pricing=require('../services/orderPricing');assert.deepEqual(pricing.totals(2000),{subtotal:2000,tax:360,total:2360,amount:236000});
 for(const file of ['checkout.ejs','admin/delivery_settings.ejs','admin/couriers.ejs']){const text=fs.readFileSync(path.join(__dirname,'../views',file),'utf8');require('ejs').compile(text);assert.doesNotMatch(text,/Pay on Delivery|Courier Charge|Delivery Charge|Shipping to be arranged/);}
 console.log('PASS: city/state normalization, state routes ignoring legacy city mappings, Bengaluru/Mumbai hubs, route-specific active partners, unknown cities, invalid state/city, inactive hubs/routes, server selection wiring, unchanged total, and three changed EJS templates. Temporary MongoDB only.');
 }finally{await mongoose.disconnect();await mongo.stop();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
