
const colors = {
  primary_color: '#0B192C',
  secondary_color: '#1E3E62',
  accent_color: '#D97706',
  background_color: '#F8FAFC',
  header_background_color: '#FFFFFF',
  header_text_color: '#0F172A',
  button_color: '#0B192C',
  button_text_color: '#FFFFFF',
  footer_background_color: '#0B192C',
  footer_text_color: '#F1F5F9',
};

const fonts = {
  'DM Sans': '"DM Sans",Arial,sans-serif',
  'Playfair Display': '"Playfair Display",Georgia,serif',
  Arial: 'Arial,sans-serif',
  Helvetica: 'Helvetica,Arial,sans-serif',
  Georgia: 'Georgia,serif',
  'Times New Roman': '"Times New Roman",serif',
  Verdana: 'Verdana,sans-serif',
  Poppins: 'Poppins,Arial,sans-serif',
  Inter: 'Inter,Arial,sans-serif',
};

const options = {
  main_font: Object.keys(fonts),
  heading_font: Object.keys(fonts),
  heading_style: ['normal', 'italic'],
  button_style: ['rounded', 'slightly-rounded', 'square'],
  card_style: ['flat', 'border', 'soft-shadow'],
  layout_density: ['compact', 'comfortable'],
  header_home_enabled: ['enabled', 'disabled'],
};

const defaults = {
  ...colors,
  main_font: 'DM Sans',
  heading_font: 'Playfair Display',
  base_font_size: 16,
  heading_style: 'normal',
  button_style: 'slightly-rounded',
  card_style: 'border',
  layout_density: 'comfortable',
  header_home_enabled: 'enabled',
};

const homepage = {
  home_eyebrow: 'BY GARMENT DESIGN STUDIO',
  homepage_heading: 'Pick a Proven Fit. Stitch Straight Away.',
  homepage_subheading: 'Body-trialled patterns that shorten your timeline and effort, with no starting from scratch.',

  home_primary_button: 'Browse Collection',
  home_secondary_button: 'Request a Custom Block',

  home_trust_1: 'Fit Blocks',
  home_trust_2: 'Fit Trials',
  home_trust_3: 'Industry Technical Expertise',

  home_image_path: '/images/basic-shirt-pattern.svg',
  home_image_alt: 'Basic Shirt Block Technical Illustration',
  home_video_path: '',
  home_showcase_image_path: '/images/basic-shirt-pattern.svg',
  home_men_image_path: '',
  home_women_image_path: '',
  home_kids_image_path: '',

  home_floating_label: 'Block Library · Digital Files',
  home_floating_text: 'Basic Shirt Block',

  home_available_eyebrow: 'HOW IT WORKS',
  home_available_heading: 'Select, Cut, Sew. Done.',
  home_available_description: 'Order the silhouette you need, cut it in your own fabric and check results on a form. Proportions come pre-balanced, so samples progress faster with less rework.',
  home_available_button: 'View All Styles',

  home_focus_eyebrow: 'ONE LIBRARY, THREE WARDROBES',
  home_focus_heading: 'One Library, Three Wardrobes',
  home_focus_description: 'Explore curated blocks engineered for production across Men, Women, and Kids.',
  home_focus_secondary_description: 'All patterns are developed with 20+ years of industrial garment technology and body-trialled on physical forms before digitisation.',

  home_card_1_title: 'Balanced Foundations',
  home_card_1_description: 'Proportions and ease pre-calibrated across critical balance points so your first toile hangs cleanly without guesswork.',

  home_card_2_title: 'Wear-Tested',
  home_card_2_description: 'Every block is pattern-trialled on physical forms and live fittings before conversion to digital master files.',

  home_card_3_title: 'Expert Validated',
  home_card_3_description: 'Developed with 20+ years of industrial garment technology and pattern engineering expertise.',

  home_card_4_title: 'Quicker Approvals',
  home_card_4_description: 'Shorten sample iterations from weeks to days with production-friendly blocks your sampling team trusts.',

  home_expertise_eyebrow: 'FOUNDER & MASTER PATTERN MAKER',
  home_expertise_heading: 'Two Decades of Garment Technology in Every File',
  home_expertise_description: 'Created by S.S. Ganesh, NIFT alumnus and founder of Garment Design Studio. Bringing over 20 years of apparel industry expertise, fit engineering, and master pattern making to production-grade digital CAD blocks for fashion brands and manufacturers worldwide.',

  home_books_status: 'Coming Soon',
  home_books_heading: 'Learning Hub',
  home_books_description: 'Comprehensive reference guides, Point of Measurement (POM) charts, and garment technology handbooks for design and sampling teams.',

  home_classes_status: 'Coming Soon',
  home_classes_heading: 'Pattern-Making Course',
  home_classes_description: 'Master professional CAD pattern making, grading, fit correction, and industrial block construction online under expert mentorship.',
};

