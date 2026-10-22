
require('../models/mongo/FeatureSettings').findById = () => ({
  lean: async () => null
});

// Isolated HTTP regression checks.
// No production data is written.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const express = require('express');
const session = require('express-session');
const { execFileSync } = require('node:child_process');

const appearance = require('../config/appearance');
const SiteSettings = require('../models/mongo/SiteSettings');

async function run() {
  const filesToCheck = [
    'server.js',
    'config/appearance.js',
    'models/mongo/SiteSettings.js',
    'services/siteSettingsService.js',
    'routes/adminAppearance.js',
    'public/js/admin-appearance.js',
    'scripts/testAppearance.js',
    'scripts/testAppearanceMongo.js'
  ];

  for (const file of filesToCheck) {
    execFileSync(
      process.execPath,
      ['--check', path.resolve(__dirname, '..', file)]
    );
  }

  let compiled = 0;

  function compileTemplates(dir) {
    for (const entry of fs.readdirSync(dir, {
      withFileTypes: true
    })) {
      const filename = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        compileTemplates(filename);
      } else if (entry.name.endsWith('.ejs')) {
        ejs.compile(
          fs.readFileSync(filename, 'utf8'),
          { filename }
        );
        compiled++;
      }
    }
  }

  compileTemplates(path.resolve(__dirname, '../views'));

  console.log(
    `PASS: modified JavaScript syntax and ${compiled} EJS templates compiled.`
  );

  // Test browser preview without a real browser.
  const elements = Object.fromEntries(
    Object.entries({
      ...appearance.defaults,
      ...appearance.content
    }).map(([key, value]) => [
      key,
      {
        name: key,
        value: String(value)
      }
    ])
  );

  const css = {};
  const listeners = {};

  const textNodes = Object.keys(
    appearance.content
  ).map(key => ({
    dataset: { preview: key }
  }));

  const pickers = Object.keys(
    appearance.colors
  ).map(key => ({
    dataset: { colorFor: key },
    addEventListener(event, handler) {
      this.handle = handler;
    }
  }));

  const form = {
    elements,
    querySelectorAll: () => pickers,
    addEventListener(name, handler) {
      listeners[name] = handler;
    }
  };

  const preview = {
    style: {
      setProperty(key, value) {
        css[key] = value;
      }
    },
    querySelectorAll: () => textNodes
  };

  let reset;

  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../public/js/admin-appearance.js'
      ),
      'utf8'
    ),
    {
      document: {
        getElementById(id) {
          if (id === 'appearance-form') return form;
          if (id === 'theme-preview') return preview;

          return {
            addEventListener(name, handler) {
              reset = handler;
            }
          };
        }
      },
      window: {
        confirm: () => false
      }
    }
  );

  elements.primary_color.value = '#112233';
  listeners.input();

  assert.equal(css['--primary-color'], '#112233');

  elements.primary_color.value = 'red; display:none';
  listeners.input();

  assert.equal(css['--primary-color'], '#112233');

  elements.main_font.value = 'Georgia';
  listeners.change();

  assert.equal(
    css['--main-font'],
    appearance.fonts.Georgia
  );

  elements.store_name.value = '<b>Text only</b>';
  listeners.input();

  assert.equal(
    textNodes.find(
      node => node.dataset.preview === 'store_name'
    ).textContent,
    '<b>Text only</b>'
  );

  let prevented = false;

  reset({
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);

  console.log(
    'PASS: live preview color/font updates, invalid color isolation, plain text rendering and reset confirmation.'
  );

  // Mock MongoDB operations in memory.
  const originalFind = SiteSettings.findOne;
  const originalUpdate = SiteSettings.findOneAndUpdate;

  let stored = {
    ...appearance.defaults,
    ...appearance.content,
    key: 'default',
    address: 'Keep this business address'
  };

  SiteSettings.findOne = () => ({
    lean: async () => ({ ...stored })
  });

  SiteSettings.findOneAndUpdate = async (
    filter,
    update,
    options
  ) => {
    assert.deepEqual(filter, { key: 'default' });
    assert.equal(options.runValidators, true);
    assert.equal(options.upsert, true);

    const next = {
      ...stored,
      ...update.$set
    };

    await new SiteSettings(next).validate();

    stored = next;
    return next;
  };

  process.env.ADMIN_USERNAME = 'appearance-test-owner';
  process.env.ADMIN_PASSWORD = 'appearance-test-password';

  const app = express();

  app.locals.adminNavigation =
    require('../config/adminNavigation');

  app.set('view engine', 'ejs');

  app.set(
    'views',
    path.resolve(__dirname, '../views')
  );

  app.use(express.urlencoded({
    extended: true
  }));

  app.use(session({
    secret: 'isolated-appearance-test-session',
    resave: false,
    saveUninitialized: false
  }));

  app.use((req, res, next) => {
    res.locals.siteSettings =
      appearance.normalize(stored);

    res.locals.themeVariables =
      appearance.cssVariables(stored);

    next();
  });

  app.use(
    '/admin/settings/appearance',
    require('../routes/adminAppearance')
  );

  app.use('/admin', require('../routes/admin'));

  const server = app.listen(0, '127.0.0.1');

  await new Promise(resolve => {
    server.once('listening', resolve);
  });

  const origin =
    `http://127.0.0.1:${server.address().port}`;

  let cookie = '';

  async function request(
    url,
    body,
    authenticated = true
  ) {
    const response = await fetch(origin + url, {
      redirect: 'manual',
      method: body ? 'POST' : 'GET',
      headers: {
        ...(authenticated && cookie
          ? { Cookie: cookie }
          : {}),
        ...(body
          ? {
              'Content-Type':
                'application/x-www-form-urlencoded'
            }
          : {})
      },
      ...(body
        ? { body: new URLSearchParams(body) }
        : {})
    });

    const setCookie =
      response.headers.get('set-cookie');

    if (setCookie) {
      cookie = setCookie.split(';')[0];
    }

    return {
      status: response.status,
      location: response.headers.get('location'),
      html: await response.text()
    };
  }

  try {
    assert.equal(
      (
        await request(
          '/admin/settings/appearance',
          null,
          false
        )
      ).location,
      '/admin/login'
    );

    assert.equal(
      (
        await request(
          '/admin/settings/appearance',
          { primary_color: '#000000' },
          false
        )
      ).location,
      '/admin/login'
    );

    assert.equal(
      (
        await request('/admin/login', {
          username: 'wrong',
          password: 'wrong'
        })
      ).status,
      401
    );

    assert.equal(
      (
        await request('/admin/login', {
          username: process.env.ADMIN_USERNAME,
          password: process.env.ADMIN_PASSWORD
        })
      ).location,
      '/admin'
    );

    let response = await request(
      '/admin/settings/appearance'
    );

    assert.equal(response.status, 200);

    assert.ok(
      !response.html.includes(
        '/css/storefront-theme.css'
      )
    );

    const token = response.html.match(
      /name="_csrf" value="([a-f0-9]+)"/
    )[1];

    assert.equal(
      (
        await request(
          '/admin/settings/appearance',
          {}
        )
      ).status,
      403
    );

    const payload = {
      ...stored,
      primary_color: '#123456',
      button_color: '#234567',
      cart_heading: 'Your selected patterns',
      store_name: 'Test & Tailor',
      _csrf: token
    };

    assert.equal(
      (
        await request(
          '/admin/settings/appearance',
          payload
        )
      ).location,
      '/admin/settings/appearance?status=saved'
    );

    assert.equal(
      stored.primary_color,
      '#123456'
    );

    assert.ok(
      (
        await request(
          '/admin/settings/appearance'
        )
      ).html.includes('value="#123456"')
    );

    // Header/footer CMS uses the existing schema, partial-save route and escaped templates.
    const customLabels = Object.fromEntries(Object.keys(appearance.headerFooter)
      .map(key => [key, key + ' & Custom']));
    for (const key of Object.keys(customLabels)) {
      assert.ok(SiteSettings.schema.path(key), key);
      assert.ok(response.html.includes('name="' + key + '"'), key);
      assert.equal(appearance.valid(key, '   '), false, key);
      assert.equal(appearance.valid(key, '<script>'), false, key);
      assert.equal(appearance.normalize({})[key], appearance.headerFooter[key], key);
    }
    assert.equal((await request('/admin/settings/appearance', {
      ...customLabels, _csrf: token
    })).location, '/admin/settings/appearance?status=saved');
    assert.equal(stored.store_name, 'Test & Tailor');
    const readback = await request('/admin/settings/appearance');
    for (const [key, value] of Object.entries(customLabels)) {
      assert.equal(stored[key], value);
      assert.ok(readback.html.includes(value.replace('&', '&amp;')), key);
    }
    for (const signedIn of [false, true]) {
      for (const section of ['header', 'footer']) {
        const html = await ejs.renderFile(path.resolve(__dirname, '../views/partials', section + '.ejs'), {
          siteSettings: appearance.normalize(stored),
          canVisit: () => true, visibleLinks: links => links, featureEnabled: () => false,
          customerSignedIn: signedIn, customerCsrf: 'test-csrf'
        });
        for (const [key, value] of Object.entries(customLabels)) {
          if (!key.startsWith(section + '_')) continue;
          const accountKeys = ['header_account_label', 'header_my_account_label', 'header_orders_label', 'header_logout_label'];
          const guestKeys = ['header_sign_in_label', 'header_register_label'];
          if ((!signedIn && accountKeys.includes(key)) || (signedIn && guestKeys.includes(key))) continue;
          assert.ok(html.includes(value.replace('&', '&amp;')), key);
        }
      }
    }

    const invalidInputs = {
      primary_color:
        '#fff;}</style><script>alert(1)</script>',
      main_font: 'evil; color:red',
      button_style: 'unknown',
      logo_url: 'javascript:alert(1)',
      favicon_url: 'data:image/svg+xml,test',
      store_name: '<script>alert(1)</script>',
      base_font_size: '999'
    };

    for (const [key, value] of Object.entries(
      invalidInputs
    )) {
      assert.equal(
        (
          await request(
            '/admin/settings/appearance',
            {
              ...payload,
              [key]: value
            }
          )
        ).status,
        400,
        key
      );

      assert.equal(
        stored.primary_color,
        '#123456'
      );
    }

    assert.equal(
      (
        await request(
          '/admin/settings/appearance/reset',
          { _csrf: token }
        )
      ).status,
      400
    );

    // Sample product used only in tests.
    const product = {
      _id: '000000000000000000000001',
      name: 'Test pattern',
      slug: 'test-pattern',
      images: [],
      base_price: 500,
      description: 'Pattern description',
      physical_price: 100,
      trial_price: 200
    };

    // Important: supply all known test page variables.
    // These are fixture values, not production data.
    const locals = {
      adminNavigation:
        require('../config/adminNavigation'),

      ...require('../config/features').helpers(),

      title: 'Appearance test',

      seoTitle: 'Appearance test',
      description: 'Test description',
      canonicalUrl: '',
      ogImage: '',
      productStructuredData: null,

      category: '',
      categories: ['shirts', 'pants', 'shorts'],

      siteSettings: appearance.normalize(stored),
      themeVariables: appearance.cssVariables(stored),

      product,
      optionAvailability: require('../services/patternOptions').availability(product),
      products: [product],

      files: [],
      addons: [],

      upcomingClasses: [],
      courses: [],
      webinars: [],
      articles: [],
      books: [],

      cart: [],
      customer: {},
      summary: {},

      order: null,
      orderId: 'test-order',
      message: 'Test message'
    };

    let rendered = 0;

    const templates = [
      'home',
      'products',
      'product',
      'cart',
      'checkout',
      'payment_method',
      'checkout_success',
      'checkout_cancel',
      'about',
      'contact',
      'login',
      'patterns',
      'error'
    ];

    for (const name of templates) {
      const html = await ejs.renderFile(
        path.resolve(
          __dirname,
          '../views',
          name + '.ejs'
        ),
        locals
      );

      assert.ok(
        html.includes('--primary-color:#123456'),
        name
      );

      assert.ok(
        html.includes('/css/storefront-theme.css'),
        name
      );

      for (const match of html.matchAll(
        /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g
      )) {
        if (match[0].includes('type="application/json"') || match[0].includes("type='application/json'") || match[0].includes('type="application/ld+json"') || match[0].includes("type='application/ld+json'")) {
          JSON.parse(match[1]);
          continue;
        }
        if (match[1].trim()) {
          new vm.Script(match[1], {
            filename: name + '-inline.js'
          });
        }
      }

      if (name === 'payment_method') {
        assert.ok(
          html.includes(
            'https://checkout.razorpay.com/v1/checkout.js'
          )
        );

        assert.ok(
          html.includes(
            '/checkout/razorpay-callback'
          )
        );

        assert.ok(
          html.includes('razorpay_signature')
        );

        // Simulate payment SDK without real payment.
        let click;
        let sdkOptions;
        let submitted;

        const button = {
          addEventListener(event, handler) {
            click = handler;
          }
        };

        const message = {};

        const document = {
          getElementById(id) {
            return id === 'pay-button'
              ? button
              : message;
          },

          createElement() {
            return {
              children: [],

              appendChild(child) {
                this.children.push(child);
              },

              submit() {
                submitted = this;
              }
            };
          },

          body: {
            appendChild() {}
          }
        };

        const script = [
          ...html.matchAll(
            /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g
          )
        ]
          .map(match => match[1])
          .find(text => text.includes('new Razorpay'));

        const context = {
          document,

          fetch: async (url, options) => {
            assert.equal(
              url,
              '/checkout/payment-method/proceed'
            );

            assert.equal(
              options.method,
              'POST'
            );

            return {
              ok: true,
              json: async () => ({
                key_id: 'test-key',
                amount: 50000,
                razorpay_order_id: 'order_test'
              })
            };
          },

          Razorpay: function(options) {
            sdkOptions = options;
            this.on = () => {};
            this.open = () => {};
          }
        };

        vm.runInNewContext(script, context);

        await click.call(button);

        assert.equal(
          sdkOptions.order_id,
          'order_test'
        );

        sdkOptions.handler({
          razorpay_order_id: 'order_test',
          razorpay_payment_id: 'pay_test',
          razorpay_signature: 'test-signature'
        });

        assert.equal(
          submitted.action,
          '/checkout/razorpay-callback'
        );

        assert.deepEqual(
          submitted.children.map(input => input.name),
          [
            'razorpay_order_id',
            'razorpay_payment_id',
            'razorpay_signature'
          ]
        );
      }

      rendered++;
    }

    const populatedCart = [{
      product_id: product._id,
      name: product.name,
      price: 500,
      quantity: 1,
      files: [],
      addons: [],
      physical_quantity: 0,
      trial_quantity: 0
    }];

    await ejs.renderFile(
      path.resolve(
        __dirname,
        '../views/cart.ejs'
      ),
      {
        ...locals,
        cart: populatedCart
      }
    );

    await ejs.renderFile(
      path.resolve(
        __dirname,
        '../views/checkout.ejs'
      ),
      {
        ...locals,
        cart: populatedCart
      }
    );

    assert.equal(
      (
        await request(
          '/admin/settings/appearance/reset',
          {
            _csrf: token,
            confirm_reset: 'yes'
          }
        )
      ).location,
      '/admin/settings/appearance?status=reset'
    );

    for (const key of Object.keys(
      appearance.defaults
    )) {
      assert.equal(
        stored[key],
        appearance.defaults[key]
      );
    }

    assert.equal(
      stored.store_name,
      'Test & Tailor'
    );

    assert.equal(
      stored.cart_heading,
      'Your selected patterns'
    );

    for (const [key, value] of Object.entries(customLabels)) {
      assert.equal(stored[key], value, 'Theme reset preserves ' + key);
    }

    assert.equal(
      stored.address,
      'Keep this business address'
    );

    const normalized = appearance.normalize({
      main_font: '</style><script>',
      primary_color: 'red',
      logo_url: 'javascript:alert(1)'
    });

    assert.equal(
      normalized.main_font,
      appearance.defaults.main_font
    );

    assert.equal(normalized.logo_url, '');

    console.log(
      `PASS: admin login/auth, appearance page, CSRF, save/readback, invalid inputs, reset isolation; ${rendered} customer templates and inline JS; populated cart/checkout; simulated Razorpay SDK handoff/callback.`
    );

    console.log(
      'Persistence adapter: isolated in-memory model. Run a MongoDB smoke test separately for real persistence.'
    );

  } finally {
    SiteSettings.findOne = originalFind;
    SiteSettings.findOneAndUpdate = originalUpdate;

    await new Promise(resolve => {
      server.close(resolve);
    });

    await require('../config/db').db.destroy();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
