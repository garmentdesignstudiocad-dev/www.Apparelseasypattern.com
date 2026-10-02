const { logError } = require('../services/safeLog');
const express = require('express');
const router = express.Router();

const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');
const Addon = require('../models/mongo/Addon');
const validation = require('../services/commerceValidation');
const pricing = require('../services/orderPricing');

function ensureCart(req) {
  if (!Array.isArray(req.session.cart)) {
    req.session.cart = [];
  }

  return req.session.cart;
}


// =====================================================
// CART PAGE
// =====================================================

router.get('/cart', (req, res) => {
  const cart = ensureCart(req);

  res.render('cart', {
    title: 'Cart',
    cart
  });
});

router.get('/cart/count', (req, res) => {
  const cart = ensureCart(req);
  const count = cart.reduce((total, item) => total + Math.max(1, Number(item.quantity) || 1), 0);
  res.json({ count });
});


// =====================================================
// ADD TO CART
// =====================================================

router.post('/cart/add', async (req, res) => {

  try {

    const {
      product_id,
      files = [],
      addons = [],
      quantity = 1,
      physical_quantity = 0,
      trial_quantity = 0
    } = req.body;


    if(!validation.id(product_id) || !validation.ids(files) || !validation.ids(addons) || !validation.quantities(req.body)) return res.status(400).json({error:'Select a valid product, options and whole-number quantities.'});
    const product = await Product.findById(product_id).lean();

    if (!product || product.active === false) {
      return res.status(400).json({
        error: 'Product not found'
      });
    }


    // Selected files
    const selectedFiles =
      Array.isArray(files)
        ? await ProductFile.find({
            _id: { $in: files },
            product_id: product._id,
            active: true
          }).lean()
        : [];


    // Selected addons
    const selectedAddons =
      Array.isArray(addons)
        ? await Addon.find({
            _id: { $in: addons },
            product_id: product._id,
            active: true
          }).lean()
        : [];


    if(selectedFiles.length!==files.length || selectedAddons.length!==addons.length) return res.status(400).json({error:'One or more selected options are unavailable for this product.'});
    const unitPrice =
      Number(product.base_price || 0);


    const filesTotal =
      selectedFiles.reduce(
        (sum, file) =>
          sum + Number(file.file_price || 0),
        0
      );


    const addonsTotal =
      selectedAddons.reduce(
        (sum, addon) =>
          sum + Number(addon.price || 0),
        0
      );


    const qty =
      Math.max(
        0,
        Number(quantity ?? 1)
      );


    const physicalQty =
      Math.max(
        0,
        Number(physical_quantity || 0)
      );


    const trialQty =
      Math.max(
        0,
        Number(trial_quantity || 0)
      );


    const physicalPrice =
      Number(product.physical_price || 0);


    const trialPrice =
      Number(product.trial_price || 0);


    const itemUnitTotal =
      unitPrice +
      filesTotal +
      addonsTotal;


    const itemTotal = pricing.itemPrice(product, selectedFiles, selectedAddons, req.body).total;


    const cart = ensureCart(req);


    const cartItem = {

      id:
        Date.now().toString() +
        Math.random()
          .toString(36)
          .substring(2, 8),

      product_id:
        product._id.toString(),

      name:
        product.name,
      selected_sizes: req.body.selected_sizes || [],
      additional_size_price: Number(product.additional_size_price || 0),

      slug:
        product.slug,

      unit_price:
        unitPrice,

      physical_price:
        physicalPrice,

      trial_price:
        trialPrice,

      selected_files:
        selectedFiles.map(file => ({
          id:
            file._id.toString(),

          file_name:
            file.file_name,
          file_type: file.file_type,

          file_price:
            Number(file.file_price || 0)
        })),

      selected_addons:
        selectedAddons.map(addon => ({
          id:
            addon._id.toString(),

          name:
            addon.name,

          price:
            Number(addon.price || 0)
        })),

      quantity:
        qty,

      physical_quantity:
        physicalQty,

      trial_quantity:
        trialQty,

      itemUnitTotal:
        itemUnitTotal,

      total:
        itemTotal
    };


    cart.push(cartItem);


    req.session.cart = cart;


    // Make sure session is saved before response
    req.session.save(err => {

      if (err) {

        logError('Session save error:', err);

        return res.status(500).json({
          error: 'Could not save cart'
        });

      }


      return res.json({
        ok: true,
        cartCount: cart.length
      });

    });


  } catch (err) {

    logError('Cart add error:', err);

    res.status(500).json({
      error: 'Could not add to cart'
    });

  }

});


