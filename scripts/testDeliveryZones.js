// Focused physical checkout regression with temporary MongoDB and a mocked gateway.
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');

process.env.RAZORPAY_KEY_ID='rzp_test_dispatch_hubs';
process.env.RAZORPAY_KEY_SECRET='dispatch-hubs-test-only';
const gatewayOrders=[];
require('razorpay');
require.cache[require.resolve('razorpay')].exports=class{
  constructor(){
    this.orders={create:async data=>{
      const row={...data,id:`order_hub_${gatewayOrders.length+1}`};
      gatewayOrders.push(row);
      return row;
    }};
  }
};
require('../services/notificationService').safeFlush=async()=>{};

const delivery=require('../services/deliveryService');
const checkout=require('../controllers/checkoutController');
const Customer=require('../models/mongo/Customer');
const Order=require('../models/mongo/Order');
const Product=require('../models/mongo/Product');
const TaxSettings=require('../models/mongo/TaxSettings');

async function invoke(handler,req){
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await handler(req,res,error=>{throw error;});
  return res;
}

async function run(){
  const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
  try{
    await mongoose.connect(mongo.getUri(),{dbName:'dispatch_hubs_test'});
    await TaxSettings.create({key:'default',enabled:true,percentage:18});

    const south=['Tamil Nadu','Karnataka','Kerala','Andhra Pradesh','Telangana','Puducherry'];
    const north=['Delhi','Chandigarh','Haryana','Himachal Pradesh','Jammu and Kashmir','Ladakh','Punjab','Rajasthan','Uttar Pradesh','Uttarakhand'];
    for(const state of south){
      const response=await invoke(checkout.getDeliveryCharge,{query:{state,city:'A city',pincode:'000000'}});
      assert.equal(response.statusCode,200,state);
      assert.equal(response.body.dispatch_location,'Bengaluru Hub',state);
    }
    for(const state of north){
      const response=await invoke(checkout.getDeliveryCharge,{query:{state,city:'A city',pincode:'000000'}});
      assert.equal(response.statusCode,200,state);
      assert.equal(response.body.dispatch_location,'Mumbai Hub',state);
    }
    const manual=await invoke(checkout.getDeliveryCharge,{query:{state:'Other Region',city:'Unknown'}});
    assert.equal(manual.statusCode,200);
    assert.equal(manual.body.dispatch_location,'Pending Manual Assignment');
    assert.equal(manual.body.hub_assignment_status,'pending_manual');

    const customer=await Customer.create({name:'Dispatch Test Customer',email:'dispatch-test@example.test',phone:'9876543210'});
    const product=await Product.create({name:'Dispatch test pattern',slug:'dispatch-test-pattern',base_price:100,physical_price:50,trial_price:60,active:true});
    const checkoutRequest=(shipping,physical=true)=>({
      createRazorpayOrder:true,
      session:{customerId:String(customer._id)},
      body:{
        customer:{name:customer.name,email:customer.email,phone:customer.phone},
        items:[{product_id:String(product._id),quantity:physical?0:1,physical_quantity:physical?1:0,selected_sizes:[]}],
        shipping
      }
    });

    const validShipping={address:'12 Test Road',city:'Test City',state:'Tamil Nadu',pincode:'560001'};
    for(const field of ['address','city','state','pincode']){
      const invalid={...validShipping,[field]:''};
      assert.equal((await invoke(checkout.postCheckout,checkoutRequest(invalid))).statusCode,400,`still requires ${field}`);
    }
    assert.equal(gatewayOrders.length,0,'invalid addresses do not create gateway orders');

    async function placePhysical(shipping){
      const response=await invoke(checkout.postCheckout,checkoutRequest(shipping));
      assert.equal(response.statusCode,200);
      return Order.findOne({razorpay_order_id:response.body.razorpay_order_id}).lean();
    }
    const southOrder=await placePhysical(validShipping);
    assert.equal(southOrder.dispatch_location,'Bengaluru Hub');
    assert.equal(southOrder.delivery_charge,0);
    assert.equal(southOrder.grand_total,59);
    assert.equal(southOrder.shipping_payment_status,'not_collected');
    assert.equal(southOrder.courier_booking_status,'not_booked');
    assert.equal(southOrder.courier_payment_separate,true);
    assert.equal(southOrder.shipping_arranged_separately,true);
    assert.equal(southOrder.courier_id,'');
    assert.equal(southOrder.courier_name,'');
    assert.equal(gatewayOrders.at(-1).amount,5900);

    const northOrder=await placePhysical({...validShipping,state:'Punjab'});
    assert.equal(northOrder.dispatch_location,'Mumbai Hub');
    assert.equal(northOrder.grand_total,59);
    const manualOrder=await placePhysical({...validShipping,state:'Other Region'});
    assert.equal(manualOrder.dispatch_location,'Pending Manual Assignment');
    assert.equal(manualOrder.grand_total,59);

    const digital=await invoke(checkout.postCheckout,checkoutRequest({},false));
    assert.equal(digital.statusCode,200);
    const digitalOrder=await Order.findOne({razorpay_order_id:digital.body.razorpay_order_id}).lean();
    assert.equal(digitalOrder.grand_total,118);
    assert.equal(digitalOrder.delivery_charge,0);
    assert.equal(digitalOrder.shipping_address,'');
    assert.equal(digitalOrder.shipping_payment_status,'not_applicable');
    assert.equal(digitalOrder.courier_booking_status,'not_required');

    console.log('PASS: hub routing, manual fallback, address validation, physical checkout without courier, zero online shipping, and digital-only checkout.');
  }finally{
    await mongoose.disconnect();
    await mongo.stop();
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
