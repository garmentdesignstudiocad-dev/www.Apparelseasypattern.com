const { logError } = require('../services/safeLog');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const mongoose = require('mongoose');
const { razorpayConfigured } = require('../config/payment');

const Customer = require('../models/mongo/Customer');
const Order = require('../models/mongo/Order');
const Payment = require('../models/mongo/Payment');
const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');
const Addon = require('../models/mongo/Addon');
const pricing = require('../services/orderPricing');

const validation = require('../services/commerceValidation');


/*
=========================================================
RAZORPAY CONFIGURATION
=========================================================
*/

const razorpay = razorpayConfigured
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  : null;


/*
=========================================================
GST CONFIGURATION
=========================================================
*/

async function getGstRate() { return 18; }

/*
=========================================================
CHECK WHETHER DELIVERY IS REQUIRED
=========================================================
*/

function requiresDelivery(items) {
  if (!Array.isArray(items)) {
    return false;
  }

  return items.some((item) => {
    const physicalQuantity = Math.max(
      0,
      Number(item.physical_quantity || 0)
    );

    const trialQuantity = Math.max(
      0,
      Number(item.trial_quantity || 0)
    );

    return (
      physicalQuantity > 0 ||
      trialQuantity > 0
    );
  });
}


/*
=========================================================
CALCULATE DELIVERY CHARGE
=========================================================
*/

async function getCheckoutPage(
  req,
  res
) {
  const gstRate = await getGstRate();
  const cart =
    req.session &&
    Array.isArray(req.session.cart)
      ? req.session.cart
      : [];

  res.render(
    'checkout',
    {
      title: 'Checkout',
      accountCustomer: req.session?.customerId ? await Customer.findById(req.session.customerId).lean() : null,

      cart,

      razorpayKeyId:
        process.env.RAZORPAY_KEY_ID || '',

      gstRate:
        gstRate,
    }
  );
}


/*
=========================================================
GET DELIVERY CHARGE
=========================================================
*/

async function getDeliveryCharge(
  req,
  res
) {
  try {

    /*
    -------------------------------------------------------
    PINCODE
    -------------------------------------------------------
    */

    const deliveryInfo=await require('../services/deliveryService').destination(req.query.state,req.query.city);
    const service=require('../services/courierService');
    const couriers=(await service.available(deliveryInfo)).map(service.option);
    return res.json({ok:true,...deliveryInfo,available:couriers.length>0,couriers});

  } catch (error) {

    logError('Delivery route error:', error);

    return res.status(error.statusCode || 500).json({

      ok: false,

      error:
        error.statusCode ? error.message : 'Unable to calculate delivery information.',

    });

  }
}


/*
=========================================================
CREATE ORDER + RAZORPAY ORDER
=========================================================
*/

