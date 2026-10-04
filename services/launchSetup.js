async function prepare(){
  const Site=require('../models/mongo/SiteSettings');
  // One-time contact migration, never overwrite later owner edits on rerun.
  await Site.updateOne({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true});
  await Site.updateOne({key:'default',launch_contacts_version:{$ne:1}},{$set:{...require('../config/launch'),launch_contacts_version:1}});
  const product=await require('../models/mongo/Product').findOne({slug:'basic-shirt-pattern'}).select('slug active').lean();
  require('./siteSettingsService').clearSiteSettingsCache();
  return {slug:product?.slug||null,active:product?.active||false,product_id:product?String(product._id):null};
}
module.exports={prepare};
