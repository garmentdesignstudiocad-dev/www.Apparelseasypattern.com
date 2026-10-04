(() => {
  const config=JSON.parse(document.getElementById('pattern-config').textContent);
  const form=document.getElementById('pattern-purchase'), button=document.getElementById('pdAddToCart');
  const checked=id=>Boolean(document.getElementById(id)?.checked);
  const selected=selector=>[...form.querySelectorAll(selector)].filter(input=>input.checked);
  const sizes=()=>document.getElementById('pattern-sizes')?[...new Set(document.getElementById('pattern-sizes').value.split(',').map(s=>s.trim()).filter(Boolean))]:selected('.pattern-size').map(input=>input.value);
  const money=value=>'₹'+(value/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const paise=value=>Math.round(Number(value)*100);
  function update(){
    const chosen=sizes(),count=Math.max(1,chosen.length);
    let total=checked('printable-option')?paise(config.base)+(count-1)*paise(config.extra):0;
    total+=selected('.pattern-file, .pattern-addon').reduce((n,input)=>n+paise(input.dataset.price),0);
    if(checked('physical-option'))total+=chosen.length?chosen.reduce((sum,size)=>sum+paise(config.sizePrices.find(row=>row.size===size)?.price ?? config.physical),0):paise(config.physical);
    if(checked('trial-option'))total+=count*paise(config.trial);
    const tax=Math.round(total*18/100);
    document.getElementById('pattern-subtotal').textContent=money(total);
    document.getElementById('pattern-tax').textContent=money(tax);
    document.getElementById('pdTotal').textContent=money(total+tax);
  }
  form.addEventListener('input',update);update();
  form.addEventListener('submit',async event=>{
    event.preventDefault();const error=document.getElementById('pattern-error');error.textContent='';
    const chosen=sizes(),files=selected('.pattern-file').map(input=>input.value),printable=checked('printable-option');
    if(!chosen.length || chosen.some(s=>!/^[a-zA-Z0-9 ._-]{1,40}$/.test(s))){error.textContent='Select or enter the sizes you require.';return;}
    if(!printable && !files.length && !checked('physical-option') && !checked('trial-option')){error.textContent='Select at least one pattern option.';return;}
    button.disabled=true;
    try{
      const response=await fetch('/cart/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:config.id,selected_sizes:chosen,printable_selected:printable,quantity:printable||files.length?1:0,physical_quantity:checked('physical-option')?chosen.length:0,trial_quantity:checked('trial-option')?chosen.length:0,files,addons:selected('.pattern-addon').map(input=>input.value)})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not add this pattern.');
      location.href='/cart';
    }catch(problem){error.textContent=problem.message;button.disabled=false;}
  });
})();
