const { logError } = require('./safeLog');
const mongoose = require('mongoose');
const SiteSettings = require('../models/mongo/SiteSettings');
const { normalize } = require('../config/appearance');

function safePublicUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

const fallback = () => normalize({
  store_name: 'Apparel Easy Patterns',
  logo_url: '',
  main_website_url: safePublicUrl(process.env.MAIN_WEBSITE_URL),
  ...require('../config/launch'), address: '', footer_text: '',
});
let cache = null;
let cacheUntil = 0;

async function getSiteSettings() {
  if (cache && Date.now() < cacheUntil) return cache;
  if (mongoose.connection.readyState !== 1) return cache || fallback();
  try {
    let stored = await SiteSettings.findOne({ key: 'default' }).lean();
    const missing=Object.fromEntries(Object.entries(require('../config/linkedin').defaults).filter(([key])=>stored?.[key]===undefined));
    if(Object.keys(missing).length){
      if(!stored){try{await SiteSettings.create({key:'default',...missing});}catch(error){if(error.code!==11000)throw error;}}
      else for(const [key,value] of Object.entries(missing))await SiteSettings.updateOne({key:'default',[key]:{$exists:false}},{$set:{[key]:value}});
      stored=await SiteSettings.findOne({key:'default'}).lean();
    }
    cache = normalize({ ...fallback(), ...(stored || {}) });
    cacheUntil = Date.now() + 60000;
    return cache;
  } catch (error) {
    logError('Site settings lookup failed:', error);
    return cache || fallback();
  }
}

function clearSiteSettingsCache() { cache = null; cacheUntil = 0; }
module.exports = { getSiteSettings, clearSiteSettingsCache };
