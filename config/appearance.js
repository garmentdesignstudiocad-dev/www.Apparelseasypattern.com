// Shared allowlists: only these values may reach storefront CSS.
const colors = {
  primary_color: '#62392d', secondary_color: '#171313', accent_color: '#c58b62',
  background_color: '#f5f0e9', header_background_color: '#fffdfa', header_text_color: '#201b1a',
  button_color: '#171313', button_text_color: '#ffffff', footer_background_color: '#171313', footer_text_color: '#eadfd5',
};
const fonts = {
  'DM Sans': '"DM Sans",Arial,sans-serif', 'Playfair Display': '"Playfair Display",Georgia,serif',
  Arial: 'Arial,sans-serif', Helvetica: 'Helvetica,Arial,sans-serif', Georgia: 'Georgia,serif',
  'Times New Roman': '"Times New Roman",serif', Verdana: 'Verdana,sans-serif',
  Poppins: 'Poppins,Arial,sans-serif', Inter: 'Inter,Arial,sans-serif',
};
const options = {
  main_font: Object.keys(fonts), heading_font: Object.keys(fonts),
  heading_style: ['normal', 'italic'], button_style: ['rounded', 'slightly-rounded', 'square'],
  card_style: ['flat', 'border', 'soft-shadow'], layout_density: ['compact', 'comfortable'],
};
const defaults = { ...colors, main_font: 'DM Sans', heading_font: 'Playfair Display', base_font_size: 16,
  heading_style: 'normal', button_style: 'slightly-rounded', card_style: 'border', layout_density: 'comfortable' };
const content = {
  ...require('../services/seoService').settingsDefaults,
  store_name: 'Apparel Easy Patterns', logo_url: '', favicon_url: '', main_website_url: '',
  ...require('./launch'), address: '',
  homepage_heading: 'Ready-to-Use Apparel Patterns',
  homepage_subheading: 'Ready-to-use garment pattern blocks for faster sampling, stitching and product development.',
  products_heading: 'READY-TO-USE AVAILABLE PATTERN TEMPLATES',
  products_description: 'Choose professional garment patterns with flexible digital files, physical pattern and trial-sample options.',
  cart_heading: 'Shopping Cart', checkout_heading: 'Complete your order.',
  footer_text: 'Professional garment pattern ordering with secure online checkout.',
  back_website_label: 'Back to Main Website', view_products_label: 'View Products',
};
function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
function valid(key, value) {
  if (key in colors) return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (key in options) return options[key].includes(value);
  if (key === 'base_font_size') return /^\d+$/.test(String(value)) && Number(value) >= 14 && Number(value) <= 20;
  if (typeof value !== 'string' || value.length > (key.endsWith('_url') ? 2048 : 600) || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return false;
  if (key.endsWith('_url')) return !value || Boolean(safeUrl(value));
  if (key === 'contact_email') return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (['contact_phone', 'whatsapp_number'].includes(key)) return !value || /^[+\d ()-]{3,30}$/.test(value);
  return !['store_name', 'back_website_label', 'view_products_label'].includes(key) || Boolean(value.trim());
}
function normalize(stored = {}) {
  // Upgrade only the former stock copy; preserve owner-written homepage text.
  stored = { ...stored };
  if(['Garment Pattern Store','Apparels Easy Pattern','Apparels Easy Patterns'].includes(stored.store_name))stored.store_name=content.store_name;
  if(stored.homepage_heading==='Professional Garment Technology, Pattern Making & Apparel Development')stored.homepage_heading=content.homepage_heading;
  if(stored.homepage_subheading==='Learn ? Develop ? Buy ? Consult')stored.homepage_subheading=content.homepage_subheading;
  if(stored.products_heading === 'Made to move from idea to production.') stored.products_heading = content.products_heading;
  if (stored.homepage_heading === 'Precision behind every silhouette.') stored.homepage_heading = content.homepage_heading;
  if (stored.homepage_subheading === 'Explore garment patterns built for practical design, sampling and production workflows. Choose the digital files, physical patterns and trial samples your project requires.') stored.homepage_subheading = content.homepage_subheading;
  const result = { ...stored, ...require('./linkedin').normalize(stored) };
  for (const [key, fallback] of Object.entries({ ...defaults, ...content })) {
    result[key] = valid(key, stored[key]) ? stored[key] : fallback;
  }
  return result;
}
function parse(body) {
  const values = {}, errors = [];
  for (const key of Object.keys({ ...defaults, ...content })) {
    const value = typeof body[key] === 'string' ? body[key].trim() : body[key];
    if (!valid(key, value)) errors.push(`Please enter a valid ${key.replaceAll('_', ' ')}.`);
    else values[key] = key === 'base_font_size' ? Number(value) : value;
  }
  return { values, errors };
}
function cssVariables(settings) {
  const s = normalize(settings);
  const vars = Object.fromEntries(Object.keys(colors).map(key => [`--${key.replaceAll('_', '-')}`, s[key]]));
  return { ...vars, '--main-font': fonts[s.main_font], '--heading-font': fonts[s.heading_font],
    '--base-font-size': `${s.base_font_size}px`, '--heading-style': s.heading_style,
    '--button-radius': { rounded: '999px', 'slightly-rounded': '9px', square: '0' }[s.button_style],
    '--card-border': s.card_style === 'border' ? '1px solid var(--border)' : '1px solid transparent',
    '--card-shadow': s.card_style === 'soft-shadow' ? '0 12px 35px rgba(35,25,20,.10)' : 'none',
    '--layout-gap': s.layout_density === 'compact' ? '14px' : '24px',
    '--card-padding': s.layout_density === 'compact' ? '16px' : '24px' };
}
module.exports = { colors, fonts, options, defaults, content, valid, normalize, parse, safeUrl, cssVariables };
