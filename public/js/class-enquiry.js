(() => {const form=document.getElementById('class-enquiry');if(!form)return;
 const profession=form.querySelector('#profession');
 const update=()=>form.querySelectorAll('[data-status]').forEach(label=>{const active=label.dataset.status==='student'?profession.value==='Student':['Working Professional','Business Owner'].includes(profession.value);label.hidden=!active;const input=label.querySelector('input');input.disabled=!active;input.required=active;});
 profession.addEventListener('change',update);update();
})();
