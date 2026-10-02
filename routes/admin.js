const { logError } = require('../services/safeLog');
const express = require('express');
const router = express.Router();
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
for(const param of ['id','productId','fileId','addonId']) router.param(param,(req,res,next,value)=>/^[a-f\d]{24}$/i.test(value)?next():res.status(404).render('error',{title:'Not Found',message:'The requested record was not found.'}));
const adminAuth = require('../middleware/adminAuth');
const { db } = require('../config/db');
const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');
const Addon = require('../models/mongo/Addon');
const Order = require('../models/mongo/Order');
const Customer = require('../models/mongo/Customer');
const Payment = require('../models/mongo/Payment');
const PricingSettings = require('../models/mongo/PricingSettings');


const adminUsername = process.env.ADMIN_USERNAME?.trim();
const adminPassword = process.env.ADMIN_PASSWORD?.trim();

router.use((req,res,next)=>req.method==='POST' && req.path!=='/login'?adminAuth(req,res,()=>require('../middleware/adminInputValidation')(req,res,next)):next());


function buildSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function parseStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n|,/)
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }

  return [];
}

function parseProductPayload(body) {
  const name = String(body?.name || '').trim();
  return {
    name,
    ...require('../services/productMetadata').parse(body),
    slug: String(body?.slug || '').trim() || buildSlug(name),
    description: String(body?.description || '').trim(),
    base_price: Number(body?.base_price || 0),
    additional_size_price: Number(body?.additional_size_price || 0),
    physical_price: Number(body?.physical_price || 0),
    trial_price: Number(body?.trial_price || 0),
    images: parseStringArray(body?.images),
    active: body?.active === 'on' || body?.active === true || body?.active === '1',
  };
}

function parseFilePayload(body) {
  return {
    file_name: String(body?.file_name || '').trim(),
    file_type: String(body?.file_type || '').trim(),
    file_price: Number(body?.file_price || 0),
    active: body?.active === 'on' || body?.active === true || body?.active === '1',
  };
}

function parseAddonPayload(body) {
  return {
    name: String(body?.name || '').trim(),
    description: String(body?.description || '').trim(),
    price: Number(body?.price || 0),
    active: body?.active === 'on' || body?.active === true || body?.active === '1',
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(Number(value || 0));
}

function buildRedirectUrl(basePath, message, type = 'success') {
  const safeMessage = encodeURIComponent(message);
  const safeType = encodeURIComponent(type);
  return `${basePath}?message=${safeMessage}&messageType=${safeType}`;
}

router.get('/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin');
  }

  const message = req.query.message || null;
  const authConfigured = !!adminUsername && !!adminPassword;

  res.render('admin/login', {
    title: 'Admin Login',
    message,
    authConfigured,
  });
});

router.post('/login', (req, res, next) => {
  if (!adminUsername || !adminPassword) {
    return res.status(500).render('admin/login', {
      title: 'Admin Login',
      message: 'Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in environment.',
      authConfigured: false,
    });
  }

  const { username, password } = req.body;
  if (username === adminUsername && password === adminPassword) {
    const preserved={...req.session};delete preserved.cookie;
    return req.session.regenerate(error=>{
      if(error)return next(error);
      Object.assign(req.session,preserved,{isAdmin:true,adminUser:username});
      if (req.body.remember === 'on') req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
      req.session.save(error=>error?next(error):res.redirect('/admin'));
    });
  }

  res.status(401).render('admin/login', {
    title: 'Admin Login',
    message: 'Invalid username or password.',
    authConfigured: true,
  });
});

router.get('/logout', (req, res, next) => {
  const preserved={...req.session};for(const key of ['cookie','isAdmin','adminUser'])delete preserved[key];
  req.session.regenerate(error=>{
    if(error)return next(error);
    Object.assign(req.session,preserved);
    req.session.save(error=>error?next(error):res.redirect('/admin/login'));
  });
});

