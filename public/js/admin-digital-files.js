document.getElementById('upload-form').addEventListener('submit',async function(event){
  event.preventDefault();const button=this.querySelector('button'),status=document.getElementById('upload-status'),file=document.getElementById('file').files[0];
  if(!file || file.size>30*1024*1024){status.textContent='Choose a file up to 30 MB.';return;}
  button.disabled=true;status.textContent='Uploading…';
  try{const response=await fetch(this.dataset.base+document.getElementById('destination').value,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-CSRF-Token':this.dataset.csrf,'X-File-Name':encodeURIComponent(file.name)},body:file});if(!response.ok)throw new Error(await response.text());status.textContent='Private file saved. Pending verified digital orders are prepared by the notification worker.';}catch(error){status.textContent=error.message || 'Upload failed.';}finally{button.disabled=false;}
});
