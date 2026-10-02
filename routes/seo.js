const router=require('express').Router();
const {siteOrigin}=require('../services/seoService');
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
router.get('/robots.txt',(req,res)=>{
  const origin=siteOrigin();
  res.type('text/plain').send(origin?'User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /receipts\nDisallow: /my-courses\nDisallow: /login\nDisallow: /enquiries\nDisallow: /classes/enquiry/thank-you\nDisallow: /course-bookings\nDisallow: /webinar-registrations\nDisallow: /book-purchases\nDisallow: /consultation-bookings\nSitemap: '+origin+'/sitemap.xml\n':'User-agent: *\nDisallow: /\n');
});
router.get('/sitemap.xml',async(req,res,next)=>{
  try{
    const origin=siteOrigin();if(!origin)return res.status(503).type('text/plain').send('Configure the permanent SITE_URL before publishing a sitemap.');
    const urls=['/','/products','/classes','/classes/enquiry','/courses','/webinars','/books','/consulting','/updates','/contact'].filter(res.locals.canVisit);
    const settings=await require('../services/paidAccessService').getSettings();
    for(const [feature,model,base,filter] of [
      ['patterns','Product','/product/',{active:true}],['online_classes','ClassSession','/classes/',{published:true,status:{$nin:['Draft','Cancelled']}}],
      ['courses','Course','/courses/',{active:true}],['webinars','Webinar','/webinars/',{active:true,starts_at:{$gt:new Date()}}],
      ['books','Book','/books/',{active:true}],['updates','Article','/updates/',{published:true,published_at:{$lte:new Date()}}],
    ]){
      if(!res.locals.featureEnabled(feature) || settings[feature]?.active===false)continue;
      const rows=await require('../models/mongo/'+model).find(filter).select('slug').limit(4000).lean();
      for(const row of rows)if(row.slug)urls.push(base+encodeURIComponent(row.slug));
    }
    const visible=urls.filter(url=>!['/courses','/webinars','/books','/consulting'].includes(url)||settings[url.slice(1)]?.active!==false);
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(visible)].map(url=>'<url><loc>'+xml(origin+url)+'</loc></url>').join('')+'</urlset>');
  }catch(error){next(error);}
});
module.exports=router;
