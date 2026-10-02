> 2026-10-01 override: New orders use configured pincode ? region ? dispatch ? delivery partner routing, with no delivery price or separate courier payment. Older fee descriptions below are historical. See SHIPPING_AND_DIGITAL_DELIVERY.md for current configuration.

# Receipts, notifications and LinkedIn

Current product checkout/deployment instructions: [SHIPPING_AND_DIGITAL_DELIVERY.md](SHIPPING_AND_DIGITAL_DELIVERY.md). Product orders now use fixed 18% GST and separate courier payment. Production links require APP_BASE_URL. Gmail uses GMAIL_USER and GMAIL_APP_PASSWORD when configured; generic EMAIL_* settings remain supported. Digital links are emailed only, including mixed orders.

## 1. Bill / receipt implementation

Legacy `/classes` payments also receive receipts and class creation/payment notifications through the same services.

Every newly verified paid product order, course registration, webinar registration, direct book purchase and consultation booking creates one immutable MongoDB `Receipt`. It includes the business/contact details, customer details, reference, item names and quantities, subtotal, discount, GST, delivery, INR total, Razorpay payment ID, payment status and verification date.

The confirmation page has **View / Print Paid Receipt**. The receipt is a clean printable HTML document; **Print / Save as PDF** opens the browser's print dialog. No external fonts, scripts or tracking assets are used on receipt pages. This is a payment receipt, not a GST tax invoice.

Product and paid-access verification both check the signature and fetch the captured gateway payment to match the stored order, amount and INR currency. Authorized-only, mismatched and refunded payments do not create PAID receipts. Prices and tax are copied from server-side transaction records. Product checkout uses the current server-calculated subtotal plus 18% GST; courier is payable separately. Paid-access amounts remain their original fee snapshots; GST and delivery are zero for those access payments. A manually edited `Paid` label or an invalid callback cannot create a receipt: the payment verifier must also have written `payment_verified_at`. Free registrations do not receive a PAID receipt. Existing historical payments without that verifier timestamp are not automatically converted into receipts.

Receipt lookup by reference requires the registering session or an admin session. Messages can contain a random 256-bit private receipt link which also works after the browser session expires. Anyone holding that link can view the receipt; it must be treated as private. Receipt responses use no-store, no-referrer and noindex headers. Issued receipts remain records of payment even if a booking is later cancelled; refunds are separate.

## 2. Email automation

`emailService.js` sends plain-text transactional email using Nodemailer SMTP. Gmail uses smtp.gmail.com, port 587, EMAIL_SECURE=false and a Google App Password (with 2-Step Verification). STARTTLS is required; port 465 with EMAIL_SECURE=true is also supported. Change the environment settings to switch SMTP providers. A stable Message-ID aids tracing but does not guarantee SMTP deduplication; atomic queue claims prevent concurrent sends. No mail credentials or raw provider responses are stored in MongoDB or displayed in Admin.

Events include order creation and payment, processing/shipped/delivered/cancelled updates, course booking/payment/status/schedule updates, webinar registration/payment/schedule updates and reminders, direct book purchases, consultation bookings/payment/status, course enquiry confirmations, digital pattern download links, and owner alerts for new orders, course enquiries, webinar registrations, book purchases, consulting bookings, successful payments and failed notifications. Owner alerts use ADMIN_NOTIFICATION_EMAIL or MongoDB SiteSettings.contact_email. Failed owner alerts remain visible in Admin and never recursively create more alerts.

Each message includes name, reference, amount, status, next steps and configured studio contact details. Verified payments include a private receipt URL when a public HTTPS origin is configured. Without that origin, customers are directed to the receipt on their confirmation page.

## 3. WhatsApp automation

WhatsApp uses the official Meta Cloud API template endpoint, not browser scraping or unofficial libraries. Set up an approved utility template in WhatsApp Manager with **six positional body parameters**, in this exact order:

1. Customer name
2. Reference ID
3. Amount, e.g. `INR 199.00`
4. Status
5. Next steps and contact information
6. Receipt URL, or confirmation-page instructions when no receipt exists

Suggested template body (submit your actual wording to Meta for approval):

```text
Hello {{1}}, here is your Garment Design Studio update.
Reference: {{2}}
Amount: {{3}}
Status: {{4}}
Next steps: {{5}}
Receipt/details: {{6}}
```

Template name and language must exactly match your approved Meta template. Phone numbers must include the country code. Arrange customer opt-in before enabling WhatsApp service messages.

## 4. Notification log and owner controls

- http://localhost:3000/admin/notifications
- http://localhost:3000/admin/settings/notifications

The log records email/WhatsApp channel, event, reference type/ID, customer, destination, state, provider message ID, safe error message, attempt count and sent date. It supports channel/event/status filters and pagination. Failed notifications can be retried from Admin.

Settings include Enable Email, Enable WhatsApp, Payment Confirmation, Order Updates, Course Updates, Webinar Updates & Reminders, Book Purchase Updates, Consulting Updates, and Admin New Order Alert. Individual customer event and owner alert switches are also available. **Both channels start disabled.** Skipped messages are not sent retroactively when a channel is enabled.

Source records carry durable pending jobs. Payment verification stores the payment job with the payment update; receipt/queue failures do not revert the payment. The application worker recovers jobs, creates receipts/logs, and processes up to 100 queued sends per pass. It runs every minute when the normal application starts. Meta requests have a 15-second timeout; SMTP connection/greeting timeouts are 15 seconds and socket timeout is 30 seconds. Multiple workers use atomic log claims and unique event keys to avoid concurrent or repeated-callback duplicates.

