function siteOrigin(){
  try{const u=new URL(process.env.SITE_URL || '');if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hostname.endsWith('.trycloudflare.com'))return '';return u.origin;}catch{return '';}
}
const pageDefaults={
  products:['Ready-to-Use Professional Garment Patterns','Explore professional garment patterns, digital soft-copy options, physical patterns and sampling options. Check available sizes, formats and delivery details.'],
  courses:['Pattern Making & Garment Technology Courses','Explore pattern making and garment technology training. Review course details and enquire about online classes, experience levels and preferred schedules.'],
  classes:['Online Pattern Making Classes & Enquiries','Online classes available for pattern making and garment technology. Send a free enquiry with your course interests, experience and preferred timing.'],
  contact:['Contact Garment Design Studio','Contact Garment Design Studio by email, WhatsApp or phone for pattern enquiries, online classes and garment development requirements.'],
};
const settingsDefaults=Object.fromEntries(Object.entries(pageDefaults).flatMap(([key,[title,description]])=>[[key+'_seo_title',title],[key+'_seo_description',description]]));
const jsonLd=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
function organization(settings){const url=siteOrigin();return url?{'@context':'https://schema.org','@type':'Organization',name:settings.store_name,url,email:settings.contact_email,telephone:settings.contact_phone}:null;}
function productData(product){
  const origin=siteOrigin();if(!origin || !product.active || !product.images?.length || !product.description || !(product.base_price>0))return null;
  return {'@context':'https://schema.org','@type':'Product',name:product.name,description:product.description,image:product.images.map(path=>new URL(path,origin).href),url:origin+'/product/'+encodeURIComponent(product.slug),offers:{'@type':'Offer',url:origin+'/product/'+encodeURIComponent(product.slug),priceCurrency:'INR',price:Number(product.base_price).toFixed(2)}};
}
module.exports={siteOrigin,pageDefaults,settingsDefaults,jsonLd,organization,productData};
