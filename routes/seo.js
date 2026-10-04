const router=require('express').Router();
const {siteOrigin}=require('../services/seoService');
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
router.get('/robots.txt',(req,res)=>{
  const origin=siteOrigin();
  res.type('text/plain').send(origin?'User-agent: *\nDisallow: /admin\nSitemap: '+origin+'/sitemap.xml\n':'User-agent: *\nDisallow: /\n');
});
router.get('/sitemap.xml',async(req,res,next)=>{
  try{
    const origin=siteOrigin();if(!origin)return res.status(503).type('text/plain').send('Configure the permanent SITE_URL before publishing a sitemap.');
    const urls=['/','/products','/classes/enquiry','/books','/contact','/about'].filter(res.locals.canVisit);
    if(res.locals.featureEnabled('patterns')){
      const rows=await require('../models/mongo/Product').find(require('../services/patternOptions').publicFilter).select('slug').limit(4000).lean();
      for(const row of rows)if(row.slug)urls.push('/product/'+encodeURIComponent(row.slug));
    }
    const visible=urls;
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(visible)].map(url=>'<url><loc>'+xml(origin+url)+'</loc></url>').join('')+'</urlset>');
  }catch(error){next(error);}
});
module.exports=router;
