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
      classList:{add(){}, remove(){}, toggle(){}}, setAttribute(){}, setCustomValidity(message){this.validationMessage=message;},
      addEventListener(name, fn){this.events[name] = fn;},
      querySelector(){return null;}};
  }
  const get = id => {if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id);};
  get('pattern-config').textContent = JSON.stringify({id:'507f1f77bcf86cd799439011', formatPricing:{dxf:399,hpgl:399,plt:399}, isBundleActive:true, bundlePrice:399});
  get('physical-copies').value = '1';
  get('physical-copies').disabled = true;
  const pills = kind => ['S','M','L'].map(size => {
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
  const trialRows = ['S','M','L'].map(size => {
    const row = get('trial-size-row-' + size.toLowerCase());
    row.dataset.size = size;
    return row;
  });
  get('trial-select-s').value = '1';
  get('trial-select-m').value = '1';
  get('trial-select-l').value = '1';
  const container = get('trialSamplePerSizeContainer');
  container.appendChild = () => {};

  const document = {getElementById:get, querySelector:()=>null, querySelectorAll:selector => {
    if (selector === '.ref-size-pill[data-soft-size]') return soft;
    if (selector === '.ref-size-pill[data-phys-size]') return physical;
    if (selector === '.phys-size-check') return physical.map(pill=>pill.querySelector());
    if (selector === '.soft-size-check') return soft.map(pill=>pill.querySelector());
    if (selector === '.trial-size-row' || selector === '.trial-size-card') return trialRows;
    if (selector === '.trial-size-select') return ['s','m','l'].map(size => get('trial-select-' + size));
    return [];
  }};
  vm.runInNewContext(source, {document, window:{addEventListener(){},location:{}}, URLSearchParams,
    fetch:async(url, options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};}});
  const fire = (element, event='click') => element.events[event]?.({preventDefault(){}});
  return {
    get, soft, physical, requests, fire,
    async buy(){fire(get('pdBuyNow'));await new Promise(resolve=>setImmediate(resolve));},
    digital(){get('digital-option').checked=true;fire(get('digital-option'),'change');},
    print(){fire(get('physicalPrintoutCard'));physical.forEach(pill=>fire(pill));get('physical-copies').value='2';fire(get('physical-copies'),'input');},
    setPhysSizes(sizes) {
      physical.forEach(pill => {
        const inp = pill.querySelector();
        inp.checked = sizes.includes(pill.dataset.physSize);
      });
      fire(get('btnSelectAllPhysSizes'));
      // manually uncheck any not in sizes
      physical.forEach(pill => {
        const inp = pill.querySelector();
        if (!sizes.includes(pill.dataset.physSize)) inp.checked = false;
      });
      // trigger update
      fire(physical[0]);
      // restore physical[0] if it was supposed to be checked
      if (sizes.includes(physical[0].dataset.physSize)) physical[0].querySelector().checked = true;
    }
  };
}

