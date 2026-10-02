document.addEventListener('DOMContentLoaded',()=>{
  const root=document.getElementById('webinar-payment'); if(!root) return;
  const pay=document.getElementById('webinar-pay'),check=document.getElementById('webinar-check'),message=document.getElementById('webinar-payment-message');
  const setBusy=value=>{if(pay)pay.disabled=value;if(check)check.disabled=value;};
  async function request(action,body={}) {
    const response=await fetch(`${root.dataset.base || '/webinar-registrations'}/${root.dataset.id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_csrf:root.dataset.csrf,...body})});
    const data=await response.json().catch(()=>({error:'Session expired or server unavailable. Reload this page.'}));
    if(!response.ok) throw new Error(data.error || 'Unable to complete this request.'); return data;
  }
  async function status() {setBusy(true);try{const data=await request('check');if(data.confirmed)window.location.assign(data.redirect);else message.textContent=data.message;}catch(error){message.textContent=error.message;}finally{setBusy(false);}}
  check?.addEventListener('click',status);
  pay?.addEventListener('click',async()=>{
    setBusy(true);message.textContent='Preparing secure payment…';
    try {
      // Recover a captured payment before offering another checkout attempt.
      const current=await request('check');if(current.confirmed){window.location.assign(current.redirect);return;}
      const data=await request('order');if(data.confirmed){window.location.assign(data.redirect);return;}
      if(typeof window.Razorpay!=='function')throw new Error('Razorpay could not load. Reload this page and try again.');
      const checkout=new window.Razorpay({key:data.key,order_id:data.order_id,amount:data.amount,currency:data.currency,name:'Garment Design Studio',description:root.dataset.description || 'Webinar Registration',prefill:{name:data.name,email:data.email,contact:data.contact},handler:async result=>{
        message.textContent='Verifying payment…';
        try {const verified=await request('verify',result);if(verified.confirmed)window.location.assign(verified.redirect);else{message.textContent=verified.message+' Reload this page to check again.';setBusy(false);}}
        catch(error){message.textContent=error.message+' Reload this page and check payment status before paying again.';setBusy(false);}
      },modal:{ondismiss:()=>{message.textContent='Payment window closed. Reload this page to check payment status or retry.';setBusy(false);}}});
      checkout.on('payment.failed',()=>{message.textContent='Payment was not completed. Reload this page to check status or retry.';setBusy(false);});
      checkout.open();
    }catch(error){message.textContent=error.message;setBusy(false);}
  });
});
