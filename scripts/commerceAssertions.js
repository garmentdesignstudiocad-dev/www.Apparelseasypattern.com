const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
module.exports=async({models,request,input,paymentOverrides})=>{
  const {Product,ProductFile,Order,Payment,Courier,NotificationLog,Receipt,NotificationSettings}=models;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'commerce-'));
  const old=process.env.PATTERN_FILES_DIR;process.env.PATTERN_FILES_DIR=dir;
  const uploaded=[];
  try{
    await fs.writeFile(path.join(dir,'p-m.dxf'),'test pattern M');
    await fs.writeFile(path.join(dir,'p-l.dxf'),'test pattern L');
    const product=await Product.create({name:'Shirt Pattern Collection – Fit 3 Basic Short-Sleeve',slug:'commerce-shirt',base_price:50,additional_size_price:50,physical_price:50,trial_price:1100,digital_file:'p-m.dxf',available_sizes:['M','L'],digital_file_map:[{format:'dxf',size:'M',file:'p-m.dxf',original_name:'p-m.dxf'},{format:'dxf',size:'L',file:'p-l.dxf',original_name:'p-l.dxf'}]});
    await Courier.create({_id:'commerce-courier',name:'Configured Courier',active:true,region_ids:['south'],pincodes:['560*'],charge:300,charge_approved:true,delivery_min_days:2,delivery_max_days:3});
    await Courier.create({_id:'destination-courier',name:'Destination Courier',active:true,region_ids:['south'],pincodes:['638751'],charge:250,charge_approved:true,delivery_min_days:3,delivery_max_days:4});
    await Courier.create({_id:'blank-courier',name:'Blank Rules',active:true,pincodes:[]});
    await Courier.create({_id:'inactive-courier',name:'Inactive',active:false,region_ids:['south'],pincodes:['638*']});
    await models.Pincode.create({pincode:'638751',district:'Tiruppur',state:'Tamil Nadu',region_id:'south',active:true});
    await models.DeliveryZone.updateOne({_id:'south'},{$set:{partner_ids:['commerce-courier','destination-courier','inactive-courier']}});
    const destination=JSON.parse((await request('/checkout/delivery-info?state=Tamil%20Nadu')).html);
    assert.equal(destination.dispatch_location,'Bengaluru Hub');assert.equal(destination.couriers,undefined);
    const unserved=JSON.parse((await request('/checkout/delivery-info?state=Unassigned')).html);assert.equal(unserved.dispatch_location,'Pending Manual Assignment');assert.equal(unserved.hub_assignment_status,'pending_manual');
    const productPage=await request('/product/'+product.slug);assert.ok(!productPage.html.includes('Contact the studio to confirm before ordering.'));assert.ok(!productPage.html.includes('Pattern Specifications'));
    process.env.ADMIN_NOTIFICATION_EMAIL='owner@example.test';
    await NotificationSettings.findOneAndUpdate({_id:'default'},{$set:{email_enabled:true,order_updates:true,payment_confirmation:true,admin_successful_payment:true,admin_new_order_alert:true}},{upsert:true});

    async function authCustomer(who) {
      const regPage = await request('/account/register', undefined, who, false);
      const regCsrf = regPage.html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
      await request('/account/register', {
        name: 'Customer ' + who,
        email: who.toLowerCase() + '@example.test',
        phone: '9876543210',
        password: 'Password123!',
        confirm_password: 'Password123!',
        _csrf: regCsrf
      }, who, false);
    }

    await authCustomer('missingdownload');
    const unavailableFile=await ProductFile.create({product_id:product._id,file_name:'Unavailable PDF',file_type:'PDF',file_price:10,active:true});
    const unavailableCheckout=await request('/checkout',{customer:input.customer,items:[{product_id:String(product._id),quantity:1,selected_files:[{id:String(unavailableFile._id)}]}],shipping:{}},'missingdownload');
    assert.equal(unavailableCheckout.status,400,'Checkout must not accept payment for a selected file without a private download.');

    const cases=[
      {name:'digital',digital:1,physical:0,trial:0,sizes:['M'],subtotal:50},
      {name:'additional size',digital:1,physical:0,trial:0,sizes:['M','L'],subtotal:100},
      {name:'physical only',digital:0,physical:1,trial:0,sizes:['M'],subtotal:50},
      {name:'physical two sizes',digital:0,physical:2,trial:0,sizes:['M','L'],subtotal:100},
      {name:'trial only',digital:0,physical:0,trial:1,sizes:['M'],subtotal:1100},
      {name:'digital physical',digital:1,physical:1,trial:0,sizes:['M'],subtotal:100},
      {name:'digital trial',digital:1,physical:0,trial:1,sizes:['M'],subtotal:1150},
      {name:'all',digital:1,physical:1,trial:1,sizes:['M'],subtotal:1200}
    ];
    for(const [index,test] of cases.entries()){
      const who='commerce'+index,physical=!!(test.physical || test.trial); await authCustomer(who);
      const item={product_id:String(product._id),quantity:test.digital,physical_quantity:test.physical,trial_quantity:test.trial,selected_sizes:test.sizes,selected_formats:['dxf'],selected_files:[],selected_addons:[],total:1,unit_price:1};
      const payload={customer:input.customer,items:[item],shipping:physical?{...input.shipping}:{},grand_total:1,tax_amount:0,payment_status:'paid'};
      assert.equal((await request('/cart/add',{...item,files:[],addons:[]},who)).status,200,test.name+' cart');
      const checkout=await request('/checkout',undefined,who);assert.equal(checkout.status,200);
      if(physical){
        for(const field of ['address','city','state','pincode']){
          const value=field==='pincode'?'invalid':'';
          assert.equal((await request('/checkout',{...payload,shipping:{...payload.shipping,[field]:value}},who)).status,400,test.name+' still validates '+field);
        }
        assert.equal((await request('/checkout',{...payload,shipping:{...payload.shipping,state:'Unassigned'}},who)).status,200,test.name+' permits manual hub assignment');
      }
      payload.shipping.dispatch_location='Tampered';payload.shipping.region='Tampered';payload.shipping.courier_charge=1;payload.shipping.courier_name='Tampered';
      assert.equal((await request('/checkout',payload,who)).status,200,test.name);
      const paymentPageSummary=await request('/checkout/payment-method',undefined,who);
      assert.match(paymentPageSummary.html,/Product subtotal/);assert.match(paymentPageSummary.html,/Final payable total/);
      if(physical){
        assert.match(paymentPageSummary.html,/Courier charges/);assert.match(paymentPageSummary.html,/Pay separately/);
        assert.match(paymentPageSummary.html,/Shipping payment status:<\/strong> Not collected/);
        assert.match(paymentPageSummary.html,/Courier booking status:<\/strong> Not booked/);
        assert.doesNotMatch(paymentPageSummary.html,/Configured Courier|₹300\.00/);
      }else assert.doesNotMatch(paymentPageSummary.html,/Courier charges/);
      const payResponse=await request('/checkout/payment-method/proceed',{},who);assert.equal(payResponse.status,200);
      const pay=JSON.parse(payResponse.html);let order=await Order.findOne({razorpay_order_id:pay.razorpay_order_id}).lean();
      assert.equal(order.subtotal,test.subtotal);assert.equal(order.tax_amount,test.subtotal*.18);assert.equal(pay.amount,Math.round(test.subtotal*118));
      assert.equal(order.delivery_charge,0);assert.equal(order.courier_payment_separate,physical);
      assert.equal(order.shipping_payment_status,physical?'not_collected':'not_applicable');
      assert.equal(order.courier_booking_status,physical?'not_booked':'not_required');
      assert.deepEqual(order.items[0].selected_sizes,test.sizes);assert.equal(order.items[0].quantity,test.digital);
      assert.equal(order.shipping_address,physical?input.shipping.address:'');assert.equal(order.courier_name,'');
      assert.equal(order.dispatch_location,physical?'Bengaluru Hub':undefined);
      assert.equal(await require('../services/digitalDeliveryService').ensure(order._id),null);
      assert.equal(await NotificationLog.countDocuments({reference_id:String(order._id),event:'order_digital_ready'}),0);
      assert.equal(await NotificationLog.countDocuments({reference_id:String(order._id),event:'order_payment_success'}),0,'No order email before verification');
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
      if(physical){
        assert.equal(order.shipping_status,'Pending','Verified payment does not imply dispatch.');
        const accountSummary=await request('/account/orders',undefined,who);
        assert.match(accountSummary.html,/Dispatch Hub:<\/strong> Bengaluru Hub/);
        assert.match(accountSummary.html,/Shipping payment status:<\/strong> Not collected/);
        assert.match(accountSummary.html,/Courier booking status:<\/strong> Not booked/);
        const confirmation=await request('/checkout/success?orderId='+order._id,undefined,who);
        assert.match(confirmation.html,/Courier charges are not included in your order total/);
        assert.match(confirmation.html,/Courier booking status:<\/strong> Not booked/);
      }
      assert.equal(Boolean(order.download_token),!!test.digital);assert.equal(await Payment.countDocuments({order_id:order._id}),1);
      assert.equal((await request('/downloads/'+order._id+'/0')).status,404);
      assert.equal((await request('/downloads/'+'a'.repeat(64)+'/0')).status,404);
      assert.equal((await request('/private/patterns/p.dxf')).status,404);
      if(test.digital){
        const url='/downloads/'+order.download_token;
        assert.equal((await request(url+'/0',undefined,who)).status,200);
        assert.equal((await request(url+'/999',undefined,who)).status,404);
        assert.equal((await request(url+'/'+product._id,undefined,who)).status,404);
        await Order.updateOne({_id:order._id},{$set:{payment_status:'failed'}});
        assert.equal((await request(url+'/0',undefined,who)).status,404);
        await Order.updateOne({_id:order._id},{$set:{payment_status:'paid',order_status:'cancelled'}});
        assert.equal((await request(url+'/0',undefined,who)).status,404);
        await Order.updateOne({_id:order._id},{$set:{order_status:order.order_status}});
      }
      const digitalLogs=await NotificationLog.find({reference_id:String(order._id),event:'order_digital_ready'}).lean();
      assert.equal(digitalLogs.length,test.digital?1:0);if(test.digital)assert.equal(digitalLogs[0].channel,'email');
      const customerMail=await NotificationLog.findOne({reference_id:String(order._id),event:'order_payment_success',channel:'email'}).lean();
      assert.match(customerMail.message,/Digital sizes:/);assert.match(customerMail.message,/GST \(18%\)/);assert.match(customerMail.message,/Online Amount Paid:/);
      if(physical){
        assert.equal(order.customer_selected_courier,false);
        assert.equal(order.destination_region,'South India');
        assert.equal(order.dispatch_location,'Bengaluru Hub');
        assert.match(customerMail.message,/Dispatch Hub: Bengaluru Hub/);
        assert.match(customerMail.message,/Courier charges: Pay separately/);
        assert.match(customerMail.message,/Shipping payment status: Not collected/);
        assert.match(customerMail.message,/Courier booking status: Not booked/);
      }
      assert.equal(await NotificationLog.countDocuments({reference_id:String(order._id),event:'admin_successful_payment'}),1);
      const receipt=await Receipt.findOne({reference_id:order._id}).lean();
      assert.equal(receipt.subtotal_paise,test.subtotal*100);assert.equal(receipt.total_paise,pay.amount);assert.equal(receipt.delivery_paise,0);
      const page=await request('/admin/orders/'+order._id,undefined,'admin');assert.equal(page.status,200);assert.match(page.html,/Online Payment Total/);
      if(physical){
        assert.match(page.html,/Dispatch Hub:<\/strong> Bengaluru Hub/);
        assert.match(page.html,/Shipping payment status:<\/strong> Not collected/);
        assert.match(page.html,/Courier booking status:<\/strong> Not booked/);
        const csrf=page.html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
        assert.equal((await request('/admin/orders/'+order._id+'/fulfilment',{_csrf:csrf,courier_id:'destination-courier',shipping_status:'Pending'},'admin')).status,303);
        assert.equal((await Order.findById(order._id)).courier_booking_status,'not_booked','Recording a courier before dispatch does not claim it was booked.');
      }
      const payment=await Payment.findOne({order_id:order._id});
      const paymentPage=await request('/admin/payments/'+payment._id,undefined,'admin');assert.equal(paymentPage.status,200);assert.match(paymentPage.html,/Online Payment Total/);
      if(physical){
        assert.match(paymentPage.html,/Dispatch hub:<\/strong> Bengaluru Hub/);
        assert.match(paymentPage.html,/Shipping payment status:<\/strong> Not collected/);
        assert.match(paymentPage.html,/Courier booking status:<\/strong> Not booked/);
      }else assert.doesNotMatch(paymentPage.html,/Courier charges/);
      const failing=require('../services/notificationService').createDispatcher({email:async()=>{throw new Error('Simulated SMTP failure');}});
      await failing(customerMail._id);
      assert.equal((await Order.findById(order._id)).payment_status,'paid');
      assert.equal((await Payment.findById(payment._id)).payment_status,'paid');
      let sends=0;const dispatch=require('../services/notificationService').createDispatcher({email:async()=>{sends++;return 'mock-smtp';}});
      for(const log of digitalLogs)await Promise.all([dispatch(log._id),dispatch(log._id)]);
      assert.equal(sends,test.digital?1:0);
    }
    await fs.writeFile(path.join(dir,'option-dxf.dxf'),'option DXF');
    await fs.writeFile(path.join(dir,'option-hpgl.plt'),'option HPGL');
    const dxf=await ProductFile.create({product_id:product._id,file_name:'Slim Fit DXF',file_type:'DXF',digital_file:'option-dxf.dxf',purpose:'dxf',file_price:399,price_per_selected_size:true,active:true});
    const hpgl=await ProductFile.create({product_id:product._id,file_name:'Slim Fit HPGL.plt',file_type:'HPGL',digital_file:'option-hpgl.plt',purpose:'other',file_price:399,price_per_selected_size:true,active:true});
    const adminFiles=await request('/admin/products/'+product._id+'/files',undefined,'admin');assert.match(adminFiles.html,/name="price_per_selected_size"/);
    const sizeProductPage=await request('/product/'+product.slug);
    assert.match(sizeProductPage.html,/Editable DXF Pattern/);assert.match(sizeProductPage.html,/HPGL Pattern/);assert.match(sizeProductPage.html,/per selected size/);
    const sizeOptionPayload={product_id:String(product._id),quantity:1,physical_quantity:0,trial_quantity:0,printable_selected:false,selected_sizes:['M','L'],files:[String(dxf._id),String(hpgl._id)],addons:[]};
    assert.equal((await request('/cart/add',{...sizeOptionPayload,selected_sizes:[],files:[String(dxf._id)]},'no-size-file')).status,400,'Cart rejects a per-size file when no size is selected.');
    assert.equal((await request('/cart/add',{...sizeOptionPayload,selected_sizes:['M','M'],files:[String(dxf._id)]},'duplicate-size-file')).status,400,'Cart rejects duplicate sizes for a per-size file.');
    assert.equal((await request('/cart/add',sizeOptionPayload,'size-cart')).status,200,'Cart accepts configured DXF and HPGL files.');
    const sizeCart=await request('/cart',undefined,'size-cart');
    assert.match(sizeCart.html,/M, L/);assert.match(sizeCart.html,/399 per size × 2 selected sizes × quantity 1/i);assert.match(sizeCart.html,/798/);
    const priceWho='per-size-price'; await authCustomer(priceWho);
    const forgedItem={product_id:String(product._id),quantity:1,physical_quantity:0,trial_quantity:0,selected_sizes:['M','L'],printable_selected:false,selected_files:[{id:String(dxf._id),file_price:0,price_per_selected_size:false},{id:String(hpgl._id),file_price:0,price_per_selected_size:false}],selected_addons:[],total:1,unit_price:1};
    assert.equal((await request('/checkout',{customer:input.customer,items:[forgedItem],shipping:{},grand_total:1,tax_amount:0,payment_status:'paid'},priceWho)).status,200,'Checkout accepts configured per-size options despite forged client prices.');
    const sizePayment=JSON.parse((await request('/checkout/payment-method/proceed',{},priceWho)).html);
    const sizeOrder=await Order.findOne({razorpay_order_id:sizePayment.razorpay_order_id}).lean();
    assert.equal(sizeOrder.subtotal,1596,'Checkout loads each file price and unit from MongoDB and charges both formats for both selected sizes.');
    assert.equal(sizePayment.amount,Math.round(1596*118),'Razorpay draft amount uses the server-calculated per-size subtotal and GST.');
    assert.equal(sizeOrder.items[0].selected_files[0].price_per_selected_size,true,'Order snapshots retain the per-size pricing unit.');
    const routingPage=await request('/admin/settings/delivery',undefined,'admin');
    assert.equal(routingPage.status,200);assert.doesNotMatch(routingPage.html,/Charge Delivery Amount|Delivery Charge/i);
    const partnersPage=await request('/admin/settings/couriers',undefined,'admin');assert.equal(partnersPage.status,200);assert.match(partnersPage.html,/name="charge"/);assert.match(partnersPage.html,/name="charge_approved"/);
    const north=JSON.parse((await request('/checkout/delivery-info?state=Delhi')).html);
    assert.equal(north.region_id,'north');assert.equal(north.dispatch_location,'Mumbai Hub');assert.equal(north.couriers,undefined);
    const routeWho='north-dispatch';await authCustomer(routeWho);
    const routePayload={customer:input.customer,items:[{product_id:String(product._id),quantity:0,physical_quantity:1,selected_sizes:['M']}],shipping:{...input.shipping,state:'Delhi',pincode:'110001',courier_id:'unavailable',courier_charge:900,dispatch_location:'Tampered',region:'South'}};
    assert.equal((await request('/checkout',routePayload,routeWho)).status,200,'North physical order does not require courier configuration.');
    const routeSummary=await request('/checkout/payment-method',undefined,routeWho);
    assert.match(routeSummary.html,/Mumbai Hub/);assert.match(routeSummary.html,/Courier charges:<\/strong> Pay separately/);
    assert.doesNotMatch(routeSummary.html,/unavailable|₹900\.00/);
    const routePayment=JSON.parse((await request('/checkout/payment-method/proceed',{},routeWho)).html);
    const routeOrder=await Order.findOne({razorpay_order_id:routePayment.razorpay_order_id}).lean();
    assert.equal(routePayment.amount,5900);assert.equal(routeOrder.dispatch_location,'Mumbai Hub');assert.equal(routeOrder.destination_region,'North India');
    assert.equal(routeOrder.delivery_charge,0);assert.equal(routeOrder.courier_id,'');assert.equal(routeOrder.courier_name,'');
    assert.equal(routeOrder.shipping_payment_status,'not_collected');assert.equal(routeOrder.courier_booking_status,'not_booked');
    assert.equal((await models.Pincode.findOne({pincode:'560001'})).delivery_charge,40);
    console.log('PASS: admin page compatibility, fixed North/Mumbai routing, no courier dependency, ignored client charge/hub values, zero online shipping and address snapshot.');
    const editPage = await request('/admin/products/'+product._id+'/edit', undefined, 'admin');
    const editCsrf = editPage.html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1] || '';
    const edit={_csrf:editCsrf,name:product.name,slug:product.slug,base_price:'60',additional_size_price:'55',physical_price:'65',trial_price:'1200',active:'on'};
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
  }finally{if(old===undefined)delete process.env.PATTERN_FILES_DIR;else process.env.PATTERN_FILES_DIR=old;for(const file of ['p-m.dxf','p-l.dxf','option-dxf.dxf','option-hpgl.plt',...uploaded])await fs.unlink(path.join(dir,file));await fs.rmdir(dir);}
};
