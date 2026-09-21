/* Presentation controls independent of the fluid model. */
(() => {
  'use strict';
  const root=document.getElementById('ink-app');
  const button=root?.querySelector('#expand-view');
  if(!root||!button||!document.fullscreenEnabled)return;
  button.hidden=false;
  button.addEventListener('click',async()=>{
    try {
      if(document.fullscreenElement===root)await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch { /* The host may decline fullscreen; the normal view stays usable. */ }
  });
  document.addEventListener('fullscreenchange',()=>{
    button.textContent=document.fullscreenElement===root?'Exit full screen':'Expand view';
  });
})();
