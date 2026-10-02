process.env.TEST_FEATURES = 'true';
process.env.NOTIFICATION_WORKER_ENABLED = 'false';
require('./testPaidAccess');