const headerFooter = {
  "header_announcement": "PRODUCTION-FRIENDLY BLOCKS FOR MEN · WOMEN · KIDS",
  "header_tagline": "BY GARMENT DESIGN STUDIO",
  "header_home_label": "Home",
  "header_patterns_label": "Available Patterns",
  "header_contact_label": "Contact",
  "header_explore_label": "Explore",
  "header_books_label": "Books - Coming Soon",
  "header_classes_label": "Online Pattern Making Classes",
  "header_account_label": "Account",
  "header_my_account_label": "My Account",
  "header_orders_label": "My Orders",
  "header_logout_label": "Logout",
  "header_sign_in_label": "Sign In",
  "header_register_label": "Create Account",
  "header_cart_label": "Shopping cart",
  "header_navigation_label": "Open navigation",
  "footer_tagline": "BY GARMENT DESIGN STUDIO",
  "footer_ordering_label": "Ordering",
  "footer_patterns_label": "Available Patterns",
  "footer_cart_label": "Shopping Cart",
  "footer_checkout_label": "Checkout",
  "footer_support_label": "Support",
  "footer_whatsapp_label": "WhatsApp",
  "footer_security_label": "Secure ordering portal",
  "footer_credit_label": "Created by",
  "footer_credit_name": "Innovix Projects"
};

const aboutPage = {
  about_eyebrow: 'About Apparel Easy Patterns',
  about_heading: 'Patterns for the work behind every garment.',
  about_intro: 'Explore a flexible pattern store designed around digital files, physical patterns and trial samples—so you can choose the right format for your next garment project.',
  about_cta_text: 'Explore Patterns',
  about_cta_link: '/products',
  about_tile_1_title: 'Digital patterns',
  about_tile_1_text: 'Select the file formats that fit your design and production workflow.',
  about_tile_2_title: 'Physical patterns',
  about_tile_2_text: 'Choose printed patterns when physical development is the better fit.',
  about_tile_3_title: 'Trial samples',
  about_tile_3_text: 'Keep your options flexible with trial sample quantities where available.',
};

const servicesPage = {
  services_heading: 'Garment Technology & Technical Services',
  services_description: 'Practical garment technology, fit development, sampling review and pattern engineering services for fashion brands and manufacturers.',
  services_cta_text: 'Request Service Details',
  services_cta_link: '/contact',
};

const classesPage = {
  classes_eyebrow: 'Online Pattern Making Class Enquiries',
  classes_heading: 'Become a Professional Pattern Maker',
  classes_description: 'Pattern making course online: learn basic blocks, womenswear, menswear, fit correction, grading and CAD garment patterns.',
  classes_cta_text: 'Request Class Information',
  classes_cta_link: '/classes/enquiry',
};

const consultingPage = {
  consulting_heading: 'Book Your Consultation at Your Convenient Time',
  consulting_subheading: 'Need expert guidance on garment patterns, fit development, or apparel production?',
  consulting_description: 'Schedule a personalized consultation with our expert at a time convenient for you.',
  consulting_cta_text: 'Submit Your Requirement',
};

const contactPage = {
  contact_heading: 'Contact the Studio',
  contact_description: 'Contact Apparel Easy Patterns by email, WhatsApp or phone for pattern enquiries, fit development and studio consultations.',
};

const socialSeo = {
  og_image_url: '',
  twitter_handle: '',
};

