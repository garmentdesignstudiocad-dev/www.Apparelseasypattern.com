const { logError } = require('../services/safeLog');
const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');
const Addon = require('../models/mongo/Addon');

/*
=========================================================
PRODUCT LIST
=========================================================
*/

async function listProducts(req, res, next) {
  try {
    const seoTitle='Ready-to-Use Available Pattern Templates | Apparel Easy Patterns';
    const category=typeof req.query.category==='string'?req.query.category.trim().toLowerCase():'';
    if(category && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category))return res.status(400).send('Choose a valid category.');
    const categories=[...new Set(['shirts','pants','shorts',...await Product.distinct('category',require('../services/patternOptions').publicFilter)])].filter(Boolean);
    const filter={...require('../services/patternOptions').publicFilter,...(category?{category}:{})};
    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.render('products', {
      title:seoTitle,
      seoTitle,
      description:'Browse ready-to-use apparel pattern templates. Choose printable files, optional DXF, tech packs, physical patterns and trial samples where available.',
      products, category, categories,
    });
  } catch (err) {
    logError('Product list error:', err);

    next(err);
  }
}


/*
=========================================================
PRODUCT DETAILS
=========================================================
*/

async function productDetails(req, res, next) {
  try {
    const slug = String(req.params.slug || '').trim();

    if (!slug) {
      return res.status(404).render('error', {
        title: 'Product Not Found',
        message: 'Product not found.',
      });
    }

    const product = await Product.findOne({
      slug,
      ...require('../services/patternOptions').publicFilter,
    }).lean();

    if (!product) {
      return res.status(404).render('error', {
        title: 'Product Not Found',
        message: 'The requested product could not be found.',
      });
    }

    const files = await ProductFile.find({
      product_id: product._id,
      active: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    const addons = await Addon.find({
      product_id: product._id,
      active: true,
    })
      .sort({ createdAt: -1 })
      .lean();

  const {seoTitle,description,ogImage,productStructuredData}=require('../services/seoService').productMetadata(product);
  res.render('product', {
    title:seoTitle,
    seoTitle,
    description,
    ogImage,
    productStructuredData,
    product,
    files,
    addons,
    optionAvailability:require('../services/patternOptions').availability(product),
  });
  } catch (err) {
    logError('Product details error:', err);

    next(err);
  }
}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {
  listProducts,
  productDetails,
};
