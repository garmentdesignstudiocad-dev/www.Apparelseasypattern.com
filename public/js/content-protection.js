// Casual-copy deterrents only. Browsers cannot prevent OS screenshots or developer tools.
(() => {
  const regions=[...document.querySelectorAll('[data-protected-content]')];if(!regions.length)return;
  const editable=target=>target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],form'));
  const protectedTarget=target=>Boolean((target?.nodeType===3?target.parentElement:target)?.closest?.('[data-protected-content]'));
  const selectionProtected=()=>{const selection=window.getSelection();return selection && (protectedTarget(selection.anchorNode)||protectedTarget(selection.focusNode));};
  for(const region of regions){
    region.querySelectorAll('img').forEach(img=>img.draggable=false);
    for(const type of ['contextmenu','dragstart','selectstart'])region.addEventListener(type,event=>{if(!editable(event.target))event.preventDefault();});
  }
  document.addEventListener('copy',event=>{if(!editable(event.target) && selectionProtected())event.preventDefault();});
  document.addEventListener('keydown',event=>{
    if(editable(event.target) || event.altKey || !(event.ctrlKey||event.metaKey))return;
    const key=event.key.toLowerCase();
    if(key==='s' || key==='c' && (selectionProtected()||protectedTarget(event.target)))event.preventDefault();
  });
})();
