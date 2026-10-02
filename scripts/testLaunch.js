process.env.TEST_LAUNCH='true';
process.env.SITE_URL='https://studio.example.test';
process.env.NOTIFICATION_WORKER_ENABLED='false';
require('./testStability');
