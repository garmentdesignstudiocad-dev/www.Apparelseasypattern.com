process.env.TEST_PATTERN_STOREFRONT = 'false';
process.env.TEST_FEATURES = 'true';
process.env.NOTIFICATION_WORKER_ENABLED = 'false';
require('./testPaidAccess');
