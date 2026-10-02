// Runs the existing paid-access suite plus receipts, provider mocks, retries and LinkedIn checks.
process.env.TEST_NOTIFICATIONS='true';
process.env.NOTIFICATIONS_WORKER_ENABLED='false';
// Configuration checks must not inherit a developer's real SMTP account.
for(const key of ['GMAIL_USER','GMAIL_APP_PASSWORD','EMAIL_HOST','EMAIL_PORT','EMAIL_SECURE','EMAIL_USER','EMAIL_PASSWORD','EMAIL_FROM'])process.env[key]='';
process.env.APP_BASE_URL='https://studio.example.test';
require('./testPaidAccess');
