const path = require('path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { collectMediaUpdate } = require('../services/productMediaIntegration');
const { logError } = require('../services/safeLog');
const express = require('express');
const multer = require('multer');
const notificationService = require('../services/notificationService');
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


const adminUsername = process.env.ADMIN_USERNAME?.trim();
const adminPassword = process.env.ADMIN_PASSWORD?.trim();


// AEP_MULTIPART_FINAL
const {
  uploadProductMedia,
  validateProductMedia,
  deleteUploadedFiles,
  publishProductMedia
} = require('../middleware/productMediaUpload');

router.use((req, res, next) => {
  if (req.method === 'GET' && /^\/products\/(?:new|[a-f\d]{24}\/edit)$/i.test(req.path) && req.session?.isAdmin) {
    req.session.productMediaCsrf ||= require('node:crypto').randomBytes(32).toString('hex');
  }
  res.locals.productMediaCsrf = req.session?.productMediaCsrf || '';
  next();
});

router.use((req, res, next) => {
  if (req.method !== 'POST' || req.path === '/login') {
    return next();
  }

  adminAuth(req, res, () => {
    const productEdit =
      (/^\/products\/[a-f\d]{24}\/edit$/i.test(req.path) || req.path === '/products');

    if (productEdit && !req.is('multipart/form-data') &&
        (!req.session.productMediaCsrf || req.body?._csrf !== req.session.productMediaCsrf)) {
      return res.status(403).send('Reload the product editor and try again.');
    }

    if (!productEdit || !req.is('multipart/form-data')) {
      return require('../middleware/adminInputValidation')(
        req, res, next
      );
    }

    res.once('finish', () => {
      if (!req.aepMediaCommitted) {
        deleteUploadedFiles(req).catch(() => {});
      }
    });

    uploadProductMedia(req, res, error => {
      if (error) return res.status(400).send('Upload failed. Use JPG, PNG or WebP photos, MP4/WebM video, or a PDF size chart. Reload the editor to try again.');

      if (!req.session.productMediaCsrf || typeof req.body._csrf !== 'string' ||
          req.body._csrf !== req.session.productMediaCsrf) {
        return deleteUploadedFiles(req).then(() => res.status(403).send('Reload the product editor and try again.'), next);
      }

      validateProductMedia(req, res, error => {
        if (error) return res.status(400).send('Invalid media content or size. Existing photos were preserved. Reload the editor to try again.');

        require('../middleware/adminInputValidation')(
          req, res, next
        );
      });
    });
  });
});


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
  const department = String(body?.department || '').trim();
  const kids_subcategory = String(body?.kids_subcategory || '').trim();
  const product_type = String(body?.product_type || '').trim();
  const style = String(body?.style || '').trim();
  const fit = String(body?.fit || '').trim();
  let category = String(body?.category || '').trim();
  if (!category) {
    if (department && product_type) {
      category = department + "'s Pattern";
    } else if (department) {
      category = department + "'s Collection";
    } else if (product_type) {
      category = product_type.toLowerCase();
    }
  }

  return {
    name,
    category,
    department,
    kids_subcategory,
    product_type,
    style,
    fit,
    name,
    ...require('../services/productMetadata').parse(body),
    ...require('../services/patternOptions').parse(body),
    slug: String(body?.slug || '').trim() || buildSlug(name),
    description: String(body?.description || '').trim(),
    base_price: Number(body?.base_price || 0),
    additional_size_price: Number(body?.additional_size_price || 0),
    physical_price: Number(body?.physical_price || 0),
    trial_price: Number(body?.trial_price || 0),
    format_pricing: {
      dxf: Number(body?.format_dxf_price !== undefined && body?.format_dxf_price !== '' ? body.format_dxf_price : (Number(body?.base_price) || 399)),
      hpgl: Number(body?.format_hpgl_price !== undefined && body?.format_hpgl_price !== '' ? body.format_hpgl_price : (Number(body?.base_price) || 399)),
      plt: Number(body?.format_plt_price !== undefined && body?.format_plt_price !== '' ? body.format_plt_price : (Number(body?.base_price) || 399)),
      pdf: Number(body?.format_pdf_price !== undefined && body?.format_pdf_price !== '' ? body.format_pdf_price : (Number(body?.base_price) || 399)),
      bundle_price: Number(body?.format_bundle_price !== undefined && body?.format_bundle_price !== '' ? body.format_bundle_price : (Number(body?.base_price) || 399)),
      active_bundle: body?.active_bundle !== 'off' && body?.active_bundle !== false
    },
    tech_pack_price: Number(body?.tech_pack_price || 0),
    marker_service_price: Number(body?.marker_service_price || 0),
    size_chart_image: String(body?.size_chart_image || '').trim(),
    size_chart_url: String(body?.size_chart_url || '').trim(),
    size_chart_visible: body?.pattern_configuration === '1'
      ? body.size_chart_visible === 'on' || body.size_chart_visible === true || body.size_chart_visible === '1'
      : body?.size_chart_visible === undefined
        ? true
        : body.size_chart_visible === 'on' || body.size_chart_visible === true || body.size_chart_visible === '1',
    images: body?.main_image_url !== undefined || body?.gallery_image_urls !== undefined
      ? [...(String(body?.main_image_url || '').trim() ? [String(body.main_image_url).trim()] : []), ...parseStringArray(body?.gallery_image_urls)]
      : parseStringArray(body?.images),
    active: body?.active === 'on' || body?.active === true || body?.active === '1',
  };
}

