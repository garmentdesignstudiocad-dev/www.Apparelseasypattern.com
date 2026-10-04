const definitions = Object.freeze({
  patterns: 'Ready-to-Use Patterns',
  online_classes: 'Online Classes',
  webinars: 'Webinars',
  books: 'Books',
  consulting: 'Consulting',
  updates: 'Fashion Updates / Articles',
  courses: 'Courses & Training',
  leads: 'Leads / Enquiry CTA',
  paid_access: 'Paid Access / New Registrations',
  linkedin: 'Footer LinkedIn',
  homepage_services: 'Homepage Services',
  homepage_catalogs: 'Homepage Catalog Sections',
});
const defaults = Object.freeze(Object.fromEntries(Object.keys(definitions).map(key => [key + '_enabled', true])));
function normalize(row = {}) {
  return Object.fromEntries(Object.keys(defaults).map(key => [key, row[key] !== false]));
}
const interestFeatures = {
  'Online Classes':'online_classes',
  'Pattern Making Course': 'courses', 'Garment Technology Training': 'courses',
  'Corporate Training': 'courses', 'Digital Patterns': 'patterns', Consulting: 'consulting', Books: 'books',
};
function helpers(settings = defaults, origin = '') {
  const enabled = key => Object.hasOwn(definitions, key) && settings[key + '_enabled'] !== false;
  function canVisit(url) {
    if (typeof url !== 'string') return false;
    if (/^(https?:)?\/\//i.test(url)) {
      try {
        const target = new URL(url, origin || undefined);
        if (!origin || target.origin !== new URL(origin).origin) return true;
        url = target.pathname + target.search + target.hash;
      } catch { return false; }
    }
    if (url.includes('#enquiry') && !enabled('leads')) return false;
    let path;
    try { path = decodeURIComponent(url.split(/[?#]/)[0]).toLowerCase(); } catch { return false; }
    const first = path.split('/')[1];
    if (!first || first === 'admin') return true;
    const groups = {
      products:'patterns', patterns:'patterns', product:'patterns', cart:'patterns', checkout:'patterns',
      classes:'online_classes', 'my-courses':'online_classes', courses:'courses',
      'garment-technology':'courses', 'corporate-training':'courses', 'course-bookings':'courses',
      webinars:'webinars', 'webinar-registrations':'webinars', books:'books', 'book-purchases':'books',
      consulting:'consulting', 'consultation-bookings':'consulting', updates:'updates', enquiries:'leads', 'pattern-updates':'leads',
    };
    if (groups[first] && !enabled(groups[first])) return false;
    if(path==='/books/notify')return enabled('books') && enabled('leads');
    if (/^\/classes\/enquiry(?:\/|$)/.test(path)) return enabled('leads');
    if (/^\/(books|consulting)\/[^/]+\/access\/?$/.test(path) || /^\/(courses|webinars)\/[^/]+\/(book|register)\/?$/.test(path) || /^\/consulting\/[^/]+\/?$/.test(path)) return enabled('paid_access');
    if (/^\/(course-bookings|webinar-registrations|book-purchases|consultation-bookings)\/[^/]+\/order\/?$/.test(path)) return enabled('paid_access');
    return true;
  }
  const visibleLinks = links => links.filter(([, url]) => canVisit(url));
  const visibleInterest = interest => !interestFeatures[interest] || enabled(interestFeatures[interest]);
  return { featureEnabled: enabled, canVisit, visibleLinks, visibleInterest };
}
module.exports = { definitions, defaults, normalize, helpers };