async function postCheckout(
  req,
  res,
  next
) {
  try {
    const GST_RATE = await getGstRate();

    const {
      items,
      shipping,
    } = req.body;
    const accountCustomer=req.session?.customerId ? await Customer.findById(req.session.customerId).lean() : null;
    if(!accountCustomer)return res.status(401).json({error:'Please sign in again.'});
    const customerPayload={name:accountCustomer.name,email:accountCustomer.email,phone:accountCustomer.phone};


    if(!Array.isArray(items) || items.length>100 || items.some(item=>!item || !validation.id(item.product_id) || !validation.quantities(item) || ['selected_files','selected_addons'].some(key=>item[key]!==undefined && (!Array.isArray(item[key]) || !validation.ids(item[key].map(value=>value && typeof value==='object'?value.id:value)))))) return res.status(400).json({error:'Select valid products, options and whole-number quantities.'});


    /*
    =======================================================
    BASIC VALIDATION
    =======================================================
    */

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {

      return res.status(400).json({

        error:
          'Cart is empty',

      });

    }


    /*
    =======================================================
    RAZORPAY CONFIGURATION
    =======================================================
    */

    if (!razorpayConfigured || !razorpay) {

      return res.status(503).json({

        error:
          'Razorpay is not configured. Please contact the store administrator.',

      });

    }


    /*
    =======================================================
    CUSTOMER VALIDATION
    =======================================================
    */

    if (
      !customerPayload ||
      !customerPayload.name ||
      !customerPayload.email
    ) {

      return res.status(400).json({

        error:
          'Customer name and email are required',

      });

    }


    /*
    =======================================================
    EMAIL VALIDATION
    =======================================================
    */

    const email =
      String(
        customerPayload.email
      )
        .trim()
        .toLowerCase();


    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


    if (
      !emailRegex.test(email)
    ) {

      return res.status(400).json({

        error:
          'Please provide a valid email address',

      });

    }


    if(typeof customerPayload.name!=='string' || !customerPayload.name.trim() || customerPayload.name.length>200 || email.length>254) return res.status(400).json({error:'Enter a valid customer name and email.'});
    customerPayload.name=customerPayload.name.trim();
    customerPayload.email =
      email;

    const customerPhone = String(customerPayload.phone || '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(customerPhone)) {
      return res.status(400).json({ error: 'Please provide a valid 10-digit phone number.' });
    }
    customerPayload.phone = customerPhone;


    /*
    =======================================================
    SHIPPING INFORMATION
    =======================================================
    */

    const shippingData =
      shipping &&
      typeof shipping === 'object'
        ? shipping
        : {};


    const address =
      String(
        shippingData.address ||
        customerPayload.address ||
        ''
      ).trim();


    const city =
      String(
        shippingData.city ||
        customerPayload.city ||
        ''
      ).trim();


    const state =
      String(
        shippingData.state ||
        customerPayload.state ||
        ''
      ).trim();


    const pincode =
      String(
        shippingData.pincode ||
        customerPayload.pincode ||
        ''
      )
        .trim();


    /*
    =======================================================
    DELIVERY REQUIRED?
    =======================================================
    */

    const deliveryRequired =
      requiresDelivery(items);


    /*
    =======================================================
    PHYSICAL ORDER VALIDATION
    =======================================================
    */

    if ([address, city, state].some(value => value.length > 500)) return res.status(400).json({error:"Delivery fields are too long."});
    if (deliveryRequired) {

      if (!address) {

        return res.status(400).json({

          error:
            'Delivery address is required for physical orders.',

        });

      }


      if (!city) {

        return res.status(400).json({

          error:
            'City is required for physical orders.',

        });

      }


      if (!state) {

        return res.status(400).json({

          error:
            'State is required for physical orders.',

        });

      }


      if (
        !/^\d{6}$/.test(pincode)
      ) {

        return res.status(400).json({

          error:
            'Valid 6-digit pincode is required for delivery.',

        });

      }

    }


    /*
    =======================================================
    FIND / CREATE CUSTOMER
    =======================================================
    */

    let customer =
      await Customer.findOne({
        email,
      }).select('+password_hash').exec();


    if (!customer) {

      customer =
        await Customer.create({

          name: customerPayload.name, email, phone: customerPhone,

          address,
          city,
          state,
          pincode,

        });

    } else if (accountCustomer || !customer.password_hash) {

      let changed = false;


      if (
        customer.name !==
        customerPayload.name
      ) {

        customer.name =
          customerPayload.name;

        changed = true;

      }


      if (
        customer.phone !==
        (customerPayload.phone || '')
      ) {

        customer.phone =
          customerPayload.phone || '';

        changed = true;

      }


      if (address) {

        customer.address =
          address;

        changed = true;

      }


      if (city) {

        customer.city =
          city;

        changed = true;

      }


      if (state) {

        customer.state =
          state;

        changed = true;

      }


      if (pincode) {

        customer.pincode =
          pincode;

        changed = true;

      }


      if (changed) {

        await customer.save();

      }

    }


    /*
    =======================================================
    TOTALS
    =======================================================
    */

    let subtotal = 0;

    let addon_total = 0;

    let physical_total = 0;

    let trial_total = 0;

    const orderItems = [];


    /*
    =======================================================
    PROCESS EACH CART ITEM
    =======================================================
    */

    for (
      const item of items
    ) {

      const productId =
        item.product_id;


      if (!productId) {

        return res.status(400).json({

          error:
            'Product ID is required for each item',

        });

      }


      /*
      -----------------------------------------------------
      FIND PRODUCT
      -----------------------------------------------------
      */

      const product =
        await Product.findById(
          productId
        ).lean();


      if (!product || product.active === false) {

        return res.status(400).json({

          error:
            'Product not found',

        });

      }


      /*
      -----------------------------------------------------
      QUANTITIES
      -----------------------------------------------------
      */

      const quantity =
        Math.max(
          0,
          Number(
            item.quantity ?? 1
          )
        );


      const physicalQuantity =
        Math.max(
          0,
          Number(
            item.physical_quantity || 0
          )
        );


      const trialQuantity =
        Math.max(
          0,
          Number(
            item.trial_quantity || 0
          )
        );


      /*
      -----------------------------------------------------
      SELECTED FILE IDS
      -----------------------------------------------------
      */

      const selectedFileIds =
        Array.isArray(
          item.selected_files
        )
          ? item.selected_files
              .map((file) =>
                typeof file === 'object'
                  ? file.id
                  : file
              )
              .filter(Boolean)
          : [];


      /*
      -----------------------------------------------------
      SELECTED ADDON IDS
      -----------------------------------------------------
      */

      const selectedAddonIds =
        Array.isArray(
          item.selected_addons
        )
          ? item.selected_addons
              .map((addon) =>
                typeof addon === 'object'
                  ? addon.id
                  : addon
              )
              .filter(Boolean)
          : [];


      /*
      -----------------------------------------------------
      GET FILES
      -----------------------------------------------------
      */

      const selectedFiles =
        selectedFileIds.length
          ? await ProductFile.find({

              _id: {
                $in:
                  selectedFileIds,
              },

              product_id:
                product._id,
              active: { $ne: false },

            }).lean()
          : [];


      /*
      -----------------------------------------------------
      GET ADDONS
      -----------------------------------------------------
      */

      const selectedAddons =
        selectedAddonIds.length
          ? await Addon.find({

              _id: {
                $in:
                  selectedAddonIds,
              },

              product_id:
                product._id,
              active: { $ne: false },

            }).lean()
          : [];


      /*
      -----------------------------------------------------
      VALIDATE FILES
      -----------------------------------------------------
      */

      if (
        selectedFileIds.length !==
        selectedFiles.length
      ) {

        return res.status(400).json({

          error:
            'One or more selected files are invalid',

        });

      }


      /*
      -----------------------------------------------------
      VALIDATE ADDONS
      -----------------------------------------------------
      */

      if (
        selectedAddonIds.length !==
        selectedAddons.length
      ) {

        return res.status(400).json({

          error:
            'One or more selected add-ons are invalid',

        });

      }


      /*
      =====================================================
      SERVER SIDE PRICING
      =====================================================
      */

      const unitPrice =
        Number(
          product.base_price || 0
        );


      const filesTotal =
        selectedFiles.reduce(
          (sum, file) =>
            sum +
            Number(
              file.file_price || 0
            ),
          0
        );


      const addonsTotal =
        selectedAddons.reduce(
          (sum, addon) =>
            sum +
            Number(
              addon.price || 0
            ),
          0
        );


      const physicalPrice =
        Number(
          product.physical_price || 0
        );


      const trialPrice =
        Number(
          product.trial_price || 0
        );


      /*
      -----------------------------------------------------
      DIGITAL TOTAL
      -----------------------------------------------------
      */

      const itemUnitTotal =
        unitPrice +
        filesTotal +
        addonsTotal;


      const optionError=require('../services/patternOptions').validate(product,selectedFiles,item);
      if(optionError)return res.status(400).json({error:optionError});
      const priced = pricing.itemPrice(product, selectedFiles, selectedAddons, item);
      const itemSubtotal = priced.digital;


      /*
      -----------------------------------------------------
      PHYSICAL TOTAL
      -----------------------------------------------------
      */

      const itemPhysicalTotal = priced.physical;


      /*
      -----------------------------------------------------
      TRIAL TOTAL
      -----------------------------------------------------
      */

      const itemTrialTotal = priced.trial;


      /*
      -----------------------------------------------------
      ITEM TOTAL
      -----------------------------------------------------
      */

      const itemTotal =
        itemSubtotal +
        itemPhysicalTotal +
        itemTrialTotal;


      /*
      -----------------------------------------------------
      ADD TOTALS
      -----------------------------------------------------
      */

      subtotal +=
        itemSubtotal;


      addon_total += priced.addons;


      physical_total +=
        itemPhysicalTotal;


      trial_total +=
        itemTrialTotal;


      /*
      -----------------------------------------------------
      ORDER ITEM
      -----------------------------------------------------
      */

      orderItems.push({
        product_name: product.name,
        printable_selected: item.printable_selected !== false,
        selected_sizes: item.selected_sizes || [],
        additional_size_price: Number(product.additional_size_price || 0),

        product_id:
          product._id,

        selected_files:
          selectedFiles.map(
            (file) => ({

              id:
                file._id.toString(),

              file_name:
                file.file_name,
              file_type: file.file_type,

              file_price:
                Number(
                  file.file_price || 0
                ),

            })
          ),

        selected_addons:
          selectedAddons.map(
            (addon) => ({

              id:
                addon._id.toString(),

              name:
                addon.name,

              price:
                Number(
                  addon.price || 0
                ),

            })
          ),

        physical_quantity:
          physicalQuantity,
        quantity,

        trial_quantity:
          trialQuantity,

        unit_price:
          unitPrice,

        total_price:
          itemTotal,

      });

    }


    /*
    =======================================================
    PRODUCT SUBTOTAL
    =======================================================
    */

    const productSubtotal =
      subtotal +
      physical_total +
      trial_total;

    const destination=deliveryRequired?await require('../services/deliveryService').destination(state,city):{};
    if(deliveryRequired && !destination.region_id)return res.status(400).json({error:'Delivery service is not currently configured for this state.'});
    const courierId=typeof shippingData.courier_id==='string'?shippingData.courier_id:'';
    let selectedCourier=null;
    const courierOptions = deliveryRequired ? await require('../services/courierService').available(destination) : [];
    if(deliveryRequired && !courierOptions.length)return res.status(400).json({error:'Delivery service is not currently configured for this state.'});
    if(deliveryRequired && !courierId) return res.status(400).json({error:'Choose a delivery partner for this dispatch hub.'});
    if(deliveryRequired && courierId){
      selectedCourier=courierOptions.find(row=>row._id===courierId);
      if(!selectedCourier)return res.status(400).json({error:'The selected delivery partner is unavailable for this dispatch hub. Refresh delivery options.'});
    }


    /*
    =======================================================
    DELIVERY CHARGE FROM MONGODB
    =======================================================
    */

    const deliveryInfo={...destination,zone:destination.region || '',...(selectedCourier?require('../services/courierService').option(selectedCourier):{})};

    /*
    =======================================================
    TAXABLE AMOUNT
    =======================================================
    */

    const taxableAmount = productSubtotal;


    /*
    =======================================================
    GST 18%
    =======================================================
    */

    const taxAmount = pricing.totals(taxableAmount).tax;


    /*
    =======================================================
    GRAND TOTAL
    =======================================================
    */

    const grandTotal = pricing.totals(productSubtotal).total;


    /*
    =======================================================
    VALIDATE TOTAL
    =======================================================
    */

    if (
      !Number.isFinite(
        grandTotal
      ) ||
      grandTotal <= 0
    ) {

      return res.status(400).json({

        error:
          'Invalid order total. Please check your cart.',

      });

    }

    /*
    =======================================================
    SAVE A SERVER-CALCULATED PAYMENT DRAFT
    =======================================================
    */

    if (!req.createRazorpayOrder) {
      req.session.paymentDraft = {
        customer: { name: customerPayload.name, email, phone: customerPhone },
        items,
        shipping: deliveryRequired ? { address, city, state, pincode, courier_id:courierId } : {},
        summary: {
          destination: destination,
          product_total: Number(productSubtotal.toFixed(2)),
          tax_rate: GST_RATE,
          tax_amount: Number(taxAmount.toFixed(2)),
          grand_total: Number(grandTotal.toFixed(2)),
          delivery_required: deliveryRequired,
          estimated_delivery: deliveryInfo.estimated_delivery || 'Not configured',
          courier_name: selectedCourier?.name || '',
          shipping_arranged_separately:false,
        },
      };

      await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
      return res.json({ ok: true, payment_method_url: '/checkout/payment-method' });
    }


    /*
    =======================================================
    CREATE MONGODB ORDER
    =======================================================
    */

    const order =
      await Order.create({
        shipping_address:deliveryRequired?address:'',shipping_city:deliveryRequired?city:'',shipping_state:deliveryRequired?state:'',
        courier_id:selectedCourier?._id || '',courier_name:selectedCourier?.name || '',
        customer_selected_courier:deliveryRequired,
        delivery_flow_version:2,
        destination_region_id:destination.region_id, destination_region:destination.region,dispatch_location:destination.dispatch_location,
        shipping_arranged_separately:false,

        account_customer_id:accountCustomer?._id,
        customer_snapshot: {name:customerPayload.name,email,phone:customerPhone},
        courier_payment_separate: false,
        customer_id:
          customer._id,

        items:
          orderItems,

        subtotal:
          Number(
            productSubtotal.toFixed(2)
          ),

        addon_total:
          Number(
            addon_total.toFixed(2)
          ),

        physical_total:
          Number(
            physical_total.toFixed(2)
          ),

        trial_total:
          Number(
            trial_total.toFixed(2)
          ),

        delivery_pincode:
          deliveryRequired
            ? pincode
            : '',

        delivery_zone:
          deliveryInfo.zone || '',

        delivery_state:
          deliveryInfo.state || '',

        delivery_district:
          deliveryInfo.district || '',

        delivery_min_days:
          deliveryRequired ? deliveryInfo.delivery_min_days : undefined,

        delivery_max_days:
          deliveryRequired ? deliveryInfo.delivery_max_days : undefined,

        estimated_delivery_from:
          deliveryRequired && deliveryInfo.estimated_from
            ? new Date(deliveryInfo.estimated_from)
            : undefined,

        estimated_delivery_to:
          deliveryRequired && deliveryInfo.estimated_to
            ? new Date(deliveryInfo.estimated_to)
            : undefined,

        tax_rate:
          GST_RATE,

        tax_amount:
          Number(
            taxAmount.toFixed(2)
          ),

        grand_total:
          Number(
            grandTotal.toFixed(2)
          ),

        order_status:
          'pending',

        payment_status:
          'unpaid',

        payment_gateway:
          'razorpay',

      });

    /*
    =======================================================
    CREATE RAZORPAY ORDER
    =======================================================
    */

    const razorpayOrder =
      await razorpay.orders.create({

        amount:
          Math.round(
            grandTotal * 100
          ),

        currency:
          'INR',

        receipt:
          `gp_${order._id}`,

        notes: {

          order_id:
            order._id.toString(),

          customer_id:
            customer._id.toString(),

          pincode:
            pincode || '',

          delivery_zone:
            deliveryInfo.zone || '',

          tax_rate:
            String(
              GST_RATE
            ),

          tax_amount:
            String(
              taxAmount
            ),

        },

      });


    /*
    =======================================================
    STORE RAZORPAY ORDER ID
    =======================================================
    */

    order.payment_reference =
      razorpayOrder.id;
    order.razorpay_order_id = razorpayOrder.id;



    /*
    =======================================================
    CREATE PAYMENT RECORD
    =======================================================
    */

    await Payment.create({
      payment_purpose: 'product_order',
      local_reference_id: String(order._id),
      razorpay_order_id: razorpayOrder.id,

      order_id:
        order._id,

      payment_provider:
        'razorpay',

      payment_id:
        razorpayOrder.id,

      payment_status:
        'created',

      amount:
        Number(
          grandTotal.toFixed(2)
        ),

      currency:
        'INR',

    });
    await order.save();
    await require('../services/notificationService').safeFlush('product_order',order._id);


    /*
    =======================================================
    SEND PAYMENT DETAILS
    =======================================================
    */

    return res.json({

      ok: true,

      payment_required:
        true,

      key:
        process.env.RAZORPAY_KEY_ID,

      key_id:
        process.env.RAZORPAY_KEY_ID,

      amount:
        razorpayOrder.amount,

      currency:
        razorpayOrder.currency,

      razorpay_order_id:
        razorpayOrder.id,

      order_id:
        order._id.toString(),

      subtotal:
        Number(
          productSubtotal.toFixed(2)
        ),

      delivery_zone:
        deliveryInfo.zone || '',

      delivery_state:
        deliveryInfo.state || '',

      delivery_district:
        deliveryInfo.district || '',

      tax_rate:
        GST_RATE,

      tax_amount:
        Number(
          taxAmount.toFixed(2)
        ),

      grand_total:
        Number(
          grandTotal.toFixed(2)
        ),

      delivery_required:
        deliveryRequired,

      customer: {

        name:
          customer.name,

        email:
          customer.email,

        phone:
          customer.phone || '',

      },

    });

  } catch (err) {

    logError('Razorpay checkout creation error:', err);

    if (!res.headersSent) {
      return res.status(502).json({
        error: 'Unable to initialize Razorpay payment. Please try again.',
      });
    }

    return next(err);

  }
}


