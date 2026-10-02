const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const { logError } = require('./services/safeLog');

dotenv.config();
if(process.env.NODE_ENV==='production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be configured in production.');

const app = express();
app.locals.adminNavigation = require('./config/adminNavigation');
app.locals.jsonLd = require('./services/seoService').jsonLd;
Object.assign(app.locals, require('./config/features').helpers());
app.locals.featureSettings = require('./config/features').defaults;
const port = process.env.PORT || 3000;
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
const { normalize, cssVariables } = require('./config/appearance');
app.use((req,res,next)=>{
  res.locals.siteSettings=normalize();res.locals.themeVariables=cssVariables(res.locals.siteSettings);
  res.locals.isAdminPage=req.path.startsWith('/admin');
  next();
});

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Verify the exact signed bytes before JSON parsing or session middleware.
app.post('/checkout/razorpay-webhook', express.raw({type:'application/json',limit:'256kb'}), require('./controllers/checkoutController').postRazorpayWebhook);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'admin-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' ? 'auto' : false,
  },
}));

const { getSiteSettings } = require('./services/siteSettingsService');
app.use(async (req, res, next) => {
  try {res.locals.siteSettings = await getSiteSettings();res.locals.themeVariables = cssVariables(res.locals.siteSettings);next();}
  catch(error){next(error);}
});

// Phase 1 business pages reuse the existing store and enrollment flows.
app.use((req, res, next) => {
  const seo=require('./services/seoService'), origin=seo.siteOrigin();
  res.locals.canonicalUrl = origin ? origin + (req.path==='/patterns'?'/products':req.path) : '';
  res.locals.organizationData=seo.organization(res.locals.siteSettings);
  const section=req.path.slice(1);
  if(seo.pageDefaults[section]){res.locals.seoTitle=res.locals.siteSettings[section+'_seo_title'];res.locals.description=res.locals.siteSettings[section+'_seo_description'];}
  next();
});
app.use(require('./middleware/features').load, require('./middleware/features').guard);
app.use('/', require('./routes/customerAccount'));
app.use('/',require('./routes/seo'));
app.use('/', require('./routes/receipts'));
app.use('/', require('./routes/downloads'));
app.use('/', require('./routes/classEnquiries'));
app.use('/', require('./routes/paidAccess'));
app.use('/', require('./routes/learning'));
app.use('/', require('./routes/business'));

const { testConnection } = require('./config/db');
const { connect: connectMongo, getMongoStatus } = require('./config/mongo');
const checkoutRouter = require('./routes/checkout');


const adminRouter = require('./routes/admin');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const classesRouter = require('./routes/classes');
const adminClassesRouter = require('./routes/adminClasses');
const adminSettingsRouter = require('./routes/adminSettings');

// Mount admin router separately from customer routes
app.use('/admin/classes', adminClassesRouter);
app.use('/admin', require('./routes/adminFulfilment'));
app.use('/admin/seo', require('./routes/adminSeo'));
app.use('/admin/settings/features', require('./routes/adminFeatures'));
app.use('/admin', require('./routes/adminNotifications'));
app.use('/admin', require('./routes/adminPaidAccess'));
app.use('/admin/settings/appearance', require('./routes/adminAppearance'));
app.use('/admin/settings', adminSettingsRouter);
app.use('/admin', require('./routes/adminLearning'));
app.use('/admin', require('./routes/adminBusiness'));
app.use('/admin', adminRouter);

// Mount products router (DB-backed)
app.use('/', productsRouter);
app.use('/', classesRouter);

// Keep simple pages
app.get('/about', (req, res) => res.render('about', { title: 'About' }));


// Mount cart router to handle cart display and actions
app.use('/', cartRouter);

// Mount checkout routes
app.use('/', checkoutRouter);

app.get('/api/health', async (req, res) => {
  const sqlOk = await testConnection();
  const mongoStatus = getMongoStatus();
  const mongoOk = mongoStatus === 'connected';

  let status = 'ok';
  if (!sqlOk && !mongoOk) {
    status = 'unhealthy';
  } else if (!sqlOk || !mongoOk) {
    status = 'degraded';
  }

  res.json({
    status,
    environment: process.env.NODE_ENV || 'unknown',
    database: {
      sql: sqlOk ? 'connected' : 'unavailable',
      mongodb: mongoStatus,
    },
  });
});

// 404 handler
require('./middleware/asyncErrors')(app._router);
app.use((req, res) => {
  res.status(404).render('error', { title: 'Page Not Found', message: 'The requested page could not be found.' });
});

// Error middleware
app.use((err, req, res, next) => {
  if(res.headersSent) return next(err);
  logError('Request failed:',err);
  const invalid=err.name==='CastError' || err.name==='ValidationError' || err.code===11000 || err.type==='entity.parse.failed';
  const status=invalid?400:err.type==='entity.too.large'?413:500;
  const message=invalid?'Please check the submitted values and try again.':status===413?'This submission is too large. Please shorten it and try again.':'Something went wrong. Please try again.';
  if(req.is('application/json') || req.path.startsWith('/api/') || req.get('Accept')?.includes('application/json')) return res.status(status).json({error:message});
  res.status(status).render('error', { title: status===500?'Server Error':'Unable to Complete Request', message });
});
async function startServer() {
  const httpServer = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  httpServer.on('error', (err) => {
    console.error('HTTP server failed to start:', {
      code: err.code || 'UNKNOWN',
      message: err.message,
    });
  });

  async function connectMongoWithRetry() {
    try {
      await connectMongo();
    } catch (err) {
      console.error('MongoDB is unavailable; the web server will remain running and retry in 30 seconds.');
      setTimeout(connectMongoWithRetry, 30000);
    }
  }

  connectMongoWithRetry();
  const stopNotifications=require('./services/notificationService').startWorker();
  httpServer.on('close',stopNotifications);
}

if (require.main === module) startServer();
module.exports = app;