// =====================================================
// UPDATE CART
// =====================================================

router.post('/cart/update', async (req, res) => {

  try {
    if(!validation.quantities(req.body)) return res.status(400).json({error:'Enter valid whole-number quantities.'});

    const {
      itemId,
      quantity,
      physical_quantity,
      trial_quantity
    } = req.body;


    const cart =
      ensureCart(req);


    const index =
      cart.findIndex(
        item =>
          String(item.id) ===
          String(itemId)
      );


    if (index === -1) {

      return res.status(404).json({
        error: 'Item not found'
      });

    }


    const item =
      cart[index];


    item.quantity =
      Math.max(
        0,
        Number(
          quantity ?? item.quantity
        )
      );


    item.physical_quantity =
      Math.max(
        0,
        Number(
          physical_quantity ??
          item.physical_quantity
        )
      );


    item.trial_quantity =
      Math.max(
        0,
        Number(
          trial_quantity ??
          item.trial_quantity
        )
      );


    const filesTotal =
      (item.selected_files || [])
        .reduce(
          (sum, file) =>
            sum +
            Number(
              file.file_price || 0
            ),
          0
        );


    const addonsTotal =
      (item.selected_addons || [])
        .reduce(
          (sum, addon) =>
            sum +
            Number(
              addon.price || 0
            ),
          0
        );


    item.itemUnitTotal =
      Number(item.unit_price || 0) +
      filesTotal +
      addonsTotal;


    if(!validation.quantities(item)) return res.status(400).json({error:'Keep at least one digital, physical or trial item. Remove the row to remove all items.'});
    const currentProduct = await Product.findById(item.product_id).lean();
    if(!currentProduct || currentProduct.active===false) return res.status(400).json({error:'Product is unavailable.'});
    const currentFiles = await ProductFile.find({_id:{$in:item.selected_files.map(f=>f.id)},product_id:item.product_id,active:true}).lean();
    const currentAddons = await Addon.find({_id:{$in:item.selected_addons.map(a=>a.id)},product_id:item.product_id,active:true}).lean();
    if(currentFiles.length!==item.selected_files.length || currentAddons.length!==item.selected_addons.length) return res.status(400).json({error:'An option is unavailable. Remove and re-add this product.'});
    item.total = pricing.itemPrice(currentProduct,currentFiles,currentAddons,item).total;

    req.session.cart =
      cart;


    req.session.save(err => {

      if (err) {

        logError('Session save error:', err);

        return res.status(500).json({
          error: 'Could not save cart'
        });

      }


      res.json({
        ok: true,
        item
      });

    });


  } catch (err) {

    logError('Cart update error:', err);

    res.status(500).json({
      error: 'Could not update cart'
    });

  }

});


// =====================================================
// REMOVE ITEM
// =====================================================

router.post('/cart/remove', (req, res) => {

  try {

    const {
      itemId
    } = req.body;


    const cart =
      ensureCart(req);


    const index =
      cart.findIndex(
        item =>
          String(item.id) ===
          String(itemId)
      );


    if (index === -1) {

      return res.status(404).json({
        error: 'Item not found'
      });

    }


    cart.splice(index, 1);


    req.session.cart =
      cart;


    req.session.save(err => {

      if (err) {

        logError('Session save error:', err);

        return res.status(500).json({
          error: 'Could not save cart'
        });

      }


      res.json({
        ok: true,
        cartCount: cart.length
      });

    });


  } catch (err) {

    logError('Cart remove error:', err);

    res.status(500).json({
      error: 'Could not remove item'
    });

  }

});


module.exports = router;
