// Explicit upload slots take precedence over legacy descriptive filenames.
function isMarker(file) {
  return file.upload_slot ? /^marker(?:_|$)/.test(file.upload_slot) : /marker|fabric/i.test(file.file_name || '') || /marker/i.test(file.file_type || '');
}
const services = {stripes:['Stripes Marker Customization','stripes_marker_price'], checks:['Checks Marker Customization','checks_marker_price'], custom:['Custom Marker Specifications','custom_marker_price']};
function validateFiles(product, files, item) {
  if (!files.some(isMarker)) return '';
  if (!(Number(product.mini_marker_price)>0)) return 'Fabric Consumption Mini Marker price is unavailable.';
  if (Number(item.quantity ?? 1)!==1) return 'Choose one mini marker bundle per order item.';
  return '';
}
function enquiry(product, body) {
  let selected, dimensions;
  try { selected=JSON.parse(body.marker_services); dimensions=JSON.parse(body.marker_dimensions || '{}'); } catch { throw new Error('Choose valid marker services.'); }
  if (!Array.isArray(selected) || !selected.length || selected.length>3 || new Set(selected).size!==selected.length || selected.some(key=>typeof key!=='string' || !Object.hasOwn(services,key))) throw new Error('Choose valid marker services.');
  let sizes;try{sizes=JSON.parse(body.marker_sizes || '[]');}catch{throw new Error('Check selected sizes.');}
  if(!Array.isArray(sizes) || sizes.length>100 || sizes.some(size=>!product.available_sizes?.includes(size)))throw new Error('Check selected sizes.');
  const rows=['Selected Sizes: '+(sizes.join(', ') || 'Custom')], specs={stripes:[['repeat',0.1],['width',1]],checks:[['warp',0.1],['weft',0.1],['width',1]]};
  let total=0;
  for(const key of selected) {
    const [label,field]=services[key],price=Number(product[field]);
    if(!Number.isFinite(price) || price<=0)throw new Error(label+' price is unavailable.');
    total+=Math.round(price*100);
    rows.push(label+': INR '+price.toFixed(2));
    for(const [dimension,min] of specs[key] || []) {
      const value=Number(dimensions?.[key]?.[dimension]);
      if(!Number.isFinite(value) || value<min || value>10000)throw new Error('Enter valid '+key+' '+dimension+' in cm.');
      rows.push(dimension+': '+value+' cm');
    }
    if(key==='custom' && !String(body.marker_notes || '').trim() && !String(body.marker_measurements || '').trim())throw new Error('Enter custom measurements or marker specifications.');
  }
  for(const key of ['marker_notes','marker_measurements']) {
    if(typeof body[key]!=='string' || body[key].length>2000 || /[<>\u0000]/.test(body[key]))throw new Error('Check marker notes and measurements.');
    if(body[key].trim())rows.push((key==='marker_notes'?'Custom marker specifications / notes: ':'Custom measurements (cm): ')+body[key].trim());
  }
  return 'Product: '+product.name+'\n'+rows.join('\n')+'\nEnquiry service total: INR '+(total/100).toFixed(2)+' (not charged at checkout; studio confirmation required).';
}
function filePrice(product,files,file) {
  return isMarker(file) ? (files.find(isMarker)===file ? Number(product.mini_marker_price) : 0) : Number(file.file_price || 0);
}
module.exports={isMarker,validateFiles,enquiry,filePrice};