router.get(['/', '/dashboard'], adminAuth, async (req, res) => {
  const defaults = { products: 0, orders: 0, payments: 0, customers: 0 };
  let counts = { ...defaults };
  let recentOrders = [];
  let recentPayments = [];
  let totalRevenue = null;
  let todayRevenue = 0;
  let orderStats = { paid: 0, pending: 0, processing: 0 };
  let inactiveProducts = [];

  try {
    // Try to use Mongoose models (MongoDB) first
    const [productsCount, ordersCount, paymentsCount, customersCount] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      Payment.countDocuments(),
      Customer.countDocuments(),
    ]);

    counts = {
      products: Number(productsCount) || 0,
      orders: Number(ordersCount) || 0,
      payments: Number(paymentsCount) || 0,
      customers: Number(customersCount) || 0,
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [paidOrders, pendingOrders, processingOrders, inactive, todayRevenueRows] = await Promise.all([
      Order.countDocuments({ payment_status: 'paid' }),
      Order.countDocuments({ order_status: 'pending' }),
      Order.countDocuments({ order_status: 'processing' }),
      Product.find({ active: false }).sort({ updatedAt: -1 }).limit(5).lean(),
      Payment.aggregate([{ $match: { payment_status: 'paid', createdAt: { $gte: today } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);
    orderStats = { paid: paidOrders, pending: pendingOrders, processing: processingOrders };
    inactiveProducts = inactive;
    todayRevenue = Number(todayRevenueRows[0]?.total || 0);

    // Recent orders
    const ordersRaw = await Order.find().sort({ createdAt: -1 }).limit(5).lean();
    recentOrders = await Promise.all(ordersRaw.map(async (o) => {
      const customer = await Customer.findById(o.customer_id).lean().catch(() => null);
      const payment = await Payment.findOne({ order_id: o._id }).lean().catch(() => null);
      return {
        id: o._id.toString(),
        customer_name: customer ? customer.name : 'Unknown',
        grand_total: o.grand_total || 0,
        order_status: o.order_status,
        payment_status: o.payment_status || (payment && payment.payment_status) || 'unpaid',
        createdAt: o.createdAt,
      };
    }));

    // Recent payments
    const paymentsRaw = await Payment.find().sort({ createdAt: -1 }).limit(5).lean();
    recentPayments = paymentsRaw.map(p => ({
      id: p._id.toString(),
      order_id: p.order_id ? String(p.order_id) : null,
      amount: p.amount || 0,
      payment_status: p.payment_status || 'unknown',
      createdAt: p.createdAt,
    }));

    // Total revenue (sum of payments.amount) - handle gracefully if unavailable
    const revenueAgg = await Payment.aggregate([
      { $match: { payment_status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).catch(() => []);
    if (Array.isArray(revenueAgg) && revenueAgg.length > 0) {
      totalRevenue = revenueAgg[0].total || 0;
    }
  } catch (err) {
    // Fall back to previous DB counts if Mongoose/Mongo is unavailable
    logError('Admin dashboard Mongoose error:', err);
    try {
      const [productResult, orderResult, paymentResult, customerResult] = await Promise.all([
        db('products').count({ count: 'id' }).first(),
        db('orders').count({ count: 'id' }).first(),
        db('payments').count({ count: 'id' }).first(),
        db('customers').count({ count: 'id' }).first(),
      ]);

      counts = {
        products: parseInt(productResult?.count, 10) || 0,
        orders: parseInt(orderResult?.count, 10) || 0,
        payments: parseInt(paymentResult?.count, 10) || 0,
        customers: parseInt(customerResult?.count, 10) || 0,
      };
    } catch (err2) {
      logError('Admin dashboard fallback DB error:', err2);
    }
  }

  let paidAccessStats=[];
  try {paidAccessStats=await require('../services/paidAccessStats')();}catch(error){paidAccessStats=[{label:'Paid Access',value:'Temporarily unavailable'}];}
  res.render('admin/dashboard', {
    paidAccessStats,
    title: 'Admin Dashboard',
    counts,
    recentOrders,
    recentPayments,
    totalRevenue,
    todayRevenue,
    orderStats,
    inactiveProducts,
    formatCurrency,
  });
});

router.get('/products', adminAuth, async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.render('admin/products', {
      title: 'Manage Products',
      products,
      editingProduct: null,
      productForm: {},
      message: req.query.message || null,
      messageType: req.query.messageType || 'success',
      formatCurrency,
    });
  } catch (err) {
    logError('Admin products list error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load products right now.',
    });
  }
});

router.get('/products/new', adminAuth, async (req, res) => {
  try {
    const [products, defaults] = await Promise.all([
      Product.find().sort({ createdAt: -1 }).lean(),
      PricingSettings.findOne({ key: 'default' }).lean().catch(() => null),
    ]);
    res.render('admin/products', {
      title: 'Add Product',
      products,
      editingProduct: null,
      productForm: {
        active: true,
        base_price: defaults?.soft_copy_price || 0,
        additional_size_price: defaults?.additional_size_price || 0,
        physical_price: defaults?.physical_pattern_price || 0,
        trial_price: defaults?.trial_sample_price || 0,
      },
      message: req.query.message || null,
      messageType: req.query.messageType || 'success',
      formatCurrency,
    });
  } catch (err) {
    logError('Admin product form error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load the product form.',
    });
  }
});

router.post('/products', adminAuth, async (req, res) => {
  const productForm = parseProductPayload(req.body);

  try {
    await Product.create(productForm);
    res.redirect(buildRedirectUrl('/admin/products', 'Product created successfully.'));
  } catch (err) {
    logError('Admin product create error:', err);
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.status(400).render('admin/products', {
      title: 'Add Product',
      products,
      editingProduct: null,
      productForm,
      message: 'Could not create product. Please verify the slug and required fields.',
      messageType: 'error',
      formatCurrency,
    });
  }
});

router.get('/products/:id/edit', adminAuth, async (req, res) => {
  try {
    const [product, products] = await Promise.all([
      Product.findById(req.params.id).lean(),
      Product.find().sort({ createdAt: -1 }).lean(),
    ]);

    if (!product) {
      return res.redirect('/admin/products');
    }

    res.render('admin/products', {
      title: 'Edit Product',
      products,
      editingProduct: product,
      productForm: product,
      message: req.query.message || null,
      messageType: req.query.messageType || 'success',
      formatCurrency,
    });
  } catch (err) {
    logError('Admin product edit load error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load this product for editing.',
    });
  }
});

router.post('/products/:id/edit', adminAuth, async (req, res) => {
  const productForm = parseProductPayload(req.body);

  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.redirect('/admin/products');
    }

    Object.assign(product, productForm);
    await product.save();
    res.redirect(buildRedirectUrl('/admin/products', 'Product updated successfully.'));
  } catch (err) {
    logError('Admin product update error:', err);
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.status(400).render('admin/products', {
      title: 'Edit Product',
      products,
      editingProduct: null,
      productForm,
      message: 'Could not update product.',
      messageType: 'error',
      formatCurrency,
    });
  }
});

