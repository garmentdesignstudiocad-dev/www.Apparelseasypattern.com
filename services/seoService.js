function siteOrigin(){
  try{const u=new URL(process.env.SITE_URL || '');if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hostname.endsWith('.trycloudflare.com'))return '';return u.origin;}catch{return '';}
}
const homeTitle='Ready-to-Use Apparel Patterns | Apparel Easy Patterns';
const homeDescription='Explore ready-to-use garment pattern blocks, printable sewing patterns and optional editable DXF files. Browse the apparel pattern library for sampling and garment development.';
const pageDefaults={
  products:['Ready-to-Use Professional Garment Patterns','Explore professional garment patterns, digital soft-copy options, physical patterns and sampling options. Check available sizes, formats and delivery details.'],
  courses:['Online Pattern Making Class Enquiries','Request information about online pattern making classes. Share your learning interests and experience.'],
  classes:['Online Pattern Making Classes - Enquiry Only','Request information about upcoming online pattern making classes. No payment is required to enquire.'],
  contact:['Contact Garment Design Studio','Contact Garment Design Studio by email, WhatsApp or phone for pattern enquiries, online classes and garment development requirements.'],
};
const settingsDefaults=Object.fromEntries(Object.entries(pageDefaults).flatMap(([key,[title,description]])=>[[key+'_seo_title',title],[key+'_seo_description',description]]));
const jsonLd=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
function organization(settings){const url=siteOrigin();return url?{'@context':'https://schema.org','@type':'Organization',name:settings.store_name,url,email:settings.contact_email,telephone:settings.contact_phone}:null;}
function publicImageUrl(path){
  if(typeof path!=='string'||!path.trim())return '';
  try{const image=new URL(path,siteOrigin());return ['http:','https:'].includes(image.protocol)&&!image.username&&!image.password?image.href:'';}catch{return '';}
}
function productData(product){
  const origin=siteOrigin(),images=(product.images||[]).map(publicImageUrl).filter(Boolean);
  if(product.status==='draft'||product.status==='coming_soon'||product.pattern_options?.printable===false)return null;
  if(!origin||!product.active||!product.name||!product.slug||!images.length||!(product.base_price>0))return null;
  const url=origin+'/product/'+encodeURIComponent(product.slug);
  return {'@context':'https://schema.org','@type':'Product',name:product.name,...(product.description?{description:product.description}:{}),image:images,url,offers:{'@type':'Offer',url,priceCurrency:'INR',price:Number(product.base_price).toFixed(2)}};
}
function productMetadata(product){
  return {
    seoTitle:product.seo_title?.trim()||`${product.name} | Garment Pattern | Apparel Easy Patterns`,
    description:product.seo_description?.trim()||(product.description||product.name).replace(/\s+/g,' ').trim().slice(0,160),
    ogImage:publicImageUrl(product.images?.[0]),
    productStructuredData:productData(product),
  };
}
module.exports={siteOrigin,pageDefaults,settingsDefaults,homeTitle,homeDescription,jsonLd,organization,publicImageUrl,productData,productMetadata};
