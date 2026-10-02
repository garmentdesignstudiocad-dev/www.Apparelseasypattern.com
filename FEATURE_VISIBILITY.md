# Feature Visibility

Owner URL: `/admin/settings/features` (Admin → Feature Visibility).

`models/mongo/FeatureSettings.js` stores a singleton `_id: "default"` with boolean fields:

- `patterns_enabled`, `online_classes_enabled`, `courses_enabled`
- `webinars_enabled`, `books_enabled`, `consulting_enabled`, `updates_enabled`
- `leads_enabled`, `paid_access_enabled`, `linkedin_enabled`
- `homepage_services_enabled`, `homepage_catalogs_enabled`

All default to true, including when a previously saved document lacks a newly added field. No launch settings are hardcoded off. Existing product, class, book, article, service, registration and payment records are not modified by these switches.

`config/features.js` defines the switches and shared URL policy. `services/featureSettingsService.js` reads MongoDB on each request, so saves also take effect across server processes without a restart. Read failures do not silently enable disabled sections. `middleware/features.js` publishes `featureSettings`, `featureEnabled` and `canVisit` to EJS and guards public routes. Admin routes are exempt; saving requires admin authentication and valid session CSRF.

Disabled section routes (including subroutes and POSTs) return the same 404 page. Patterns includes cart and checkout; Online Classes controls legacy `/classes` and `/my-courses`; Courses controls `/courses`, training pages and course bookings. Paid Access hides new direct book/consulting access, course/webinar registration forms and new order creation. It does not change fees or turn paid items free. Existing confirmation, verification and receipt endpoints remain usable when their parent section is enabled. Signed product gateway callbacks and protected receipts remain available to settle/retrieve existing payments. Existing Paid Access Settings catalog-active flags still apply independently.

Templates updated: shared header, footer, business cards, learning cards, business CTA and enquiry form; homepage; business detail/list pages; learning detail/index/confirmation pages; public store, cart, checkout, class and account pages with cross-section links. Admin sidebar links to the new page; admin content lists are never filtered by visibility. Footer LinkedIn also respects the existing website setting. Homepage service and catalog switches hide those groups independently of their public routes.

## Verification

Run `npm.cmd run test:features`. This uses unique temporary MongoDB collections, removes only those collections afterward, and mocks Razorpay. Owner settings and real customer records are untouched.

Automated checks log in, open the settings page, reject invalid CSRF, save OFF, read booleans back from MongoDB, check public 404 and hidden homepage links, verify admin lists remain accessible and documents unchanged, save ON, and check pages/links return without restarting:

| Feature | Public URLs | Admin URL |
| --- | --- | --- |
| Books | `/books`, `/books/digital-book` | `/admin/books` |
| Webinars | `/webinars`, `/webinars/access-webinar` | `/admin/webinars` |
| Consulting | `/consulting`, `/consulting/fit-consultation/access` | `/admin/consulting` |
| Updates | `/updates`, `/updates/feature-test` | `/admin/articles` |

Other checks cover `/`, `/products`, `/patterns`, `/product/example` (OFF), `/cart`, `/checkout`, `/classes`, `/my-courses`, `/courses`, `/garment-technology`, `/contact`, POST `/enquiries`, `/books/digital-book/access`, `/courses/access-course/book`, `/webinars/access-webinar/register`, and a generated `/book-purchases/:id/order`. Patterns and Online Classes stay available while the other four sections are switched off. Case variants and encoded URL policy are checked. Direct database updates are observed on the next request. Existing paid confirmation survives the Paid Access switch.

Manual owner check: log in → Feature Visibility → turn Books OFF → Save → refresh `/` and `/books` → verify `/admin/books` still opens → turn Books ON → Save → refresh. Repeat for Webinars, Consulting and Updates. Keep Ready-to-Use Patterns and Online Classes ON for launch. Switch Footer LinkedIn OFF/ON and refresh the homepage footer. Toggle the two homepage groups independently. No application restart is needed for settings changes after this code is deployed.

## Complete public visibility follow-up

Closed remaining discovery gaps: hidden features no longer appear in enquiry interest options or same-origin class promotions, empty Ordering/CTA/service groups disappear, hidden card partials render no empty-state content, and hidden legacy-class related links leave no separator behind. The shared helper supplies filtered link lists for desktop/mobile navigation, footer and CTAs. Same-origin absolute promotional links follow the same policy as relative public routes. Stale enquiry submissions selecting a now-disabled service are rejected without saving a lead.

Templates changed in this follow-up: `partials/header`, `partials/footer`, `partials/business-cta`, `partials/lead-form`, `partials/business-cards`, `partials/learning-cards`, `home`, `learning/index`, `classes/detail`. Contact-page introductory copy no longer advertises specific disabled sections.

Passed `node scripts/testPublicVisibility.js`, `node scripts/testFeatures.js`, `node scripts/testBusiness.js`, and `node scripts/testAppearance.js`. Public visibility tests cover shared desktop/mobile navigation markup and execute the real mobile open/close handler; these are automated rendering/handler checks, not visual browser screenshots.

Expanded MongoDB tests individually save OFF then ON for Patterns, Online Classes, Courses, Webinars, Books, Consulting and Updates. For each, the public index and detail routes return 404 while OFF and 200 after ON; admin lists remain 200 and content documents are identical before/after. Exact additional index/detail/admin URLs:

- `/products`, `/product/feature-pattern`, `/admin/products`
- `/classes`, `/classes/feature-class`, `/admin/classes`
- `/courses`, `/courses/access-course`, `/admin/courses`

The Books, Webinars, Consulting and Updates URLs are listed in the table above. Each OFF case also checks discovery links on `/`, `/contact`, `/about`, `/login`, and `/classes/feature-class` when Online Classes is enabled. Patterns and classes are expected to remain 200 when a different section is switched off. Footer, homepage and CTA partials are rendered for every OFF/ON combination. All OFF/ON changes take effect in the same running test server; no restarts or owner-data changes are used.