/*
=========================================================
RAZORPAY PAYMENT PAGE
=========================================================
*/

async function getPaymentMethodPage(req, res) {
  const draft = req.session && req.session.paymentDraft;
  if (!draft || !draft.summary) return res.redirect('/checkout');
  return res.render('payment_method', {
    title: 'Secure Payment',
    summary: draft.summary,
    customer: draft.customer,
  });
}

const pendingCheckouts = new Set();
async function postPaymentMethodProceed(req, res, next) {
  const key=req.sessionID;
  if(pendingCheckouts.has(key)) return res.status(409).json({error:'Payment setup is already in progress. Please wait and try again.'});
  pendingCheckouts.add(key);
  try { return await proceedWithPayment(req,res,next); }
  finally { pendingCheckouts.delete(key); }
}
async function proceedWithPayment(req, res, next) {
  await new Promise((resolve,reject)=>req.session.reload(error=>error?reject(error):resolve()));
  const draft = req.session && req.session.paymentDraft;
  if (!draft || !draft.summary) return res.status(400).json({ error: 'Your checkout session has expired. Please return to checkout.' });
  if (draft.paymentResponse && draft.paymentResponse.razorpay_order_id) {
    return res.json(draft.paymentResponse);
  }

  const sendJson = res.json.bind(res);
  res.json = async (payload) => {
    if (payload && payload.razorpay_order_id) {
      draft.paymentResponse = payload;
      await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    }
    return sendJson(payload);
  };
  req.body = { customer: draft.customer, items: draft.items, shipping: draft.shipping };
  req.createRazorpayOrder = true;
  return postCheckout(req, res, next);
}

