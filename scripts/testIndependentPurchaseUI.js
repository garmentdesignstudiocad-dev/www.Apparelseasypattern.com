// Executes the product page's actual script with a small DOM fixture; no network or DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const template = fs.readFileSync(path.join(__dirname, '../views/product.ejs'), 'utf8');
const script = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const source = ejs.render(script, {basePrice:399, physicalPrice:399, gstRate:18, product:{name:'Fixture', slug:'fixture'}});

function fixture() {
  const nodes = new Map(), requests = [];
  function node() {
    return {checked:false, disabled:false, value:'', textContent:'', dataset:{}, style:{}, events:{},
      classList:{add(){}, remove(){}, toggle(){}}, setAttribute(){},
      addEventListener(name, fn){this.events[name] = fn;},
      querySelector(){return null;}};
  }
  const get = id => {if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id);};
  get('pattern-config').textContent = JSON.stringify({id:'507f1f77bcf86cd799439011', formatPricing:{dxf:399,hpgl:399,plt:399}, isBundleActive:true, bundlePrice:399});
  get('physical-copies').value = '1';
  get('physical-copies').disabled = true;
  const pills = kind => ['S','M'].map(size => {
    const pill = node(), input = node();
    pill.dataset[kind + 'Size'] = size;
    input.value = size;
    input.dataset.price = '399';
    input.checked = kind === 'soft' && size === 'S';
    pill.querySelector = () => input;
    return pill;
  });
  const soft = pills('soft'), physical = pills('phys');
  for (const format of ['Dxf','Hpgl','Plt','Pdf']) {
    get('formatInput' + format).value = format.toLowerCase();
    get('formatCard' + format).querySelector = selector => selector === 'input' ? get('formatInput' + format) : null;
  }
  const document = {getElementById:get, querySelector:()=>null, querySelectorAll:selector => {
    if (selector === '.ref-size-pill[data-soft-size]') return soft;
    if (selector === '.ref-size-pill[data-phys-size]') return physical;
    if (selector === '.phys-size-check') return physical.map(pill=>pill.querySelector());
    return [];
  }};
  vm.runInNewContext(source, {document, window:{addEventListener(){},location:{}}, URLSearchParams,
    fetch:async(url, options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};}});
  const fire = (element, event='click') => element.events[event]?.({preventDefault(){}});
  return {get, soft, physical, requests, fire, async buy(){fire(get('pdBuyNow'));await new Promise(resolve=>setImmediate(resolve));},
    digital(){get('digital-option').checked=true;fire(get('digital-option'),'change');},
    print(){fire(get('physicalPrintoutCard'));physical.forEach(pill=>fire(pill));get('physical-copies').value='2';fire(get('physical-copies'),'input');}};
}

(async()=>{
  for (const mode of ['neither','physical','digital','both']) {
    const ui = fixture();
    assert.equal(ui.get('sumSubtotal').textContent, '₹0');
    if (mode === 'digital' || mode === 'both') {ui.digital();ui.fire(ui.get('btnSelectAllSoftSizes'));}
    if (mode === 'physical' || mode === 'both') ui.print();
    await ui.buy();
    if (mode === 'neither') {
      assert.equal(ui.requests.length, 0);
      assert.match(ui.get('pattern-error').textContent, /Select Physical Pattern Printout/);
    } else {
      assert.equal(ui.requests.length, 1);
      const item = ui.requests[0].body;
      const digital = mode !== 'physical', physical = mode !== 'digital';
      assert.equal(item.quantity, digital ? 1 : 0);
      assert.equal(item.printable_selected, digital);
      assert.equal(item.selected_sizes.length, digital ? 2 : 0);
      assert.equal(item.selected_formats.length, digital ? 3 : 0);
      assert.equal(item.physical_quantity, physical ? 4 : 0);
      assert.equal(item.physical_sizes.length, physical ? 2 : 0);
      assert.equal(ui.get('sumSubtotal').textContent, '₹' + ((digital ? 798 : 0) + (physical ? 1596 : 0)).toLocaleString('en-IN'));
    }
    console.log('PASS mocked product DOM: ' + mode);
  }
  for (const missing of ['digital-size','digital-format','physical-size','physical-quantity']) {
    const ui = fixture();ui.digital();ui.print();
    if (missing === 'digital-size') ui.fire(ui.get('btnClearSoftSizes'));
    if (missing === 'digital-format') for (const fmt of ['Dxf','Hpgl','Plt']) ui.fire(ui.get('formatCard' + fmt));
    if (missing === 'physical-size') ui.fire(ui.get('btnClearPhysSizes'));
    if (missing === 'physical-quantity') ui.get('physical-copies').value = '1.5';
    await ui.buy();assert.equal(ui.requests.length, 0, missing);
    assert.match(ui.get('pattern-error').textContent, /Select at least one/);
  }
  const ui = fixture();ui.digital();ui.print();
  ui.get('digital-option').checked=false;ui.fire(ui.get('digital-option'),'change');
  await ui.buy();assert.equal(ui.requests[0].body.quantity, 0);
  assert.equal(ui.requests[0].body.selected_formats.length, 0);
  assert.equal(ui.requests[0].body.selected_sizes.length, 0);
  assert.equal(ui.get('sumSubtotal').textContent, '₹1,596');
  console.log('PASS incomplete selections blocked and disabled digital selections excluded from payload/totals.');
})().catch(error=>{console.error(error);process.exitCode=1;});
