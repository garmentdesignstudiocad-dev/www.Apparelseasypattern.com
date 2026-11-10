const express = require('express');
const router = express.Router();
const { listProducts, productDetails, searchProductsApi } = require('../controllers/productsController');

router.get(['/api/products/search', '/products/search'], searchProductsApi);
router.get(['/products', '/patterns'], listProducts);
router.get(['/product/:slug', '/products/:slug'], productDetails);

module.exports = router;