router.post('/products/:id/toggle', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.redirect('/admin/products');
    }

    product.active = !product.active;
    await product.save();
    const status = product.active ? 'activated' : 'deactivated';
    res.redirect(buildRedirectUrl('/admin/products', `Product ${status} successfully.`));
  } catch (err) {
    logError('Admin product toggle error:', err);
    res.redirect(buildRedirectUrl('/admin/products', 'Could not update product status.', 'error'));
  }
});

router.get('/products/:productId/files', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).lean();
    if (!product) {
      return res.redirect('/admin/products');
    }

    const files = await ProductFile.find({ product_id: req.params.productId }).sort({ createdAt: -1 }).lean();
    res.render('admin/productFiles', {
      title: 'Manage Product Files',
      product,
      files,
      editingFile: null,
      fileForm: { active: true },
      message: req.query.message || null,
      messageType: req.query.messageType || 'success',
      formatCurrency,
    });
  } catch (err) {
    logError('Admin product files load error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load product files.',
    });
  }
});

router.post('/products/:productId/files', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.redirect('/admin/products');
    }

    const fileForm = parseFilePayload(req.body);
    await ProductFile.create({
      product_id: product._id,
      ...fileForm,
    });

    res.redirect(buildRedirectUrl(`/admin/products/${product._id}/files`, 'Pattern file added successfully.'));
  } catch (err) {
    logError('Admin product file create error:', err);
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/files`, 'Could not add pattern file.', 'error'));
  }
});

router.get('/products/:productId/files/:fileId/edit', adminAuth, async (req, res) => {
  try {
    const [product, files, editingFile] = await Promise.all([
      Product.findById(req.params.productId).lean(),
      ProductFile.find({ product_id: req.params.productId }).sort({ createdAt: -1 }).lean(),
      ProductFile.findById(req.params.fileId).lean(),
    ]);

    if (!product || !editingFile) {
      return res.redirect(`/admin/products/${req.params.productId}/files`);
    }

    res.render('admin/productFiles', {
      title: 'Edit Product File',
      product,
      files,
      editingFile,
      fileForm: editingFile,
      message: req.query.message || null,
      messageType: req.query.messageType || 'success',
      formatCurrency,
    });
  } catch (err) {
    logError('Admin product file edit load error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load this file for editing.',
    });
  }
});

router.post('/products/:productId/files/:fileId/edit', adminAuth, async (req, res) => {
  try {
    const file = await ProductFile.findById(req.params.fileId);
    if (!file) {
      return res.redirect(`/admin/products/${req.params.productId}/files`);
    }

    Object.assign(file, parseFilePayload(req.body));
    await file.save();
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/files`, 'Pattern file updated successfully.'));
  } catch (err) {
    logError('Admin product file update error:', err);
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/files`, 'Could not update pattern file.', 'error'));
  }
});

router.post('/products/:productId/files/:fileId/toggle', adminAuth, async (req, res) => {
  try {
    const file = await ProductFile.findById(req.params.fileId);
    if (!file) {
      return res.redirect(`/admin/products/${req.params.productId}/files`);
    }

    file.active = !file.active;
    await file.save();
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/files`, `Pattern file ${file.active ? 'activated' : 'deactivated'} successfully.`));
  } catch (err) {
    logError('Admin product file toggle error:', err);
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/files`, 'Could not update file status.', 'error'));
  }
});

router.get('/products/:productId/addons', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).lean();
    if (!product) {
      return res.redirect('/admin/products');
    }

    const addons = await Addon.find({ product_id: req.params.productId }).sort({ createdAt: -1 }).lean();
    res.render('admin/productAddons', {
      title: 'Manage Product Add-ons',
      product,
      addons,
      editingAddon: null,
      addonForm: { active: true },
      message: req.query.message || null,
      messageType: req.query.messageType || 'success',
      formatCurrency,
    });
  } catch (err) {
    logError('Admin product addons load error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load product add-ons.',
    });
  }
});

router.post('/products/:productId/addons', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.redirect('/admin/products');
    }

    const addonForm = parseAddonPayload(req.body);
    await Addon.create({
      product_id: product._id,
      ...addonForm,
    });

    res.redirect(buildRedirectUrl(`/admin/products/${product._id}/addons`, 'Add-on added successfully.'));
  } catch (err) {
    logError('Admin product add-on create error:', err);
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/addons`, 'Could not add add-on.', 'error'));
  }
});

