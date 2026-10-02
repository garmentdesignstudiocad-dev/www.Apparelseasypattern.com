const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
module.exports=async({models,request,input,paymentOverrides})=>{
  const {Product,Order,Payment,Courier,NotificationLog,Receipt,NotificationSettings}=models;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'commerce-'));
  const old=process.env.PATTERN_FILES_DIR;process.env.PATTERN_FILES_DIR=dir;
  const uploaded=[];
  try{
    await fs.writeFile(path.join(dir,'p.dxf'),'test pattern');
    const product=await Product.create({name:'Shirt Pattern Collection – Fit 3 Basic Short-Sleeve',slug:'commerce-shirt',base_price:50,additional_size_price:50,physical_price:50,trial_price:1100,digital_file:'p.dxf'});
    await Courier.create({_id:'commerce-courier',name:'Configured Courier',active:true,region_ids:['south'],pincodes:['560*'],charge:300,delivery_min_days:2,delivery_max_days:3});
    await Courier.create({_id:'destination-courier',name:'Destination Courier',active:true,region_ids:['south'],pincodes:['638751'],charge:250,delivery_min_days:3,delivery_max_days:4});
    await Courier.create({_id:'blank-courier',name:'Blank Rules',active:true,pincodes:[]});
    await Courier.create({_id:'inactive-courier',name:'Inactive',active:false,region_ids:['south'],pincodes:['638*']});
    await models.Pincode.create({pincode:'638751',district:'Tiruppur',state:'Tamil Nadu',region_id:'south',active:true});
    await models.DeliveryZone.updateOne({_id:'south'},{$set:{partner_ids:['commerce-courier','destination-courier','inactive-courier']}});
    const destination=JSON.parse((await request('/checkout/delivery-info?state=Tamil%20Nadu')).html);
    assert.deepEqual(destination.couriers.map(c=>c._id),['commerce-courier','destination-courier']);assert.equal(destination.couriers[0].charge,undefined);assert.equal(destination.couriers[1].delivery_min_days,3);
    const unserved=JSON.parse((await request('/checkout/delivery-info?state=Unassigned')).html);assert.equal(unserved.available,false);assert.deepEqual(unserved.couriers,[]);
    const productPage=await request('/product/'+product.slug);assert.ok(!productPage.html.includes('Contact the studio to confirm before ordering.'));assert.ok(!productPage.html.includes('Pattern Specifications'));
    process.env.ADMIN_NOTIFICATION_EMAIL='owner@example.test';
    await NotificationSettings.findOneAndUpdate({_id:'default'},{$set:{email_enabled:true,order_updates:true,payment_confirmation:true,admin_successful_payment:true,admin_new_order_alert:true}},{upsert:true});
    const cases=[
      {name:'digital',digital:1,physical:0,trial:0,sizes:['M'],subtotal:50},
      {name:'additional size',digital:1,physical:0,trial:0,sizes:['M','L'],subtotal:100},
      {name:'physical only',digital:0,physical:1,trial:0,sizes:['M'],subtotal:50},
      {name:'trial only',digital:0,physical:0,trial:1,sizes:['M'],subtotal:1100},
      {name:'digital physical',digital:1,physical:1,trial:0,sizes:['M'],subtotal:100},
      {name:'digital trial',digital:1,physical:0,trial:1,sizes:['M'],subtotal:1150},
      {name:'all',digital:1,physical:1,trial:1,sizes:['M'],subtotal:1200}
    ];
    for(const [index,test] of cases.entries()){
      const who='commerce'+index,physical=!!(test.physical || test.trial);
      const item={product_id:String(product._id),quantity:test.digital,physical_quantity:test.physical,trial_quantity:test.trial,selected_sizes:test.sizes,selected_files:[],selected_addons:[],total:1,unit_price:1};
      const payload={customer:input.customer,items:[item],shipping:physical?{...input.shipping,courier_id:'commerce-courier'}:{},grand_total:1,tax_amount:0,payment_status:'paid'};
      assert.equal((await request('/cart/add',{...item,files:[],addons:[]},who)).status,200,test.name+' cart');
      const checkout=await request('/checkout',undefined,who);assert.equal(checkout.status,200);
      if(physical){
        for(const shipping of [{...payload.shipping,courier_id:''},{...payload.shipping,courier_id:'inactive-courier'},{...payload.shipping,state:'Unassigned'},{...payload.shipping,pincode:'invalid'}])assert.equal((await request('/checkout',{...payload,shipping},who)).status,400,test.name+' requires serviceable customer selection');
      }
      payload.shipping.dispatch_location='Tampered';payload.shipping.region='Tampered';payload.shipping.courier_charge=1;payload.shipping.courier_name='Tampered';
      assert.equal((await request('/checkout',payload,who)).status,200,test.name);
      assert.match((await request('/checkout/payment-method',undefined,who)).html,/Online Payment Total/);
      const payResponse=await request('/checkout/payment-method/proceed',{},who);assert.equal(payResponse.status,200);
      const pay=JSON.parse(payResponse.html);let order=await Order.findOne({razorpay_order_id:pay.razorpay_order_id}).lean();
      assert.equal(order.subtotal,test.subtotal);assert.equal(order.tax_amount,test.subtotal*.18);assert.equal(pay.amount,Math.round(test.subtotal*118));
      assert.equal(order.delivery_charge,undefined);assert.equal(order.courier_payment_separate,false);
      assert.deepEqual(order.items[0].selected_sizes,test.sizes);assert.equal(order.items[0].quantity,test.digital);
      assert.equal(order.shipping_address,physical?input.shipping.address:'');assert.equal(order.courier_name,physical?'Configured Courier':'');
      assert.equal(await require('../services/digitalDeliveryService').ensure(order._id),null);
      assert.equal(await NotificationLog.countDocuments({reference_id:String(order._id),event:'order_digital_ready'}),0);
      assert.equal(await NotificationLog.countDocuments({reference_id:String(order._id)}),0,'No order email before verification');
      const paymentId='pay_commerce'+index;
      const captured={id:paymentId,order_id:pay.razorpay_order_id,amount:pay.amount,currency:'INR',status:'captured',captured:true};
      paymentOverrides.set(paymentId,{...captured,status:'failed',captured:false});
      const callback={razorpay_order_id:pay.razorpay_order_id,razorpay_payment_id:paymentId,razorpay_signature:crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(pay.razorpay_order_id+'|'+paymentId).digest('hex')};
      assert.equal((await request('/checkout/razorpay-callback',callback,who)).status,409);
      assert.equal((await Order.findById(order._id)).payment_status,'unpaid');
      assert.equal((await request('/checkout/razorpay-callback',{...callback,razorpay_signature:'0'.repeat(64)},who)).status,400);
      paymentOverrides.set(paymentId,{...captured,amount:1});
      assert.equal((await request('/checkout/razorpay-callback',callback,who)).status,400);
      paymentOverrides.set(paymentId,captured);
      const webhook={event:'payment.captured',payload:{payment:{entity:captured}}};
      const headers={'x-razorpay-signature':crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(webhook)).digest('hex')};
      assert.equal((await request('/checkout/razorpay-webhook',webhook,who,true,{'x-razorpay-signature':'0'.repeat(64)})).status,400);
      const completed=await Promise.all([request('/checkout/razorpay-callback',callback,who),request('/checkout/razorpay-webhook',webhook,who,true,headers)]);
      assert.deepEqual(completed.map(r=>r.status),[302,200]);
      assert.equal((await request('/checkout/razorpay-webhook',webhook,who,true,headers)).status,200);
      order=await Order.findById(order._id).select('+download_token').lean();
      assert.equal(order.payment_status,'paid');assert.equal(order.order_status,'confirmed');
      assert.equal(Boolean(order.download_token),!!test.digital);assert.equal(await Payment.countDocuments({order_id:order._id}),1);
      assert.equal((await request('/downloads/'+order._id+'/0')).status,404);
      assert.equal((await request('/downloads/'+'a'.repeat(64)+'/0')).status,404);
      assert.equal((await request('/private/patterns/p.dxf')).status,404);
      if(test.digital){
        const url='/downloads/'+order.download_token;
        assert.equal((await request(url+'/0')).status,200);
        assert.equal((await request(url+'/999')).status,404);
        assert.equal((await request(url+'/'+product._id)).status,404);
        await Order.updateOne({_id:order._id},{$set:{payment_status:'failed'}});
        assert.equal((await request(url+'/0')).status,404);
        await Order.updateOne({_id:order._id},{$set:{payment_status:'paid',order_status:'cancelled'}});
        assert.equal((await request(url+'/0')).status,404);
        await Order.updateOne({_id:order._id},{$set:{order_status:order.order_status}});
      }
      const digitalLogs=await NotificationLog.find({reference_id:String(order._id),event:'order_digital_ready'}).lean();
      assert.equal(digitalLogs.length,test.digital?1:0);if(test.digital)assert.equal(digitalLogs[0].channel,'email');
      const customerMail=await NotificationLog.findOne({reference_id:String(order._id),event:'order_payment_success',channel:'email'}).lean();
      assert.match(customerMail.message,/Selected sizes:/);assert.match(customerMail.message,/GST \(18%\)/);assert.match(customerMail.message,/Online Amount Paid:/);
      if(physical){assert.equal(order.customer_selected_courier,true);assert.equal(order.delivery_min_days,2);assert.equal(order.delivery_max_days,3);}
      if(physical){assert.equal(order.destination_region,'South');assert.equal(order.dispatch_location,'Bengaluru');assert.match(customerMail.message,/Dispatch From: Bengaluru/);}
      assert.doesNotMatch(customerMail.message,/Courier Charge|Pay Separately|Pay on Delivery/i);
      assert.equal(await NotificationLog.countDocuments({reference_id:String(order._id),event:'admin_successful_payment'}),1);
      const receipt=await Receipt.findOne({reference_id:order._id}).lean();
      assert.equal(receipt.subtotal_paise,test.subtotal*100);assert.equal(receipt.total_paise,pay.amount);assert.equal(receipt.delivery_paise,0);
      const page=await request('/admin/orders/'+order._id,undefined,'admin');assert.equal(page.status,200);assert.match(page.html,/Online Payment Total/);assert.doesNotMatch(page.html,/Delivery Charge|Courier Charge|Pay Separately|Pay on Delivery/i);
      if(physical){assert.match(page.html,/Customer Selected Delivery Partner:/);const csrf=page.html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];assert.equal((await request('/admin/orders/'+order._id+'/fulfilment',{_csrf:csrf,courier_id:'destination-courier',shipping_status:'Pending'},'admin')).status,409);}
      const payment=await Payment.findOne({order_id:order._id});
      const paymentPage=await request('/admin/payments/'+payment._id,undefined,'admin');assert.equal(paymentPage.status,200);assert.match(paymentPage.html,/Online Payment Total/);assert.doesNotMatch(paymentPage.html,/Delivery Charge|Courier Charge|Pay Separately|Pay on Delivery/i);
      const failing=require('../services/notificationService').createDispatcher({email:async()=>{throw new Error('Simulated SMTP failure');}});
      await failing(customerMail._id);
      assert.equal((await Order.findById(order._id)).payment_status,'paid');
      assert.equal((await Payment.findById(payment._id)).payment_status,'paid');
      let sends=0;const dispatch=require('../services/notificationService').createDispatcher({email:async()=>{sends++;return 'mock-smtp';}});
      for(const log of digitalLogs)await Promise.all([dispatch(log._id),dispatch(log._id)]);
      assert.equal(sends,test.digital?1:0);
    }
    const routingPage=await request('/admin/settings/delivery',undefined,'admin');
    assert.equal(routingPage.status,200);assert.doesNotMatch(routingPage.html,/Charge Delivery Amount|Delivery Charge/i);
    const routeCsrf=routingPage.html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    assert.equal((await request('/admin/settings/delivery',{region_id:'north',name:'North',dispatch_location:'Mumbai',active:'on'},'admin')).status,403);
    assert.equal((await request('/admin/settings/delivery',{_csrf:routeCsrf,region_id:'north',name:'North',dispatch_location:'Mumbai',states:'Delhi',active:'on'},'admin')).status,302);
    const partnersPage=await request('/admin/settings/couriers',undefined,'admin');assert.equal(partnersPage.status,200);assert.doesNotMatch(partnersPage.html,/name="charge"/);
    const partnerCsrf=partnersPage.html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    for(const id of ['north-one','north-two'])assert.equal((await request('/admin/settings/couriers',{_csrf:partnerCsrf,courier_id:id,name:id,hub_ids:['north'],priority:'1',active:'on'},'admin')).status,303);
    const north=JSON.parse((await request('/checkout/delivery-info?state=Delhi')).html);
    assert.equal(north.region,'North');assert.equal(north.dispatch_location,'Mumbai');assert.deepEqual(north.couriers.map(c=>c._id),['north-one','north-two']);
    const routePayload={customer:input.customer,items:[{product_id:String(product._id),quantity:0,physical_quantity:1,selected_sizes:['M']}],shipping:{...input.shipping,state:'Delhi',pincode:'110001',courier_id:'north-one',dispatch_location:'Tampered',region:'South'}};
    for(const id of ['north-one','north-two']){
      const who='route-'+id;routePayload.shipping.courier_id=id;
      assert.equal((await request('/checkout',routePayload,who)).status,200);
      const pay=JSON.parse((await request('/checkout/payment-method/proceed',{},who)).html);
      const row=await Order.findOne({razorpay_order_id:pay.razorpay_order_id}).lean();
      assert.equal(pay.amount,5900);assert.equal(row.tax_amount,9);assert.equal(row.dispatch_location,'Mumbai');assert.equal(row.destination_region,'North');assert.equal(row.delivery_charge,undefined);
    }
    routePayload.shipping.courier_id='commerce-courier';assert.equal((await request('/checkout',routePayload,'wrong-region')).status,400);
    await models.DeliveryZone.updateOne({_id:'north'},{$set:{active:false}});
    assert.equal(JSON.parse((await request('/checkout/delivery-info?state=Delhi')).html).available,false);
    await models.DeliveryZone.updateOne({_id:'north'},{$set:{active:true}});
    // Preserve persisted historical amounts when the route config is edited.
    assert.equal((await models.Pincode.findOne({pincode:'560001'})).delivery_charge,40);
    console.log('PASS: Admin CSRF/configuration, South/Bengaluru and North/Mumbai, region filtering, inactive regions, forged dispatch rejection and equal GST/gateway amounts across partners.');
    const edit={name:product.name,slug:product.slug,base_price:'60',additional_size_price:'55',physical_price:'65',trial_price:'1200',active:'on'};
    assert.equal((await request('/admin/products/'+product._id+'/edit',edit,'admin',false)).status,302);
    const changed=await Product.findById(product._id);
    assert.deepEqual([changed.base_price,changed.additional_size_price,changed.physical_price,changed.trial_price],[60,55,65,1200]);
    assert.equal((await request('/admin/products/'+product._id+'/files',{file_name:'AAMA option',file_type:'AAMA',file_price:'0',active:'on'},'admin',false)).status,302);
    const uploadPage=await request('/admin/products/'+product._id+'/digital-files',undefined,'admin');
    const csrf=uploadPage.html.match(/data-csrf="([a-f0-9]+)"/)[1];
    const headers={'Content-Type':'application/octet-stream','x-csrf-token':csrf,'x-file-name':'test.aama'};
    const uploadUrl='/admin/products/'+product._id+'/digital-files';
    assert.equal((await request(uploadUrl,Buffer.from('test-only AAMA'),'admin',false,{...headers,'x-csrf-token':'invalid'})).status,403);
    assert.equal((await request(uploadUrl,Buffer.from('test-only AAMA'),'admin',false,headers)).status,200);
    const stored=await Product.findById(product._id).select('+digital_file');uploaded.push(stored.digital_file);
    assert.match(stored.digital_file,/^[a-f0-9]{48}\.aama$/);
    const option=await models.ProductFile.findOne({product_id:product._id,file_type:'AAMA'});
    assert.equal((await request(uploadUrl+'/'+option._id,Buffer.from('test-only ASTM'),'admin',false,{...headers,'x-file-name':'test.astm'})).status,200);
    const storedOption=await models.ProductFile.findById(option._id).select('+digital_file');uploaded.push(storedOption.digital_file);
    assert.match(storedOption.digital_file,/\.astm$/);
    const other=await Product.create({name:'Unrelated upload target',slug:'unrelated-upload-target'});
    assert.equal((await request('/admin/products/'+other._id+'/digital-files/'+option._id,Buffer.from('test'),'admin',false,headers)).status,404);
    assert.equal((await request('/'+stored.digital_file)).status,404);
    assert.equal((await request('/admin/products/'+product._id+'/addons',{name:'Adjustment',price:'20',active:'on'},'admin',false)).status,302);
    assert.equal((await request('/admin/products/'+product._id+'/toggle',{},'admin',false)).status,302);
    assert.equal((await Product.findById(product._id)).active,false);
    assert.equal((await request('/product/'+product.slug)).status,404);
    console.log('PASS: seven purchase combinations, sizes, 18% GST, paise, courier exclusion, address snapshots, failed/tampered payments, signed webhooks, concurrent callback/webhook idempotency, customer/owner email content, SMTP failure isolation, private download entitlement, email-only mixed digital delivery, receipts, admin order/payment display and admin product/price/file/add-on management.');
  }finally{if(old===undefined)delete process.env.PATTERN_FILES_DIR;else process.env.PATTERN_FILES_DIR=old;for(const file of ['p.dxf',...uploaded])await fs.unlink(path.join(dir,file));await fs.rmdir(dir);}
};
