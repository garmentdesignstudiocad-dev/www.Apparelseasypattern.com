# Consulting form and payment retry fix

## Cause and scope

The exact “This form has expired. Reload the page and try again.” response came from `middleware/learningForms.js`, before the consulting POST handler or Razorpay. It compared the submitted CSRF value with a single mutable token in the session. A form retained across session expiry/restart or stale session state could only reach a plain 403 response.

Separately, consulting and direct books shared one `accessNonce`. GET requests reused it, validation errors reused it, and a successful submission in either flow replaced it for every outstanding form. Refresh/back/multiple-tab flows could therefore carry stale submission state. `/consulting/:slug` also had no route.

These source-level failure paths were reproduced with stale tokens and multiple forms in isolated HTTP tests. The user's original browser session was not available for inspection. A read-only probe of the already-running `localhost:3000` returned HTTP 500 for the consulting pages and 404 for the missing detail route at that time; this is distinct from the reported CSRF rejection.

## Token and session behavior

- Every form render issues a fresh HMAC-authenticated CSRF token and a fresh submission token.
- CSRF tokens are bound to the current signed session ID and expire after one hour. Independently issued tokens remain valid for their lifetime so opening another tab does not invalidate an existing form or payment request.
- Submission tokens additionally bind to the item and access type. They cannot be transferred to another service or browser session.
- CSRF checks remain mandatory. A stale consulting/book form POST returns 403, creates nothing, and renders a fresh form with the submitted customer values preserved. A stale submission token similarly returns 409 with a fresh form.
- Input validation failures return 400 with preserved values and newly issued tokens.
- Forms use `Cache-Control: no-store`, an explicit POST action, and save the session before rendering or redirecting.
- Session cookies, SameSite/HttpOnly settings, server-side prices and Razorpay signature/captured-payment checks remain intact. No secrets were exposed and no page redesign was made.

## Consumption, retries and duplicate safety

Successful booking insertion durably consumes the submission key. Its unique MongoDB index handles simultaneous clicks. Replaying the same valid submission returns the existing reference; it never creates a second booking.

A second unique, server-derived `request_key` binds the session, item and validated details. Submitting a freshly rendered form with identical details resumes the existing booking and its original price instead of creating another booking. A `session_owner` binding also preserves ownership checks if concurrent session saves lose an entry from the browser's reference list. Legacy session-owned records remain accessible.

CSRF tokens are intentionally reusable within their session/lifetime; submission keys are the one-time booking guard. Payment retry operates on the existing booking and requires no second customer registration.

The existing gateway service remains authoritative: a definite order-creation rejection unlocks that booking for retry, an existing gateway order is reused, and an ambiguous network failure stays locked for safe recovery/owner review rather than issuing another order. Expired or replaced browser sessions do not bypass ownership checks.

The new request-key indexes are partial indexes, so existing records without these fields do not need a backfill.

## Routes and tests

Run `npm run test:consulting-forms` for the isolated MongoDB/HTTP suite. It runs the normal paid-access regressions plus consulting-specific tests and executes the real payment browser script with a mocked Razorpay popup/provider.

Paths exercised:

- `/consulting`
- `/consulting/cad-pattern-support` → redirects to its access form
- `/consulting/cad-pattern-support/access`
- `/consulting/fit-consultation/access` (cross-service token rejection)
- `/consultation-bookings/:id`
- `/consultation-bookings/:id/check`
- `/consultation-bookings/:id/order`
- `/consultation-bookings/:id/verify`
- `/courses/access-course` and its booking/payment flow
- `/webinars/access-webinar`, `/webinars/free-webinar` and registration/payment flows
- `/books/digital-book/access` and the direct-book payment flow

Assertions cover fresh tokens on refresh/error, preserved values, stale-CSRF rejection without writes, session/service binding, outstanding tabs, concurrent submissions, pending-reference reuse, a rejected gateway order followed by retry, a single gateway order across popup dismissal/retry, popup opening and verified confirmation. Tests use temporary records and random local ports; no live booking or charge is made.

After restarting the application to load the changes, the requested local entry URLs are:

- http://localhost:3000/consulting
- http://localhost:3000/consulting/cad-pattern-support
- http://localhost:3000/consulting/cad-pattern-support/access

Additional regressions: `npm run test:learning` and `npm run test:business`.

## Files changed for this fix

- `middleware/learningForms.js`
- `services/sessionFormTokens.js` (new)
- `routes/paidAccess.js`
- `models/mongo/BookPurchase.js`
- `models/mongo/ConsultationBooking.js`
- `views/learning/access-form.ejs`
- `scripts/testConsultingForms.js` (new)
- `scripts/consultingFormAssertions.js` (new)
- `scripts/testPaidAccess.js`
- `package.json`
- `CONSULTING_FORM_FIX.md` (this report)
