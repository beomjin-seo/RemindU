(() => {
  'use strict';
  const photos = [
    {id:'chair', photo:'1503602642458-232111445657', style:'product', brand:'FORM & OBJECT', headline:'A quiet place.', sub:'Everyday chair · Natural', title:'매일 곁에 두고 싶은 의자', description:'자연스러운 소재와 단정한 형태의 조합.'},
    {id:'forest', photo:'1441974231531-c6227db76b6e', style:'full', brand:'FIELD NOTES', headline:'Into the\nquiet.', sub:'A little further from the everyday.', title:'잠시, 초록 속으로', description:'다음 산책을 위해 저장해둔 숲의 한 장면.'},
    {id:'coffee', photo:'1495474472287-4d71bcdd2085', style:'editorial', brand:'SLOW SUNDAY', headline:'Slow\nmornings.', sub:'Coffee & small rituals', title:'천천히 시작하는 아침', description:'커피 한 잔과 함께하는 작은 일상의 취향.'},
    {id:'style', photo:'1515886657613-9f3515b0c78f', style:'full', brand:'THE EDIT', headline:'Less,\nbut better.', sub:'Notes on personal style', title:'가볍게 입는 하루', description:'다시 꺼내 보고 싶은 데일리 스타일.'},
    {id:'interior', photo:'1600210492486-724fe5c67fb0', style:'editorial', brand:'SPACES', headline:'Room\nto breathe.', sub:'At home, at ease.', title:'머물고 싶은 공간', description:'따뜻한 빛과 여유가 있는 거실.'},
    {id:'shoe', photo:'1549298916-b41d501d3772', style:'product', brand:'DAILY FINDS', headline:'One more step.', sub:'Sneakers · Warm tones', title:'다음 걸음을 위한 스니커즈', description:'색감이 마음에 들어 남겨둔 한 켤레.'},
    {id:'lake', photo:'1470770841072-f978cf4d019e', style:'full', brand:'SOMEWHERE', headline:'Stay\na little.', sub:'Places worth remembering', title:'언젠가 가보고 싶은 곳', description:'잔잔한 호수 너머로 펼쳐지는 풍경.'},
    {id:'perfume', photo:'1541643600914-78b084683601', style:'product', brand:'OBJECT JOURNAL', headline:'A lasting note.', sub:'Fragrance · The collection', title:'오래 기억하고 싶은 향', description:'좋아하는 향을 찾아가는 기록.'},
    {id:'books', photo:'1494438639946-1ebd1d20bf85', style:'editorial', brand:'ON THE SHELF', headline:'Between\nthe pages.', sub:'A reading list for a slower day', title:'다음에 펼쳐볼 이야기', description:'읽고 싶은 책과 곁에 두고 싶은 문장들.'},
  ];
  // Design fixtures, not actual photo-library metadata or calibrated AI results.
  // Keep capture time separate from file modification/import time for integration.
  const sampleAnalysis = {
    chair:{summary:'내추럴 우드 소재의 스툴',reason:'등받이 없는 형태와 밝은 나뭇결을 확인했어요.',confidence:92,capturedAt:'2026-09-05T14:32:00+09:00'},
    forest:{summary:'햇빛이 들어오는 숲속 풍경',reason:'빽빽한 나무와 그 사이로 들어오는 빛을 확인했어요.',confidence:30,capturedAt:'2026-09-05T11:08:00+09:00'},
    coffee:{summary:'라테 아트가 올라간 커피',reason:'커피 위의 우유 거품과 잎 모양 패턴을 확인했어요.',confidence:70,capturedAt:'2026-09-04T09:16:00+09:00'},
    style:{summary:'옐로 컬러의 셔츠·팬츠 셋업',reason:'상의와 하의의 색상, 셔츠 칼라를 확인했어요.',confidence:31,capturedAt:'2026-09-04T08:45:00+09:00'},
    interior:{summary:'뉴트럴 톤의 거실 인테리어',reason:'베이지 소파와 우드 가구의 조합을 확인했어요.',confidence:71,capturedAt:'2026-09-03T21:07:00+09:00'},
    shoe:{summary:'나이키의 브라운 스니커즈',reason:'측면 스우시 로고와 브라운 색상을 확인했어요.',confidence:96,capturedAt:'2026-09-03T18:24:00+09:00'},
    lake:{summary:'산과 호수가 있는 여행지',reason:'산의 능선과 물에 비친 풍경을 단서로 파악했어요.',confidence:24,capturedAt:'2026-09-02T23:12:00+09:00'},
    perfume:{summary:'샤넬 N°5 향수 제품',reason:'병에 적힌 ‘N°5 CHANEL’ 문구를 확인했어요.',confidence:98,capturedAt:'2026-09-02T16:50:00+09:00'},
    books:{summary:'화이트 스탠드 조명이 있는 책상',reason:'둥근 조명 갓과 관절형 프레임을 확인했어요.',confidence:58,capturedAt:'2026-09-01T10:03:00+09:00'},
  };
  const captureFormatter=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
  const candidateFixtures={chair:['wooden-stool','wooden-chair','wood-furniture'],forest:['forest'],coffee:[],style:['yellow-outfit','yellow-fashion'],shoe:['brown-sneakers','nike-shoes'],lake:['mountain-lake'],perfume:[]};
  const candidateNames={chair:['원목 스툴 관련 사진','우드 체어 관련 사진','우드 가구 관련 사진'],forest:['숲속 풍경 관련 사진'],style:['옐로 셋업 관련 사진','옐로 패션 관련 사진'],shoe:['브라운 스니커즈 관련 사진','나이키 스니커즈 관련 사진'],lake:['산과 호수 관련 사진']};
  function sourceUrl(p){return `https://images.unsplash.com/photo-${p.photo}?auto=format&fit=max&w=1600&q=90`;}
  function confidenceBand(score){return score<=30?'low':score<=70?'medium':'high';}
  function renderCandidates(p,analysis){
    // Simulates zero, one, and multiple returned candidates. The UI accepts
    // any count but displays only the three highest-scoring entries.
    const terms=candidateFixtures[p.id];
    const candidates=terms===undefined?[]:[
      {title:analysis.summary,url:sourceUrl(p),source:'images.unsplash.com · 사진 원본',confidence:analysis.confidence},
      ...terms.map((term,i)=>({title:candidateNames[p.id][i],url:`https://unsplash.com/s/photos/${term}`,source:'unsplash.com · 관련 이미지',confidence:Math.max(5,analysis.confidence-[24,64,70][i])})),
    ];
    const visible=candidates.sort((a,b)=>b.confidence-a.confidence).slice(0,3);
    $('candidate-section').hidden=visible.length===0;
    $('candidate-count').textContent=`${visible.length}개`;
    $('candidate-list').replaceChildren();
    for(const [i,candidate] of visible.entries()){
      const li=document.createElement('li');
      const link=document.createElement('a');link.className='candidate-link';link.href=candidate.url;link.target='_blank';link.rel='noopener noreferrer';
      const rank=document.createElement('span');rank.className='candidate-rank';rank.textContent=String(i+1).padStart(2,'0');rank.setAttribute('aria-hidden','true');
      const content=document.createElement('span');content.className='candidate-content';
      const title=document.createElement('strong');title.textContent=candidate.title;
      const source=document.createElement('small');source.textContent=candidate.source;content.append(title,source);
      const score=document.createElement('span');score.className='candidate-score';score.dataset.confidence=confidenceBand(candidate.confidence);score.textContent=`${candidate.confidence}%`;score.setAttribute('aria-label',`AI 추정 링크 정확도 ${candidate.confidence}%`);
      const arrow=document.createElement('span');arrow.className='candidate-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent='↗';
      link.append(rank,content,score,arrow);li.append(link);$('candidate-list').append(li);
    }
  }
  function formatCaptureTime(value){
    const parts=Object.fromEntries(captureFormatter.formatToParts(new Date(value)).map(p=>[p.type,p.value]));
    return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.dayPeriod} ${parts.hour}:${parts.minute}`;
  }
  const $ = id => document.getElementById(id);
  const device = $('device'), library = $('library'), detail = $('detail');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forceReduced = new URLSearchParams(location.search).get('motion')==='reduce';
  const motionDisabled = () => reduced.matches || forceReduced;
  const collectionHeading=document.querySelector('.collection-heading');
  const libraryFootnote=document.querySelector('.library-footnote');
  const linkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 15 6-6M8 10l-2 2a4 4 0 0 0 6 6l2-2M10 8l2-2a4 4 0 0 1 6 6l-2 2"/></svg>';
  function art(p) {
    return `<div class="shot-art ${p.style} ${p.id}"><img src="dark-assets/${p.id}.jpg" alt="" draggable="false"><div class="mini-brand">${p.brand}<span class="tiny-dot"></span></div><div class="mini-copy"><strong>${p.headline.replace('\n','<br>')}</strong><small>${p.sub}</small></div></div>`;
  }
  $('shot-grid').innerHTML = photos.map((p,i) => `<button class="shot" data-index="${i}" aria-label="${p.title} 상세 보기">${art(p)}<span class="link-badge">${linkIcon}</span></button>`).join('');
  const cards = [...document.querySelectorAll('.shot')];

  // Analytic critically damped springs retain current position and velocity
  // when their targets change. No transition blocks input or resets velocity.
  function scalar(value, frequency = 15) { return {value, target:value, velocity:0, frequency}; }
  function step(s, dt) {
    if (motionDisabled()) { s.value=s.target; s.velocity=0; return false; }
    const d=s.value-s.target, a=s.velocity+s.frequency*d, decay=Math.exp(-s.frequency*dt);
    s.value=s.target+(d+a*dt)*decay;
    s.velocity=(s.velocity-s.frequency*a*dt)*decay;
    if(Math.abs(s.value-s.target)<.001 && Math.abs(s.velocity)<.01) {s.value=s.target;s.velocity=0;return false;}
    return true;
  }
  function snap(s,value){s.value=s.target=value;s.velocity=0;}
  // Cards begin in a different spatial order, rather than tilted in their
  // eventual cells. Coordinates adapt to the current grid size.
  const collage=[
    [-.04,.66,-23,1.02],[.82,.03,18,.83],[.40,.38,-10,.94],
    [.03,.03,13,.90],[.91,.79,24,.82],[.85,.43,-16,.95],
    [.03,.35,-12,.77],[.43,.91,11,.92],[.46,-.06,-21,.75],
  ];
  const positions=cards.map((el)=>({el,badge:el.querySelector('.link-badge'),x:scalar(0,13),y:scalar(0,13),r:scalar(0,11),s:scalar(1,13),depth:scalar(1,12)}));
  function scatterTarget(i){
    const el=cards[i],grid=$('shot-grid'),[x,y,r,s]=collage[i];
    return{x:x*(grid.clientWidth-el.offsetWidth)-el.offsetLeft,y:y*(grid.clientHeight-el.offsetHeight)-el.offsetTop+18,r,s,depth:1};
  }
  function collectTarget(i){
    const el=cards[i],grid=$('shot-grid');
    // An open fan briefly gathers the scattered cards before they fan out
    // into the library. Each card retains a visible edge and its own depth.
    return{x:(grid.clientWidth-el.offsetWidth)/2-el.offsetLeft+(i%3-1)*31,
      y:(grid.clientHeight-el.offsetHeight)*.4-el.offsetTop+(Math.floor(i/3)-1)*39,
      r:(i%3-1)*9+(Math.floor(i/3)-1)*3,s:.78+(i%3)*.055,depth:1};
  }
  function targetCard(p,values,immediate=false){
    for(const key of ['x','y','r','s','depth']){p[key].target=values[key];if(immediate)snap(p[key],values[key]);}
  }
  const heading=scalar(0,11), pill=scalar(1,12);
  let frame=0,lastTime=0,timers=[],selected=null,flight=null,drag=null,gathering=true;
  const modal=scalar(0,19),dragY=scalar(0,19);
  function schedule(fn, delay){const id=setTimeout(()=>{fn();wake();},delay);timers.push(id);}
  function clearTimers(){timers.forEach(clearTimeout);timers=[];}
  function wake(){if(!frame){lastTime=performance.now();frame=requestAnimationFrame(tick);}}
  function tick(time){
    frame=0;const dt=Math.min((time-lastTime)/1000,.05);lastTime=time;let active=false;
    for(const p of positions){for(const key of ['x','y','r','s','depth'])active=step(p[key],dt)||active;
      p.el.style.transform=`translate3d(${p.x.value}px,${p.y.value}px,0) rotate(${p.r.value}deg) scale(${p.s.value})`;
      p.el.style.setProperty('--card-depth',p.depth.value);
      p.badge.style.opacity=1-p.depth.value;
    }
    active=step(heading,dt)||active;active=step(pill,dt)||active;
    $('intro-heading').style.opacity=Math.max(0,1-heading.value*2);$('intro-heading').style.transform=`translateY(${-9*heading.value}px)`;
    $('ready-heading').style.opacity=Math.max(0,heading.value*2-1);$('ready-heading').style.transform=`translateY(${9*(1-heading.value)}px)`;
    collectionHeading.style.opacity=heading.value;
    libraryFootnote.style.opacity=heading.value*(1-pill.value);
    $('gather-status').style.opacity=pill.value;$('gather-status').style.transform=`translate(-50%,${8*(1-pill.value)}px)`;
    $('gather-status').setAttribute('aria-hidden',String(pill.target===0));
    $('intro-heading').setAttribute('aria-hidden',String(heading.target===1));$('ready-heading').setAttribute('aria-hidden',String(heading.target===0));
    if(selected!==null){
      active=step(modal,dt)||active;
      if(!drag) active=step(dragY,dt)||active;
      renderDetail();
      if(modal.target===0 && modal.value===0){finishClose();}
      else if(modal.value===1 && !drag && dragY.value===0){
        $('detail-art').style.visibility='visible';if(flight)flight.el.style.visibility='hidden';
      }
    }
    if(active) frame=requestAnimationFrame(tick);
  }
  function settle(immediate=false){
    gathering=false;heading.target=1;pill.target=0;
    positions.forEach(p=>{targetCard(p,{x:0,y:0,r:0,s:1,depth:0},immediate);p.el.style.zIndex='0';});
    if(immediate){snap(heading,1);snap(pill,0);}device.dataset.phase='organized';wake();
  }
  function play(initial=false){
    if(selected!==null) finishClose();
    clearTimers();$('library-scroll').scrollTop=0;
    if(motionDisabled()){settle(true);return;}
    gathering=true;device.dataset.phase='scattered';heading.target=0;pill.target=1;
    $('gather-copy').textContent='흩어진 순간을 모으고 있어요';
    positions.forEach((p,i)=>{targetCard(p,scatterTarget(i),initial);p.el.style.zIndex=String([5,2,7,4,1,6,3,8,0][i]);});
    const collectAt=initial?680:850;
    schedule(()=>{
      device.dataset.phase='gathering';
      positions.forEach((p,i)=>schedule(()=>targetCard(p,collectTarget(i)),i*24));
    },collectAt);
    schedule(()=>{
      device.dataset.phase='arranging';heading.target=1;
      $('gather-copy').textContent='하나씩, 제자리를 찾고 있어요';
      positions.forEach((p,i)=>schedule(()=>{
        p.el.style.zIndex=String(20+i);
        targetCard(p,{x:0,y:0,r:0,s:1,depth:0});
      },i*85));
    },collectAt+780);
    schedule(()=>{$('gather-copy').textContent='모두 제자리에 모였어요';},collectAt+2150);
    schedule(()=>{gathering=false;pill.target=0;device.dataset.phase='organized';positions.forEach(p=>p.el.style.zIndex='0');},collectAt+2700);
    wake();
  }
  function relativeRect(element){const r=element.getBoundingClientRect(),d=device.getBoundingClientRect();return{x:r.left-d.left,y:r.top-d.top,w:r.width,h:r.height};}
  function openDetail(index, focus=true){
    if(selected!==null)return;
    const source=cards[index], p=photos[index];
    // Capture the live presentation geometry before settling the library.
    const current=relativeRect(source);
    const angle=positions[index].r.value;
    const width=source.offsetWidth, height=source.offsetHeight, scale=positions[index].s.value;
    const origin={x:current.x+current.w/2,y:current.y+current.h/2,scale,angle};
    clearTimers();settle();selected=index;
    const analysis=sampleAnalysis[p.id];
    $('detail-title').textContent=analysis.summary;$('detail-description').textContent=analysis.reason;
    const confidence=Math.max(0,Math.min(100,Math.round(analysis.confidence)));
    $('link-confidence').textContent=`${confidence}%`;
    $('match-status').setAttribute('aria-label',`AI 추정 링크 정확도 ${confidence}%`);
    $('match-status').dataset.confidence=confidenceBand(confidence);
    $('capture-time').dateTime=analysis.capturedAt;
    $('capture-time').textContent=formatCaptureTime(analysis.capturedAt);
    $('capture-time').setAttribute('aria-label',`사진첩 기록 ${formatCaptureTime(analysis.capturedAt)}`);
    renderCandidates(p,analysis);
    $('detail-source').textContent='Unsplash';$('detail-type').textContent='사진 원본 · 시안용 링크';
    $('open-source').href=sourceUrl(p);
    $('detail-art').innerHTML=art(p);$('detail-art').style.visibility='hidden';detail.hidden=false;$('detail-scroll').scrollTop=0;
    const target=relativeRect($('detail-art'));
    const el=document.createElement('div');el.className='flying-card';el.innerHTML=art(p);el.setAttribute('aria-hidden','true');
    el.style.width=`${width}px`;el.style.height=`${height}px`;device.append(el);
    flight={el,width,height,origin,target:{x:target.x+target.w/2,y:target.y+target.h/2,scale:target.w/width,angle:0}};
    source.style.visibility='hidden';library.inert=true;modal.target=1;snap(dragY,0);
    renderDetail();if(focus)$('close-detail').focus({preventScroll:true});wake();
  }
  function renderDetail(){
    const t=modal.value,dy=dragY.value;detail.style.opacity=Math.max(0,t-Math.abs(dy)/1100);
    // Real content follows the finger 1:1, while the close/open path stays
    // anchored to the selected thumbnail.
    $('detail-preview').style.transform=`translateY(${dy}px)`;
    if(!flight)return;
    const a=flight.origin,b=flight.target;
    const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t+dy*t;
    const scale=(a.scale+(b.scale-a.scale)*t)*(1-Math.min(Math.abs(dy)/1600,.15));
    flight.el.style.transform=`translate3d(${x}px,${y}px,0) rotate(${a.angle*(1-t)}deg) scale(${scale}) translate(-50%,-50%)`;
    flight.el.style.borderRadius=`${10-5*t}px`;flight.el.style.opacity=motionDisabled()?String(t):'1';
  }
  function closeDetail(){
    if(selected===null)return;
    const r=relativeRect(cards[selected]);
    flight.origin={x:r.x+r.w/2,y:r.y+r.h/2,scale:1,angle:0};
    $('detail-art').style.visibility='hidden';flight.el.style.visibility='visible';modal.target=0;dragY.target=0;wake();
  }
  function finishClose(){
    if(selected===null)return;
    const last=cards[selected];last.style.visibility='';flight?.el.remove();flight=null;selected=null;drag=null;
    detail.hidden=true;library.inert=false;snap(modal,0);snap(dragY,0);last.focus({preventScroll:true});
  }
  cards.forEach((card,i)=>card.addEventListener('click',()=>openDetail(i)));
  $('close-detail').addEventListener('click',closeDetail);
  $('replay').addEventListener('click',()=>play());
  document.addEventListener('keydown',e=>{
    if(selected===null)return;
    if(e.key==='Escape'){e.preventDefault();closeDetail();}
    if(e.key==='Tab'){
      const first=$('close-detail'),last=$('open-source');
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  const preview=$('detail-preview');
  preview.addEventListener('pointerdown',e=>{
    // Touch gestures scroll the complete detail page, including the image.
    // Mouse dragging retains the desktop dismiss interaction.
    if(selected===null||e.button!==0||e.pointerType!=='mouse')return;
    preview.setPointerCapture(e.pointerId);
    drag={id:e.pointerId,start:e.clientY-dragY.value,history:[{y:e.clientY,t:e.timeStamp}],moved:false};
    // Re-grabbing a closing preview redirects its existing spring.
    modal.target=1;$('detail-art').style.visibility='hidden';flight.el.style.visibility='visible';wake();
  });
  preview.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const distance=e.clientY-drag.start;
    if(!drag.moved&&Math.abs(distance)<8)return;
    drag.moved=true;
    dragY.value=distance>=0?distance:distance*.2;
    drag.history.push({y:e.clientY,t:e.timeStamp});drag.history=drag.history.filter(p=>e.timeStamp-p.t<90);
    renderDetail();
  });
  function endDrag(e,cancelled=false){
    if(!drag||drag.id!==e.pointerId)return;
    const history=drag.history,first=history[0],last=history[history.length-1];
    const velocity=e.timeStamp-last.t>100?0:(last.y-first.y)/Math.max(last.t-first.t,1)*1000;
    const moved=drag.moved;drag=null;
    dragY.velocity=cancelled?0:velocity;dragY.target=0;
    const projected=dragY.value+velocity*.18;
    if(!cancelled&&moved&&velocity>-150&&projected>110)closeDetail();else{modal.target=1;wake();}
  }
  preview.addEventListener('pointerup',e=>endDrag(e));
  preview.addEventListener('pointercancel',e=>endDrag(e,true));
  preview.addEventListener('lostpointercapture',e=>endDrag(e,true));
  new ResizeObserver(()=>{
    if(selected!==null&&flight){const r=relativeRect($('detail-art'));flight.target={x:r.x+r.w/2,y:r.y+r.h/2-dragY.value,scale:r.w/flight.width,angle:0};renderDetail();}
  }).observe(device);
  $('detail-scroll').addEventListener('scroll',()=>{
    if(selected===null||!flight)return;
    const r=relativeRect($('detail-art'));flight.target={x:r.x+r.w/2,y:r.y+r.h/2-dragY.value,scale:r.w/flight.width,angle:0};
    if(modal.target===1 && modal.value===1 && !drag){flight.el.style.visibility='hidden';$('detail-art').style.visibility='visible';}
  });
  reduced.addEventListener('change',()=>{clearTimers();settle(true);wake();});
  const params=new URLSearchParams(location.search);
  if(params.has('embed'))document.body.classList.add('embedded');
  const mode=params.get('view');
  if(mode==='feed'||mode==='detail'){settle(true);if(mode==='detail')requestAnimationFrame(()=>openDetail(0,!params.has('embed')));}
  else if(mode==='scattered'){positions.forEach((p,i)=>{targetCard(p,scatterTarget(i),true);p.el.style.zIndex=String(i);});snap(pill,0);device.dataset.phase='scattered';wake();}
  else play(true);
})();
