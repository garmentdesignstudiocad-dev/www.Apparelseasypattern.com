// Missing option settings retain the legacy purchase contract for existing records.
const sizes = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
const publicFilter = {active:true, status:{$ne:'draft'}};
function availability(product) {
  return {printable:product.pattern_options?.printable !== false, physical:product.pattern_options?.physical !== false, trial:product.pattern_options?.trial !== false};
}
function printable(item) { return item.printable_selected !== false; }
function validate(product, files, item) {
  const available=availability(product), selected=item.selected_sizes || [];
  if(product.status==='draft' || product.status==='coming_soon')return 'This pattern is not available to purchase yet.';
  if(Number(item.quantity ?? 1)>0 && printable(item) && !available.printable)return 'Printable soft copy is unavailable.';
  if(Number(item.quantity ?? 1)>0 && !printable(item) && !files.length)return 'Select a digital option.';
  if(Number(item.physical_quantity)>0 && !available.physical)return 'Physical pattern is unavailable.';
  if(Number(item.trial_quantity)>0 && !available.trial)return 'Trial sample is unavailable.';
  if(product.available_sizes?.length && (!selected.length || selected.some(size=>!product.available_sizes.includes(size))))return 'Select the configured sizes for this pattern.';
  if(product.available_sizes?.length && [item.physical_quantity,item.trial_quantity].some(q=>Number(q)>0 && Number(q)%selected.length!==0))return 'Physical and trial quantities must include each selected size.';
  return '';
}
function physicalUnit(product, selected=[]) {
  if(!selected.length)return Number(product.physical_price || 0);
  return selected.reduce((sum,size)=>sum+Number(product.size_prices?.find(row=>row.size===size)?.price ?? product.physical_price ?? 0),0)/selected.length;
}
function parse(body) {
  if(body.pattern_configuration!=='1')return {};
  const text=(key,max=300)=>require('./businessValidation').text(body,key,max);
  const category=text('category',80).toLowerCase();
  if(category && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category))throw new Error('Use a category slug such as shirts or womens-dresses.');
  const status=text('status');if(!['active','draft','coming_soon'].includes(status))throw new Error('Choose a product status.');
  const available_sizes=[...new Set((text('available_sizes',500)).split(',').map(s=>s.trim()).filter(Boolean))];
  if(available_sizes.some(s=>!/^[a-zA-Z0-9 ._-]{1,40}$/.test(s)))throw new Error('Check available sizes.');
  const size_prices=text('size_prices',3000).split(/\r?\n/).filter(Boolean).map(line=>{const [size,value,...rest]=line.split('=');const price=Number(value);if(rest.length || !available_sizes.includes(size.trim()) || !value?.trim() || !Number.isFinite(price) || price<0 || price>1000000)throw new Error('Use one configured size=price per line.');return {size:size.trim(),price};});
  if(new Set(size_prices.map(s=>s.size)).size!==size_prices.length)throw new Error('Use each size price once.');
  const media={};for(const key of ['sample_image_url','video_url']){media[key]=text(key,2048);if(media[key] && !require('../config/appearance').safeUrl(media[key]))throw new Error('Use an HTTP(S) media URL.');}
  return {category,status,available_sizes,size_prices,...media,featured:body.featured==='on',printable_dimensions:text('printable_dimensions',500),pattern_options:{printable:body.printable_enabled==='on',physical:body.physical_enabled==='on',trial:body.trial_enabled==='on'}};
}
module.exports={sizes,publicFilter,availability,printable,validate,physicalUnit,parse};
