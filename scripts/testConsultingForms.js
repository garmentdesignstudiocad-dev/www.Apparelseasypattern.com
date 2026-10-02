// Real HTTP/MongoDB forms, simulated Razorpay orders and popup. No live charge.
process.env.TEST_CONSULTING_FORMS='true';
process.env.NOTIFICATIONS_WORKER_ENABLED='false';
require('./testPaidAccess');
