const { publicGarmentMedia } = require('../services/productMediaIntegration');
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
    const settings = res.locals.siteSettings || {};
    const seoTitle = settings.products_seo_title || 'Ready-to-Use Available Pattern Templates | Apparel Easy Patterns';

    // Validate and sanitize query parameters
    const categoryRaw = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
    if (categoryRaw && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categoryRaw)) {
      return res.status(400).send('Choose a valid category.');
    }

    const subcatRaw = typeof req.query.subcat === 'string' ? req.query.subcat.trim().toLowerCase() : '';
    if (subcatRaw && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subcatRaw)) {
      return res.status(400).send('Choose a valid subcategory.');
    }

    const styleRaw = typeof req.query.style === 'string' ? req.query.style.trim().toLowerCase() : '';
    if (styleRaw && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(styleRaw)) {
      return res.status(400).send('Choose a valid style.');
    }

    const typeRaw = typeof req.query.type === 'string' ? req.query.type.trim().toLowerCase() : '';
    if (typeRaw && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(typeRaw)) {
      return res.status(400).send('Choose a valid type.');
    }

    const fitRaw = typeof req.query.fit === 'string' ? req.query.fit.trim().toLowerCase() : '';
    if (fitRaw && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fitRaw)) {
      return res.status(400).send('Choose a valid fit.');
    }

    const sizeRaw = typeof req.query.size === 'string' ? req.query.size.trim().toUpperCase() : '';
    if (sizeRaw && !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(sizeRaw)) {
      return res.status(400).send('Choose a valid size.');
    }

    const formatRaw = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : '';
    if (formatRaw && !['digital', 'physical'].includes(formatRaw)) {
      return res.status(400).send('Choose a valid format.');
    }

    const publicFilter = require('../services/patternOptions').publicFilter;
    const allPublished = await Product.find(publicFilter).sort({ createdAt: -1 }).lean();

    // Distinct categories across published products
    const distinctDbCats = [...new Set(allPublished.map(p => (p.category || '').toLowerCase()).filter(Boolean))];
    const categories = [...new Set(['shirts', 'pants', 'shorts', ...distinctDbCats])];

    // Department filtering: Men, Women, Kids or Direct Category
    let departmentProducts = allPublished;

    if (categoryRaw && categoryRaw !== 'all') {
      if (categoryRaw === 'men') {
        const menTypes = ['shirts', 't-shirts', 'trousers', 'pants', 'shorts'];
        departmentProducts = departmentProducts.filter(p => {
          const dept = (p.department || '').toLowerCase();
          if (dept === 'men') return true;
          if (dept === 'women' || dept === 'kids') return false;
          const c = (p.category || '').toLowerCase();
          const n = (p.name || '').toLowerCase();
          const isWomen = /\b(women|womens|women's|lady|ladies)\b/i.test(n) || ['dresses', 'tops', 'kurtas', 'blouses'].includes(c);
          const isKids = /\b(kid|kids|child|children|boy|boys|girl|girls)\b/i.test(n);
          return (c === 'men' || c === 'mens' || /\b(men|mens|men's)\b/i.test(n) || menTypes.includes(c)) && !isWomen && !isKids;
        });
      } else if (categoryRaw === 'women') {
        const womenTypes = ['dresses', 'tops', 'kurtas', 'blouses', 'bottoms'];
        departmentProducts = departmentProducts.filter(p => {
          const dept = (p.department || '').toLowerCase();
          if (dept === 'women') return true;
          if (dept === 'men' || dept === 'kids') return false;
          const c = (p.category || '').toLowerCase();
          const n = (p.name || '').toLowerCase();
          const isKids = /\b(kid|kids|child|children|girl|girls|boy|boys)\b/i.test(n);
          return (c === 'women' || c === 'womens' || /\b(women|womens|women's|lady|ladies)\b/i.test(n) || womenTypes.includes(c)) && !isKids;
        });
      } else if (categoryRaw === 'kids') {
        departmentProducts = departmentProducts.filter(p => {
          const dept = (p.department || '').toLowerCase();
          if (dept === 'kids') return true;
          if (dept === 'men' || dept === 'women') return false;
          const c = (p.category || '').toLowerCase();
          const n = (p.name || '').toLowerCase();
          return c === 'kids' || c === 'children' || /\b(kid|kids|child|children|boy|boys|girl|girls)\b/i.test(n);
        });
      } else {
        // Direct category match (e.g. category=shirts, category=t-shirts, category=trousers)
        departmentProducts = departmentProducts.filter(p => (p.category || '').toLowerCase() === categoryRaw);
      }
    }

    if (subcatRaw) {
      departmentProducts = departmentProducts.filter(p => {
        const sub = (p.kids_subcategory || '').toLowerCase();
        if (sub) return sub === subcatRaw;
        const n = (p.name || '').toLowerCase();
        if (subcatRaw === 'boys') return /\\b(boy|boys)\\b/i.test(n);
        if (subcatRaw === 'girls') return /\\b(girl|girls)\\b/i.test(n);
        return true;
      });
    }

        // Dynamic selectable values supported ONLY by actual published products in this department
    const availableTypes = [...new Set(departmentProducts.map(p => (p.category || '').trim()).filter(Boolean))];
    const distinctStyles = [...new Set(departmentProducts.map(p => (p.style || '').trim()).filter(Boolean))];
    const styleKeywords = ['Formal', 'Casual', 'Party', 'Sport', 'Streetwear', 'Everyday', 'Workwear'];
    const matchedStyleKeywords = styleKeywords.filter(stKw =>
      departmentProducts.some(p => (p.name + ' ' + (p.description || '')).toLowerCase().includes(stKw.toLowerCase()))
    );
    const availableStyles = [...new Set([...distinctStyles, ...matchedStyleKeywords])];

    const fitKeywords = ['Slim Fit', 'Regular Fit', 'Relaxed Fit', 'Comfort Fit', 'Classic Fit', 'Tailored Fit'];
    const availableFits = fitKeywords.filter(fitKw =>
      departmentProducts.some(p => (p.name + ' ' + (p.description || '')).toLowerCase().includes(fitKw.toLowerCase()))
    );
    const availableSizes = [...new Set(departmentProducts.flatMap(p => p.available_sizes || []))].filter(Boolean);
    const hasDigital = departmentProducts.some(p => p.pattern_options?.printable !== false);
    const hasPhysical = departmentProducts.some(p => p.pattern_options?.physical !== false);

    // Apply secondary filters to matched products
    let matchedProducts = departmentProducts;

    if (typeRaw) {
      matchedProducts = matchedProducts.filter(p => {
        const c = (p.category || '').toLowerCase();
        const n = (p.name || '').toLowerCase();
        return c === typeRaw || n.includes(typeRaw.replace('-', ' '));
      });
    }

    if (styleRaw) {
      const styleQuery = styleRaw.replace('-', ' ');
      matchedProducts = matchedProducts.filter(p => {
        const st = (p.style || '').toLowerCase();
        if (st) return st === styleRaw || st.includes(styleQuery);
        const n = (p.name || '').toLowerCase();
        const d = (p.description || '').toLowerCase();
        return n.includes(styleQuery) || d.includes(styleQuery);
      });
    }

        if (fitRaw) {
      const fitQuery = fitRaw.replace('-', ' ');
      matchedProducts = matchedProducts.filter(p => {
        const n = (p.name || '').toLowerCase();
        const d = (p.description || '').toLowerCase();
        return n.includes(fitQuery) || d.includes(fitQuery);
      });
    }

    if (sizeRaw) {
      matchedProducts = matchedProducts.filter(p => (p.available_sizes || []).includes(sizeRaw));
    }

    if (formatRaw === 'digital') {
      matchedProducts = matchedProducts.filter(p => p.pattern_options?.printable !== false);
    } else if (formatRaw === 'physical') {
      matchedProducts = matchedProducts.filter(p => p.pattern_options?.physical !== false);
    }

    // Enrich products with actual file availability flags (Tech Pack, Marker, Digital Formats)
    const productIds = matchedProducts.map(p => p._id).filter(Boolean);
    let relatedFiles = [];
    if (productIds.length > 0) {
      try {
        relatedFiles = await ProductFile.find({ product_id: { $in: productIds }, active: true }).lean();
      } catch (fileErr) {
        logError('Failed to fetch product files for catalog listing:', fileErr);
      }
    }

    const pathMod = require('path');
    const enrichedProducts = matchedProducts.map(p => {
      const pObj = publicGarmentMedia(p);
      const pFiles = relatedFiles.filter(f => String(f.product_id) === String(p._id));
      const hasTechPack = pFiles.some(f => f.purpose === 'tech_pack' || (f.file_name && /tech[-_ ]?pack/i.test(f.file_name)));
      const hasMarker = pFiles.some(f => f.file_name && /marker|fabric[-_ ]?consumption/i.test(f.file_name));
      const fileExts = pFiles.map(f => {
        const ext = (f.file_type || pathMod.extname(f.file_name || '')).replace('.', '').toUpperCase();
        return ext;
      }).filter(e => ['DXF', 'HPGL', 'PLT', 'PDF'].includes(e));

      const formatsSet = new Set(fileExts);
      if (p.file_formats) {
        p.file_formats.split(/[,\s]+/).forEach(fmt => {
          const clean = fmt.trim().toUpperCase();
          if (clean) formatsSet.add(clean);
        });
      }
      pObj.has_tech_pack = hasTechPack;
      pObj.has_marker = hasMarker;
      pObj.digital_formats = Array.from(formatsSet).join(' · ') || (p.pattern_options?.printable !== false ? 'DXF · HPGL · PLT' : '');
      return pObj;
    });

    res.render('products', {
      title: seoTitle,
      seoTitle,
      description: settings.products_seo_description || 'Browse ready-to-use apparel pattern templates. Choose printable files, optional DXF, tech packs, physical patterns and trial samples where available.',
      products: enrichedProducts,
      category: categoryRaw,
      categories,
      selectedType: typeRaw,
      selectedSubcat: subcatRaw,
      selectedStyle: styleRaw,
      availableStyles,
      selectedFit: fitRaw,
      selectedSize: sizeRaw,
      selectedFormat: formatRaw,
      availableTypes,
      availableFits,
      availableSizes,
      hasDigital,
      hasPhysical
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

    let product = await Product.findOne({
      slug,
      ...require('../services/patternOptions').publicFilter,
    }).lean();

    if (!product) {
      return res.status(404).render('error', {
        title: 'Product Not Found',
        message: 'The requested product could not be found.',
      });
    }

    product = publicGarmentMedia(product);

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
  if (req.session) {
    req.session.leadToken ||= require('crypto').randomBytes(32).toString('hex');
  }
  res.render('product', {
    title:seoTitle,
    seoTitle,
    description,
    ogImage,
    productStructuredData,
    product,
    configuredGstRate: await require('../services/orderPricing').taxRate(),
    files,
    addons,
    optionAvailability:require('../services/patternOptions').availability(product),
    csrf: req.session?.leadToken || '',
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


/*
=========================================================
SEARCH PRODUCTS API
=========================================================
*/
async function searchProductsApi(req, res, next) {
  try {
    const rawQ = String(req.query.q || '').trim();
    if (rawQ.length > 100) {
      return res.status(400).json({ success: false, error: 'Query exceeds maximum allowed length of 100 characters.' });
    }
    const q = rawQ.toLowerCase();
    const publicFilter = require('../services/patternOptions').publicFilter;
    const allPublished = await Product.find(publicFilter).sort({ createdAt: -1 }).lean();

    const formatted = allPublished.map(p => {
      const pm = publicGarmentMedia(p);
      const img = (pm.images && pm.images[0]) || pm.sample_image_url || '/images/reference/blue-shirt-main.jpg';
      const dept = (p.department || '').trim();
      const ptype = (p.product_type || p.category || '').trim();
      const style = (p.style || '').trim();
      const fit = (p.fit || '').trim();
      return {
        id: p._id,
        name: p.name,
        slug: p.slug,
        department: dept || 'Apparel',
        product_type: ptype,
        style: style,
        fit: fit,
        base_price: p.base_price,
        image: img,
        category: p.category,
        available_sizes: p.available_sizes || []
      };
    });

    let results = formatted;
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      results = formatted.filter(p => {
        const text = [p.name, p.department, p.product_type, p.style, p.fit, p.category].filter(Boolean).join(' ').toLowerCase();
        return tokens.every(token => text.includes(token));
      });
    }

    // Suggestions derived strictly from actual published catalog data
    const suggestionsSet = new Set();
    formatted.forEach(p => {
      if (p.product_type) suggestionsSet.add(p.product_type);
      if (p.style) suggestionsSet.add(p.style);
      if (p.fit) suggestionsSet.add(p.fit);
      if (p.department) suggestionsSet.add(p.department + "'s Patterns");
      if (p.category) suggestionsSet.add(p.category.charAt(0).toUpperCase() + p.category.slice(1));
    });

    const suggestions = Array.from(suggestionsSet).filter(Boolean).slice(0, 8);

    res.json({
      success: true,
      query: rawQ,
      count: results.length,
      suggestions,
      results
    });
  } catch (err) {
    logError('Search API error:', err);
    res.status(500).json({ success: false, error: 'Failed to search products' });
  }
}

module.exports = {
  searchProductsApi,
  listProducts,
  productDetails,
};
