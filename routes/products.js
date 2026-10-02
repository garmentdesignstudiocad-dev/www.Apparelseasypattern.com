const express = require('express');
const router = express.Router();
const { listProducts, productDetails } = require('../controllers/productsController');

router.get(['/products', '/patterns'], listProducts);
router.get('/product/:slug', productDetails);

module.exports = router;