New logs use queued, sent and failed, with sending, skipped and uncertain retained as safety states. Legacy pending logs remain dispatchable. Provider timeouts and interrupted sends become **uncertain**, rather than automatically being resent. The owner must check provider logs and acknowledge possible duplication before retrying. This matters because exactly-once delivery cannot be guaranteed across an interrupted external request. **Sent** means the provider accepted the request, not that the customer received/read it; delivery-status webhooks are not implemented.

Confirmed/free or paid webinar registrations receive one reminder per webinar start time in the 24 hours before the webinar. Cancelled registrations are excluded when reminders are queued. The server must be running to process reminders. Schedule edits create a new schedule-update event and allow a reminder for the changed start time.

## 5. LinkedIn settings

Website Settings now stores these MongoDB fields:

- `linkedin_personal_url`
- `linkedin_business_url`
- `linkedin_show_books`
- `linkedin_show_footer`

The two supplied profile URLs are initialized once from `config/linkedin.js` when settings are first read. Existing owner values, including intentionally cleared URLs or hidden sections, are preserved. URLs must use HTTPS on `linkedin.com` or `www.linkedin.com`, without URL credentials or custom ports. Unsafe protocols and lookalike domains are rejected.

## 6. Books pages

Both `/books` and `/books/:slug` show **About the Author / Connect with Us**, with the requested clean labels:

- Connect with Ganesh Subramani on LinkedIn
- Follow Garment Design Studio on LinkedIn

Both open in a new tab with `rel="noopener noreferrer"`. Existing covers, titles, author, descriptions, topics and purchase options remain. No icon dependency was added.

## 7. Footer behavior

The footer shows compact Personal LinkedIn and Garment Design Studio LinkedIn links using the same saved settings. Books/footer visibility controls are independent. Hiding either does not delete the saved URLs. Website Appearance saves/resets do not overwrite the LinkedIn values.

## 8. Required environment configuration

Copy the names from `.env.notifications.example` into the deployment's private environment. The existing `.env` was not edited.

| Variable | Purpose |
|---|---|
| `PUBLIC_BASE_URL` | Public HTTPS origin for receipt links; falls back to HTTPS `SITE_URL` |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE` | SMTP host, port and true/false TLS mode |
| `EMAIL_USER`, `EMAIL_PASSWORD` | SMTP login and App Password, server environment only |
| `EMAIL_FROM` | Verified sender, optionally `Studio <billing@domain>` |
| `ADMIN_NOTIFICATION_EMAIL` | Owner alert override; defaults to SiteSettings contact email |
| `WHATSAPP_ACCESS_TOKEN` | Meta access token with messaging permissions |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta sender phone-number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_FROM_NUMBER` | Business account and sender identity for setup; sends use PHONE_NUMBER_ID |
| `WHATSAPP_API_VERSION` | Supported Graph API version, e.g. the version selected in your Meta app |
| `WHATSAPP_TEMPLATE_NAME` | Exact approved six-parameter template name |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Approved language code; defaults to `en` |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | Optional prefix for unprefixed 10-digit numbers; set `91` if those numbers are Indian. The default is 91 for this India-based checkout; international customers should supply +country-number. |
| `NOTIFICATIONS_WORKER_ENABLED` | Defaults to enabled; set `false` to pause the worker |

Existing MongoDB, Razorpay, session and admin environment settings remain required as before.

## 9. Exact local URLs and tests

- http://localhost:3000/admin/login
- http://localhost:3000/admin/notifications
- http://localhost:3000/admin/settings/notifications
- http://localhost:3000/admin/settings/website
- http://localhost:3000/books (open any active book to test its actual detail URL)
- http://localhost:3000/courses
- http://localhost:3000/webinars
- http://localhost:3000/consulting
- http://localhost:3000/checkout
- http://localhost:3000/admin/access-records

Complete a Razorpay **test-mode** payment, then open View / Print Paid Receipt on its confirmation page. Receipt URLs use generated private tokens, so there is no fixed public receipt URL to publish here.

`npm run test:notifications` uses temporary MongoDB collections and mocks all Razorpay, email and WhatsApp calls. It exercises all five payment receipt types, fee snapshots, invalid callbacks, access privacy, duplicate events, concurrent sends, failure/retry, uncertain sends, order updates, reminders, admin filters/settings, LinkedIn persistence/validation and independent visibility. Existing paid-access, learning, business, appearance and stability tests remain available. No real messages or charges are sent by automated tests.

## 10. Remaining provider setup

Enable Google 2-Step Verification and create an App Password for the SMTP account; set EMAIL_FROM to that account or an authorized sender alias. Never use the regular Gmail password. Configure your Meta business app, sender phone number, access token and approved template. Set the public HTTPS origin, populate studio contact information, restart with `npm start`, then enable the desired channels/events in Notification Settings. Perform a controlled test to your own opted-in email/WhatsApp recipient before enabling customer sends. No provider account, approved template, DNS records or real messages were created during implementation.

Official implementation references: [Nodemailer SMTP](https://nodemailer.com/smtp), [Google SMTP and App Password guidance](https://support.google.com/mail/answer/7104828?hl=en), and [Meta template-message parameters](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/).

## Main implementation files

New models: `Receipt`, `NotificationLog`, `NotificationSettings`, shared `communicationFields`.

New services: `receiptService.js`, `notificationService.js`, `notificationProviders.js`.

New routes/views: `routes/receipts.js`, `routes/adminNotifications.js`, `views/receipt.ejs`, `views/admin/notifications.ejs`, `views/admin/notification-settings.ejs`, `views/partials/linkedin.ejs`, `public/js/receipt.js`.

Integration changes: payment callbacks, registration creation, order/booking status updates, course/webinar schedule edits, website settings, public book pages/footer, confirmation-page receipt links, admin navigation and server worker startup. Existing test model lists were expanded so new writes remain in temporary test collections.
