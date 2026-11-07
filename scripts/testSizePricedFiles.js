const assert=require('node:assert/strict');
const pricing=require('../services/orderPricing');
const options=require('../services/patternOptions');

const product={name:'Pricing fixture',base_price:0,additional_size_price:0,physical_price:0,trial_price:0,pattern_options:{printable:true,physical:false,trial:false}};
const dxf={file_price:399,purpose:'dxf',price_per_selected_size:true};
const hpgl={file_price:399,purpose:'other',file_type:'HPGL',price_per_selected_size:true};
const item=(selected_sizes,files=[dxf])=>({quantity:1,physical_quantity:0,trial_quantity:0,printable_selected:false,selected_sizes,selected_files:files.map(file=>({id:file._id || 'file'}))});

assert.equal(pricing.itemPrice(product,[dxf],[],item(['M'])).digital,399,'One selected size charges one DXF rate.');
assert.equal(pricing.itemPrice(product,[dxf],[],item(['M','L','XL'])).digital,1197,'Three selected sizes charge three DXF rates.');
assert.equal(pricing.itemPrice(product,[dxf,hpgl],[],item(['M','L'],[dxf,hpgl])).digital,1596,'DXF and HPGL are each priced for both sizes.');
assert.equal(pricing.itemPrice(product,[{file_price:399}],[],item(['M','L'],[{file_price:399}])).digital,399,'Legacy flat-price files remain flat.');
assert.match(options.validate(product,[dxf],item([])),/at least one size/i,'Per-size files require at least one size.');
assert.match(options.validate(product,[dxf],item(['M','M'])),/each size only once/i,'Duplicate sizes are rejected.');
assert.match(options.validate(product,[dxf],item(['M',' m '])),/each size only once/i,'Case and whitespace duplicates are rejected.');
assert.equal(pricing.itemPrice(product,[dxf],[],{...item(['M','L']),quantity:2}).digital,1596,'Digital quantity multiplies the per-size file subtotal.');

console.log('PASS: one size, multiple sizes, DXF plus HPGL, legacy flat pricing, missing sizes, duplicate sizes, and quantity scaling.');
