const defaults={
  linkedin_personal_url:'https://www.linkedin.com/in/s-s-ganesh-subramani?utm_source=share_via&utm_content=profile&utm_medium=member_android',
  linkedin_business_url:'https://www.linkedin.com/in/garment-design-studio-garment-technology-consultant-5a6673408?utm_source=share_via&utm_content=profile&utm_medium=member_android',
  linkedin_show_books:true,linkedin_show_footer:true,
};
function validUrl(value){
  if(value==='')return true;
  if(typeof value!=='string' || value.length>2048)return false;
  try{const url=new URL(value);return url.protocol==='https:' && ['linkedin.com','www.linkedin.com'].includes(url.hostname) && !url.username && !url.password && !url.port;}catch{return false;}
}
function normalize(data={}){
  return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,data[key]===undefined?value:typeof value==='boolean'?data[key]===true:validUrl(data[key])?data[key]:'']));
}
module.exports={defaults,validUrl,normalize};
