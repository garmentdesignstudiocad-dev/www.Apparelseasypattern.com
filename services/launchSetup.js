async function prepare(){
  const Site=require('../models/mongo/SiteSettings'),Product=require('../models/mongo/Product');
  // One-time contact migration, never overwrite later owner edits on rerun.
  await Site.updateOne({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true});
  await Site.updateOne({key:'default',launch_contacts_version:{$ne:1}},{$set:{...require('../config/launch'),launch_contacts_version:1}});
  let product=await Product.findOne({$or:[{slug:'basic-shirt-pattern'},{name:/^basic shirt pattern$/i}]});
  if(!product)product=await Product.create({name:'Shirt Pattern Collection - Fit 3: Basic Short-Sleeve',base_price:50,additional_size_price:50,physical_price:50,trial_price:1000,slug:'basic-shirt-pattern',active:false,description:'Basic shirt pattern for garment development. Confirm the intended fit, size range, pattern pieces and file formats with the studio before ordering.',images:['/images/basic-shirt-pattern.svg'],seo_title:'Basic Shirt Pattern | Ready-to-Use Garment Patterns',seo_description:'Explore Basic Shirt Pattern for garment development. Confirm available sizes, digital file formats, physical pattern options and delivery with Garment Design Studio.'});
  require('./siteSettingsService').clearSiteSettingsCache();
  return {slug:product.slug,active:product.active,product_id:String(product._id)};
}
module.exports={prepare};
