# Notification final regression report

Date: 2026-09-29

## Scope and safety

Continued the existing notification implementation. No new application features or production-code changes. No live email, WhatsApp message, or Razorpay payment was sent. Test processes used `NOTIFICATIONS_WORKER_ENABLED=false`; notification dispatch used injected provider mocks. The private `.env` was not changed.

The configured remote MongoDB was unreachable (`MongooseServerSelectionError`). Database regressions were therefore run against an isolated MongoDB 8.2.6 instance bound to `127.0.0.1:27028`, using temporary test collections. This verifies application behavior, not connectivity to the deployment database or live providers.

## Files changed in this verification pass

- `scripts/notificationAssertions.js`: added post-delivery concurrent Razorpay callback checks, unauthenticated settings access checks, complete/incomplete provider readiness checks, and assertions that SMTP identity/password and Meta ID/token values do not appear in settings or logs HTML.
- `NOTIFICATION_FINAL_REPORT.md`: this report and setup handoff.

No Git metadata was present in this directory, so earlier workspace changes cannot be reconstructed as a Git diff.

## Verification

Commands: `npm run test:<name>` for each suite below.

| Suite | Result |
|---|---|
| notification-providers | PASS |
| notifications | PASS; includes the paid-access suite |
| stability | PASS |
| learning | PASS |
| business | PASS |
| consulting-forms | PASS |
| features | PASS |
| shipping | PASS |
| launch | PASS |
| public-visibility | PASS |
| appearance | PASS |
| appearance:mongo | PASS |

Verified through authenticated HTTP requests, rendered HTML, database assertions and mocked provider calls:

- Notification Settings renders, saves controls, protects access, and displays configuration presence without credential values. “Present” explicitly says the connection/provider is not verified.
- Notification Logs renders and supports the tested channel/status/event filter route. Failure details are sanitized. Unauthorized visitors redirect to login.
- Duplicate payment callbacks create one payment-success notification per customer/channel. Concurrent dispatch claims prevent duplicate sends. Additional concurrent product callbacks after delivery do not cause either channel to send again.
- Failed sends are persisted as `failed`, can be queued through the CSRF-protected admin retry route, and succeed using a mock provider. Ambiguous outcomes are `uncertain` and require duplicate-risk acknowledgement before retry.
- Existing product, populated cart, checkout, server-priced payment, digital/physical delivery, course, webinar, book and consulting flows pass the regression coverage. Stability checks include 104 public/admin routes and 71 EJS templates.

Admin verification was HTTP/rendered-HTML testing, not a manual browser layout inspection. `sent` means the provider accepted the request; it does not establish recipient delivery. SMTP/Meta cannot guarantee exactly-once delivery after an ambiguous network response; inspect provider logs before retrying `uncertain` items.

## Exact admin URLs

For the configured local port 3000:

- Login: http://localhost:3000/admin/login
- Dashboard: http://localhost:3000/admin
- Notification Settings: http://localhost:3000/admin/settings/notifications
- Notification Logs: http://localhost:3000/admin/notifications
- Failed sends: http://localhost:3000/admin/notifications?status=failed
- Uncertain sends: http://localhost:3000/admin/notifications?status=uncertain

On deployment, replace `http://localhost:3000` with your actual HTTPS origin. No deployment origin was verified in this pass.

## Environment variables

Existing application requirements remain: `MONGODB_URI` (or an existing supported MongoDB URI alias), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` for paid checkout. `PORT` defaults to 3000. Use `NODE_ENV=production` on deployment.

Notification configuration, matching `.env.notifications.example`:

```dotenv
PUBLIC_BASE_URL=https://YOUR-ACTUAL-STORE-DOMAIN
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=YOUR-GMAIL-ADDRESS
EMAIL_PASSWORD=YOUR-GOOGLE-APP-PASSWORD
EMAIL_FROM="Garment Design Studio <YOUR-GMAIL-ADDRESS>"
ADMIN_NOTIFICATION_EMAIL=YOUR-OWNER-EMAIL

WHATSAPP_ACCESS_TOKEN=YOUR-SYSTEM-USER-TOKEN
WHATSAPP_PHONE_NUMBER_ID=YOUR-NUMERIC-PHONE-NUMBER-ID
WHATSAPP_API_VERSION=SUPPORTED-VERSION-FROM-YOUR-META-APP
WHATSAPP_TEMPLATE_NAME=studio_service_update
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_DEFAULT_COUNTRY_CODE=91