router.get('/products/:productId/addons/:addonId/edit', adminAuth, async (req, res) => {
  try {
    const [product, addons, editingAddon] = await Promise.all([
      Product.findById(req.params.productId).lean(),
      Addon.find({ product_id: req.params.productId }).sort({ createdAt: -1 }).lean(),
      Addon.findById(req.params.addonId).lean(),
    ]);

    if (!product || !editingAddon) {
      return res.redirect(`/admin/products/${req.params.productId}/addons`);
    }

    res.render('admin/productAddons', {
      title: 'Edit Product Add-on',
      product,
      addons,
      editingAddon,
      addonForm: editingAddon,
      message: req.query.message || null,
      messageType: req.query.messageType || 'success',
      formatCurrency,
    });
  } catch (err) {
    logError('Admin product add-on edit load error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load this add-on for editing.',
    });
  }
});

router.post('/products/:productId/addons/:addonId/edit', adminAuth, async (req, res) => {
  try {
    const addon = await Addon.findById(req.params.addonId);
    if (!addon) {
      return res.redirect(`/admin/products/${req.params.productId}/addons`);
    }

    Object.assign(addon, parseAddonPayload(req.body));
    await addon.save();
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/addons`, 'Add-on updated successfully.'));
  } catch (err) {
    logError('Admin product add-on update error:', err);
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/addons`, 'Could not update add-on.', 'error'));
  }
});

