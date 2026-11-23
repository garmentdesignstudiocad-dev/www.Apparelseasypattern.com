// Explicit Admin assignments take precedence; legacy names are used only when absent.
const slug = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
const typeKey = value => {
  const key = slug(value);
  return ({shirts:'shirt','t-shirts':'t-shirt',pants:'casual-pant',trousers:'trouser',jackets:'jacket',
    dresses:'dress',tops:'top',kurtas:'kurta',blouses:'blouse'})[key] || key;
};
const fitKey = value => slug(value).replace(/-fit$/, '');
const typeOf = product => product.product_type || product.category || '';
function fitsOf(product) {
  if (product.fit?.trim()) return [product.fit.trim()];
  const text = `${product.name || ''} ${product.description || ''}`;
  return ['Slim', 'Regular', 'Relaxed', 'Comfort', 'Classic', 'Tailored', 'Resort', 'Oversized']
    .filter(fit => new RegExp(`\\b${fit}\\s+fit\\b`, 'i').test(text)).map(fit => `${fit} Fit`);
}
function matchesType(product, value) { return typeKey(typeOf(product)) === typeKey(value); }
function matchesFit(product, value) { return fitsOf(product).some(fit => fitKey(fit) === fitKey(value)); }
function breadcrumbs(product) {
  const department = slug(product.department);
  const query = new URLSearchParams();
  const result = [];
  if (['men','women','kids'].includes(department)) {
    query.set('category', department);
    result.push({label: {men:"Men's",women:"Women's",kids:"Kid's"}[department], href:'/products?' + query});
  }
  if (typeOf(product)) {
    query.set('type', slug(typeOf(product)));
    result.push({label:typeOf(product), href:'/products?' + query});
  }
  if (product.fit?.trim()) {
    query.set('fit', slug(product.fit));
    result.push({label:product.fit, href:'/products?' + query});
  }
  return result;
}
module.exports = {slug, typeOf, fitsOf, matchesType, matchesFit, breadcrumbs};
