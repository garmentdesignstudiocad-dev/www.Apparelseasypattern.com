> 2026-10-01 override: New orders use configured pincode ? region ? dispatch ? delivery partner routing, with no delivery price or separate courier payment. Older fee descriptions below are historical. See SHIPPING_AND_DIGITAL_DELIVERY.md for current configuration.

> Product payment/delivery rules updated on 2026-10-01. See SHIPPING_AND_DIGITAL_DELIVERY.md and COMMERCE_IMPLEMENTATION_REPORT.md for current 18% GST, courier exclusion, APP_BASE_URL and tests. Older tax/delivery statements below describe the earlier implementation.

# Pattern sales and online class enquiry launch

## Current status

The existing cart, server-calculated prices, GST, Razorpay verification, admin control center, feature visibility and appearance systems are preserved. Tests use temporary MongoDB collections and a mocked gateway; no live charge is made.

The requested contact details have been saved in the live `SiteSettings` document:

- Email: garmentdesignstudiocad@gmail.com
- Call / WhatsApp: +91 9791753067
- CTA: “DM for technical support / sampling support / fit optimization.”

Owner edits are available under `/admin/settings/website`. Shared contact rendering provides email, WhatsApp and call links on the footer, contact, product and class enquiry pages. Consulting-specific support wording follows the Consulting visibility switch.

## Basic Shirt Pattern

No Basic Shirt Pattern record existed when checked. An **inactive draft** was created at slug `basic-shirt-pattern`, with an original SVG technical illustration, description and SEO copy. The illustration is not a cutting pattern or a specification of the final product.

Edit this actual draft at `/admin/products/6ab949d9fdf4c0ac256529cd/edit`, also reachable through `/admin` → Products / Patterns. Its fields include size information, file formats, delivery information, download/fulfilment instructions, images, description, prices, SEO title/description, Amazon URL and Active.