/*
=========================================================
RAZORPAY CALLBACK
=========================================================
*/

async function completeVerifiedPayment(order, savedOrderId, paymentId) {
    // Invalid callbacks never change payment state. Retries cannot reset delivery status.
    await Order.updateOne({_id:order._id,payment_verified_at:{$exists:false}},{$set:{payment_status:'paid',shipping_status:order.order_status==='cancelled'?'Cancelled':'Confirmed',order_status:order.order_status==='cancelled'?'cancelled':'confirmed',payment_reference:paymentId,razorpay_order_id:savedOrderId,payment_verified_at:order.payment_verified_at || new Date()},$addToSet:{notification_jobs:{key:'paid',event:'payment_success',status:'Paid'}}});
    await Payment.findOneAndUpdate({order_id:order._id},{$set:{payment_purpose:'product_order',local_reference_id:String(order._id),razorpay_order_id:savedOrderId,razorpay_payment_id:paymentId,payment_provider:'razorpay',payment_id:paymentId,payment_status:'paid',amount:order.grand_total,currency:'INR'}},{upsert:true,runValidators:true});
    await require('../services/notificationService').safeFlush('product_order',order._id);
}

async function postRazorpayWebhook(req, res) {
  const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
  if(!secret)return res.status(503).json({error:'Webhook is not configured.'});
  const signature=req.get('x-razorpay-signature');
  if(!Buffer.isBuffer(req.body) || !/^[a-f0-9]{64}$/i.test(signature || ''))return res.sendStatus(400);
  const expected=crypto.createHmac('sha256',secret).update(req.body).digest();
  if(!crypto.timingSafeEqual(expected,Buffer.from(signature,'hex')))return res.sendStatus(400);
  try {
    const event=JSON.parse(req.body.toString('utf8'));
    if(!['payment.captured','order.paid'].includes(event.event))return res.sendStatus(200);
    const payment=event.payload?.payment?.entity;
    if(!payment || !/^pay_[a-zA-Z0-9]+$/.test(payment.id || '') || !/^order_[a-zA-Z0-9]+$/.test(payment.order_id || ''))return res.sendStatus(400);
    const order=await Order.findOne({razorpay_order_id:payment.order_id});
    if(!order)return res.sendStatus(200); // Other checkout modules may use the same gateway account.
    if(!razorpay)return res.sendStatus(503);
    const verified=await razorpay.payments.fetch(payment.id);
    if(verified.order_id!==order.razorpay_order_id || verified.amount!==Math.round(order.grand_total*100) || verified.currency!=='INR' || verified.status!=='captured' || verified.captured!==true || Number(verified.amount_refunded || 0)>0)return res.sendStatus(409);
    await completeVerifiedPayment(order,order.razorpay_order_id,payment.id);
    return res.sendStatus(200);
  } catch(error) { logError('Payment webhook deferred:',error);return res.sendStatus(500); }
}