(async()=>{
  // 1. HARD COPY -> TRIAL SAMPLE SYNCHRONIZATION TESTS
  {
    const ui = fixture();
    ui.get('trial-sample-option').dataset.price = '125';
    // Enable Physical Pattern Printout (Hard Copy)
    ui.fire(ui.get('physicalPrintoutCard'));
    // Select Hard Copy sizes S and M
    ui.physical[0].querySelector().checked = true; // S
    ui.physical[1].querySelector().checked = true; // M
    ui.physical[2].querySelector().checked = false; // L
    ui.fire(ui.get('physicalPrintoutCard')); // update
    ui.fire(ui.get('physicalPrintoutCard'));

    // Enable Trial Fit Sample
    ui.fire(ui.get('trialSampleCard'));

    // Verify Trial Sample displays S and M, and hides L
    assert.equal(ui.get('trial-size-row-s').style.display, 'flex');
    assert.equal(ui.get('trial-size-row-m').style.display, 'flex');
    assert.equal(ui.get('trial-size-row-l').style.display, 'none');

    // Set quantities: S=2, M=1
    ui.get('trial-select-s').value = '2';
    ui.get('trial-select-m').value = '1';
    ui.fire(ui.get('trial-select-s'), 'change');

    await ui.buy();
    assert.equal(ui.requests.length, 1);
    const item1 = ui.requests[0].body;
    assert.equal(item1.trial_quantity, 3);
    assert.deepEqual(item1.trial_sizes, { S: 2, M: 1 });
    assert.deepEqual(item1.physical_sizes, ['S', 'M']);
    console.log('PASS Hard Copy S+M -> Trial Sample S+M synchronized (S=2, M=1 -> Total 3).');
  }

  // 2. Add L to Hard Copy -> L appears automatically in Trial Sample
  {
    const ui = fixture();
    ui.get('trial-sample-option').dataset.price = '125';
    ui.fire(ui.get('physicalPrintoutCard'));
    ui.physical[0].querySelector().checked = true; // S
    ui.physical[1].querySelector().checked = true; // M
    ui.physical[2].querySelector().checked = true; // L added!
    ui.fire(ui.get('trialSampleCard'));
    ui.fire(ui.get('physicalPrintoutCard'));
    ui.fire(ui.get('physicalPrintoutCard'));

    assert.equal(ui.get('trial-size-row-s').style.display, 'flex');
    assert.equal(ui.get('trial-size-row-m').style.display, 'flex');
    assert.equal(ui.get('trial-size-row-l').style.display, 'flex');

    ui.get('trial-select-s').value = '2';
    ui.get('trial-select-m').value = '1';
    ui.get('trial-select-l').value = '2';
    ui.fire(ui.get('trial-select-l'), 'change');

    await ui.buy();
    assert.equal(ui.requests.length, 1);
    const item2 = ui.requests[0].body;
    assert.equal(item2.trial_quantity, 5);
    assert.deepEqual(item2.trial_sizes, { S: 2, M: 1, L: 2 });
    assert.deepEqual(item2.physical_sizes, ['S', 'M', 'L']);
    console.log('PASS Add L -> Trial Sample L appears, S=2, M=1, L=2 -> Total 5 samples.');
  }

  // 3. Remove M from Hard Copy -> M disappears, quote updates, S and L preserved
  {
    const ui = fixture();
    ui.get('trial-sample-option').dataset.price = '125';
    ui.fire(ui.get('physicalPrintoutCard'));
    ui.physical[0].querySelector().checked = true; // S
    ui.physical[1].querySelector().checked = false; // M deselected!
    ui.physical[2].querySelector().checked = true; // L
    ui.fire(ui.get('trialSampleCard'));
    ui.fire(ui.get('physicalPrintoutCard'));
    ui.fire(ui.get('physicalPrintoutCard'));

    assert.equal(ui.get('trial-size-row-s').style.display, 'flex');
    assert.equal(ui.get('trial-size-row-m').style.display, 'none'); // M removed!
    assert.equal(ui.get('trial-size-row-l').style.display, 'flex');

    ui.get('trial-select-s').value = '2';
    ui.get('trial-select-l').value = '1';
    ui.fire(ui.get('trial-select-s'), 'change');

    await ui.buy();
    assert.equal(ui.requests.length, 1);
    const item3 = ui.requests[0].body;
    assert.equal(item3.trial_quantity, 3);
    assert.deepEqual(item3.trial_sizes, { S: 2, L: 1 });
    assert.deepEqual(item3.physical_sizes, ['S', 'L']);
    console.log('PASS Remove M -> Trial Sample M removed, quote excludes M, S and L preserved.');
  }

  // 4. Hard Copy with no sizes selected -> No Trial Sample cards displayed
  {
    const ui = fixture();
    ui.get('trial-sample-option').dataset.price = '125';
    ui.fire(ui.get('physicalPrintoutCard'));
    ui.physical.forEach(pill => pill.querySelector().checked = false);
    ui.fire(ui.get('trialSampleCard'));
    ui.fire(ui.get('physicalPrintoutCard'));
    ui.fire(ui.get('physicalPrintoutCard'));

    assert.equal(ui.get('trial-size-row-s').style.display, 'none');
    assert.equal(ui.get('trial-size-row-m').style.display, 'none');
    assert.equal(ui.get('trial-size-row-l').style.display, 'none');
    assert.equal(ui.get('trialSampleEmptyWarning').style.display, 'block');
    await ui.buy();
    assert.equal(ui.requests.length, 0);
    assert.match(ui.get('pattern-error').textContent, /Pattern Hard Copy size/);
    console.log('PASS No Hard Copy sizes selected -> No Trial Sample cards displayed.');
  }

  // 5. Independent Trial Sample purchase (Hard Copy not clicked)
  for (const [sCount, mCount] of [[1,1], [1,2], [2,1], [2,2]]) {
    const ui = fixture();
    ui.get('trial-sample-option').dataset.price = '125';
    ui.get('trial-select-s').value = String(sCount);
    ui.get('trial-select-m').value = String(mCount);
    ui.fire(ui.get('trialSampleCard'));
    ui.soft[0].querySelector().checked = true;
    ui.soft[1].querySelector().checked = true;
    ui.soft[2].querySelector().checked = false;
    ui.fire(ui.get('btnSelectAllSoftSizes'));
    ui.soft[2].querySelector().checked = false;
    ui.fire(ui.get('trial-select-s'), 'change');
    await ui.buy();
    assert.equal(ui.requests.length, 1);
    const item = ui.requests[0].body;
    assert.equal(item.trial_quantity, sCount + mCount);
    assert.deepEqual(item.trial_sizes, { S: sCount, M: mCount });
    const server = require('../services/orderPricing').itemPrice({ trial_price: 125, physical_price: 0 }, [], [], item);
    assert.equal(ui.get('sumSubtotal').textContent, '₹' + server.total.toLocaleString('en-IN'));
  }
  for (const count of [3, 4, 0, 1.5, '']) {
    const ui = fixture();
    ui.get('trial-sample-option').dataset.price = '125';
    ui.get('trial-select-s').value = String(count);
    ui.fire(ui.get('trialSampleCard'));
    ui.soft[0].querySelector().checked = true;
    ui.soft[1].querySelector().checked = true;
    ui.soft[2].querySelector().checked = false;
    ui.fire(ui.get('btnSelectAllSoftSizes'));
    ui.soft[2].querySelector().checked = false;
    ui.fire(ui.get('trial-select-s'), 'change');
    await ui.buy();
    assert.equal(ui.requests.length, 0);
    assert.match(ui.get('pattern-error').textContent, /Maximum 2/);
  }
  console.log('PASS independent trial DOM: native dropdowns 1 and 2 per size, quote matches server, invalid quantities blocked.');

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
      assert.equal(item.selected_sizes.length, digital ? 3 : 0);
      assert.equal(item.selected_formats.length, digital ? 3 : 0);
      assert.equal(item.physical_quantity, physical ? 6 : 0);
      assert.equal(item.physical_sizes.length, physical ? 3 : 0);
      assert.equal(ui.get('sumSubtotal').textContent, '₹' + ((digital ? 1197 : 0) + (physical ? 2394 : 0)).toLocaleString('en-IN'));
    }
    console.log('PASS mocked product DOM: ' + mode);
  }
  for (const missing of ['digital-size','digital-format','physical-size','physical-quantity']) {
    const ui = fixture();ui.digital();ui.print();
    if (missing === 'digital-size') ui.fire(ui.get('btnClearSoftSizes'));
    if (missing === 'digital-format') for (const fmt of ['Dxf','Hpgl','Plt']) ui.fire(ui.get('formatCard' + fmt));
    if (missing === 'physical-size') ui.fire(ui.get('btnClearPhysSizes'));
    if (missing === 'physical-quantity') {ui.get('physical-copies').value = '0';ui.fire(ui.get('physical-copies'),'input');}
    await ui.buy();
    assert.equal(ui.requests.length, 0);
    assert.ok(ui.get('pattern-error').textContent.length > 0);
    console.log('PASS blocked missing requirement: ' + missing);
  }
  {
    const ui = fixture();
    ui.get('miniMarkerOption').dataset.price = '149';
    ui.get('miniMarkerOption').dataset.files = JSON.stringify(['marker-file-1']);
    ui.get('miniMarkerOption').checked = true;
    ui.fire(ui.get('miniMarkerOption'), 'change');
    assert.equal(ui.get('sumSubtotal').textContent, '₹149');
    await ui.buy();
    assert.equal(ui.requests.length, 1);
    const item = ui.requests[0].body;
    assert.equal(item.quantity, 1);
    assert.equal(item.printable_selected, false);
    assert.deepEqual(item.files, ['marker-file-1']);
    ui.get('miniMarkerOption').checked = false;
    ui.fire(ui.get('miniMarkerOption'), 'change');
    assert.equal(ui.get('sumSubtotal').textContent, '₹0');
    console.log('PASS mini marker selected/deselected totals and marker-only purchase payload.');
  }
  {
    const ui = fixture();
    ui.digital();
    ui.fire(ui.get('formatCardDxf'));
    ui.fire(ui.get('formatCardHpgl'));
    ui.fire(ui.get('formatCardPlt'));
    await ui.buy();
    assert.equal(ui.requests.length, 0);
    assert.match(ui.get('pattern-error').textContent, /Select at least one digital format and size/);

    const ui2 = fixture();
    ui2.digital();
    ui2.fire(ui2.get('btnSelectAllSoftSizes'));
    ui2.get('formatCardPdf').querySelector = () => null;
    ui2.fire(ui2.get('digital-option'), 'change');
    await ui2.buy();
    assert.equal(ui2.requests.length, 1);
    assert.deepEqual(ui2.requests[0].body.selected_formats, ['dxf', 'hpgl', 'plt']);
    console.log('PASS incomplete selections blocked and disabled digital selections excluded from payload/totals.');
  }
})();
