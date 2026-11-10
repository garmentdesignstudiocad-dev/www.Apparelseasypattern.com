# Dispatch routing and secure digital delivery

Current physical-checkout policy: the website collects INR 0 for shipping. Courier charges are not included in the order total and customers pay them separately and directly to the courier service. The website does not require courier availability, select a courier, calculate courier rates, or book courier service. Historical order amounts and receipts remain available.

Dispatch routing is based on the delivery state. Tamil Nadu, Karnataka, Kerala, Andhra Pradesh, Telangana and Puducherry route to Bengaluru Hub. Delhi, Chandigarh, Haryana, Himachal Pradesh, Jammu and Kashmir, Ladakh, Punjab, Rajasthan, Uttar Pradesh and Uttarakhand route to Mumbai Hub. Other states and regions are accepted with dispatch hub marked Pending Manual Assignment; checkout does not guess a hub.

Physical/trial checkout still requires the customer's full name, phone number, delivery address, city, state and six-digit pincode. New physical orders save the address, assigned hub (or pending assignment), INR 0 website shipping charge, courier charges payable separately, shipping payment status Not collected and courier booking status Not booked. Admin fulfilment may record courier and tracking information only after they have been arranged separately and the shipment has actually been dispatched.

Digital-only purchases require no address or courier. Physical patterns and trial samples require address, city, state and pincode. Admin fulfilment records courier, tracking number, dispatch date and shipment status. Marking a verified paid shipment Shipped queues the existing shipment notifications.

Admin Products / Digital Files accepts DXF, AAMA, ASTM, PDF, ZIP, DWG, AI, EPS and PLT, up to 30 MB. Base assets accompany digital purchases; option assets are released only for purchased ProductFile IDs belonging to the ordered product. Use appropriate size-specific options or product records when assets differ by size. Do not upload a full collection as the base file unless all digital purchasers are entitled to it. Selected sizes are stored on the order; the application does not generate or grade CAD files automatically.

Files default to `private/patterns`, outside static `public`. `PATTERN_FILES_DIR` can select another private directory. Traversal and paths/junctions into public storage are rejected. Purchased assets are snapshotted into a random 256-bit token grant after captured, verified payment. Digital-only and mixed orders receive digital access; physical-only orders do not. URLs use the private token and an index within that order's assets, not public filenames or interchangeable product IDs. Grants expire after 30 days. Cancelled, expired, unpaid and unverified orders cannot download. These are bearer links: anyone with the complete link can use it until revoked/expired, so customers should keep them private.

Digital links are emailed only. Missing files or a missing public URL defer digital email without undoing payment. Unique message keys and atomic queue claims prevent repeated callback/webhook sends. Ambiguous SMTP responses require admin review rather than automatic resending.

## Production configuration

Add these to the existing `.env` when available; blank values below are placeholders:

```dotenv
# Final HTTPS origin, without a path, query or fragment.
APP_BASE_URL=
# Exactly the same secret entered in the Razorpay Dashboard webhook.
RAZORPAY_WEBHOOK_SECRET=
```

Keep existing `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `MONGODB_URI`, `SESSION_SECRET`, `ADMIN_USERNAME` and `ADMIN_PASSWORD`. Set `NODE_ENV=production` when deployed. Optionally set `ADMIN_NOTIFICATION_EMAIL`; otherwise owner messages go to the admin-managed store contact email. `PATTERN_FILES_DIR` is optional. Leave `NOTIFICATIONS_WORKER_ENABLED` unset or `true` in production.

The Razorpay Dashboard webhook URL is **the value of APP_BASE_URL, without a trailing slash, followed by `/checkout/razorpay-webhook`**. Subscribe to `payment.captured` and/or `order.paid`. The endpoint verifies the HMAC of the original request bytes using `RAZORPAY_WEBHOOK_SECRET`, then fetches the gateway payment and checks captured status, INR currency, stored order ID and exact paise amount. It shares idempotent finalization with the callback. No production URL is assumed.

Production links require `APP_BASE_URL` and HTTPS; there is no localhost fallback. Development may explicitly set `APP_BASE_URL=http://localhost:3000` for local-only testing. Legacy `PUBLIC_BASE_URL`/`SITE_URL` fallbacks are accepted only outside production.

Enable Email, Order Updates, Payment Confirmation, Digital Pattern Download Ready and desired owner events in Admin Notification Settings. Upload actual files, enter final sizes/formats, confirm product prices and activate the existing Basic Shirt product. Courier partner/rate settings do not affect checkout totals or hub assignment. No production files were invented.

## Tests

- `npm run test:courier-ui`: state-based dispatch hub display, pending manual assignment and no courier-selection or courier-charge dependency.
- `npm run test:commerce-security`: URL configuration, private storage, traversal/junction rejection and paise rounding; no database required.
- `npm run test:notification-providers`: mocked Gmail/generic SMTP and Meta providers; no messages sent.
- `npm run test:commerce`: temporary collections in configured MongoDB; seven purchase combinations and shipping/security/admin assertions; gateway and SMTP mocked.
- `npm run test:commerce-local`: commerce plus notification/paid-access regressions against temporary local MongoDB, without production database access. First use downloads an official MongoDB binary; `MONGOMS_SYSTEM_BINARY` can supply an installed binary. Binary postinstall downloads are disabled for ordinary dependency installation.

See `COMMERCE_IMPLEMENTATION_REPORT.md` for results, file inventory and outstanding setup.