async function postRazorpayCallback(req, res) {
  try {
    const { razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: signature } = req.body;
    if(typeof paymentId!=='string' || !/^pay_[a-zA-Z0-9]+$/.test(paymentId) || typeof orderId!=='string' || !/^order_[a-zA-Z0-9]+$/.test(orderId) || typeof signature!=='string' || !/^[a-f0-9]{64}$/i.test(signature)) return res.status(400).send('Invalid payment response. Please try again.');
    if(!process.env.RAZORPAY_KEY_SECRET) return res.status(503).send('Payment verification is temporarily unavailable.');
    // The original payment_reference lookup supports older pending orders.
    const order=await Order.findOne({$or:[{razorpay_order_id:orderId},{payment_reference:orderId}]});
    if(!order) return res.status(404).send('Order not found.');
    const savedOrderId=order.razorpay_order_id || order.payment_reference;
    const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(savedOrderId+'|'+paymentId).digest('hex');
    if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex'))) return res.status(400).send('Payment verification failed. Please try again.');
    if(!razorpay)return res.status(503).send('Payment verification is temporarily unavailable.');
    const captured=await razorpay.payments.fetch(paymentId);
    if(captured.order_id!==savedOrderId || captured.amount!==Math.round(Number(order.grand_total)*100) || captured.currency!=='INR')return res.status(400).send('Payment details do not match this order.');
    if(captured.status!=='captured' || captured.captured!==true || Number(captured.amount_refunded || 0)>0)return res.status(409).send('Payment is not captured or has been refunded. Contact the studio with your reference before paying again.');
    await completeVerifiedPayment(order, savedOrderId, paymentId);
    if(req.session && (!order.account_customer_id || String(order.account_customer_id)===String(req.session.customerId))) {
      req.session.cart=[]; delete req.session.paymentDraft;
      req.session.completedOrderIds=Array.isArray(req.session.completedOrderIds)?req.session.completedOrderIds:[];
      if(!req.session.completedOrderIds.includes(String(order._id))) req.session.completedOrderIds.push(String(order._id));
      await new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
    }
    return res.redirect('/checkout/success?orderId='+order._id);
  } catch(error) { logError('Razorpay callback error:',error);return res.status(500).send('Payment verification could not be completed. Please try again.'); }
}

