(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons={library:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>'};
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  icons.feed='<circle cx="12" cy="6" r="3"/><circle cx="6" cy="15" r="3"/><circle cx="18" cy="15" r="3"/>';
  const fixtures=[
    ['chair','원목 의자','스크린샷','공간 · 인테리어',['원목','의자','가구'],'작은 방 꾸미기 원룸 인테리어 책상 꾸미기','found'],
    ['forest','숲 사진','Instagram','여행 · 장소',['숲','산책','자연'],'쉬고 싶은 날 힐링 주말 여행','shared'],
    ['coffee','라테 사진','YouTube','일상 · 기타',['커피','홈카페','라테'],'아침 루틴 음료 만들기','shared'],
    ['style','여름 의상','Instagram','패션 · 쇼핑',['옷','여름','스타일'],'내일 뭐 입지 데일리 코디','shared'],
    ['interior','거실 인테리어','스크린샷','공간 · 인테리어',['거실','베이지','조명'],'작은 방 꾸미기 원룸 인테리어 집 꾸미기','similar'],
    ['shoe','스니커즈','스크린샷','패션 · 쇼핑',['신발','스니커즈','브라운'],'편한 신발 산책 운동화','similar'],
    ['lake','호수와 산','스크린샷','여행 · 장소',['호수','산','여행'],'쉬고 싶은 날 조용한 여행 휴가','missing'],
    ['perfume','향수','웹 링크','패션 · 쇼핑',['향수','샤넬','선물'],'생일 선물 향기 쇼핑','shared'],
    ['books','책 사진','웹 링크','일상 · 기타',['책','독서','책상'],'쉬고 싶은 날 독서 취미','shared']
  ];
  const photoIds=['1503602642458-232111445657','1441974231531-c6227db76b6e','1495474472287-4d71bcdd2085','1515886657613-9f3515b0c78f','1600210492486-724fe5c67fb0','1549298916-b41d501d3772','1470770841072-f978cf4d019e','1541643600914-78b084683601','1494438639946-1ebd1d20bf85'];
  const folders=['공간 · 인테리어','패션 · 쇼핑','여행 · 장소','일상 · 기타'];
  let items=fixtures.map((p,i)=>({id:p[0],title:p[1],platform:p[2],folder:p[3],tags:p[4],meaning:p[5],sourceState:p[6],image:`dark-assets/${p[0]}.jpg`,url:`https://images.unsplash.com/photo-${photoIds[i]}?auto=format&fit=max&w=1600&q=90`,sample:true,status:'ready',savedAt:Date.now()-i*86400000}));
  let view='feed',platform='전체',folder='',query='',sort='new',selected=null,toastTimer,returnFocus,feedController;
  const scroll=$('library-scroll');
  $('gather-status').hidden=true;
  $('detail').hidden=true;
  document.querySelector('.preview-caption').innerHTML='<span>콘텐츠 저장·분류·검색 시안</span><span>AI 분류·원본 검색·의미 검색 API 미연동</span>';
  $('replay').innerHTML='↻ 처음 화면';
  document.title='Storyge · Prototype';
  $('library').setAttribute('aria-label','콘텐츠 보관함');
  const tabs=document.createElement('nav');tabs.className='app-tabs';tabs.setAttribute('aria-label','주요 메뉴');
  tabs.innerHTML=[['feed','나의 피드'],['library','보관함'],['folder','폴더'],['search','검색']].map(([id,label])=>`<button data-view="${id}" aria-label="${label}">${icon(id)}${label}</button>`).join('');
  $('device').append(tabs);
  const live=document.createElement('div');live.className='toast';live.hidden=true;live.setAttribute('role','status');$('device').append(live);
  function toast(message){live.textContent=message;live.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>live.hidden=true,2600);}
  function filtered(){
    const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(p=>(platform==='전체'||p.platform===platform)&&(!folder||p.folder===folder)&&(!terms.length||terms.every(t=>`${p.title} ${p.tags.join(' ')} ${p.meaning} ${p.folder}`.toLowerCase().includes(t)))).sort((a,b)=>sort==='new'?b.savedAt-a.savedAt:a.savedAt-b.savedAt);
  }
  function cards(){const list=filtered();return `<div class="collection-heading"><h2>${view==='search'?(query?'검색 결과':'전체 저장 항목'):(folder||'전체 저장 항목')} <span>${list.length}</span></h2><select id="sort" aria-label="저장 시간 정렬"><option value="new" ${sort==='new'?'selected':''}>최신순</option><option value="old" ${sort==='old'?'selected':''}>오래된순</option></select></div>${list.length?`<div class="shot-grid">${list.map(p=>`<button class="shot" data-item="${p.id}" aria-label="${esc(p.title)} 상세 보기"><div class="shot-visual"><img src="${esc(p.image)}" alt="" loading="lazy"><span class="platform-tag">${esc(p.platform)}</span><span class="link-badge">${p.status==='processing'?'◌':p.sourceState==='missing'?'?':'↗'}</span></div><strong class="card-name">${esc(p.title)}</strong><small class="card-folder">${p.status==='processing'?'분류 처리 중 · 데모':esc(p.folder)}</small></button>`).join('')}</div>`:'<div class="empty"><strong>표시할 항목 없음</strong>검색어 또는 필터를 변경하세요.</div>'}`;}
  function render(){
    feedController?.destroy();feedController=null;
    scroll.classList.toggle('feed-page',view==='feed');
    scroll.classList.toggle('folder-detail-page',view==='folder'&&Boolean(folder));
    tabs.querySelectorAll('button').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    const titles={feed:'나의 피드',library:'보관함',folder:'폴더',search:'검색'};
    $('library').setAttribute('aria-label',titles[view]);
    const heading=view==='folder'&&folder?'<button class="round-button" id="back-folder" aria-label="전체 폴더로 돌아가기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button>':`<h1>${titles[view]}</h1>`;
    scroll.innerHTML=`<header class="library-heading page-heading">${heading}<button class="add-button" id="add" aria-label="콘텐츠 추가"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></header>`;
    if(view==='feed'){
      const field=document.createElement('div');field.className='feed-field';field.setAttribute('role','group');field.setAttribute('aria-label','저장 항목 피드. 드래그하여 이동하고 항목을 눌러 상세 정보를 확인하세요.');
      scroll.append(field);feedController=createStorygeFeed(field,items,openDetail);return;
    }
    if(view==='folder'&&!folder){scroll.innerHTML+=`<div class="ai-note"><b>✦</b><div><strong>폴더별 저장 항목</strong><small>분류 결과를 확인하고 수정할 수 있습니다.</small></div></div><div class="folder-grid">${[...folders,'분류 대기'].map(f=>`<button class="folder-tile" data-folder="${f}">${icon('folder')}<strong>${f}</strong><small>${items.filter(p=>p.folder===f).length}개 보관 중</small></button>`).join('')}</div>`;return;}
    if(view==='library')scroll.innerHTML+=`<div class="ai-note"><b>✦</b><div><strong>${items.length}개의 저장 항목이 있습니다</strong><small>${folders.length}개 분류 폴더</small></div></div>`;
    if(view==='search')scroll.innerHTML+=`<div class="searchbox">${icon('search')}<input id="search-input" aria-label="저장한 콘텐츠 검색" placeholder="제목 또는 키워드 검색" value="${esc(query)}"><button id="clear-search" aria-label="검색어 지우기" style="background:none;color:#888">×</button></div><div class="suggestions">${['인테리어','여행','옷'].map(s=>`<button class="chip" data-query="${s}">${s}</button>`).join('')}</div><p class="search-hint">${query?'제목·키워드·폴더·예시 검색어에서 검색합니다.':'검색어를 입력하세요.'}<br><span class="demo-label">현재 시안은 텍스트 일치 검색을 사용합니다.</span></p>`;
    scroll.innerHTML+=`<div class="filters" aria-label="플랫폼 필터">${['전체','스크린샷','YouTube','Instagram','웹 링크'].map(p=>`<button class="chip ${platform===p?'active':''}" data-platform="${p}" aria-pressed="${platform===p}">${p}</button>`).join('')}</div><div id="results">${cards()}</div>`;
  }
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let navigationAnimation, outgoingAnimation, pageSnapshot;
  function clearPageMotion(){navigationAnimation?.cancel();outgoingAnimation?.cancel();pageSnapshot?.remove();pageSnapshot=null;}
  function changePage(update,direction=1){
    clearPageMotion();
    if(!reducedMotion.matches){
      pageSnapshot=scroll.cloneNode(true);pageSnapshot.removeAttribute('id');
      pageSnapshot.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
      pageSnapshot.classList.add('page-snapshot');pageSnapshot.inert=true;pageSnapshot.setAttribute('aria-hidden','true');
      scroll.parentElement.append(pageSnapshot);pageSnapshot.scrollTop=scroll.scrollTop;
    }
    update();render();scroll.scrollTop=0;
    if(reducedMotion.matches)return;
    const options={duration:360,easing:'cubic-bezier(.25,.65,.3,1)'};
    navigationAnimation=scroll.animate([{transform:`translateX(${direction*100}%)`},{transform:'translateX(0)'}],options);
    outgoingAnimation=pageSnapshot.animate([{transform:'translateX(0)'},{transform:`translateX(${-direction*100}%)`}],options);
    outgoingAnimation.onfinish=()=>{pageSnapshot?.remove();pageSnapshot=null;};
  }
  tabs.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(!b||b.dataset.view===view)return;const order=['feed','library','folder','search'];const direction=Math.sign(order.indexOf(b.dataset.view)-order.indexOf(view));changePage(()=>{view=b.dataset.view;folder='';platform='전체';query='';},direction);});
  reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)clearPageMotion();});
  scroll.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='add')openAdd();if(b.dataset.platform){platform=b.dataset.platform;render();}if(b.dataset.folder)changePage(()=>{folder=b.dataset.folder;});if(b.id==='back-folder')changePage(()=>{folder='';},-1);if(b.dataset.query){query=b.dataset.query;render();}if(b.id==='clear-search'){query='';render();$('search-input').focus();}if(b.dataset.item)openDetail(b.dataset.item);});
  scroll.addEventListener('input',e=>{if(e.target.id==='search-input'){query=e.target.value;$('results').innerHTML=cards();}});
  scroll.addEventListener('change',e=>{if(e.target.id==='sort'){sort=e.target.value;$('results').innerHTML=cards();}});
  function openDetail(id){
    selected=items.find(p=>p.id===id);if(!selected)return;returnFocus=document.activeElement;const p=selected;
    $('detail').hidden=false;$('library').inert=true;tabs.inert=true;
    $('detail').querySelector('.detail-nav>span').textContent=p.platform;
    $('detail-art').innerHTML=`<img src="${esc(p.image)}" alt="${esc(p.title)}">`;
    $('detail').querySelector('.detail-info').innerHTML=`<div class="detail-meta"><span>${p.platform}</span><span>${new Date(p.savedAt).toLocaleDateString('ko-KR')} 저장</span></div><h2 id="detail-title">${esc(p.title)}</h2><p class="detail-description">${p.sample?'예시 콘텐츠 · 플랫폼과 저장 날짜는 데모 데이터입니다.':'직접 추가한 항목 · 새로고침 시 삭제됩니다.'}</p><section class="analysis-box"><h3>✦ ${p.status==='processing'?'분류 처리 중 · 데모':'분류 정보'}</h3><label>폴더<select id="edit-folder">${[...folders,'분류 대기'].map(f=>`<option ${p.folder===f?'selected':''}>${f}</option>`).join('')}</select></label><label>키워드<input id="edit-tags" value="${esc(p.tags.join(', '))}" placeholder="쉼표로 키워드를 구분하세요"></label><p>폴더와 키워드를 수정할 수 있습니다. 자동 분류는 데모 동작입니다.</p><button class="subtle-button" id="save-labels">분류 수정 저장</button></section><section class="source-state" id="source-state"></section>`;
    renderSource();$('detail-scroll').scrollTop=0;$('close-detail').focus({preventScroll:true});
  }
  function renderSource(){const p=selected;if(!p)return;
    $('source-state').dataset.searching=String(p.sourceState==='searching');
    const labels={found:'원본 링크 있음',similar:'유사 링크 있음',missing:'원본 링크 없음',searching:'검색 처리 중 · 데모',shared:'저장된 링크'};
    $('source-state').innerHTML=`<h3>${labels[p.sourceState]}${p.sample?' · 예시':''}</h3><p>${p.sample?'예시 결과입니다. 링크는 샘플 사진 출처로 연결됩니다.':p.platform==='스크린샷'?'원본 검색 API가 연결되지 않아 실제 검색은 실행되지 않습니다.':'입력한 URL을 저장했습니다.'}</p>${['found','similar','shared'].includes(p.sourceState)?`<a target="_blank" rel="noopener noreferrer" href="${esc(p.url)}">${p.sample?'샘플 사진 출처 확인':esc(new URL(p.url).hostname)} ↗</a>`:''}${p.platform==='스크린샷'?`<button class="subtle-button" id="retry-source" ${p.sourceState==='searching'?'disabled':''}>${p.sourceState==='searching'?'처리 중…':'원본 다시 찾기'}</button>`:''}`;
    const link=$('open-source'),available=['found','similar','shared'].includes(p.sourceState);link.removeAttribute('href');link.setAttribute('aria-disabled',String(!available));if(available)link.href=p.url;
    link.textContent=available?(p.sample?'샘플 출처 열기 ↗':`${p.platform==='웹 링크'?'웹사이트':p.platform}에서 열기 ↗`):'연결 가능한 링크 없음';
  }
  let detailExit=null;
  function finishDetailClose(){
    $('detail').hidden=true;detailExit?.cancel();detailExit=null;
    $('library').inert=false;tabs.inert=false;selected=null;
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else tabs.querySelector('[aria-current=page]')?.focus({preventScroll:true});
  }
  function closeDetail(immediate=false){
    const detail=$('detail');if(detail.hidden)return;
    if(immediate||reducedMotion.matches){finishDetailClose();return;}
    if(detailExit)return;
    const style=getComputedStyle(detail);
    detailExit=detail.animate([
      {transform:style.transform},
      {transform:'translateX(100%)'}
    ],{duration:400,easing:'cubic-bezier(.4,0,.7,.3)',fill:'forwards'});
    detailExit.onfinish=finishDetailClose;
  }
  reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches&&detailExit)finishDetailClose();});
  $('close-detail').onclick=()=>closeDetail();
  $('detail').addEventListener('click',e=>{if(e.target.id==='save-labels'){selected.folder=$('edit-folder').value;selected.tags=$('edit-tags').value.split(',').map(t=>t.trim()).filter(Boolean);render();toast('폴더·키워드 수정 완료');}if(e.target.id==='retry-source'){const p=selected;p.sourceState='searching';renderSource();setTimeout(()=>{p.sourceState=p.sample?'similar':'missing';if(selected?.id===p.id)renderSource();render();},1500);}});
  function openAdd(){
    if($('add-layer'))return;
    clearPageMotion();
    returnFocus=document.activeElement;const layer=document.createElement('div');layer.className='sheet-layer';layer.id='add-layer';layer.innerHTML=`<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="add-title"><div class="sheet-head"><h2 id="add-title">항목 추가</h2><button id="close-add" aria-label="닫기">×</button></div><p>URL을 입력하거나 이미지 파일을 선택하세요.</p><form id="link-form"><label for="new-link">링크 붙여넣기</label><input id="new-link" type="url" required placeholder="https://…"><button class="primary-button" type="submit">링크 저장하기 ↗</button></form><label class="upload-area">스크린샷 추가<input type="file" id="upload" accept="image/*" aria-label="스크린샷 선택"></label><label>공유 항목 추가 예시 <span class="demo-label">DEMO</span></label><div class="sheet-demo"><button data-demo="YouTube">YouTube 영상</button><button data-demo="Instagram">Instagram 릴스</button><button data-demo="스크린샷">스크린샷</button></div><p class="demo-label">분석은 예시로 진행되며 파일은 서버로 전송되지 않습니다.<br>이번 시안의 추가·수정 내용은 새로고침하면 초기화됩니다.</p></section>`;
    $('device').classList.add('add-open');$('device').append(layer);$('library').inert=true;tabs.inert=true;$('close-add').focus({preventScroll:true});
    layer.addEventListener('click',e=>{if(e.target.id==='close-add'||e.target===layer)closeAdd();if(e.target.dataset.demo){const demo=items.find(p=>p.platform===e.target.dataset.demo);addItem({...demo,id:crypto.randomUUID(),savedAt:Date.now()});}});
    $('link-form').onsubmit=e=>{e.preventDefault();let u;try{u=new URL($('new-link').value);}catch{return;}if(!['http:','https:'].includes(u.protocol)){$('new-link').setCustomValidity('http 또는 https 링크를 입력하세요.');$('new-link').reportValidity();return;}const host=u.hostname;addItem({id:crypto.randomUUID(),title:host,platform:/(^|\.)(youtube\.com|youtu\.be)$/.test(host)?'YouTube':/(^|\.)instagram\.com$/.test(host)?'Instagram':'웹 링크',image:'dark-assets/books.jpg',url:u.href,sourceState:'shared',tags:[],meaning:'새로 저장한 링크',sample:false,savedAt:Date.now()});};
    $('new-link').oninput=()=> $('new-link').setCustomValidity('');
    $('upload').onchange=e=>{const f=e.target.files[0];if(!f)return;if(!f.type.startsWith('image/')){toast('이미지 파일을 선택해 주세요');return;}addItem({id:crypto.randomUUID(),title:f.name,platform:'스크린샷',image:URL.createObjectURL(f),url:'',sourceState:'missing',tags:[],meaning:'새로 저장한 스크린샷',sample:false,savedAt:Date.now()});};
  }
  function closeAdd(){
    const layer=$('add-layer');if(!layer)return;
    if(layer.dataset.closing)return;layer.dataset.closing='true';
    const finish=()=>{layer.remove();$('device').classList.remove('add-open');$('library').inert=false;tabs.inert=false;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});};
    if(reducedMotion.matches){finish();return;}
    const sheet=layer.querySelector('.sheet');
    const exit=sheet.animate([{transform:getComputedStyle(sheet).transform},{transform:'translateY(100%)'}],{duration:300,easing:'cubic-bezier(.4,0,.7,.3)',fill:'forwards'});
    exit.onfinish=finish;
  }
  function addItem(p){const target=p.folder||'일상 · 기타';p.folder='분류 대기';p.status='processing';items.unshift(p);closeAdd();view=view==='feed'?'feed':'library';folder='';platform='전체';render();scroll.scrollTop=0;toast('항목 추가 완료 · 분류 데모 처리 중');setTimeout(()=>{p.status='ready';p.folder=target;if(!p.tags.length)p.tags=['추가 항목','예시 키워드'];render();toast('분류 데모 완료');},2000);}
  document.addEventListener('keydown',e=>{const modal=$('add-layer')||(!$('detail').hidden?$('detail'):null);if(!modal)return;if(e.key==='Escape'){e.preventDefault();if($('add-layer'))closeAdd();else closeDetail();}if(e.key==='Tab'){const all=[...modal.querySelectorAll('button:not(:disabled),a[href],input,select')].filter(x=>x.offsetParent!==null);const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  function launch(){
    if($('storyge-launch'))return;
    const splash=document.createElement('div');splash.id='storyge-launch';splash.className='storyge-launch';splash.setAttribute('role','status');splash.innerHTML='<span>Storyge</span>';
    $('device').append(splash);$('library').inert=true;tabs.inert=true;
    const finish=()=>{splash.remove();$('library').inert=false;tabs.inert=false;};
    setTimeout(()=>{if(reducedMotion.matches){finish();return;}const animation=splash.animate([{transform:'translateY(0)'},{transform:'translateY(-100%)'}],{duration:450,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});animation.onfinish=finish;},900);
  }
  $('replay').onclick=()=>{if($('add-layer'))return;closeDetail(true);clearPageMotion();view='feed';folder='';platform='전체';query='';render();scroll.scrollTop=0;launch();};
  if(new URLSearchParams(location.search).has('embed'))document.documentElement.classList.add('embedded');
  render();if(new URLSearchParams(location.search).get('view')==='detail')openDetail(items[0].id);else launch();
})();
