> 2026-10-01 override: New orders use configured pincode ? region ? dispatch ? delivery partner routing, with no delivery price or separate courier payment. Older fee descriptions below are historical. See SHIPPING_AND_DIGITAL_DELIVERY.md for current configuration.

# Garment Pattern Store implementation report

Completed 2026-10-01 in the existing project. No parallel checkout system was created.


## Courier selection and product UI update (2026-10-01)

Removed the repeated Pattern Specifications placeholder block and explanatory delivery/fulfilment prose from the product page. Actual configured size/format text and all purchase controls remain. No sizes or formats are invented.

Every physical/trial order now requires the customer's explicit selection of an active courier whose configured pincodes/prefixes match the customer destination. Blank rules no longer mean nationwide service. No-match destinations block checkout with a clear contact-store message; there is no arrange-later option or automatic courier selection. Changing the pincode resets the selection and stale responses are ignored. The summary updates the name, database charge and configured ETA immediately. Admin can manage estimated minimum/maximum days. New admin orders label and preserve Customer Selected Courier; fulfilment cannot replace it. GST and Razorpay amounts still exclude courier.

Files changed in this update: controllers/checkoutController.js; services/courierService.js, deliveryService.js, notificationService.js; models/mongo/Courier.js, Order.js; routes/adminFulfilment.js; views/product.ejs, checkout.ejs, payment_method.ejs, admin/couriers.ejs, admin/order_detail.ejs, admin/payment_detail.ejs; scripts/testStability.js, commerceAssertions.js, launchAssertions.js; package.json; SHIPPING_AND_DIGITAL_DELIVERY.md; this report. Created scripts/testCourierUI.js.

Tests: test:commerce-local passed (seven combinations, 104 routes, 71 templates, payment/download/email/admin regressions); test:courier-ui passed (pincode refresh, stale responses, no automatic selection, immediate summary and invalid/no-service destination reset). Gateway/SMTP were mocked. Browser visual inspection remains unavailable. No external courier API is required for admin-configured serviceability; no booking confirmation is claimed.

Admin next step: supply actual serviceable pincodes/prefixes, charges and estimated delivery days for each active courier. Couriers with blank pincode rules are intentionally unavailable at checkout.

## Resume findings

The prior courier/GST, physical-only/mixed-order, Gmail, size/add-on and Razorpay verification changes were present. There is no Git repository in this directory, so git status/diff are unavailable. Source files were compared with `D:/garments/garment-pattern-store-backup-20260930`. No secrets were copied into that source backup. The existing Basic Shirt product was previously updated to INR 50 base/additional-size/physical pricing and INR 1,000 trial pricing, while remaining inactive. Those prices remain admin-editable. Atlas is currently unreachable, so the record could not be re-read in the final connectivity check.

## Completed behavior

- Existing checkout recalculates database prices, exactly 18% GST and integer-paise Razorpay amounts. Courier never enters the online amount or its GST.
- Digital-only, additional size, physical-only, trial-only and all mixed combinations work through the existing routes. Size labels, formats, add-ons and customer/address/courier snapshots are retained.
- Checkout/payment summaries distinguish Online Payment from Courier. Digital-only orders require no courier/address. Admin orders/payments and receipts identify separate courier payment.
- Signed callback and raw-body webhook verification also fetch captured gateway payments and match order, currency and amount. Repeated/concurrent processing retains one receipt and digital email job. Email failure does not reverse paid records.
- Gmail environment variables are supported. Customer confirmation, payment-success, owner new-order and digital email content use stored order details. Digital links go only through email.
- Private file uploads support DXF/AAMA/ASTM and other existing formats. Files live outside public static storage; traversal and public-directory junctions are rejected. Random download tokens expire after 30 days and are restricted to that paid, verified, non-cancelled order's asset snapshot. Unpaid/cancelled/expired access and alternate order/file IDs are rejected.
- Production email links require APP_BASE_URL with HTTPS. Missing URL/files defer digital email safely; development-only localhost testing is configurable.
- No active Stripe code or warnings were found. The unused legacy SQL migration's USD default was corrected to INR; no historical amounts were converted.

## Tests and results

