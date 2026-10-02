function amazonUrl(value) {
  try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.port && /(^|\.)amazon\.(in|com|co\.uk|de|fr|it|es|ca|com\.au)$/.test(u.hostname); } catch {return false;}
}
const fields={size_information:3000,file_formats:500,delivery_information:3000,download_information:3000,seo_title:200,seo_description:320,amazon_listing_url:2048};
function parse(body){
  const data={};
  for(const [key,max] of Object.entries(fields)) {
    if(body[key]===undefined)continue;
    if(typeof body[key]!=='string' || body[key].length>max)throw new Error('Invalid product detail.');
    data[key]=body[key].trim();
  }
  if(data.amazon_listing_url && !amazonUrl(data.amazon_listing_url))throw new Error('Use a valid HTTPS Amazon listing URL.');
  return data;
}
module.exports={amazonUrl,fields,parse};