# Keep disabled until live messaging is explicitly approved.
NOTIFICATIONS_WORKER_ENABLED=false
```

`EMAIL_*` fields shown above and the token/phone ID/API version/template name are required by their respective provider. `PUBLIC_BASE_URL` should be the real HTTPS origin for receipt/download links; `SITE_URL` is a fallback. The Meta version must use the form `vNN.N`.

Optional/defaulted values: `ADMIN_NOTIFICATION_EMAIL` falls back to Site Settings contact email; template language defaults to `en`; default country code defaults to `91` in the current implementation. Use a suitable country code for your customers and prefer explicit E.164 numbers. `WHATSAPP_BUSINESS_ACCOUNT_ID` and `WHATSAPP_FROM_NUMBER` appear in the example file but are not consumed by the current send adapter; retain them as operational reference if useful.

## Gmail SMTP setup

1. Sign in to the Google account that will send mail. Open https://myaccount.google.com/security and enable **2-Step Verification**.
2. Open https://myaccount.google.com/apppasswords. Create an app password named `Garment Store SMTP`. Copy the generated 16-character password into the server's private `EMAIL_PASSWORD`, without display spaces. Use an app password, not the account login password. If App Passwords is unavailable, check account/organization restrictions; this adapter does not implement OAuth.
3. Set `EMAIL_HOST=smtp.gmail.com`, `EMAIL_PORT=587`, `EMAIL_SECURE=false`, `EMAIL_USER` to the full Gmail address, and `EMAIL_FROM` to that same address with the desired display name. Port 587 uses STARTTLS; this adapter requires TLS.
4. Set the optional owner address and HTTPS public origin. Keep `NOTIFICATIONS_WORKER_ENABLED=false`, then restart the application to load the environment.
5. Log in to Notification Settings and confirm SMTP configuration is present. This checks presence only and does not authenticate to Gmail or send a message.
6. After live sending is authorized, review queued/pending notifications before activation, select the desired email/event controls, set `NOTIFICATIONS_WORKER_ENABLED=true`, and restart. The worker runs immediately at startup and then once per minute. Verify one approved recipient in Notification Logs and the receiving inbox before broader use.

Google references: [App passwords](https://support.google.com/mail/answer/185833), [SMTP settings](https://support.google.com/a/answer/9003945).

## Meta WhatsApp Cloud API setup

1. In https://developers.facebook.com/apps/, create/select an app with the WhatsApp use case/product and connect your Meta business portfolio. Open its **WhatsApp → API Setup/Getting Started** panel. Labels can vary with the dashboard version.
2. In WhatsApp Manager, add the business sender number, verify ownership by SMS or voice, and complete its Cloud API registration/two-step-verification PIN setup. Complete display-name, billing and business-verification requirements presented for your account. Copy the **Phone Number ID**, not the displayed phone number, into `WHATSAPP_PHONE_NUMBER_ID`.
3. In Meta Business Settings → Users → System Users, create/select a system user. Assign the app and WhatsApp assets it needs. Generate a token for this app with `whatsapp_business_messaging`; grant `whatsapp_business_management` when managing templates/account assets. Choose the appropriate available expiry, store it privately as `WHATSAPP_ACCESS_TOKEN`, and plan renewal if expiring. Avoid using the short-lived dashboard test token for production.
4. Select a currently supported Graph API version shown for the app and set `WHATSAPP_API_VERSION` in `vNN.N` format. Do not copy the mocked test version as a claim of current support.
5. In WhatsApp Manager → Message templates, create `studio_service_update` in English, with positional parameters and a transaction/service-appropriate category. Use exactly six BODY text parameters in this order: customer name, reference, amount, status, next step/contact, receipt link or fallback text. The adapter supplies no header or button parameters. Suggested body:

   ```text
   Hello {{1}}, here is your service update.
   Reference: {{2}}
   Amount: {{3}}
   Status: {{4}}
   Next step: {{5}}
   Receipt or confirmation: {{6}}
   Thank you for choosing Garment Design Studio.
   ```

   Provide realistic sample values for all six placeholders and submit for approval. Approval is determined by Meta. Match `WHATSAPP_TEMPLATE_NAME` and `WHATSAPP_TEMPLATE_LANGUAGE` exactly to the approved template/language (for example `en`, or `en_US` if that is what you created).
6. Keep the worker disabled, restart, and check the admin readiness indicator. Only message customers who agreed to receive these updates, using valid E.164 numbers. Meta test numbers additionally restrict recipients to the approved test-recipient list.
7. After live sending is authorized and the template approved, review queued/pending items, enable WhatsApp and the desired event controls, then enable/restart the worker. Start with one approved recipient and inspect Notification Logs plus Meta delivery information. This application records the provider message ID; this pass did not add delivery-status webhook processing.

Meta's official references: [Cloud API collection and setup](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api), [Cloud API getting started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started). Meta's developer pages returned HTTP 429 during this review; the Meta-owned Postman documentation was accessible. Account-specific dashboard requirements still need to be completed in your Meta account.