- `npm run test:commerce-local`: PASS against temporary real local MongoDB with Razorpay and SMTP mocked. Covers all seven combinations; tampered totals/signatures; fixed GST and paise; separate courier; failed/verified payments; signed and duplicate concurrent webhooks; customer/owner email rendering; email failure isolation; private download authorization; admin price/files/add-ons/status; 104 public/admin routes; 71 EJS templates; JavaScript syntax; shipping expiry; and the existing notification/paid-access regressions.
- `npm run test:commerce-security`: PASS for APP_BASE_URL production/development behavior, HTTPS restrictions, traversal and junction checks, private storage and paise totals.
- `npm run test:notification-providers`: PASS for mocked Gmail/generic SMTP, TLS, stable Message-ID, rejected/uncertain sends and secret-safe errors.
- Actual `server.js` startup and restart, MongoDB connection and HTTP checkout 200: PASS with isolated local MongoDB.
- Prior configured-database shipping/commerce suites passed before the Atlas outage. Final configured Atlas check: unavailable, ReplicaSetNoPrimary. This is not claimed as a current live-database pass.
- Browser visual testing unavailable: no browser was connected. HTTP/template and script checks were used.
- No real payment was charged and no real customer/owner email was sent by the tests. Live gateway/SMTP delivery still requires a controlled external smoke test.

## Remaining setup and exact next step

1. Restore Atlas reachability: check cluster availability, Network Access/IP allowlist and the configured MONGODB_URI. Do not replace it with the temporary test database URI.
2. When the final domain exists, fill these new values in the existing `.env`:

```dotenv
APP_BASE_URL=
RAZORPAY_WEBHOOK_SECRET=
```

APP_BASE_URL is your actual HTTPS origin, without a path/query/fragment. Do not use localhost in production. The webhook URL is the value of APP_BASE_URL with no trailing slash, followed by `/checkout/razorpay-webhook`. Subscribe to `payment.captured` and/or `order.paid`; the Dashboard secret must exactly equal RAZORPAY_WEBHOOK_SECRET.

3. Keep existing GMAIL_USER, GMAIL_APP_PASSWORD, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, MONGODB_URI, SESSION_SECRET, ADMIN_USERNAME and ADMIN_PASSWORD. Set NODE_ENV=production on deployment. Optional ADMIN_NOTIFICATION_EMAIL overrides the store contact email; optional PATTERN_FILES_DIR overrides private/patterns. NOTIFICATIONS_WORKER_ENABLED must be unset or true in production.
4. In Admin, upload real pattern assets, enter final size/format details, confirm trial pricing and courier/pincode rules, and enable the required email/order/payment/digital/owner events. Only then activate the existing Basic Shirt product. No fake production assets were created.
5. Restart the deployed server and perform one controlled Razorpay test-mode purchase to your own email, including a webhook retry. Courier selection remains a request; no courier booking API has been configured.

For detailed operational instructions, see [SHIPPING_AND_DIGITAL_DELIVERY.md](SHIPPING_AND_DIGITAL_DELIVERY.md). The test-only mongodb-memory-server dev dependency does not change runtime dependency versions. Local tests can use an installed MongoDB binary via MONGOMS_SYSTEM_BINARY; otherwise they download the official test binary on first run. Normal dependency installation does not download it.

## Files modified (full work)

- `controllers/checkoutController.js`
- `LAUNCH_READINESS.md`
- `migrations/20260809_create_schema.js`
- `models/mongo/Courier.js`
- `models/mongo/Order.js`
- `models/mongo/OrderItem.js`
- `models/mongo/Receipt.js`
- `NOTIFICATIONS_AND_RECEIPTS.md`
- `package-lock.json`
- `package.json`
- `routes/admin.js`
- `routes/adminFulfilment.js`
- `routes/adminNotifications.js`
- `routes/adminSettings.js`
- `routes/cart.js`
- `scripts/shippingAssertions.js`
- `scripts/testNotificationProviders.js`
- `scripts/testNotifications.js`
- `scripts/testShipping.js`
- `scripts/testStability.js`
- `server.js`
- `services/commerceValidation.js`
- `services/digitalDeliveryService.js`
- `services/emailService.js`
- `services/launchSetup.js`
- `services/notificationService.js`
- `services/receiptService.js`
- `SHIPPING_AND_DIGITAL_DELIVERY.md`
- `views/admin/couriers.ejs`
- `views/admin/digital-files.ejs`
- `views/admin/order_detail.ejs`
- `views/admin/payment_detail.ejs`
- `views/admin/settings_form.ejs`
- `views/cart.ejs`
- `views/checkout.ejs`
- `views/checkout_success.ejs`
- `views/payment_method.ejs`
- `views/product.ejs`
- `views/receipt.ejs`

## Files created

- `scripts/commerceAssertions.js`
- `scripts/testCommerce.js`
- `scripts/testCommerceLocal.js`
- `scripts/testCommerceSecurity.js`
- `services/orderPricing.js`
- `COMMERCE_IMPLEMENTATION_REPORT.md`

Verification reference: [Razorpay security checklist](https://security.razorpay.com/security/checklist/).