router.post('/products/:productId/addons/:addonId/toggle', adminAuth, async (req, res) => {
  try {
    const addon = await Addon.findById(req.params.addonId);
    if (!addon) {
      return res.redirect(`/admin/products/${req.params.productId}/addons`);
    }

    addon.active = !addon.active;
    await addon.save();
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/addons`, `Add-on ${addon.active ? 'activated' : 'deactivated'} successfully.`));
  } catch (err) {
    logError('Admin product add-on toggle error:', err);
    res.redirect(buildRedirectUrl(`/admin/products/${req.params.productId}/addons`, 'Could not update add-on status.', 'error'));
  }
});

router.get('/orders', adminAuth, async (req, res) => {
  try {
    const ordersRaw = await Order.find().sort({ createdAt: -1 }).lean();

    const orders = await Promise.all(ordersRaw.map(async (o) => {
      const customer = await Customer.findById(o.customer_id).lean().catch(() => null);
      const payment = await Payment.findOne({ order_id: o._id }).lean().catch(() => null);
      return {
        id: o._id.toString(),
        customer_name: o.customer_snapshot?.name || customer?.name || 'Unknown',
        customer_email: o.customer_snapshot?.email || customer?.email || '',
        customer_phone: o.customer_snapshot?.phone || customer?.phone || '',
        customer_address: [o.shipping_address,o.shipping_city,o.shipping_state,o.delivery_pincode].filter(Boolean).join(', '),
        courier_name: o.courier_name || '',dispatch_location:o.dispatch_location || '',
        order_status: o.order_status,
        payment_status: o.payment_status || (payment && payment.payment_status) || 'unpaid',
        grand_total: o.grand_total || 0,
        createdAt: o.createdAt,
      };
    }));

    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const paymentStatus = String(req.query.payment || '').trim().toLowerCase();
    const filteredOrders = orders.filter((order) => {
      const matchesSearch = !search || [order.id, order.customer_name, order.customer_email].some(value => String(value || '').toLowerCase().includes(search));
      return matchesSearch && (!status || String(order.order_status).toLowerCase() === status) && (!paymentStatus || String(order.payment_status).toLowerCase() === paymentStatus);
    });

    res.render('admin/orders', {
      title: 'Manage Orders',
      orders: filteredOrders,
      filters: { search: req.query.search || '', status: req.query.status || '', payment: req.query.payment || '' },
      formatCurrency,
    });
  } catch (err) {
    logError('Admin orders list error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load orders right now.',
    });
  }
});

router.post('/products/:id/delete', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.redirect('/admin/products');
    if (product.active) return res.redirect(buildRedirectUrl('/admin/products', 'Deactivate the product before deleting it.', 'error'));
    const usedByOrder = await Order.exists({ 'items.product_id': product._id });
    if (usedByOrder) return res.redirect(buildRedirectUrl('/admin/products', 'This product is referenced by an order and cannot be deleted.', 'error'));
    await Promise.all([ProductFile.deleteMany({ product_id: product._id }), Addon.deleteMany({ product_id: product._id }), product.deleteOne()]);
    return res.redirect(buildRedirectUrl('/admin/products', 'Inactive product deleted safely.'));
  } catch (err) {
    logError('Admin product delete error:', err);
    return res.redirect(buildRedirectUrl('/admin/products', 'Could not delete product.', 'error'));
  }
});

router.get('/orders-export.csv', adminAuth, async (req, res) => {
  try {
    const orders = await Order.find().populate('customer_id').sort({ createdAt: -1 }).lean();
    const { csvCell } = require('../services/businessValidation');
    const rows = [['Order ID','Customer','Email','Phone','Pincode','Subtotal','Historical Delivery','GST','Grand Total','Payment Status','Order Status','Razorpay Reference','Date']];
    orders.forEach(order => rows.push([order._id,order.customer_id?.name,order.customer_id?.email,order.customer_id?.phone,order.delivery_pincode,order.subtotal,order.delivery_flow_version===2?undefined:order.delivery_charge,order.tax_amount,order.grand_total,order.payment_status,order.order_status,order.payment_reference,order.createdAt]));
    res.type('text/csv').attachment('orders.csv').send(rows.map(row => row.map(csvCell).join(',')).join('\n'));
  } catch (error) { logError('Order CSV export error:', error); res.status(500).send('Unable to export orders.'); }
});

// Order detail
router.get('/orders/:id', adminAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer_id')
      .populate('items.product_id')
      .lean();

    if (!order) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Order not found.' });
    }

    const payment = await Payment.findOne({ order_id: order._id }).lean().catch(() => null);
    require('../middleware/learningForms').fresh(req,res);

    res.render('admin/order_detail', {
      title: `Order ${order._id}`,
      order,
      customer: order.customer_id || null,
      payment,
      couriers:await require('../models/mongo/Courier').find().sort({priority:1,name:1}).lean(),
      formatCurrency,
    });
  } catch (err) {
    logError('Admin order detail error:', err);
    res.status(500).render('error', { title: 'Admin Error', message: 'Unable to load order.' });
  }
});

// Update order status
router.post('/orders/:id/status', adminAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).redirect('/admin/orders');

    const { status } = req.body;
    if(status==='shipped')return res.redirect(303,`/admin/orders/${order._id}#fulfilment`);
    if (['pending','confirmed','processing','completed','shipped','delivered','cancelled'].includes(status) && order.order_status!==status) {
      order.notification_jobs ||= [];
      order.notification_jobs.push(require('../services/notificationService').statusJob(status));
      order.order_status = status;
      await order.save();
      await require('../services/notificationService').safeFlush('product_order',order._id);
    }

    res.redirect(`/admin/orders/${order._id}`);
  } catch (err) {
    logError('Admin order status update error:', err);
    res.status(500).render('error', { title: 'Admin Error', message: 'Unable to update order status.' });
  }
});

