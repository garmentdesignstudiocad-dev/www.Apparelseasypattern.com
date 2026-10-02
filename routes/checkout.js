const express = require('express');

const router = express.Router();
router.use((req,res,next)=>['/checkout','/checkout/payment-method','/checkout/payment-method/proceed','/checkout/delivery-info','/checkout/delivery-charge'].includes(req.path)?require('../middleware/customerAuth')(req,res,next):next());

const {
  getCheckoutPage,
  getDeliveryCharge,
  postCheckout,
  getPaymentMethodPage,
  postPaymentMethodProceed,
  postRazorpayCallback,
  getSuccess,
  getCancel,
} = require('../controllers/checkoutController');


/*
=========================================================
CHECKOUT PAGE
=========================================================
*/

router.get(
  '/checkout',
  getCheckoutPage
);


/*
=========================================================
DELIVERY CHARGE
=========================================================
*/

router.get(
  '/checkout/delivery-charge',
  getDeliveryCharge
);

router.get('/checkout/delivery-info', getDeliveryCharge);


/*
=========================================================
CREATE ORDER + RAZORPAY
=========================================================
*/

router.post(
  '/checkout',
  postCheckout
);

router.get('/checkout/payment-method', getPaymentMethodPage);
router.post('/checkout/payment-method/proceed', postPaymentMethodProceed);


/*
=========================================================
RAZORPAY CALLBACK
=========================================================
*/

router.post(
  '/checkout/razorpay-callback',
  postRazorpayCallback
);


/*
=========================================================
PAYMENT SUCCESS
=========================================================
*/

router.get(
  '/checkout/success',
  getSuccess
);


/*
=========================================================
PAYMENT CANCELLED
=========================================================
*/

router.get(
  '/checkout/cancel',
  getCancel
);


/*
=========================================================
EXPORT ROUTER
=========================================================
*/

module.exports = router;
