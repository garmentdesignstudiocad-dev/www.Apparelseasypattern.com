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
    const products = await Product.find({
      active: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.render('products', {
      title: res.locals.siteSettings.products_seo_title,
      description:res.locals.siteSettings.products_seo_description,
      products,
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
      active: true,
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

  res.render('product', {
  title: product.seo_title || product.name+' | Professional Garment Pattern',
  seoTitle:product.seo_title || product.name+' | Professional Garment Pattern',
  description:product.seo_description || product.description?.slice(0,200) || 'View garment pattern sizes, formats and ordering options.',
  productStructuredData:require('../services/seoService').productData(product),
  product,
  files,
  addons,
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