/*
=========================================================
SUCCESS PAGE
=========================================================
*/

async function getSuccess(
  req,
  res
) {

  const {
    orderId,
  } = req.query;

  let order = null;
  const allowedOrders = req.session && Array.isArray(req.session.completedOrderIds)
    ? req.session.completedOrderIds
    : [];
  if (orderId && allowedOrders.includes(String(orderId))) {
    order = await Order.findOne({ _id: orderId, payment_status: 'paid', payment_verified_at: {$ne:null} }).select('+download_token').lean().catch((error) => {
      logError('Order success lookup error:', error);
      return null;
    });
  }


  res.render(
    'checkout_success',
    {

      title:
        'Payment Success',

      orderId:
        orderId || null,

      order,

    }
  );
}


/*
=========================================================
CANCEL PAGE
=========================================================
*/

async function getCancel(
  req,
  res
) {

  const {
    orderId,
  } = req.query;


  res.render(
    'checkout_cancel',
    {

      title:
        'Payment Cancelled',

      orderId:
        orderId || null,

    }
  );
}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

  getCheckoutPage,

  getDeliveryCharge,

  postCheckout,

  getPaymentMethodPage,

  postPaymentMethodProceed,

  postRazorpayCallback,
  postRazorpayWebhook,

  getSuccess,

  getCancel,

};
