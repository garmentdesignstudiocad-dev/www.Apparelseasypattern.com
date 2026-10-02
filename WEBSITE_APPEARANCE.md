# Website Appearance

Open **Admin → Website Appearance** at `/admin/settings/appearance`.

Choose colors with the picker or a six-digit hex value, select fonts and styles, and edit branding or basic text. The sample preview changes immediately. Click **Save Website Appearance** to publish, then refresh the storefront. Wix remains the main marketing website; enter its URL in **Main Website URL**.

To try a color change, set **Button Color** to `#2563EB`, save, and open `/products`, a product detail, `/cart`, and `/checkout`. Add a product to the cart to reach checkout. Check the buttons, header, footer, fonts and page background. Save your preferred colors afterward.

To restore the default look, check the confirmation under **Reset to Default Theme**, press its button, and accept the confirmation dialog. Only colors, typography, button/card styles and density reset. Branding, text, products, customers, orders and payments are retained.

## Files modified

- `package.json` — repeatable appearance test commands.
- `server.js` — global validated CSS variables and protected appearance router.
- `models/mongo/SiteSettings.js` — defaults and schema validation.
- `services/siteSettingsService.js` — normalize saved settings and legacy/missing fields.
- `views/partials/admin_header.ejs` — Website Appearance navigation entry.
- `views/partials/header.ejs`, `views/partials/footer.ejs` — configurable Wix label and WhatsApp support link.
- `views/home.ejs`, `views/products.ejs` — configurable headings, descriptions and collection button label.
- `views/product.ejs`, `views/cart.ejs` — shared branding/header/footer and theme integration; configurable cart heading.
- `views/checkout.ejs` — theme and checkout heading.
- `views/payment_method.ejs`, `views/checkout_success.ejs`, `views/checkout_cancel.ejs` — theme integration; configurable Wix return label on success; shared branding on cancellation.
- `views/contact.ejs` — configured contact information and theme.
- `views/about.ejs`, `views/login.ejs`, `views/patterns.ejs`, `views/error.ejs` — shared theme include.
- `views/classes/index.ejs`, `views/classes/detail.ejs`, `views/classes/my_courses.ejs`, `views/classes/confirmation.ejs` — shared theme include.

## Files created

- `config/appearance.js` — defaults, font/style allowlists, input validation and safe CSS variable generation.
- `routes/adminAppearance.js` — authenticated settings form, save and reset, with session CSRF protection.
- `views/admin/appearance.ejs` — owner settings page.
- `views/partials/theme.ejs` — customer-only CSS variables, favicon and selected web font loading.
- `public/css/storefront-theme.css` — storefront theme layer.
- `public/css/admin-appearance.css` — settings form and isolated preview styling.
- `public/js/admin-appearance.js` — live preview and reset confirmation.
- `scripts/testAppearance.js` — isolated HTTP, validation, template, preview and simulated payment tests.
- `scripts/testAppearanceMongo.js` — real MongoDB persistence test using a unique temporary record.
- `WEBSITE_APPEARANCE.md` — this guide and implementation report.

## MongoDB

The existing `SiteSettings` model and `key: 'default'` document are reused. No new collection or migration is required. Existing documents receive safe defaults when read; saving persists the new fields.

New fields:

- Colors: `primary_color`, `secondary_color`, `accent_color`, `background_color`, `header_background_color`, `header_text_color`, `button_color`, `button_text_color`, `footer_background_color`, `footer_text_color`.
- Typography: `main_font`, `heading_font`, `base_font_size`, `heading_style`.
- Styles: `button_style`, `card_style`, `layout_density`.
- Content: `favicon_url`, `products_heading`, `products_description`, `cart_heading`, `checkout_heading`, `back_website_label`, `view_products_label`.

Existing branding, contact, address, footer, homepage heading and homepage subheading fields are reused. The older `/admin/settings/website` endpoint remains available for compatibility.

Only predefined fonts/styles and six-digit hex colors reach CSS. Plain business text is escaped by EJS. HTTP/HTTPS URLs are checked; script/data URLs and embedded credentials are rejected. The admin shell does not load the storefront theme. Preview styles are scoped to its sample box. Poppins and Inter load from Google Fonts, with local fallback fonts if unavailable.

## Verification

- `npm run test:appearance`: passes modified JavaScript syntax checks, compiles all 39 EJS templates, renders the main customer pages and populated cart/checkout, and checks admin login, authorization, CSRF, save/readback, invalid input rejection, appearance-only reset, live preview behavior and simulated Razorpay SDK handoff/callback.
- `npm run test:appearance:mongo`: passed against the configured MongoDB connection. Checks persisted save/readback, schema rejection and reset preservation. The temporary record was removed; live settings were unchanged.
- Payment/order, cart, GST, delivery and customer controllers/routes were not changed. No real payment was made.
- Browser visual and mobile interaction checks could not run because no browser was available in this session. Existing responsive layouts and breakpoints are retained, with responsive settings controls. Check at desktop and approximately 390px width before deployment, including mobile navigation, populated cart/checkout, and a Razorpay test-mode payment.
