(() => {
  const config=JSON.parse(document.getElementById('pattern-config').textContent);
  const form=document.getElementById('pattern-purchase'), button=document.getElementById('pdAddToCart'), buyNow=document.getElementById('pdBuyNow');
  const checked=id=>{const input=document.getElementById(id);return Boolean(input?.checked && !input.disabled);};
  const selected=selector=>[...form.querySelectorAll(selector)].filter(input=>input.checked && !input.disabled);
  const sizes=()=>document.getElementById('pattern-sizes')?[...new Set(document.getElementById('pattern-sizes').value.split(',').map(s=>s.trim()).filter(Boolean))]:selected('.pattern-size').map(input=>input.value);
  const money=value=>'₹'+(value/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const paise=value=>Math.round(Number(value)*100);
  function update(){
    const chosen=sizes(),count=Math.max(1,chosen.length);
    if(checked('printable-option') && chosen.length>1 && !(Number(config.extra)>0)){
      for(const id of ['pattern-subtotal','pattern-tax','pdTotal'])document.getElementById(id).textContent='Price confirmation required';
      return;
    }
    let total=checked('printable-option')?paise(config.base)+(count-1)*paise(config.extra):0;
    total+=selected('.pattern-file, .pattern-addon').reduce((n,input)=>n+paise(input.dataset.price)*(input.dataset.perSelectedSize==='1'?chosen.length:1),0);
    form.querySelectorAll('.pattern-file').forEach((input,index)=>{
      const detail=form.querySelector(`.pattern-file-price-detail[data-file-index="${input.dataset.fileIndex ?? index}"]`);
      if(!detail || input.disabled || input.dataset.perSelectedSize!=='1')return;
      const unit=paise(input.dataset.price),subtotal=unit*chosen.length;
      detail.textContent=chosen.length?`${chosen.length} selected size${chosen.length===1?'':'s'} × ${money(unit)} = ${money(subtotal)}`:'Select sizes to calculate this file option.';
    });
    if(checked('physical-option'))total+=chosen.length?chosen.reduce((sum,size)=>sum+paise(config.sizePrices.find(row=>row.size===size)?.price ?? config.physical),0):paise(config.physical);
    if(checked('trial-option'))total+=count*paise(config.trial);
    const tax=Math.round(total*18/100);
    document.getElementById('pattern-subtotal').textContent=money(total);
    document.getElementById('pattern-tax').textContent=money(tax);
    document.getElementById('pdTotal').textContent=money(total+tax);
  }
  ['input','change'].forEach(type=>form.addEventListener(type,update));update();
  async function submitAction(destination){
    const error=document.getElementById('pattern-error');error.textContent='';
    const chosen=sizes(),files=selected('.pattern-file').map(input=>input.value),printable=checked('printable-option');
    if(!chosen.length || chosen.some(s=>!/^[a-zA-Z0-9 ._-]{1,40}$/.test(s))){error.textContent='Select or enter the sizes you require.';return;}
    if(!printable && !files.length && !checked('physical-option') && !checked('trial-option')){error.textContent='Select at least one pattern option.';return;}
    if(printable && chosen.length>1 && !(Number(config.extra)>0)){error.textContent='Additional printable sizes need a confirmed price. Select one size or enquire with the studio.';return;}
    if(button)button.disabled=true;if(buyNow)buyNow.disabled=true;
    try{
      const response=await fetch('/cart/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:config.id,selected_sizes:chosen,printable_selected:printable,quantity:printable||files.length?1:0,physical_quantity:checked('physical-option')?chosen.length:0,trial_quantity:checked('trial-option')?chosen.length:0,files,addons:selected('.pattern-addon').map(input=>input.value)})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not add this pattern.');
      location.href=destination;
    }catch(problem){error.textContent=problem.message;if(button)button.disabled=false;if(buyNow)buyNow.disabled=false;}
  }
  form.addEventListener('submit',event=>{event.preventDefault();submitAction('/cart');});
  if(buyNow)buyNow.addEventListener('click',event=>{event.preventDefault();submitAction('/checkout');});
})();