router.get('/payments', adminAuth, async (req, res) => {
  try {
    const paymentFilter = String(req.query.status || '').trim().toLowerCase();
    const paymentsRaw = await Payment.find(paymentFilter ? { payment_status: paymentFilter } : {}).sort({ createdAt: -1 }).lean();

    const payments = await Promise.all(paymentsRaw.map(async (p) => {
      const order = await Order.findById(p.order_id).lean().catch(() => null);
      const customer = order ? await Customer.findById(order.customer_id).lean().catch(() => null) : null;
      return {
        id: p._id.toString(),
        order_id: p.order_id ? String(p.order_id) : null,
        customer_name: customer ? customer.name : (order ? 'Unknown' : ''),
        customer_email: customer ? customer.email : '',
        payment_provider: p.payment_provider,
        payment_status: p.payment_status,
        amount: p.amount,
        currency: p.currency || 'INR',
        createdAt: p.createdAt,
      };
    }));

    res.render('admin/payments', {
      title: 'Manage Payments',
      payments,
      formatCurrency,
      selectedStatus: paymentFilter,
    });
  } catch (err) {
    logError('Admin payments list error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load payments right now.',
    });
  }
});

// Payment detail
router.get('/payments/:id', adminAuth, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id).lean();
    if (!payment) return res.status(404).render('error', { title: 'Not Found', message: 'Payment not found.' });

    const order = payment.order_id ? await Order.findById(payment.order_id).lean().catch(() => null) : null;
    const customer = order ? await Customer.findById(order.customer_id).lean().catch(() => null) : null;

    res.render('admin/payment_detail', {
      title: `Payment ${payment._id}`,
      payment,
      order,
      customer,
      formatCurrency,
    });
  } catch (err) {
    logError('Admin payment detail error:', err);
    res.status(500).render('error', { title: 'Admin Error', message: 'Unable to load payment.' });
  }
});

// Customers list
router.get('/customers', adminAuth, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const customerQuery = search ? { $or: [{ name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { phone: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] } : {};
    const customersRaw = await Customer.find(customerQuery).sort({ createdAt: -1 }).lean();

    const customers = await Promise.all(customersRaw.map(async (c) => {
      const orders = await Order.find({ customer_id: c._id }).lean().catch(() => []);
      const orderCount = orders.length;
      const totalPurchase = orders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
      return {
        id: c._id.toString(),
        name: c.name,
        email: c.email,
        phone: c.phone || '',
        createdAt: c.createdAt,
        orderCount,
        totalPurchase,
        address: c.address || '', city: c.city || '', state: c.state || '', postal_code: c.postal_code || '',
        lastOrderDate: orders.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt))[0]?.createdAt || null,
      };
    }));

    res.render('admin/customers', {
      title: 'Manage Customers',
      customers,
      formatCurrency,
      search,
    });
  } catch (err) {
    logError('Admin customers list error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Unable to load customers right now.',
    });
  }
});

// Customer detail
router.get('/customers/:id', adminAuth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).lean();
    if (!customer) return res.status(404).render('error', { title: 'Not Found', message: 'Customer not found.' });

    const ordersRaw = await Order.find({ customer_id: customer._id }).sort({ createdAt: -1 }).lean();
    const orders = await Promise.all(ordersRaw.map(async (o) => {
      const payment = await Payment.findOne({ order_id: o._id }).lean().catch(() => null);
      return {
        id: o._id.toString(),
        createdAt: o.createdAt,
        grand_total: o.grand_total || 0,
        order_status: o.order_status,
        payment_status: o.payment_status || (payment && payment.payment_status) || 'unpaid',
      };
    }));

    const totalOrders = orders.length;
    const totalPurchase = orders.reduce((sum, o) => sum + (o.grand_total || 0), 0);

    res.render('admin/customer_detail', {
      title: `Customer ${customer.name}`,
      customer,
      orders,
      totalOrders,
      totalPurchase,
      formatCurrency,
    });
  } catch (err) {
    logError('Admin customer detail error:', err);
    res.status(500).render('error', { title: 'Admin Error', message: 'Unable to load customer.' });
  }
});

module.exports = router;