function parseFilePayload(body) {
  const price = body?.file_price;
  return {
    ...(body.purpose!==undefined?{purpose:body.purpose,watermark_pdf:body.watermark_pdf==='on' && ['specs','tech_pack'].includes(body.purpose)}:{}),
    file_name: String(body?.file_name || '').trim(),
    file_type: String(body?.file_type || '').trim(),
    ...(price !== undefined && String(price).trim() !== '' ? { file_price: Number(price) } : {}),
    price_per_selected_size: body?.price_per_selected_size === 'on' || body?.price_per_selected_size === true || body?.price_per_selected_size === '1',
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

async function hasConfiguredPaidOption(product) {
  const options = product.pattern_options || {};
  if (options.printable !== false && Number(product.base_price) > 0) return true;
  if (options.physical !== false && Number(product.physical_price) > 0) return true;
  if (options.physical !== false && product.size_prices?.some(row => Number(row.price) > 0)) return true;
  if (options.trial !== false && Number(product.trial_price) > 0) return true;
  return Boolean(await ProductFile.exists({
    product_id: product._id,
    active: true,
    file_price: { $gt: 0 },
  }));
}

function productSetup(product, files = []) {
  const missing = [];
  const basicComplete = Boolean(
    product.name?.trim()
    && product.category?.trim()
    && product.description?.trim()
    && !product.description.includes('Admin review required.')
  );
  const imageComplete = Array.isArray(product.images) && product.images.length > 0;
  const filesNeedingReview = files.filter(file =>
    file.purpose === 'other' && (product.import_source_key || file.import_source_key));
  const filesWithoutUpload = files.filter(file => file.purpose !== 'other' && !file.hasPrivateFile);
  const sizesComplete = Array.isArray(product.available_sizes) && product.available_sizes.length > 0;
  const options = product.pattern_options || {};
  const mappedFileSizes = new Set(product.mappedFileSizes || (product.digital_file_map || []).map(file => file.size));
  const missingMappedSizes = sizesComplete && options.printable !== false
    ? product.available_sizes.filter(size => !mappedFileSizes.has(size))
    : [];
  const hasPrivateMappedFiles = mappedFileSizes.size > 0;
  const filesComplete = (product.hasPrivateBaseFile || hasPrivateMappedFiles || files.length > 0)
    && filesNeedingReview.length === 0
    && filesWithoutUpload.length === 0
    && missingMappedSizes.length === 0;
  const pricingComplete = Boolean(
    (options.printable !== false && Number(product.base_price) > 0)
    || (options.physical !== false && Number(product.physical_price) > 0)
    || (options.physical !== false && product.size_prices?.some(row => Number(row.price) > 0))
    || (options.trial !== false && Number(product.trial_price) > 0)
    || files.some(file => file.active && file.purpose !== 'other' && Number(file.file_price) > 0)
  );

  if (!basicComplete) missing.push('Product name, category, or customer description needs review.');
  if (!imageComplete) missing.push('Main product image not added.');
  for (const file of filesNeedingReview) {
    missing.push(`"${file.file_name}" purpose not confirmed.`);
  }
  for (const file of filesWithoutUpload) {
    missing.push(`Private download missing for "${file.file_name}".`);
  }
  if (!filesComplete) missing.push('Product files have not been added or reviewed.');
  if (missingMappedSizes.length) missing.push('Upload a private pattern file for every available size.');
  if (!pricingComplete) missing.push('Customer price not set for an available option.');
  if (!sizesComplete) missing.push('Available sizes not set.');

  const ready = missing.length === 0;
  return {
    missing,
    steps: [
      { label: 'Basic Information', complete: basicComplete },
      { label: 'Images', complete: imageComplete },
      { label: 'Files', complete: filesComplete },
      { label: 'Pricing', complete: pricingComplete },
      { label: 'Sizes', complete: sizesComplete },
      { label: 'Final Review', complete: ready },
    ],
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
    // Admin must include drafts and inactive records; publicFilter is storefront-only.
    const products = await Product.find({}).select('+digital_file_map').sort({ createdAt: -1 }).lean();
    const [productFiles, productsWithBaseFiles] = products.length
      ? await Promise.all([
        ProductFile.find({ product_id: { $in: products.map(product => product._id) } }).lean(),
        Product.find({ _id: { $in: products.map(product => product._id) }, digital_file: { $exists: true, $ne: null } }).select('_id').lean(),
      ])
      : [[], []];
    const productsWithPrivateBase = new Set(productsWithBaseFiles.map(product => String(product._id)));
    const filesWithPrivateUploads = productFiles.length
      ? await ProductFile.find({
        _id: { $in: productFiles.map(file => file._id) },
        digital_file: { $exists: true, $ne: null },
      }).select('_id').lean()
      : [];
    const filesWithPrivateUploadsSet = new Set(filesWithPrivateUploads.map(file => String(file._id)));
    for (const product of products) {
      product.hasPrivateBaseFile = productsWithPrivateBase.has(String(product._id));
      product.mappedFileSizes=(product.digital_file_map || []).map(file=>file.size);
    }
    for (const file of productFiles) {
      file.hasPrivateFile = filesWithPrivateUploadsSet.has(String(file._id));
    }
    const filesByProduct = new Map();
    for (const file of productFiles) {
      const key = String(file.product_id);
      filesByProduct.set(key, [...(filesByProduct.get(key) || []), file]);
    }
    const setupByProduct = new Map(products.map(product => [
      String(product._id),
      productSetup(product, filesByProduct.get(String(product._id)) || []),
    ]));
    const reviewCount = productFiles.filter(file =>
      file.purpose === 'other' && (file.import_source_key
        || products.find(product => String(product._id) === String(file.product_id))?.import_source_key)).length;
    const filteredProducts = req.query.review === '1'
      ? products.filter(product => (filesByProduct.get(String(product._id)) || []).some(file =>
        file.purpose === 'other' && (product.import_source_key || file.import_source_key)))
      : products;

    res.render('admin/product-list', {
      title: 'Products / Patterns',
      products: filteredProducts,
      totalProducts: products.length,
      activeProducts: products.filter(product => product.active === true
        && (!product.status || product.status === 'active')).length,
      draftProducts: products.filter(product => product.status === 'draft').length,
      inactiveProducts: products.filter(product => product.active !== true && product.status !== 'draft').length,
      setupRequired: [...setupByProduct.values()].filter(setup => !setup.steps.at(-1).complete).length,
      reviewCount,
      reviewFilter: req.query.review === '1',
      filesByProduct,
      setupByProduct,
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
    res.render('admin/product-editor', {
      title: 'Add Product',
      editingProduct: null,
      productFiles: [],
      productSetup: productSetup({ name: '', category: '', description: '', images: [], available_sizes: [], pattern_options: {} }),
      productForm: {
        status: 'draft',
        active: false,
        base_price: '',
        additional_size_price: '',
        physical_price: '',
        trial_price: '',
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
    Object.assign(productForm, collectMediaUpdate({}, req.body, req.files));
    await publishProductMedia(req);
    await Product.create(productForm);
    req.aepMediaCommitted = true;
    res.redirect(buildRedirectUrl('/admin/products', 'Product created successfully.'));
  } catch (err) {
    logError('Admin product create error:', err);
    productForm.images = [];
    productForm.sample_image_url = '';
    productForm.video_url = '';
    res.status(400).render('admin/product-editor', {
      title: 'Add Product',
      editingProduct: null,
      productFiles: [],
      productSetup: productSetup({ ...productForm, pattern_options: productForm.pattern_options || {} }),
      productForm,
      message: 'Could not create product. Please verify the slug and required fields.',
      messageType: 'error',
      formatCurrency,
    });
  }
});

router.get('/products/:id/edit', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).select('+digital_file +digital_file_map').lean();

    if (!product) {
      return res.redirect('/admin/products');
    }
    const productFiles = await ProductFile.find({ product_id: product._id }).sort({ createdAt: -1 }).select('+digital_file').lean();
    product.mappedFiles=(product.digital_file_map || []).map(({format,size,file,original_name})=>({format,size,fileType:path.extname(file).slice(1),fileName:original_name || ''}));
    product.mappedFileSizes=product.mappedFiles.map(file=>file.size);
    delete product.digital_file_map;
    product.hasPrivateBaseFile = Boolean(product.digital_file);
    delete product.digital_file;
    for (const file of productFiles) {
      file.hasPrivateFile = Boolean(file.digital_file);
      delete file.digital_file;
    }

    res.render('admin/product-editor', {
      title: 'Edit Product',
      productFiles,
      productSetup: productSetup(product, productFiles),
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
    const product = await Product.findById(req.params.id).select('+digital_file +digital_file_map');
    if (!product) {
      return res.redirect('/admin/products');
    }

    // AEP_PRESERVE_EMPTY_PRICES
    // Blank Admin prices must not convert existing null values to zero.
    for (const field of [
      'base_price',
      'additional_size_price',
      'physical_price',
      'trial_price'
    ]) {
      if (req.body[field] === undefined ||
          String(req.body[field]).trim() === '') {
        productForm[field] = product[field];
      }
    }

    const adminAction = String(req.body.admin_action || '');
    if (adminAction === 'save') {
      productForm.active = product.active;
      productForm.status = product.status;
    } else if (adminAction === 'activate') {
      productForm.active = true;
      productForm.status = 'active';
    } else if (adminAction === 'deactivate') {
      productForm.active = false;
      productForm.status = product.status;
    }

    if (product.import_source_key && productForm.active && productForm.status === 'active') {
      const candidate = { ...product.toObject(), ...productForm };
      if (!await hasConfiguredPaidOption(candidate)) {
        const productFiles = await ProductFile.find({ product_id: product._id }).select('+digital_file').lean();
        for (const file of productFiles) {
          file.hasPrivateFile = Boolean(file.digital_file);
          delete file.digital_file;
        }
        const missing = productSetup({ ...candidate, hasPrivateBaseFile: Boolean(candidate.digital_file) }, productFiles).missing;
        missing.push('A positive price is required for at least one enabled product option.');
        return res.redirect(buildRedirectUrl(
          `/admin/products/${product._id}/edit`,
          `Activation blocked. Complete: ${[...new Set(missing)].join(' ')}`,
          'error'
        ));
      }
    }
Object.assign(product, productForm, collectMediaUpdate(product, req.body, req.files));
    await publishProductMedia(req);
    await product.save();
    req.aepMediaCommitted = true;
    res.redirect(buildRedirectUrl(
      `/admin/products/${product._id}/edit`,
      adminAction === 'save' ? 'Changes saved. Product publication status was unchanged.'
        : adminAction === 'activate' ? 'Product activated successfully.'
          : adminAction === 'deactivate' ? 'Product saved as inactive.'
            : 'Product updated successfully.'
    ));
  } catch (err) {
    logError('Admin product update error:', err);
    const [product, productFiles] = await Promise.all([
      Product.findById(req.params.id).select('+digital_file +digital_file_map').lean(),
      ProductFile.find({ product_id: req.params.id }).sort({ createdAt: -1 }).select('+digital_file').lean(),
    ]);
    if (product) {
      product.hasPrivateBaseFile = Boolean(product.digital_file);
      product.mappedFileSizes=(product.digital_file_map || []).map(file=>file.size);
      delete product.digital_file;
      delete product.digital_file_map;
    }
    for (const file of productFiles) {
      file.hasPrivateFile = Boolean(file.digital_file);
      delete file.digital_file;
    }
    res.status(400).render('admin/product-editor', {
      title: 'Edit Product',
      editingProduct: product,
      productFiles,
      productSetup: productSetup(product || productForm, productFiles),
      productForm: { ...product, ...productForm, images: product?.images || [], sample_image_url: product?.sample_image_url || '', video_url: product?.video_url || '' },
      message: 'Could not update product.',
      messageType: 'error',
      formatCurrency,
    });
  }
});

router.post('/products/:id/toggle', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).select('+digital_file');
    if (!product) {
      return res.redirect('/admin/products');
    }

    if (!product.active && product.import_source_key
      && (product.status !== 'active' || !await hasConfiguredPaidOption(product))) {
      const files = await ProductFile.find({ product_id: product._id }).select('+digital_file').lean();
      for (const file of files) {
        file.hasPrivateFile = Boolean(file.digital_file);
        delete file.digital_file;
      }
      const productData = product.toObject();
      productData.hasPrivateBaseFile = Boolean(productData.digital_file);
      productData.mappedFileSizes=(product.digital_file_map || []).map(file=>file.size);
      delete productData.digital_file;
      delete productData.digital_file_map;
      const missing = productSetup(productData, files).missing;
      if (product.status !== 'active' || !await hasConfiguredPaidOption(product)) {
        missing.push('A positive price is required for at least one enabled product option.');
      }
      return res.redirect(buildRedirectUrl(
        `/admin/products/${product._id}/edit`,
        `Activation blocked. Complete: ${[...new Set(missing)].join(' ')}`,
        'error'
      ));
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
      fileForm: { active: !product.import_source_key },
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
    if (product.import_source_key && fileForm.active && !(fileForm.file_price > 0)) {
      return res.redirect(buildRedirectUrl(`/admin/products/${product._id}/files`, 'Set a positive file price before activating this imported file.', 'error'));
    }

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

// Direct pattern file upload endpoint (DXF, HPGL, PLT, PDF, Tech Pack, Markers)
const directPatternUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 5, parts: 6 },
  defParamCharset: 'utf8'
});

router.post('/products/:productId/direct-file', adminAuth, (req,res,next)=>directPatternUpload.single('file')(req,res,error=>{
  if(!error)return next();
  logError('Direct upload multipart rejected:',error);
  return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({error:error.code==='LIMIT_FILE_SIZE'?'File exceeds the 50 MB upload limit.':'Invalid upload. Select one file and try again.'});
}), async (req, res) => {
  let pendingPath;
  try {
    if(!req.session.productMediaCsrf || req.body._csrf!==req.session.productMediaCsrf)return res.status(403).json({error:'Reload the product editor and try again.'});
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if(req.body.purpose==='pattern'){
      return res.json(await require('../services/digitalDeliveryService').uploadSizeFile(product._id,req.body.format,req.body.size,req.file.originalname,req.file.buffer,req.file.mimetype));
    }
    const originalName = req.file.originalname || 'pattern-file';
    const rawFormat = String(req.body.format || '').toLowerCase();
    const uploadValidation=require('../services/digitalUploadValidation');
    // Companion slot: a secondary attachment (PDF or ZIP) alongside a primary CAD/document slot.
    if(uploadValidation.COMPANION_SLOTS.has(rawFormat)){
      const extResult=uploadValidation.validateCompanion(originalName,req.file.buffer,rawFormat,req.file.mimetype);
      const ext=extResult instanceof Promise ? await extResult : extResult;
      const delivery=require('../services/digitalDeliveryService');
      await fs.promises.mkdir(delivery.root(),{recursive:true});
      const privateRoot=await delivery.privateRoot();
      const safeStorageName=crypto.randomBytes(24).toString('hex')+ext;
      const destPath=path.join(privateRoot,safeStorageName);
      await fs.promises.writeFile(destPath,req.file.buffer,{flag:'wx',mode:0o600});
      pendingPath=destPath;
      const file_type=ext.slice(1);
      // Companion purpose: companion files are attached to orders as selected_files so delivery works via ProductFile
      const purpose='specs';
      const existingDoc=await ProductFile.findOne({product_id:product._id,upload_slot:rawFormat});
      let doc;
      if(existingDoc){
        existingDoc.file_name=originalName;existingDoc.file_type=file_type;
        existingDoc.purpose=purpose;existingDoc.digital_file=safeStorageName;existingDoc.active=true;
        await existingDoc.save();doc=existingDoc;
      }else{
        doc=await ProductFile.create({product_id:product._id,file_name:originalName,file_type,purpose,upload_slot:rawFormat,digital_file:safeStorageName,file_price:0,active:true});
      }
      pendingPath=null;
      const slotLabel=rawFormat.replace('_',' ').toUpperCase();
      const badgeClass=file_type==='pdf'?'file-badge--pdf':file_type==='csv'?'file-badge--pdf':'file-badge--zip';
      return res.json({success:true,fileId:doc._id.toString(),fileName:doc.file_name,fileType:doc.file_type,purpose:doc.purpose,badgeText:slotLabel+' / '+file_type.toUpperCase(),badgeClass,isReplacement:Boolean(existingDoc)});
    }
    const purposes={techpack:'tech_pack',measurement:'specs',marker:'specs'};
    if(!Object.hasOwn(purposes,rawFormat))return res.status(400).json({error:'Choose a supported document slot.'});
    const ext=rawFormat==='measurement'
      ? await uploadValidation.validateMeasurement(originalName,req.file.buffer,req.file.mimetype)
      : uploadValidation.validate(originalName,req.file.buffer,rawFormat,req.file.mimetype);

    // Save to private storage (never public!)
    const delivery = require('../services/digitalDeliveryService');
    await fs.promises.mkdir(delivery.root(), { recursive: true });
    const privateRoot = await delivery.privateRoot();
    const safeStorageName = crypto.randomBytes(24).toString('hex') + ext;
    const destPath = path.join(privateRoot, safeStorageName);
    await fs.promises.writeFile(destPath, req.file.buffer, { flag: 'wx', mode: 0o600 });
    pendingPath=destPath;

    const file_type=ext.slice(1);
    const purpose=purposes[rawFormat];
    // Slot-scoped replacement cannot overwrite another document with the same filename.
    const existingFile=await ProductFile.findOne({product_id:product._id,upload_slot:rawFormat});

    let doc;
    if (existingFile) {
      existingFile.file_name = originalName;
      existingFile.file_type = file_type;
      existingFile.purpose = purpose;
      existingFile.digital_file = safeStorageName;
      existingFile.active = true;
      await existingFile.save();
      doc = existingFile;
    } else {
      doc = await ProductFile.create({
        product_id: product._id,
        file_name: originalName,
        file_type,
        purpose,
        upload_slot: rawFormat,
        digital_file: safeStorageName,
        file_price: purpose === 'tech_pack' ? Number(product.tech_pack_price || 0) : 0,
        active: true
      });
    }

    pendingPath=null; // Persisted; retain previous binaries for issued download grants.
    const badgeText=({techpack:'TECH PACK',measurement:'MEASUREMENT CHART',marker:'MARKER'})[rawFormat]+' / '+file_type.toUpperCase();

    const badgeClass = file_type === 'pdf' ? 'file-badge--pdf'
      : file_type === 'dxf' ? 'file-badge--dxf'
      : (file_type === 'hpgl' || file_type === 'plt') ? 'file-badge--hpgl'
      : 'file-badge--zip';

    return res.json({
      success: true,
      fileId: doc._id.toString(),
      fileName: doc.file_name,
      fileType: doc.file_type,
      purpose: doc.purpose,
      badgeText,
      badgeClass,
      isReplacement: Boolean(existingFile)
    });
  } catch (err) {
    if(pendingPath)await fs.promises.unlink(pendingPath).catch(error=>logError('Direct upload cleanup failed:',error));
    logError('Direct file upload failed:',err);
    const storage=['EACCES','EPERM','ENOENT','ENOSPC','EROFS'].includes(err.code);
    return res.status(err.status || (storage?503:500)).json({error:err.status?err.message:storage?'Private storage is unavailable. Ask the server administrator to check the storage directory, permissions and free space.':'Could not save the uploaded file. Check server logs and try again.'});
  }
});

router.post('/products/:productId/direct-file/:fileId/delete', adminAuth, async (req, res) => {
  try {
    await ProductFile.deleteOne({ _id: req.params.fileId, product_id: req.params.productId });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Delete failed' });
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
    const file = await ProductFile.findOne({ _id: req.params.fileId, product_id: req.params.productId });
    if (!file) {
      return res.redirect(`/admin/products/${req.params.productId}/files`);
    }

    const fileForm = parseFilePayload(req.body);
    const product = await Product.findById(req.params.productId);
    const effectivePrice = Object.hasOwn(fileForm, 'file_price') ? fileForm.file_price : file.file_price;
    if (product?.import_source_key && fileForm.active && !(effectivePrice > 0)) {
      return res.redirect(buildRedirectUrl(`/admin/products/${product._id}/files`, 'Set a positive file price before activating this imported file.', 'error'));
    }

    await ProductFile.updateOne(
      { _id: file._id, product_id: req.params.productId },
      { $set: fileForm },
      { runValidators: true }
    );
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

    const product = await Product.findById(req.params.productId);
    if (product?.import_source_key && !file.active && !(file.file_price > 0)) {
      return res.redirect(buildRedirectUrl(`/admin/products/${product._id}/files`, 'Set a positive file price before activating this imported file.', 'error'));
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
        has_physical:o.items?.some(item=>Number(item.physical_quantity || 0)>0 || Number(item.trial_quantity || 0)>0),
        delivery_flow_version:o.delivery_flow_version,
        shipping_payment_status:o.shipping_payment_status || 'not_applicable',
        courier_booking_status:o.courier_booking_status || 'not_required',
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
    const rows = [['Order ID','Customer','Email','Phone','Pincode','Subtotal','Courier Charge','GST','Grand Total','Payment Status','Order Status','Razorpay Reference','Date']];
    orders.forEach(order => rows.push([order._id,order.customer_id?.name,order.customer_id?.email,order.customer_id?.phone,order.delivery_pincode,order.subtotal,order.delivery_charge,order.tax_amount,order.grand_total,order.payment_status,order.order_status,order.payment_reference,order.createdAt]));
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

    res.locals.downloadCsrf = require('../services/sessionFormTokens').issue(req,'download-reissue');
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


// Reissue 24-hour download link
router.post('/orders/:id/reissue-download', adminAuth, async (req, res, next) => {
  if (!require('../services/sessionFormTokens').valid(req,'download-reissue',req.body?._csrf)) return res.status(403).send('Reload the order page and try again.');
  try {
    const delivery = require('../services/digitalDeliveryService');
    const updated = await delivery.reissue(req.params.id);
    if (!updated) return res.status(400).redirect(`/admin/orders/${req.params.id}`);
    res.redirect(303, `/admin/orders/${req.params.id}`);
  } catch(e) { next(e); }
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
