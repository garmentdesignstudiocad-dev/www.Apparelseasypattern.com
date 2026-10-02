# Owner controls and paid access

Implemented in the existing Express/EJS/MongoDB application. No new dependencies were added. Product pricing remains product + options + delivery + GST. Existing website branding, appearance, Wix/main-website navigation, products, coupons, orders, customers, leads and legacy classes remain available.

## Owner setup

1. Start or restart the application with `npm start`.
2. Open http://localhost:3000/admin/login and sign in with the existing owner credentials.
3. Open http://localhost:3000/admin/settings/paid-access. The first access persists four default INR fee settings of ₹199 in MongoDB.
4. Change any Default Access Fee (for example, 199 to 299), button text, Paid Access Enabled, or Active checkbox, then save. New storefront requests immediately use the saved settings.
5. Use the existing course/webinar forms, Books, and the new Consulting section to manage individual offers. A blank price uses the section default; an explicit price overrides it; zero is free. Existing explicit prices, including zero, are preserved.

Paid Access Disabled means new registrations are free. Inactive hides a section and closes new registrations; existing confirmations remain accessible. Fee changes never rewrite existing registrations or gateway orders. INR is fixed. Existing product checkout fees are independent.

The established consulting services are copied into editable MongoDB service records on first catalog/admin access when the service collection is empty. This preserves the service list and enquiry form while adding bookable services.

## Customer flows

- **Course:** `/courses` → course detail and customer/schedule form → booking reference → Razorpay → server verification → confirmed registration. An optional private Course Access URL appears only after confirmed paid/free access. Public descriptions and modules remain browseable.
- **Webinar:** `/webinars` → detail and registration → seat reservation → Razorpay for paid registrations → server verification → confirmed registration and private meeting link. A price of zero confirms a free registration after a successful seat claim. Existing seat limits, attendance, cancellation and payment recovery remain available.
- **Book:** `/books` → book detail → Direct Paid Access → customer details → Razorpay → verification → purchase confirmation and private e-book URL. External Amazon books link directly to Amazon with no local fee or payment order. Free books use a free access record.
- **Consulting:** `/consulting` → select service → name, email, WhatsApp, preferred date/time (IST), requirement → Razorpay → verification → booking confirmation. Payment confirms the booking; the studio still agrees the final schedule.

Confirmation pages display customer, item/service, reference, amount, payment status and access status. Access remains tied to the registering browser session, matching the existing webinar flow. If that session expires, the customer is directed to studio support. Private URLs are gated links; external document hosts retain control over downloads and sharing.

## Admin management

http://localhost:3000/admin/access-records combines course registrations, webinar registrations, book purchases and consultation bookings. It provides section selection, customer/item search, payment/access filters, pagination, references, payment checks, cancellation and ambiguous-order recovery. Webinar attendance and meeting management remain in the existing webinar admin pages. Consulting booking status and requirements are managed here.

Dashboard cards show total course registrations, webinar registrations, book purchases, consulting bookings, paid-access revenue, pending payments and successful payments. Revenue is the recorded captured amount in INR; cancellation does not automatically refund a payment. Refunds remain an owner action in Razorpay.

Existing `/admin/payments` continues to show product payments and links to the access-payment records. Paid records cannot be manually promoted to paid; the shared gateway verifier controls that state.

## Payment security

- One reusable payment implementation: the existing `webinarPaymentService.createService`, parameterized for the other registration models by `paidAccessService`.
- Fees are calculated from MongoDB settings and item overrides on the server and stored as integer paise before creating a Razorpay order. Browser amounts are ignored.
- Callback verification uses HMAC-SHA256 and a timing-safe signature comparison. The gateway payment is fetched server-side and must match the stored order, amount and INR currency, be captured, and have no refunded amount.
- The status-check recovery path also fetches captured payment data directly from Razorpay; it does not trust browser status.
- Repeated order requests reuse the recorded order. Conditional state transitions keep callbacks idempotent and prevent reactivating cancelled records or undoing webinar attendance.
- Ambiguous order creation remains locked until owner review/recovery; automatic duplicate gateway orders are avoided.
- Session ownership and CSRF checks protect customer actions. Private course, e-book and webinar links are omitted from public catalog queries and unconfirmed/cancelled confirmation pages.
- Payments store purpose, local reference, gateway order/payment IDs, amount, currency, status and timestamps on the relevant registration/purchase record. Product Payment records also receive purpose/reference metadata without changing pricing.
- Environment secrets were not edited or exposed in admin forms or responses.

## Exact local entry URLs

The configured local port is 3000.

