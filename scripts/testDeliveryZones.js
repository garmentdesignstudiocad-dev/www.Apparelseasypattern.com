// Targeted delivery regression: temporary MongoDB, mocked gateway and notifications.
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
process.env.RAZORPAY_KEY_ID = 'rzp_test_delivery_zones';
process.env.RAZORPAY_KEY_SECRET = 'delivery-zone-test-only';
const gatewayOrders = [];
require('razorpay');
require.cache[require.resolve('razorpay')].exports = class {
  constructor() { this.orders = { create: async data => {
    const row = { ...data, id: `order_zone_${gatewayOrders.length}` };
    gatewayOrders.push(row); return row;
  } }; }
};
require('../services/notificationService').safeFlush = async () => {};
const delivery = require('../services/deliveryService');
const controller = require('../controllers/checkoutController');
const Zone = require('../models/mongo/DeliveryZone');
const Courier = require('../models/mongo/Courier');
const Product = require('../models/mongo/Product');
const Order = require('../models/mongo/Order');
async function invoke(handler, req) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res, error => { throw error; }); return res;
}
async function run() {
  const mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  try {
    await mongoose.connect(mongo.getUri(), { dbName: 'delivery_zone_targeted' });
    const initial = await invoke(controller.getDeliveryCharge, { query: { state: 'Tamil Nadu', city: 'Tiruppur', pincode: '638751' } });
    assert.equal(initial.body.region, 'South'); assert.equal(initial.body.dispatch_location, 'Bengaluru');
    assert.deepEqual(initial.body.couriers, []);
    assert.equal(await Courier.countDocuments(), 0, 'No invented partners');
    await Courier.create([
      { _id: 'test-south', name: 'South test fixture', active: true, charge: 999 },
      { _id: 'test-north', name: 'North test fixture', active: true, charge: 888 },
      { _id: 'test-inactive', name: 'Inactive test fixture', active: false }
    ]);
    await Zone.updateOne({ _id: 'south' }, { $set: { states: [' Tamil  Nadu '], partner_ids: ['test-south', 'test-inactive'] } });
    await Zone.updateOne({ _id: 'north' }, { $set: { states: ['punjab'], partner_ids: ['test-north'] } });
    for (const [state, zone, hub, partner] of [
      [' Tamil   Nadu ', 'south', 'Bengaluru', 'test-south'], ['Punjab', 'north', 'Mumbai', 'test-north']
    ]) {
      const route = await invoke(controller.getDeliveryCharge, { query: { state } });
      assert.equal(route.statusCode, 200);
      assert.equal(route.body.region_id, zone); assert.equal(route.body.dispatch_location, hub);
      assert.deepEqual(route.body.couriers.map(row => row._id), [partner]);
      const otherCity = await delivery.destination(state, 'Any city without a mapping');
      assert.equal(otherCity.dispatch_location, hub);
    }
    console.log('PASS 1-4: South/Bengaluru and North/Mumbai; only active hub partners, independent of city/pincode.');
    const admin = require('../routes/adminFulfilment');
    const save = admin.stack.find(layer => layer.route?.path === '/settings/couriers' && layer.route.methods.post).route.stack[0].handle;
    const savePartner = async hub_ids => {
      const res = { status(code) { throw new Error('Admin save failed: '+code); }, redirect(code) { assert.equal(code,303); } };
      await save({ body: { courier_id:'test-admin', name:'Admin test fixture', priority:'100', enabled:'on', hub_ids } }, res);
    };
    await savePartner('south');
    let api = await invoke(controller.getDeliveryCharge, { query: { state:'tamil nadu' } });
    assert.ok(api.body.couriers.some(row=>row._id==='test-admin'));
    await savePartner('north');
    api = await invoke(controller.getDeliveryCharge, { query: { state:'Tamil Nadu' } });
    assert.ok(!api.body.couriers.some(row=>row._id==='test-admin'));
    api = await invoke(controller.getDeliveryCharge, { query: { state:'Punjab' } });
    assert.ok(api.body.couriers.some(row=>row._id==='test-admin'));
    console.log('PASS: Admin hub assignment and reassignment immediately visible to checkout.');
    await savePartner(['south','north']);
    const RealDate=global.Date;
    try {
      for(const time of ['2026-10-02T01:00:00+05:30','2026-10-02T12:00:00+05:30']) {
        global.Date=class extends RealDate {
          constructor(...args){super(...(args.length?args:[time]));}
          static now(){return new RealDate(time).getTime();}
        };
        for(const state of ['Tamil Nadu','Punjab']) {
          const result=await invoke(controller.getDeliveryCharge,{query:{state}});
          assert.ok(result.body.couriers.some(row=>row._id==='test-admin'));
        }
      }
    } finally {global.Date=RealDate;}
    console.log('PASS: Both-hub enabled partner selectable at 1 AM and noon India time.');
    const product = await Product.create({ name: 'Test pattern', slug: 'test-pattern', base_price: 100, physical_price: 50, trial_price: 50 });
    const checkout = (state, courier_id, quantities = { physical_quantity: 1 }, extra = {}) => invoke(controller.postCheckout, {
      createRazorpayOrder: true, session: {}, body: {
        customer: { name: 'Test customer', email: 'delivery@example.test', phone: '9876543210' },
        items: [{ product_id: String(product._id), quantity: 1, ...quantities }],
        shipping: { address: 'Test address', city: 'Unmapped city', state, pincode: '638751', courier_id, ...extra }
      }
    });
    for (const id of ['test-north', 'test-inactive', 'unknown', '']) {
      assert.equal((await checkout('Tamil Nadu', id, undefined, { region_id: 'north', dispatch_location: 'Mumbai', partner_ids: [id] })).statusCode, 400);
    }
    assert.equal(gatewayOrders.length, 0);
    assert.equal((await checkout('Unknown state', 'test-south')).statusCode, 400);
    console.log('PASS 5: wrong-hub, inactive, unknown, missing partners and unmapped states rejected.');
    const digital = await checkout('', 'unknown', { physical_quantity: 0 }, { address: '', city: '', pincode: '' });
    assert.equal(digital.statusCode, 200); assert.equal(digital.body.amount, 11800);
    const digitalOrder = await Order.findOne({ razorpay_order_id: digital.body.razorpay_order_id }).lean();
    assert.equal(digitalOrder.customer_selected_courier, false); assert.equal(digitalOrder.courier_id, '');
    console.log('PASS 6: digital-only checkout bypasses delivery.');
    for (const [state, partner, hub, quantities] of [
      ['Tamil Nadu', 'test-south', 'Bengaluru', { physical_quantity: 1 }],
      ['Punjab', 'test-north', 'Mumbai', { trial_quantity: 1 }]
    ]) {
      const result = await checkout(state, partner, quantities, { region_id: 'forged', dispatch_location: 'forged', delivery_charge: 5000 });
      assert.equal(result.statusCode, 200); assert.equal(result.body.amount, 17700);
      const order = await Order.findOne({ razorpay_order_id: result.body.razorpay_order_id }).lean();
      assert.equal(order.dispatch_location, hub); assert.equal(order.courier_id, partner);
      assert.equal(order.courier_name, partner==='test-south'?'South test fixture':'North test fixture');
      assert.equal(order.destination_region, hub==='Bengaluru'?'South':'North');
      assert.equal(order.shipping_address, 'Test address'); assert.equal(order.shipping_city, 'Unmapped city');
      assert.equal(order.shipping_state, state); assert.equal(order.delivery_pincode, '638751');
      assert.equal(order.subtotal, 150); assert.equal(order.tax_amount, 27); assert.equal(order.grand_total, 177);
      assert.equal(order.delivery_charge, undefined); assert.equal(order.courier_payment_separate, false);
      assert.equal(gatewayOrders.at(-1).amount, 17700);
    }
    console.log('PASS 7: physical pattern/trial sample subtotal + 18% GST equals mocked Razorpay amount; partner charges ignored.');
    const {seed,catalog}=require('./seedCourierCatalog');
    await seed();const count=await Courier.countDocuments();await seed();
    assert.equal(await Courier.countDocuments(),count,'Repeat seeding creates no duplicates');
    await require('./verifyCourierCatalog')();
    for(const state of ['Tamil Nadu','Punjab'])for(const partner of catalog){
      const result=await checkout(state,partner._id);
      assert.equal(result.statusCode,200);
      const saved=await Order.findOne({razorpay_order_id:result.body.razorpay_order_id}).lean();
      assert.equal(saved.courier_id,partner._id);assert.equal(saved.courier_name,partner.name);
      assert.equal(saved.dispatch_location,state==='Tamil Nadu'?'Bengaluru':'Mumbai');
      assert.equal(saved.destination_region,state==='Tamil Nadu'?'South':'North');
      assert.equal(saved.shipping_address,'Test address');assert.equal(saved.grand_total,177);
    }
    console.log('PASS: every researched courier selection saved for both hubs in isolated orders; gateway mocked.');
    require('./testCourierUI');
  } finally { await mongoose.disconnect(); await mongo.stop(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
