const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
module.exports=async({models,request,input})=>{
  const {Order,DeliverySettings,Courier,Product,NotificationLog}=models;
  await Courier.create({_id:'test-courier',name:'Test Courier',active:true,region_ids:['south'],pincodes:['560*'],tracking_url:'https://courier.example.test/{awb}'});
  await models.DeliveryZone.updateOne({_id:'south'},{$addToSet:{partner_ids:'test-courier'}});
  await DeliverySettings.updateOne({key:'default'},{$set:{enabled:false}});
  const options=JSON.parse((await request('/checkout/delivery-info?state=Karnataka')).html);
  assert.equal(options.delivery_charge,undefined);assert.equal(options.dispatch_location,'Bengaluru');
  assert.ok(options.couriers.some(c=>c._id==='test-courier'));
  assert.ok(!JSON.parse((await request('/checkout/delivery-info?state=Unassigned')).html).couriers.some(c=>c._id==='test-courier'));
  const physical={...input,items:[{...input.items[0],physical_quantity:1}],shipping:{...input.shipping,courier_id:'test-courier'}};
  for(const field of ['address','city','state','pincode'])assert.equal((await request('/checkout',{...physical,shipping:{...physical.shipping,[field]:''}},'shipping')).status,400);
  assert.equal((await request('/checkout',{...physical,shipping:{...physical.shipping,courier_id:'missing'}},'shipping')).status,400);
  assert.equal((await request('/checkout',physical,'shipping')).status,200);
  assert.match((await request('/checkout/payment-method',undefined,'shipping')).html,/Bengaluru/);
  const result=JSON.parse((await request('/checkout/payment-method/proceed',{},'shipping')).html);
  let order=await Order.findById(result.order_id);
  if(!order)order=await Order.findOne({razorpay_order_id:result.razorpay_order_id});
  assert.equal(order.delivery_charge,undefined);assert.equal(order.shipping_arranged_separately,false);assert.equal(order.courier_id,'test-courier');
  const page=await request('/admin/orders/'+order._id,undefined,'admin');
  const csrf=page.html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const shipment={_csrf:csrf,courier_id:'test-courier',tracking_number:'AWB123',dispatch_date:'2026-09-28',shipping_status:'Shipped'};
  const endpoint='/admin/orders/'+order._id+'/fulfilment';
  assert.equal((await request(endpoint,shipment,'admin')).status,409);
  await Order.updateOne({_id:order._id},{$set:{payment_status:'paid',payment_verified_at:new Date()}});
  for(const status of ['Confirmed','Preparing','Ready to Dispatch']){
    assert.equal((await request(endpoint,{...shipment,shipping_status:status},'admin')).status,303);
    const saved=await Order.findById(order._id).lean();
    assert.equal(saved.shipping_status,status);assert.equal(saved.tracking_number,'AWB123');assert.equal(saved.courier_id,'test-courier');
  }
  assert.equal((await request(endpoint,shipment,'admin')).status,303);
  assert.equal((await request(endpoint,shipment,'admin')).status,303);
  assert.equal(await NotificationLog.countDocuments({reference_id:String(order._id),event:'order_shipped'}),2);
  const shipped=await NotificationLog.findOne({reference_id:String(order._id),event:'order_shipped'});
  assert.match(shipped.message,/AWB123/);assert.match(shipped.message,/https:\/\/courier.example.test\/AWB123/);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pattern-shipping-'));
  const previous=process.env.PATTERN_FILES_DIR;process.env.PATTERN_FILES_DIR=dir;
  try{
    await fs.writeFile(path.join(dir,'pattern.pdf'),'%PDF-1.4 test pattern');
    const product=await Product.create({name:'Private pattern',slug:'private-test-pattern',base_price:100,digital_file:'pattern.pdf'});
    const digital=await Order.create({customer_id:order.customer_id,items:[{product_id:product._id,quantity:1}],grand_total:100});
    const service=require('../services/digitalDeliveryService');
    assert.equal(await service.ensure(digital._id),null);
    await Order.updateOne({_id:digital._id},{$set:{payment_status:'paid'}});
    assert.equal(await service.ensure(digital._id),null,'Paid flag alone cannot grant access');
    await Order.updateOne({_id:digital._id},{$set:{payment_verified_at:new Date()}});
    const grants=await Promise.all([service.ensure(digital._id),service.ensure(digital._id)]);
    assert.equal(grants[0].download_token,grants[1].download_token);
    const url='/downloads/'+grants[0].download_token;
    assert.equal((await request(url)).status,200);assert.equal((await request(url+'/0')).status,200);
    await require('../services/notificationService').flush('product_order',digital._id);
    await require('../services/notificationService').flush('product_order',digital._id);
    const logs=await NotificationLog.find({reference_id:String(digital._id),event:'order_digital_ready'});
    assert.equal(logs.length,1);assert.deepEqual(logs.map(l=>l.channel).sort(),['email']);
    for(const log of logs)assert.ok(log.message.includes(url));
    await models.NotificationSettings.findOneAndUpdate({_id:'default'},{$set:{email_enabled:true,whatsapp_enabled:true,order_updates:true}},{upsert:true});
    await NotificationLog.updateMany({_id:{$in:logs.map(log=>log._id)}},{$set:{status:'queued'}});
    let sends=0;
    const dispatch=require('../services/notificationService').createDispatcher({email:async()=>{sends++;return 'smtp-digital';},whatsapp:async()=>{sends++;return 'meta-digital';}});
    for(const log of logs)await Promise.all([dispatch(log._id),dispatch(log._id)]);
    assert.equal(sends,1);assert.equal(await NotificationLog.countDocuments({_id:{$in:logs.map(log=>log._id)},status:'sent'}),1);

    await Order.updateOne({_id:digital._id},{$set:{download_expires_at:new Date(0)}});
    assert.equal((await request(url)).status,404);
  }finally{
    if(previous===undefined)delete process.env.PATTERN_FILES_DIR;else process.env.PATTERN_FILES_DIR=previous;
    await fs.unlink(path.join(dir,'pattern.pdf'));await fs.rmdir(dir);
  }
  await DeliverySettings.updateOne({key:'default'},{$set:{enabled:true}});
  console.log('PASS: shipping toggle, required address, courier rules, verified digital grants, expiry, and deduplicated email/WhatsApp shipment/download jobs.');
};