| Area | URL |
|---|---|
| Owner login | http://localhost:3000/admin/login |
| Dashboard | http://localhost:3000/admin/dashboard |
| Paid Access Settings | http://localhost:3000/admin/settings/paid-access |
| Course management | http://localhost:3000/admin/courses |
| Webinar management | http://localhost:3000/admin/webinars |
| Book management | http://localhost:3000/admin/books |
| Consulting management | http://localhost:3000/admin/consulting |
| Course access records | http://localhost:3000/admin/access-records?kind=courses |
| Webinar access records | http://localhost:3000/admin/access-records?kind=webinars |
| Book purchases | http://localhost:3000/admin/access-records?kind=books |
| Consultation bookings | http://localhost:3000/admin/access-records?kind=consulting |
| Courses | http://localhost:3000/courses |
| Webinars | http://localhost:3000/webinars |
| Books | http://localhost:3000/books |
| Consulting | http://localhost:3000/consulting |
| Existing product store | http://localhost:3000/products |
| Existing cart | http://localhost:3000/cart |
| Existing checkout | http://localhost:3000/checkout |
| Website settings | http://localhost:3000/admin/settings/website |
| Website appearance | http://localhost:3000/admin/settings/appearance |

Open an active item from its catalog for its actual slug URL. Confirmation URLs contain the generated registration ID and require the original browser session. Automated fixture slugs are temporary and are removed after testing.

## Models

New MongoDB models: `PaidAccessSettings`, `ConsultingService`, `BookPurchase`, `ConsultationBooking`.

Extended existing models: `Course`, `CourseBooking`, `Webinar`, `WebinarRegistration`, `Book`, `Payment`. `accessFields.js` supplies common payment snapshot fields; it is not a separate collection.

## File inventory

New files:

- `models/mongo/accessFields.js`
- `models/mongo/PaidAccessSettings.js`
- `models/mongo/ConsultingService.js`
- `models/mongo/BookPurchase.js`
- `models/mongo/ConsultationBooking.js`
- `services/paidAccessService.js`
- `services/paidAccessStats.js`
- `routes/paidAccess.js`
- `routes/adminPaidAccess.js`
- `views/learning/access-form.ejs`
- `views/learning/access-confirmation.ejs`
- `views/admin/paid-access.ejs`
- `views/admin/consulting.ejs`
- `views/admin/access-records.ejs`
- `scripts/testPaidAccess.js`
- `PAID_ACCESS.md`

Modified files:

- `server.js`, `package.json`
- `controllers/checkoutController.js` (payment reference metadata only)
- `models/mongo/Course.js`, `CourseBooking.js`, `Webinar.js`, `WebinarRegistration.js`, `Book.js`, `Payment.js`
- `services/webinarPaymentService.js`, `learningValidation.js`, `businessValidation.js`
- `routes/learning.js`, `business.js`, `adminLearning.js`, `adminBusiness.js`, `admin.js`
- `public/js/webinar-payment.js`
- `views/learning/detail.ejs`, `registration.ejs`
- `views/partials/learning-cards.ejs`, `admin_header.ejs`
- `views/business/page.ejs`
- `views/admin/learning-form.ejs`, `learning-records.ejs`, `business-content.ejs`, `dashboard.ejs`, `payments.ejs`
- `views/admin/productFiles.ejs`, `productAddons.ejs` (existing broken Add links now target their existing forms)
- `scripts/testBusiness.js`, `testLearning.js`, `testStability.js` (updated fixtures and isolation for new collections)

## Verification

- `npm run test:paid-access`: scenarios A–H, plus free books, session ownership, CSRF, captured amount/status checks, overrides, inactive sections, immutable fee snapshots, duplicate callbacks and cancellation privacy. Uses isolated MongoDB collections and a simulated Razorpay gateway.
- `npm run test:stability`: scenario I, 95 routes/links, product options, digital/physical delivery, GST 18%/5%/disabled, server-priced gateway totals, product payment records, duplicate callbacks, legacy registrations and safe error handling. Uses isolated MongoDB collections and a simulated gateway.
- `npm run test:business`: public pages, leads, content CRUD/visibility, admin authorization, filters, CSV and checkout rendering with simulated persistence.
- `npm run test:appearance`: appearance controls, preview, CSRF, validation, reset isolation and storefront rendering with simulated persistence.
- `npm run test:learning`: existing learning/seat/attendance/recovery regression using temporary MongoDB collections.

No real Razorpay charge is made by these tests. Integration tests require a working MongoDB connection and permission to create/drop their uniquely named temporary collections.
