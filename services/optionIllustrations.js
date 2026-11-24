const slots = [
  ['digital_1', 'Digital Soft Copy - Image 1', 'soft_copy_bundle_cad.jpg'],
  ['digital_2', 'Digital Soft Copy - Image 2', 'soft_copy_bundle_roll.jpg'],
  ['measurement', 'Measurement Chart - Image 3', 'measurement_chart.jpg'],
  ['tech_pack', 'Basic Construction Tech Pack - Image 4', 'tech_pack.jpg'],
  ['physical', 'Physical Pattern - Image Slot 5', ''],
  ['mini_marker', 'Mini Marker - Image Slot 6', ''],
  ['trial', 'Trial Fit Sample - Image 7', 'trial_fit_sample.jpg']
];
function resolve(product = {}) {
  return Object.fromEntries(slots.map(([key,,fallback]) => {
    const value = product.option_images?.[key];
    const url = value === undefined ? (fallback ? '/images/options/' + fallback : '') : value;
    return [key, typeof url === 'string' && (/^\/uploads\/products\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(url) || slots.some(s => s[2] && url === '/images/options/' + s[2])) ? url : ''];
  }));
}
function collect(product, body, files) {
  const result = resolve(product);
  for (const [key] of slots) {
    const file = files['option_image_' + key]?.[0];
    if (file) result[key] = require('../middleware/productMediaUpload').publicMediaUrl(file);
    else if (['on', '1', true].includes(body['remove_option_image_' + key])) result[key] = '';
  }
  return result;
}
module.exports = {slots, resolve, collect};