As requested, missing commercial details were left for the owner. Before activation, confirm prices (the draft's model defaults are zero), actual sizes, formats, pattern files, fulfilment instructions and the image. No downloadable garment file was invented. Product file options still use the existing file-management page. The preserved purchase flow confirms paid orders; fulfilment must follow the configured instructions and available assets.

The draft public route correctly returns 404 until activated. In isolated tests, a separate Basic Shirt Pattern fixture is activated with test-only values to verify the product page, digital checkout and physical checkout. Existing production product values are never changed by tests or overwritten by the setup script.

`node scripts/prepareLaunch.js` is an idempotent setup command: it creates a missing draft and applies the contact migration once. Re-running it preserves the existing product and subsequent owner contact edits.

## Delivery

Configure `/admin/settings/delivery`:

1. Enable or disable delivery charges.
2. Set the fallback charge.
3. Optionally enable a free-delivery threshold on the product total **before GST**, including selected options.
4. Add an exact six-digit pincode or prefix such as `600*`.

Matching priority is exact pincode → longest active prefix → default. Digital-only orders always have zero delivery. Physical patterns and trial samples use the matching charge. Disabling charges or meeting the enabled threshold makes delivery free. The checkout displays the calculation; the server recalculates authoritative delivery and GST before creating an order. Failed settings reads do not silently choose a zero charge.

Existing physical/trial option pricing semantics and GST rules were preserved.

## Free online class enquiries

`/classes` now leads with “Online Classes Available” and “Enquire for Online Classes”. `/classes/enquiry` collects full name, WhatsApp, email, location, interested course, experience, preferred timing and message. Validation errors preserve values. Session CSRF and throttling protect submission; no order or gateway request is made.

MongoDB `Lead` stores the enquiry with interest `Online Classes`, an `interested_course` field, and status `New`. `/admin` → Online Class Enquiries opens the filtered list. Search includes course names; the course filter matches the entered course name. Owners can set New, Contacted, Interested, Converted or Closed. Existing paid class/course registrations remain available as separate flows.

The form and its links respect both Online Classes and Leads visibility. Courses may be OFF while the independent Online Classes enquiry flow remains ON.

## SEO and Google indexing

Product-specific SEO fields are edited with the product. Website Settings and Appearance expose SEO titles/descriptions for products, courses, online classes and contact. Important pages have a single H1, descriptive sections, natural internal links, descriptions, canonical URLs and Open Graph metadata. Product JSON-LD is emitted only for an active product with an image, description and positive configured base price; no reviews or stock claims are fabricated. Organization JSON-LD uses stored business contact details.

`SITE_URL` must be the permanent public origin. **No valid permanent SITE_URL was configured during this update.** Until supplied, canonical/organization URLs are omitted, `robots.txt` disallows crawling and `sitemap.xml` returns 503 with a configuration message. Temporary `*.trycloudflare.com` values are rejected. `.env` was not modified; `.env.launch.example` shows the setting.

Once configured and deployed, check `/robots.txt` and `/sitemap.xml`, verify the permanent domain in Google Search Console and submit its sitemap. Sitemaps include active, visible catalogs and details, excluding admin, payment confirmation and private receipt routes. Toggling a feature OFF removes its sitemap entries immediately. The current sitemap supports up to 4,000 entries per catalog; expand to paginated sitemap indexes before exceeding that limit.

References used: [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [Google ecommerce site structure](https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure). Indexing and ranking are not guaranteed by adding SEO tags.

## Keyword planning and Amazon

Exactly 1,000 unique ideas in 20 clusters are stored in `data/seo-keywords.json`, with intent, suggested page and planning status. `/admin/seo` provides search and cluster filtering; `/admin/seo/keywords.csv` exports them. This resource is admin-only and is not inserted into customer meta tags or page content. Ideas are not measured search demand; city phrases are research candidates, not claims of offices in those cities.

The optional `amazon_listing_url` field accepts HTTPS Amazon listing URLs. A configured value displays “Buy on Amazon” on the product page as a separate external physical-pattern purchase. No Amazon API, account connection, listing creation or assumption of digital-product eligibility was added.

## Verification and exact URLs

Commands: `npm.cmd run test:launch`, `npm.cmd run test:features`, `npm.cmd run test:public-visibility`, `npm.cmd run test:business`, `npm.cmd run test:appearance`.

Automated checks cover Basic Shirt Pattern draft preservation/public page, digital/physical checkout, GST 18%/5%/disabled, mocked Razorpay order/capture verification and duplicate callbacks, enquiry validation/CSRF/storage/admin status, contacts, Amazon URL validation, SEO and JSON-LD, pincode/prefix/default/threshold rules, 1,000 unique keywords and sitemap OFF/ON behavior. Only the explicit setup command writes requested launch data to the real database.

Local URLs after starting the app:

- `http://localhost:3000/admin`
- `http://localhost:3000/admin/products/6ab949d9fdf4c0ac256529cd/edit`
- `http://localhost:3000/products`
- `http://localhost:3000/product/basic-shirt-pattern` — 404 until the draft is activated
- `http://localhost:3000/cart`
- `http://localhost:3000/checkout`
- `http://localhost:3000/checkout/payment-method`
- `http://localhost:3000/checkout/success` — confirmation requires the purchasing session
- `http://localhost:3000/classes`
- `http://localhost:3000/classes/enquiry`
- `http://localhost:3000/classes/enquiry/thank-you` — after successful submission
- `http://localhost:3000/admin/leads?interest=Online%20Classes`
- `http://localhost:3000/courses`
- `http://localhost:3000/contact`
- `http://localhost:3000/admin/settings/delivery`
- `http://localhost:3000/admin/settings/website`
- `http://localhost:3000/admin/settings/features`
- `http://localhost:3000/admin/seo`
- `http://localhost:3000/robots.txt`
- `http://localhost:3000/sitemap.xml` — requires permanent SITE_URL

Leave Patterns and Online Classes ON for launch; other sections remain owner-controlled. No feature data is removed or deactivated by the visibility switches.
