/* Touch-first honeycomb feed. No external libraries or network requests. */
window.createStorygeFeed = function(host, items, openItem) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  const listen = (el, event, fn) => el.addEventListener(event, fn, {signal:abort.signal});
  const points = [[0,0],[0,-1],[1,-1],[1,0],[0,1],[-1,1],[-1,0],[1,-2],[-1,2]];
  for(let ring=2;points.length<items.length;ring++) {
    for(let q=-ring;q<=ring;q++) for(let r=-ring;r<=ring;r++) {
      if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))===ring && !points.some(p=>p[0]===q&&p[1]===r))points.push([q,r]);
    }
  }
  let width=0,height=0,pan={x:0,y:0},target={x:0,y:0},pointer=null,drag=null,frame=0,last=0;
  let suppressedUntil=0,disposed=false;
  const nodes=items.map((item,i)=>{
    const button=document.createElement('button');
    button.className='feed-bubble';button.type='button';
    button.setAttribute('aria-label',`${item.title} · ${item.platform} 상세 보기`);
    const img=document.createElement('img');img.src=item.image;img.alt='';img.draggable=false;
    button.append(img);host.append(button);
    const node={button,q:points[i][0],r:points[i][1],scale:1};
    listen(button,'click',e=>{if(performance.now()<suppressedUntil){e.preventDefault();return;}openItem(item.id);});
    listen(button,'focus',()=>{if(drag||!button.matches(':focus-visible'))return;const step=spacing();target={x:-(node.q+node.r/2)*step,y:-node.r*step*.866};draw(performance.now(),true);});
    return node;
  });
  const spacing=()=>Math.min(120,Math.max(98,width*.30));
  function measure(){width=host.clientWidth;height=host.clientHeight;draw(performance.now(),true);}
  function draw(time,instant=false){
    if(disposed)return;
    const dt=Math.min(40,time-last||16);last=time;
    const ease=instant||motion.matches?1:1-Math.exp(-dt/75);
    pan.x+=(target.x-pan.x)*ease;pan.y+=(target.y-pan.y)*ease;
    const step=spacing(),size=step*.83;
    for(const [i,n] of nodes.entries()){
      const x=width/2+(n.q+n.r/2)*step+pan.x;
      const y=height/2+n.r*step*.866+pan.y;
      const focus=pointer||{x:width/2,y:height/2};
      const dist=Math.hypot(x-focus.x,y-focus.y);
      const desired=motion.matches?1:pointer ? .72+.58*Math.exp(-dist*dist/(step*step*.7)) : .88+.22*Math.exp(-dist*dist/(step*step*1.5));
      n.scale+=(desired-n.scale)*ease;
      const drift=motion.matches||pointer?0:Math.sin(time/1900+i*1.7)*3;
      n.button.style.width=n.button.style.height=`${size}px`;
      n.button.style.transform=`translate3d(${x-size/2}px,${y-size/2+drift}px,0) scale(${n.scale})`;
      n.button.style.zIndex=String(Math.round(n.scale*100));
    }
  }
  function tick(t){if(!document.hidden&&!host.closest('[inert]'))draw(t);frame=requestAnimationFrame(tick);}
  listen(host,'pointerdown',e=>{
    if(e.button!==0||drag)return;
    const rect=host.getBoundingClientRect();
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:target.x,py:target.y,moved:false,rect};
    pointer={x:e.clientX-rect.left,y:e.clientY-rect.top,active:true};
  });
  listen(host,'pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(Math.hypot(dx,dy)>7&&!drag.moved){drag.moved=true;host.setPointerCapture(e.pointerId);}
    if(drag.moved){
      const limitX=Math.max(...nodes.map(n=>Math.abs(n.q+n.r/2)),1)*spacing();
      const limitY=Math.max(...nodes.map(n=>Math.abs(n.r)),1)*spacing()*.866;
      target.x=Math.max(-limitX,Math.min(limitX,drag.px+dx));target.y=Math.max(-limitY,Math.min(limitY,drag.py+dy));
    }
    pointer={x:e.clientX-drag.rect.left,y:e.clientY-drag.rect.top,active:true};
    if(motion.matches)draw(performance.now(),true);
  });
  function release(e){if(!drag||e.pointerId!==drag.id)return;if(drag.moved||e.type==='pointercancel')suppressedUntil=performance.now()+350;drag=null;pointer=null;if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);}
  listen(host,'pointerup',release);listen(host,'pointercancel',release);listen(host,'lostpointercapture',release);
  listen(host,'pointerleave',e=>{if(drag&&!drag.moved)release(e);});
  const resize=new ResizeObserver(measure);resize.observe(host);
  listen(motion,'change',()=>{cancelAnimationFrame(frame);draw(performance.now(),true);if(!motion.matches)frame=requestAnimationFrame(tick);});
  measure();if(!motion.matches)frame=requestAnimationFrame(tick);
  return {destroy(){disposed=true;cancelAnimationFrame(frame);resize.disconnect();abort.abort();}};
};
