(() => {
  let current=null;
  const close=(focus=true)=>{if(!current)return;const {popup,trigger}=current;current=null;popup.remove();trigger.setAttribute('aria-expanded','false');if(focus&&trigger.isConnected)trigger.focus({preventScroll:true});};
  function enhance(){
    document.querySelectorAll('#sort,#edit-folder').forEach(select=>{
      if(select.dataset.popupReady)return;
      select.dataset.popupReady='true';select.hidden=true;
      const trigger=document.createElement('button');trigger.type='button';trigger.className='select-trigger';
      trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
      const label=select.id==='sort'?'저장 시간 정렬':'폴더';
      const sync=()=>{trigger.replaceChildren(document.createTextNode(select.selectedOptions[0]?.textContent||''));trigger.insertAdjacentHTML('beforeend','<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>');trigger.setAttribute('aria-label',`${label}: ${select.selectedOptions[0]?.textContent}`);};
      sync();select.after(trigger);select.addEventListener('change',sync);
      trigger.onclick=()=>{
        if(current?.trigger===trigger){close();return;}close(false);
        const popup=document.createElement('div');popup.className='select-popup';popup.setAttribute('popover','manual');popup.setAttribute('role','listbox');popup.setAttribute('aria-label',label);
        const options=[...select.options].map(option=>{
          const button=document.createElement('button');button.type='button';button.className='select-option';button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.selected));button.disabled=option.disabled;
          button.append(document.createTextNode(option.textContent));const check=document.createElement('span');check.className='select-check';check.setAttribute('aria-hidden','true');check.textContent=option.selected?'✓':'';button.append(check);
          button.onclick=()=>{select.value=option.value;close();select.dispatchEvent(new Event('change',{bubbles:true}));enhance();const replacement=document.querySelector(`#${select.id}`)?.nextElementSibling;replacement?.focus({preventScroll:true});};popup.append(button);return button;
        });
        trigger.parentElement.append(popup);current={popup,trigger};trigger.setAttribute('aria-expanded','true');popup.showPopover();
        const rect=trigger.getBoundingClientRect();popup.style.minWidth=`${Math.max(154,rect.width)}px`;
        const size=popup.getBoundingClientRect();popup.style.left=`${Math.max(12,Math.min(rect.right-size.width,innerWidth-size.width-12))}px`;popup.style.top=`${Math.max(12,rect.bottom+size.height+8<innerHeight?rect.bottom+8:rect.top-size.height-8)}px`;
        (options.find(b=>b.getAttribute('aria-selected')==='true')||options[0])?.focus({preventScroll:true});
        popup.onkeydown=e=>{const enabled=options.filter(b=>!b.disabled);let i=enabled.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();i=e.key==='Home'?0:e.key==='End'?enabled.length-1:(i+(e.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;enabled[i]?.focus();}};
      };
    });
    if(current&&!current.trigger.isConnected)close(false);
  }
  document.addEventListener('pointerdown',e=>{if(current&&!current.popup.contains(e.target)&&!current.trigger.contains(e.target))close(false);},true);
  document.addEventListener('keydown',e=>{if(current&&['Escape','Tab'].includes(e.key)){e.stopImmediatePropagation();if(e.key==='Escape')e.preventDefault();close();}},true);
  window.addEventListener('resize',()=>close(false));
  document.addEventListener('scroll',e=>{if(current&&!current.popup.contains(e.target))close(false);},true);
  new MutationObserver(enhance).observe(document.getElementById('device'),{childList:true,subtree:true});enhance();
})();
