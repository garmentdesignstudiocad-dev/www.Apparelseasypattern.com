// Missing option settings retain the legacy purchase contract for existing records.
const sizes = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
const publicFilter = {active:true, status:{$ne:'draft'}};
function availability(product) {
  return {printable:product.pattern_options?.printable !== false, physical:product.pattern_options?.physical !== false, trial:product.pattern_options?.trial !== false};
}
function printable(item) { return item.printable_selected !== false; }
function validate(product, files, item) {
  const markerError=require('./markerOptions').validateFiles(product,files,item);
  if(markerError)return markerError;
  const available=availability(product), selected=item.selected_sizes || [];
  const physicalSelected = (Array.isArray(item.physical_sizes) && item.physical_sizes.length) ? item.physical_sizes : null;
  const trialSizes = (item.trial_sizes && typeof item.trial_sizes === 'object' && Object.keys(item.trial_sizes).length)
    ? Object.keys(item.trial_sizes)
    : (physicalSelected || selected);
  const priced=value=>value!==null && value!=='' && Number.isFinite(Number(value)) && Number(value)>0;
  if(Number(item.quantity ?? 1)>0 && printable(item) && !priced(product.base_price))return 'Digital pattern price is unavailable.';
  if(Number(item.quantity ?? 1)>0 && files.some(file=>!require('./markerOptions').isMarker(file) && !priced(file.file_price)))return 'Selected document price is unavailable.';
  if(Number(item.physical_quantity)>0 && !(item.physical_sizes?.length ? item.physical_sizes : selected).every(size=>priced(product.size_prices?.find(row=>row.size===size)?.price ?? product.physical_price)))return 'Physical pattern price is unavailable.';
  if(Number(item.physical_quantity)>0 && !priced(product.physical_price) && !(item.physical_sizes?.length || selected.length))return 'Physical pattern price is unavailable.';
  if(Number(item.trial_quantity)>0 && trialSizes.length && !product.available_sizes?.length)return 'Trial sample sizes are not configured.';
  if(Number(item.trial_quantity)>0 && !priced(product.trial_price))return 'Trial sample price is unavailable.';
  if(Number(item.trial_quantity)>0 && product.available_sizes?.length && (!trialSizes.length || trialSizes.some(size=>!product.available_sizes.includes(size)) || (!item.trial_sizes && Number(item.trial_quantity)%trialSizes.length!==0)))return 'Select configured sizes and a whole-number sample quantity for each size.';
  if(physicalSelected && Number(item.trial_quantity)>0) {
    if(trialSizes.length !== physicalSelected.length || trialSizes.some(size => !physicalSelected.includes(size))) {
      return 'Trial sample sizes must match selected Hard Copy sizes.';
    }
  }
  const trialError = require('./trialQuantity').validateItems([item]);
  if (trialError) return trialError;
  if(Number(item.quantity ?? 1)>0 && printable(item) && product.available_sizes?.length && (!Array.isArray(item.selected_formats) || !item.selected_formats.length || item.selected_formats.some(format=>!['dxf','hpgl','plt','pdf'].includes(format))))return 'Select at least one valid digital format.';
  if(files.some(file=>file.price_per_selected_size && !require('./markerOptions').isMarker(file))) {
    if(!Array.isArray(item.selected_sizes) || !selected.length)return 'Select at least one size for per-size digital files.';
    if(selected.some(size=>typeof size!=='string' || !/^[a-zA-Z0-9 ._-]{1,40}$/.test(size.trim())) || new Set(selected.map(size=>size.trim().toLowerCase())).size!==selected.length)return 'Choose each size only once for per-size digital files.';
  }
  if(product.status==='draft' || product.status==='coming_soon')return 'This pattern is not available to purchase yet.';
  if(Number(item.quantity ?? 1)>0 && printable(item) && !available.printable)return 'Printable soft copy is unavailable.';
  if(Number(item.quantity ?? 1)>0 && !printable(item) && !files.length)return 'Select a digital option.';
  if(Number(item.physical_quantity)>0 && !available.physical)return 'Physical pattern is unavailable.';
  if(Number(item.trial_quantity)>0 && !available.trial)return 'Trial sample is unavailable.';
  if(Number(item.quantity ?? 1)>0 && (printable(item) || files.some(file=>!require('./markerOptions').isMarker(file) && file.price_per_selected_size)) && product.available_sizes?.length && (!selected.length || selected.some(size=>!product.available_sizes.includes(size))))return 'Select the configured sizes for this pattern.';
  if(selected.length && product.available_sizes?.length && selected.some(size=>!product.available_sizes.includes(size)))return 'Select the configured sizes for this pattern.';
  if(Number(item.physical_quantity)>0 && product.available_sizes?.length && !physicalSelected && (Array.isArray(item.physical_sizes) || !selected.length))return 'Select at least one size for physical patterns.';
  if(Number(item.physical_quantity)>0 && physicalSelected && product.available_sizes?.length && physicalSelected.some(size=>!product.available_sizes.includes(size)))return 'Select configured sizes for physical patterns.';
  if(Number(item.physical_quantity)>0 && physicalSelected && Number(item.physical_quantity)%physicalSelected.length!==0)return 'Choose a whole-number print quantity for each selected physical size.';
  if(!physicalSelected && product.available_sizes?.length && Number(item.physical_quantity)>0 && selected.length>0 && Number(item.physical_quantity)%selected.length!==0)return 'Physical and trial quantities must include each selected size.';
  if(!item.trial_sizes && product.available_sizes?.length && Number(item.trial_quantity)>0 && trialSizes.length>0 && Number(item.trial_quantity)%trialSizes.length!==0)return 'Physical and trial quantities must include each selected size.';
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
