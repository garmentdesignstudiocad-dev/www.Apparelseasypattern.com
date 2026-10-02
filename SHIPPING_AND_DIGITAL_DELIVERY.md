# Dispatch routing and secure digital delivery

Current requirement (2026-10-01): delivery partners have no price in checkout. Product/services subtotal + GST 18% is the online total. New orders do not store a delivery charge. Historical order amounts and receipts remain available.

Open Admin > Delivery Settings to initialize/edit South ? Bengaluru and North ? Mumbai, then map actual pincodes or prefixes to regions. An exact mapping takes precedence over the longest prefix; an inactive exact mapping blocks fallback. Defaults never overwrite Admin changes.

Open Admin > Courier Settings to select each partner's service regions, active status, optional pincode restrictions and optional estimated delivery days. Empty pincode restrictions cover its selected regions only. No partner is offered without an active configured region and route. Existing partners require region assignment before they can be offered. Availability represents Admin configuration, not live carrier booking. No real serviceability is invented.

Physical/trial checkout derives destination, region and dispatch from the database and requires an explicit available partner. Pincode changes clear the selection and refresh the route; stale responses are discarded. Unconfigured destinations cannot proceed. Orders snapshot address, pincode, region, dispatch location and the selected partner. Admin fulfilment preserves that choice.

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

Enable Email, Order Updates, Payment Confirmation, Digital Pattern Download Ready and desired owner events in Admin Notification Settings. Upload actual files, enter final sizes/formats, confirm prices and courier rules, then activate the existing Basic Shirt product. No production files were invented.

## Tests

- `npm run test:courier-ui`: destination changes, stale-response rejection, explicit selection and immediate summary updates using the actual checkout JavaScript.
- `npm run test:commerce-security`: URL configuration, private storage, traversal/junction rejection and paise rounding; no database required.
- `npm run test:notification-providers`: mocked Gmail/generic SMTP and Meta providers; no messages sent.
- `npm run test:commerce`: temporary collections in configured MongoDB; seven purchase combinations and shipping/security/admin assertions; gateway and SMTP mocked.
- `npm run test:commerce-local`: commerce plus notification/paid-access regressions against temporary local MongoDB, without production database access. First use downloads an official MongoDB binary; `MONGOMS_SYSTEM_BINARY` can supply an installed binary. Binary postinstall downloads are disabled for ordinary dependency installation.

See `COMMERCE_IMPLEMENTATION_REPORT.md` for results, file inventory and outstanding setup.
