process.env.TEST_COMMERCE='true';
process.env.TEST_SHIPPING='true';
process.env.NOTIFICATIONS_WORKER_ENABLED='false';
process.env.APP_BASE_URL='https://store.example.test';
process.env.RAZORPAY_WEBHOOK_SECRET='commerce-webhook-test-secret';
require('./testStability');