const content = {
  ...headerFooter,
  ...require('../services/seoService').settingsDefaults,

  store_name: 'Apparel Easy Patterns',
  logo_url: '',
  favicon_url: '',
  main_website_url: '',

  ...require('./launch'),
  address: '',

  ...homepage,
  ...aboutPage,
  ...servicesPage,
  ...classesPage,
  ...consultingPage,
  ...contactPage,
  ...socialSeo,

  products_heading: 'READY-TO-USE AVAILABLE PATTERN TEMPLATES',
  products_description: 'Choose professional garment patterns with flexible digital files, physical pattern and trial-sample options.',
  cart_heading: 'Shopping Cart',
  checkout_heading: 'Complete your order.',
  footer_text: 'Professional garment pattern ordering with secure online checkout.',
  back_website_label: 'Back to Main Website',
  view_products_label: 'View Products',
};

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function safeImagePath(value) {
  if (typeof value !== 'string') return false;
  const path = value.trim();

  if (!path) return true;

  if (path.startsWith('/') && !path.startsWith('//')) {
    return !/[<>"'\\\u0000-\u001f]/.test(path);
  }

  return Boolean(safeUrl(path));
}

function valid(key, value) {
  if (key in colors) {
    return typeof value === 'string' &&
      /^#[0-9a-f]{6}$/i.test(value);
  }

  if (key in options) {
    return options[key].includes(value);
  }

  if (key === 'base_font_size') {
    return /^\d+$/.test(String(value)) &&
      Number(value) >= 14 &&
      Number(value) <= 20;
  }

    const mediaFields = [
    'home_image_path',
    'home_video_path',
    'home_showcase_image_path',
    'home_men_image_path',
    'home_women_image_path',
    'home_kids_image_path'
  ];
  if (mediaFields.includes(key)) {
    return typeof value === 'string' &&
      value.length <= 2048 &&
      safeImagePath(value);
  }

  const maxLength = key.endsWith('_url') ? 2048 :
    (['home_', 'homepage_', 'about_', 'services_', 'classes_', 'consulting_', 'contact_', 'products_'].some(p => key.startsWith(p)) ? 3000 : 600);

  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  ) {
    return false;
  }

  if (key.endsWith('_url')) {
    return !value || Boolean(safeUrl(value));
  }

  if (key.endsWith('_link')) {
    return !value || Boolean(safeImagePath(value));
  }

  if (key === 'contact_email') {
    return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  if (['contact_phone', 'whatsapp_number'].includes(key)) {
    return !value || /^[+\d ()-]{3,30}$/.test(value);
  }

  if (Object.prototype.hasOwnProperty.call(headerFooter, key)) return Boolean(value.trim());

  return ![
    'store_name',
    'back_website_label',
    'view_products_label',
  ].includes(key) || Boolean(value.trim());
}

function normalize(input = {}) {
  const stored = { ...input };

  if ([
    'Garment Pattern Store',
    'Apparels Easy Pattern',
    'Apparels Easy Patterns',
  ].includes(stored.store_name)) {
    stored.store_name = content.store_name;
  }

  if (
    stored.homepage_heading ===
    'Professional Garment Technology, Pattern Making & Apparel Development'
  ) {
    stored.homepage_heading = content.homepage_heading;
  }

  if (stored.homepage_subheading === 'Learn ? Develop ? Buy ? Consult') {
    stored.homepage_subheading = content.homepage_subheading;
  }

  if (
    stored.products_heading ===
    'Made to move from idea to production.'
  ) {
    stored.products_heading = content.products_heading;
  }

  if (
    stored.homepage_heading ===
    'Precision behind every silhouette.'
  ) {
    stored.homepage_heading = content.homepage_heading;
  }

  if (
    stored.homepage_subheading ===
    'Explore garment patterns built for practical design, sampling and production workflows. Choose the digital files, physical patterns and trial samples your project requires.'
  ) {
    stored.homepage_subheading = content.homepage_subheading;
  }

  const result = {
    ...stored,
    ...require('./linkedin').normalize(stored),
  };

  for (const [key, fallback] of Object.entries({
    ...defaults,
    ...content,
    ...headerFooter
  })) {
    result[key] = valid(key, stored[key]) ? stored[key] : fallback;
  }

  return result;
}

function parse(body) {
  const values = {};
  const errors = [];

  for (const key of Object.keys({
    ...defaults,
    ...content,
    ...headerFooter
  })) {
    const value = typeof body[key] === 'string'
      ? body[key].trim()
      : body[key];

    if (!valid(key, value)) {
      errors.push(
        `Please enter a valid ${key.replaceAll('_', ' ')}.`
      );
    } else {
      values[key] = key === 'base_font_size'
        ? Number(value)
        : value;
    }
  }

  return { values, errors };
}

function cssVariables(settings) {
  const s = normalize(settings);

  const vars = Object.fromEntries(
    Object.keys(colors).map(key => [
      `--${key.replaceAll('_', '-')}`,
      s[key],
    ])
  );

  return {
    ...vars,
    '--main-font': fonts[s.main_font],
    '--heading-font': fonts[s.heading_font],
    '--base-font-size': `${s.base_font_size}px`,
    '--heading-style': s.heading_style,
    '--button-radius': {
      rounded: '999px',
      'slightly-rounded': '9px',
      square: '0',
    }[s.button_style],
    '--card-border': s.card_style === 'border'
      ? '1px solid var(--border)'
      : '1px solid transparent',
    '--card-shadow': s.card_style === 'soft-shadow'
      ? '0 12px 35px rgba(35,25,20,.10)'
      : 'none',
    '--layout-gap': s.layout_density === 'compact'
      ? '14px'
      : '24px',
    '--card-padding': s.layout_density === 'compact'
      ? '16px'
      : '24px',
  };
}

module.exports = {
  colors,
  fonts,
  options,
  defaults,
  content,
  homepage,
  headerFooter,
  valid,
  normalize,
  parse,
  safeUrl,
  cssVariables,
};
