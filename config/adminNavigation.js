// Shared by the owner dashboard and persistent sidebar; never filtered by public visibility.
module.exports = {
  Business: [
    ['/admin/products', 'Products / Patterns'], ['/admin/classes', 'Online Classes'],
    ['/admin/courses', 'Courses'], ['/admin/webinars', 'Webinars'], ['/admin/books', 'Books'],
    ['/admin/consulting', 'Consulting'], ['/admin/articles', 'Updates / Articles'],
  ],
  Customers: [
    ['/admin/leads', 'Leads / Enquiries'], ['/admin/orders', 'Orders'],
    ['/admin/leads?interest=Online%20Classes', 'Online Class Enquiries'],
    ['/admin/customers', 'Customers'], ['/admin/payments', 'Payments'],
    ['/admin/access-records', 'Access Records'], ['/admin/course-bookings', 'Course Bookings'],
    ['/admin/webinar-registrations', 'Webinar Registrations'],
  ],
  'Website Control': [
    ['/admin/settings/features', 'Feature Visibility'], ['/admin/settings/appearance', 'Website Appearance'],
    ['/admin/settings/website', 'Website Settings'],
    ['/admin/seo', 'SEO Planning & Keywords'],
  ],
  'Pricing & Operations': [
    ['/admin/settings/paid-access', 'Paid Access Settings'], ['/admin/settings/gst', 'GST Settings'],
    ['/admin/settings/delivery', 'Delivery Settings'], ['/admin/settings/coupons', 'Coupons'],
    ['/admin/settings/couriers', 'Courier Settings'],
    ['/admin/settings/pricing', 'Pricing Settings'], ['/admin/settings/admin', 'Admin Settings'],
  ],
  Communication: [
    ['/admin/notifications', 'Notifications'], ['/admin/settings/notifications', 'Notification Settings'],
  ],
};
