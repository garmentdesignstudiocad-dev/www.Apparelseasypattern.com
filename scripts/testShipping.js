process.env.TEST_SHIPPING='true';
process.env.NOTIFICATIONS_WORKER_ENABLED='false';
process.env.APP_BASE_URL='https://store.example.test';
require('./testStability');
