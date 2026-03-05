
// ── CONFIG ───────────────────────────────────────────────────────────────────
// Supabase Edge Functions как прокси — работают везде
var SB_URL = 'https://jvjsorcgunzxtuwrchww.supabase.co';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2anNvcmNndW56eHR1d3JjaHd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MDIwOTcsImV4cCI6MjA4ODE3ODA5N30.zfTmycvrRTgLb8JtzD2IH6-jTLMVYnkRTlDUc06iSN4';
var SB_H = {'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY};
var PROXY = 'https://jvjsorcgunzxtuwrchww.supabase.co/functions/v1/api';
var UPLOAD = 'https://jvjsorcgunzxtuwrchww.supabase.co/functions/v1/upload';

// ── STATE ────────────────────────────────────────────────────────────────────
var KB=[], TOPICS=[], SUBTOPICS=[];
var curFilter='all', curSearch='', curItem=null, sugFocused=-1, curSubtopicId=null;
var pendingFile=null, editingId=null, removeGif=false;
var userToken=null, userEmail=null, isAdmin=false;



// ── AUTH ─────────────────────────────────────────────────────────────────────
function openLogin(){ document.getElementById('login-screen').classList.add('open'); setTimeout(function(){document.getElementById('login-email').focus();},100); }
function closeLogin(){ document.getElementById('login-screen').classList.remove('open'); }

function doLogin(){
  var email=document.getElementById('login-email').value.trim();
  var pass=document.getElementById('login-pass').value;
  var btn=document.getElementById('login-btn');
  var err=document.getElementById('login-err');
  err.classList.remove('show');
  btn.disabled=true; btn.textContent='Входим...';
  // Прямой запрос к Supabase Auth
  fetch(SB_URL+'/auth/v1/token?grant_type=password',{
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':SB_KEY},
    body:JSON.stringify({email:email,password:pass})
  }).then(function(r){return r.json();}).then(function(data){
    if (data.access_token) {
      userToken=data.access_token;
      userEmail=(data.user&&data.user.email)||email;
      sessionStorage.setItem('sb_token', userToken);
      sessionStorage.setItem('sb_email', userEmail);
      setAdminMode(true);
      closeLogin();
      showToast('✅ Добро пожаловать, '+userEmail);
    } else {
      err.classList.add('show');
    }
    btn.disabled=false; btn.textContent='Войти';
  }).catch(function(){
    err.textContent='Ошибка подключения. Попробуй ещё раз.';
    err.classList.add('show');
    btn.disabled=false; btn.textContent='Войти';
  });
}

function doLogout(){
  sessionStorage.removeItem('sb_token');
  sessionStorage.removeItem('sb_email');
  userToken=null; userEmail=null;
  setAdminMode(false);
  showView('search');
  showToast('👋 Вышли из аккаунта');
}

function setAdminMode(admin){
  isAdmin=admin;
  document.getElementById('admin-nav').style.display=admin?'block':'none';
  document.getElementById('nav-login-btn').style.display=admin?'none':'flex';
  document.getElementById('nav-logout-btn').style.display=admin?'flex':'none';
  document.getElementById('user-name').textContent=admin?(userEmail||'Администратор'):'Гость';
  document.getElementById('user-role').textContent=admin?'Администратор':'Только просмотр';
  document.getElementById('user-av').textContent=admin?'👑':'👤';
  renderCards(getCurrentResults());
}

function checkSavedSession(){
  var t=sessionStorage.getItem('sb_token');
  var e=sessionStorage.getItem('sb_email');
  if (t) {
    userToken=t; userEmail=e;
    // Проверяем токен напрямую
    fetch(SB_URL+'/auth/v1/user',{
      headers:{'apikey':SB_KEY,'Authorization':'Bearer '+t}
    }).then(function(r){return r.json();}).then(function(data){
      if (data.id) { setAdminMode(true); }
      else { sessionStorage.removeItem('sb_token'); sessionStorage.removeItem('sb_email'); userToken=null; }
    }).catch(function(){});
  }
}

// ── API HELPERS ───────────────────────────────────────────────────────────────
// ── ПРЯМЫЕ ЗАПРОСЫ К SUPABASE (без прокси) ──────────────────────────────────
function apiGet(path){
  return fetch(PROXY+'?path='+encodeURIComponent(path)).then(function(r){return r.json();});
}

function authHeaders(){
  var h = {'Content-Type':'application/json','x-user-token':userToken||'','Prefer':'return=representation'};
  return h;
}

function apiPost(path,body){
  return fetch(PROXY+'?path='+encodeURIComponent(path),{
    method:'POST', headers:authHeaders(), body:JSON.stringify(body)
  }).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});
}

function apiPatch(path,body){
  return fetch(PROXY+'?path='+encodeURIComponent(path),{
    method:'PATCH', headers:authHeaders(), body:JSON.stringify(body)
  }).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});
}

function apiDelete(path){
  return fetch(PROXY+'?path='+encodeURIComponent(path),{
    method:'DELETE', headers:authHeaders()
  }).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);});
}

// ── LOAD ──────────────────────────────────────────────────────────────────────
var CACHE_KEY = 'agroros_kb_cache';
var CACHE_TTL = 5 * 60 * 1000; // 5 минут

// ── ПОИСК БЕЗ ВНЕШНИХ ЗАВИСИМОСТЕЙ ──────────────────────────────────────────
function localSearch(query) {
  var q = (query||'').toLowerCase().trim();
  if (!q) return KB.map(function(i){return{item:i,score:0};});
  var words = q.split(' ').filter(function(w){return w.length>0;});
  var results = [];
  KB.forEach(function(item) {
    var title = (item.title||'').toLowerCase();
    var kw    = (item.kw||'').toLowerCase();
    var desc  = (item.desc||'').toLowerCase();
    var score = 0;
    words.forEach(function(w) {
      // Точное совпадение в начале заголовка
      if (title.indexOf(w) === 0)        score += 12;
      else if (title.indexOf(w) !== -1)  score += 7;
      if (kw.indexOf(w) !== -1)          score += 4;
      if (desc.indexOf(w) !== -1)        score += 1;
      // Частичное — первые 3 символа
      if (w.length >= 3) {
        var p = w.slice(0, 3);
        if (title.indexOf(p) !== -1)     score += 2;
        if (kw.indexOf(p) !== -1)        score += 1;
      }
    });
    if (score > 0) results.push({item:item, score:score});
  });
  return results.sort(function(a,b){return b.score - a.score;});
}

function applyData(data){
  TOPICS = data.topics;
  SUBTOPICS = data.subtopics;
  KB = data.articles.map(function(row){
    return {id:row.id,title:row.title||'',cat:row.category||'web',
      subtopic_id:row.subtopic_id||null,media:row.media_type||null,
      desc:row.description||'',icon:row.icon||'📄',
      kw:row.keywords||'',media_url:row.media_url||null,steps:row.steps||[]};
  });
  document.getElementById('loader').classList.add('hidden');
  renderNavTopics(); renderSubtopicSelects(); updateStats(); handleSearch(curSearch);
}

function fetchWithTimeout(url, opts, ms) {
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); }, ms||8000);
  return fetch(url, Object.assign({}, opts, {signal: controller.signal}))
    .finally(function(){ clearTimeout(timer); });
}

function apiGetFast(path){
  return fetchWithTimeout(PROXY+'?path='+encodeURIComponent(path), {}, 8000)
    .then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    });
}

function fetchFresh(){
  return Promise.all([
    apiGetFast('/rest/v1/topics?select=*,subtopics(*)&order=order_index.asc'),
    apiGetFast('/rest/v1/articles?select=*&order=order_index.asc,title.asc')
  ]).then(function(r){
    var topicsWithSubs = Array.isArray(r[0]) ? r[0] : [];
    var topics = topicsWithSubs.map(function(t){ return {id:t.id,name:t.name,icon:t.icon,order_index:t.order_index}; });
    var subtopics = [];
    topicsWithSubs.forEach(function(t){ (t.subtopics||[]).forEach(function(s){ subtopics.push(s); }); });
    var data = { topics: topics, subtopics: subtopics, articles: Array.isArray(r[1])?r[1]:[], ts: Date.now() };
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch(e){}
    return data;
  });
}

function loadAll(manual){
  if (manual) {
    showToast('🔄 Обновляем...');
    fetchFresh().then(function(data){
      applyData(data);
      showToast('✅ Обновлено · ' + KB.length + ' статей');
    }).catch(function(err){ showToast('❌ ' + err.message, true); });
    return;
  }

  // Stale-while-revalidate: показываем кэш мгновенно, обновляем в фоне
  var cached = null;
  try {
    var raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch(e){}

  if (cached && cached.topics && cached.articles) {
    // Показываем кэш сразу — без лоадера
    applyData(cached);
    // Если кэш старше TTL — тихо обновляем в фоне
    if (Date.now() - (cached.ts || 0) > CACHE_TTL) {
      fetchFresh().then(function(data){
        applyData(data);
      }).catch(function(){});
    }
  } else {
    // Кэша нет — показываем лоадер и грузим
    document.getElementById('loader').classList.remove('hidden');
    fetchFresh().then(function(data){
      applyData(data);
    }).catch(function(err){
      var msg = err.name === 'AbortError' ? 'Превышено время ожидания (8 сек). Проверь соединение.' : err.message;
      document.getElementById('loader-text').innerHTML =
        '<div style="color:#c0522a;text-align:center;font-size:13px">❌ ' + msg
        + '<br><br><button class="btn btn-p" onclick="loadAll(false)" style="margin-top:8px">🔄 Повторить</button></div>';
    });
  }
}

// ── NAV ───────────────────────────────────────────────────────────────────────
function renderNavTopics(){
  document.getElementById('nav-topics').innerHTML=TOPICS.map(function(topic){
    var subs=SUBTOPICS.filter(function(s){return s.topic_id===topic.id;});
    return '<div class="topic-group">'
      +'<div class="topic-header open" onclick="toggleTopic(this)">'
      +'<span style="font-size:15px">'+topic.icon+'</span>'+topic.name
      +'<span class="topic-arrow">▶</span></div>'
      +'<div class="topic-children open">'
      +subs.map(function(s){
        var cnt=KB.filter(function(a){return a.subtopic_id===s.id;}).length;
        return '<div class="subtopic-item" id="sub-'+s.id+'" onclick="setSubtopic('+s.id+')">'
          +'<span class="ico">'+s.icon+'</span>'+s.name+'<span class="nbadge">'+cnt+'</span></div>';
      }).join('')
      +'</div></div>';
  }).join('');
}

function toggleTopic(el){el.classList.toggle('open');el.nextElementSibling.classList.toggle('open');}

function setSubtopic(id){
  curSubtopicId=id;
  document.querySelectorAll('.subtopic-item').forEach(function(e){e.classList.remove('active');});
  document.querySelectorAll('.nav-item').forEach(function(e){e.classList.remove('active');});
  if (id){
    var el=document.getElementById('sub-'+id); if(el)el.classList.add('active');
    var sub=SUBTOPICS.find(function(s){return s.id===id;});
    var topic=sub?TOPICS.find(function(t){return t.id===sub.topic_id;}):null;
    document.getElementById('crumb').innerHTML=(topic?'<span>'+topic.icon+' '+topic.name+'</span> › ':'')+( sub?'<span>'+sub.icon+' '+sub.name+'</span>':'');
  } else {
    document.getElementById('nn-search').classList.add('active');
    document.getElementById('crumb').innerHTML='';
  }
  handleSearch(curSearch);
}

function renderSubtopicSelects(){
  var opts=SUBTOPICS.map(function(s){
    var t=TOPICS.find(function(x){return x.id===s.topic_id;});
    return '<option value="'+s.id+'">'+(t?t.icon+' '+t.name+' › ':'')+s.icon+' '+s.name+'</option>';
  }).join('');
  var ns=document.getElementById('n-subtopic');
  if(ns)ns.innerHTML=opts;
  var af=document.getElementById('admin-filter-sub');
  if(af)af.innerHTML='<option value="">Все разделы</option>'+opts;
}



function getCurrentResults(){
  var r = curSearch.length>=1 ? localSearch(curSearch) : KB.map(function(i){return{item:i,score:0};});
  return applyFilter(r);
}

function applyFilter(results){
  return results.filter(function(r){
    var mf=curFilter==='all'?true:curFilter==='gif'?!!r.item.media_url:r.item.cat===curFilter;
    var ms=curSubtopicId?r.item.subtopic_id===curSubtopicId:true;
    return mf&&ms;
  });
}

function handleKey(e){
  var items=document.getElementById('sugg').querySelectorAll('.sug-item');
  if(e.key==='ArrowDown'){e.preventDefault();sugFocused=Math.min(sugFocused+1,items.length-1);updFocus(items);}
  else if(e.key==='ArrowUp'){e.preventDefault();sugFocused=Math.max(sugFocused-1,-1);updFocus(items);}
  else if(e.key==='Enter'&&sugFocused>=0&&items[sugFocused]){items[sugFocused].click();}
  else if(e.key==='Escape'){clearSearch();}
}
function updFocus(items){items.forEach(function(el,i){el.classList.toggle('focused',i===sugFocused);});}
function showSugg(){if(curSearch.length>=1)document.getElementById('sugg').classList.add('open');}
function hideSugg(){document.getElementById('sugg').classList.remove('open');sugFocused=-1;}
function clearSearch(){document.getElementById('si').value='';curSearch='';hideSugg();handleSearch('');}

function getSubCat(id){var s=SUBTOPICS.find(function(x){return x.id===id;});if(!s)return'web';return s.name==='iOS'?'ios':s.name==='Android'?'android':'web';}
function getSubName(id){var s=SUBTOPICS.find(function(x){return x.id===id;});return s?s.name:'';}

function renderSugg(raw){
  var sugg=document.getElementById('sugg');
  var fl=applyFilter(raw);
  if(!fl.length){hideSugg();return;}
  var html='<div class="sug-header">Найдено в базе знаний</div>';
  fl.slice(0,5).forEach(function(r){
    var cat=getSubCat(r.item.subtopic_id)||r.item.cat;
    html+='<div class="sug-item" onclick="openM('+r.item.id+');hideSugg()">'
      +'<span style="font-size:15px;flex-shrink:0">'+r.item.icon+'</span>'
      +'<span class="sug-text" style="flex:1">'+hlT(r.item.title)+'</span>'
      +'<span class="sug-tag '+cat+'">'+cat.toUpperCase()+'</span>'
      +(r.item.media_url?'<span style="font-size:11px">🎞️</span>':'')+'</div>';
  });
  sugg.innerHTML=html; sugg.classList.add('open');
}

// ── RENDER CARDS ──────────────────────────────────────────────────────────────
function renderCards(results){
  var c=document.getElementById('cards');
  if(!results.length){
    c.innerHTML='<div class="nores"><div class="ni">🌿</div>'
      +'<h3>'+(curSearch?'Ничего не найдено по «'+curSearch+'»':'Здесь пока нет статей')+'</h3>'
      +'<p>'+(curSearch?'Попробуй другие слова:':'Добавь статью через кнопку ➕')+'</p>'
      +(curSearch?'<div class="nores-hint">'
        +['платёж','выписка','версия','скачать'].map(function(p){
          return '<span class="nores-chip" onclick="document.getElementById(\'si\').value=\''+p+'\';handleSearch(\''+p+'\')">'+p+'</span>';
        }).join('')+'</div>':'')
      +'</div>';
    return;
  }
  var html='';
  if(curSearch){
    html='<div class="sec-label">Результаты · '+results.length+' найдено</div><div class="cards-grid">';
    results.forEach(function(r){var sc=r.score||0;html+=cardHtml(r.item,true,sc<0.15?'🎯 Точное':sc<0.3?'✓ Похожее':'',sc<0.15?'high':'med');});
    html+='</div>';
  } else {
    var groups={};
    results.forEach(function(r){var k=r.item.subtopic_id||'none';if(!groups[k])groups[k]=[];groups[k].push(r);});
    Object.keys(groups).forEach(function(sid){
      var sub=SUBTOPICS.find(function(s){return s.id==sid;});
      html+='<div class="sec-label">'+(sub?sub.icon+' '+sub.name:'Без раздела')+'</div><div class="cards-grid">';
      groups[sid].forEach(function(r){html+=cardHtml(r.item,false,'','');});
      html+='</div>';
    });
  }
  c.innerHTML=html;
}

function cardHtml(item,snippet,ml,mc){
  var cat=getSubCat(item.subtopic_id)||item.cat;
  var adminBtns=isAdmin
    ?'<div class="card-actions visible" onclick="event.stopPropagation()">'
      +'<button class="card-act-btn" onclick="startEdit('+item.id+')" title="Редактировать">✏️</button>'
      +'<button class="card-act-btn del" onclick="delArt('+item.id+')" title="Удалить">🗑️</button>'
      +'</div>'
    :'';
  return '<div class="card '+cat+'" onclick="openM('+item.id+')">'
    +adminBtns
    +(item.media_url?'<div class="card-gif"><img src="'+item.media_url+'" alt="" loading="lazy"></div>':'')
    +'<div class="card-hd"><div class="card-ico '+cat+'">'+item.icon+'</div>'
    +'<div class="card-title">'+hlT(item.title)+'</div></div>'
    +(snippet?'<div class="card-snippet">'+hlT(item.desc.slice(0,90))+'...</div>':'')
    +'<div class="card-meta"><span class="tag '+cat+'">'+cat.toUpperCase()+'</span>'
    +(item.media_url?'<span class="mbadge">🎞️ Гифка</span>':'')
    +(ml?'<span class="match-score '+mc+'">'+ml+'</span>':'')
    +'</div></div>';
}

function renderMeta(n){
  var m=document.getElementById('rmeta');
  if(!curSearch){m.innerHTML='';return;}
  m.innerHTML='<span class="rmeta-text">Найдено: <span>'+n+'</span></span>'
    +'<button class="rmeta-clear" onclick="clearSearch()">× Очистить</button>';
}
function hlT(t){if(!curSearch||curSearch.length<2)return t;return t.replace(new RegExp('('+curSearch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<mark>$1</mark>');}
function setFilter(t,el){curFilter=t;document.querySelectorAll('.chip').forEach(function(c){c.classList.remove('active');});el.classList.add('active');handleSearch(curSearch);}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openM(id){
  var item=KB.find(function(i){return i.id===id;});
  if(!item)return; curItem=item; hideSugg();
  var cat=getSubCat(item.subtopic_id)||item.cat;
  var ico=document.getElementById('mico'); ico.textContent=item.icon; ico.className='mico '+cat;
  document.getElementById('mtitle').textContent=item.title;
  var tag=document.getElementById('mtag'); tag.textContent=cat.toUpperCase(); tag.className='tag '+cat;
  var b='';
  if(item.media_url) b+='<div class="gif-container"><img src="'+item.media_url+'" alt="Инструкция"></div>';
  if(item.desc) b+='<div class="mdesc">'+item.desc+'</div>';
  if(item.steps&&item.steps.length) b+=renderStepsHtml(item.steps);
  document.getElementById('mbody').innerHTML=b;
  var editBtn=document.getElementById('modal-edit-btn');
  editBtn.style.display=isAdmin?'flex':'none';
  document.getElementById('modal').classList.add('open');
}
function closeModal(){document.getElementById('modal').classList.remove('open');}
function copyAns(){if(!curItem)return;navigator.clipboard.writeText(curItem.desc).then(function(){showToast('📋 Скопировано!');}).catch(function(){showToast('❌ Не удалось скопировать');});}
function editFromModal(){if(curItem){closeModal();startEdit(curItem.id);}}


// ── STEPS BUILDER ────────────────────────────────────────────────────────────
var stepsData = []; // [{title, text, media_url, pendingFile}]

function addStep(data) {
  var idx = stepsData.length;
  stepsData.push(data || {title:'', text:'', media_url:'', pendingFile:null});
  renderStepsBuilder();
}

function removeStep(idx) {
  stepsData.splice(idx, 1);
  renderStepsBuilder();
}

function moveStep(idx, dir) {
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= stepsData.length) return;
  var tmp = stepsData[idx];
  stepsData[idx] = stepsData[newIdx];
  stepsData[newIdx] = tmp;
  renderStepsBuilder();
}

function renderStepsBuilder() {
  var el = document.getElementById('steps-builder');
  if (!stepsData.length) {
    el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--td);font-size:13px;border:2px dashed var(--border);border-radius:var(--r)">Нет шагов — нажми «+ Добавить шаг» чтобы создать пошаговую инструкцию</div>';
    return;
  }
  el.innerHTML = stepsData.map(function(step, i) {
    return '<div class="step-card" id="step-card-'+i+'">'
      + '<div class="step-card-hdr">'
      + '<div class="step-num">'+(i+1)+'</div>'
      + '<input type="text" value="'+escHtml(step.title)+'" placeholder="Название шага (напр. Открой раздел Платежи)" '
      + 'oninput="stepsData['+i+'].title=this.value" style="flex:1;font-size:13px;padding:8px 12px">'
      + '<div class="step-move">'
      + '<button onclick="moveStep('+i+',-1)" '+(i===0?'disabled':'')+'>▲</button>'
      + '<button onclick="moveStep('+i+',1)" '+(i===stepsData.length-1?'disabled':'')+'>▼</button>'
      + '</div>'
      + '<button class="step-del" onclick="removeStep('+i+')">✕</button>'
      + '</div>'
      + '<textarea placeholder="Описание шага..." oninput="stepsData['+i+'].text=this.value" '
      + 'style="width:100%;margin-bottom:10px;min-height:60px;font-size:13px">'+escHtml(step.text)+'</textarea>'
      + '<div class="step-upzone" id="step-upzone-'+i+'">'
      + '<input type="file" accept="image/*,.gif" onchange="handleStepFile(event,'+i+')">'
      + '🎞️ Прикрепить гифку к шагу (необязательно)'
      + '</div>'
      + (step.media_url ? '<div class="step-gif-preview"><img src="'+step.media_url+'"><br>'
        + '<button class="btn btn-g" onclick="clearStepMedia('+i+')" style="font-size:11px;padding:4px 10px;margin-top:4px">✕ Удалить гифку</button></div>' : '')
      + (step.pendingFile ? '<div style="font-size:11px;color:var(--ac);margin-top:6px">📎 '+step.pendingFile.name+'</div>' : '')
      + '</div>';
  }).join('');
}

function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function handleStepFile(e, idx) {
  var file = e.target.files[0];
  if (!file) return;
  stepsData[idx].pendingFile = file;
  stepsData[idx].media_url = '';
  var reader = new FileReader();
  reader.onload = function(ev) {
    stepsData[idx].media_url = ev.target.result; // preview only
    renderStepsBuilder();
  };
  reader.readAsDataURL(file);
}

function clearStepMedia(idx) {
  stepsData[idx].media_url = '';
  stepsData[idx].pendingFile = null;
  renderStepsBuilder();
}

function clearSteps() {
  stepsData = [];
  renderStepsBuilder();
}

// Upload all step files and return steps with real URLs
function uploadStepsFiles() {
  var promises = stepsData.map(function(step, i) {
    if (step.pendingFile && step.media_url && step.media_url.startsWith('data:')) {
      return uploadFile(step.pendingFile).then(function(url) {
        stepsData[i].media_url = url;
        stepsData[i].pendingFile = null;
        return url;
      });
    }
    return Promise.resolve(step.media_url);
  });
  return Promise.all(promises);
}

// Render steps in modal
function renderStepsHtml(steps) {
  if (!steps || !steps.length) return '';
  var html = '<div class="steps-label">Пошаговая инструкция</div><div class="steps-list">';
  steps.forEach(function(step, i) {
    html += '<div class="step-item">'
      + '<div class="step-item-hdr">'
      + '<div class="step-badge">'+(i+1)+'</div>'
      + '<div class="step-title">'+(step.title||'Шаг '+(i+1))+'</div>'
      + '</div>'
      + (step.media_url ? '<div class="step-gif"><img src="'+step.media_url+'" loading="lazy"></div>' : '')
      + (step.text ? '<div class="step-text">'+step.text+'</div>' : '')
      + (i < steps.length-1 ? '<div class="step-divider"></div>' : '')
      + '</div>';
  });
  return html + '</div>';
}

// ── ARTICLE FORM ──────────────────────────────────────────────────────────────
function startEdit(id){
  if(!isAdmin){showToast('🔐 Нужна авторизация',true);return;}
  var item=KB.find(function(i){return i.id===id;});
  if(!item)return;
  editingId=id; pendingFile=null; removeGif=false;
  document.getElementById('edit-id').value=id;
  document.getElementById('nt').value=item.title;
  document.getElementById('nico').value=item.icon;
  document.getElementById('nd').value=item.desc;
  document.getElementById('nkw').value=item.kw;
  document.getElementById('media-url-input').value='';
  document.getElementById('n-subtopic').value=item.subtopic_id||'';
  document.getElementById('file-preview').style.display='none';
  document.getElementById('gif-file').value='';
  var cgp=document.getElementById('current-gif-preview');
  if(item.media_url){cgp.style.display='block';document.getElementById('current-gif-img').src=item.media_url;}
  else{cgp.style.display='none';}
  // Load steps
  stepsData = (item.steps||[]).map(function(s){return {title:s.title||'',text:s.text||'',media_url:s.media_url||'',pendingFile:null};});
  renderStepsBuilder();
  document.getElementById('form-title').textContent='✏️ Редактирование статьи';
  document.getElementById('admin-view-title').textContent='✏️ Редактировать статью';
  document.getElementById('save-btn').textContent='💾 Сохранить изменения';
  showView('admin');
  window.scrollTo(0,0);
}

function cancelEdit(){
  editingId=null; pendingFile=null; removeGif=false;
  clearForm();
  document.getElementById('form-title').textContent='📝 Новая статья';
  document.getElementById('admin-view-title').textContent='➕ Добавить статью';
  document.getElementById('save-btn').textContent='✅ Сохранить';
  showView('search');
}

function clearForm(){
  ['nt','nd','nkw','nico','media-url-input'].forEach(function(id){document.getElementById(id).value='';});
  pendingFile=null; editingId=null; removeGif=false;
  document.getElementById('file-preview').style.display='none';
  document.getElementById('current-gif-preview').style.display='none';
  document.getElementById('gif-file').value='';
  clearSteps();
}

function previewFile(e){
  var file=e.target.files[0]; if(!file)return;
  pendingFile=file;
  var reader=new FileReader();
  reader.onload=function(ev){
    document.getElementById('preview-img').src=ev.target.result;
    document.getElementById('preview-name').textContent=file.name+' ('+Math.round(file.size/1024)+' KB)';
    document.getElementById('file-preview').style.display='block';
  };
  reader.readAsDataURL(file);
}

function clearFile(){pendingFile=null;document.getElementById('file-preview').style.display='none';document.getElementById('gif-file').value='';}
function removeCurrentGif(){removeGif=true;document.getElementById('current-gif-preview').style.display='none';}

function uploadFile(file){
  return new Promise(function(resolve,reject){
    var filename=Date.now()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    var progress=document.getElementById('upload-progress');
    var fill=document.getElementById('progress-fill');
    progress.classList.add('show'); fill.style.width='30%';
    var reader=new FileReader();
    reader.onload=function(ev){
      var base64=ev.target.result.split(',')[1];
      fill.style.width='70%';
      fetch(UPLOAD+'?filename='+encodeURIComponent(filename),{
        method:'POST',
        headers:{'Content-Type':'application/json','x-user-token':userToken,'x-file-type':file.type},
        body:JSON.stringify({data:base64,filename:filename,type:file.type})
      }).then(function(r){return r.json();}).then(function(data){
        fill.style.width='100%';
        setTimeout(function(){progress.classList.remove('show');fill.style.width='0%';},500);
        resolve(data.url);
      }).catch(reject);
    };
    reader.readAsDataURL(file);
  });
}

function saveArticle(){
  if(!isAdmin){showToast('🔐 Нужна авторизация',true);return;}
  var title=document.getElementById('nt').value.trim();
  var desc=document.getElementById('nd').value.trim();
  if(!title||!desc){showToast('❌ Заполни заголовок и описание',true);return;}
  var subtopic_id=parseInt(document.getElementById('n-subtopic').value)||null;
  var icon=document.getElementById('nico').value.trim()||'📄';
  var kw=document.getElementById('nkw').value.trim();
  var manualUrl=document.getElementById('media-url-input').value.trim();
  var sub=SUBTOPICS.find(function(s){return s.id===subtopic_id;});
  var cat=sub?(sub.name==='iOS'?'ios':sub.name==='Android'?'android':'web'):'web';
  var btn=document.getElementById('save-btn');
  btn.disabled=true; btn.textContent='Сохраняем...';

  function persist(mediaUrl){
    var currentItem=editingId?KB.find(function(i){return i.id===editingId;}):null;
    var finalUrl=mediaUrl!==undefined?mediaUrl:(removeGif?null:(currentItem?currentItem.media_url:null));
    var cleanSteps=stepsData.map(function(s){return{title:s.title,text:s.text,media_url:s.pendingFile?'':s.media_url};});
    var payload={title:title,category:cat,subtopic_id:subtopic_id,description:desc,
      icon:icon,keywords:kw,media_url:finalUrl,media_type:finalUrl?'gif':null,steps:cleanSteps};
    var p=editingId
      ?apiPatch('/rest/v1/articles?id=eq.'+editingId,payload)
      :apiPost('/rest/v1/articles',payload);
    p.then(function(){
      clearForm();
      btn.disabled=false; btn.textContent='✅ Сохранить';
      document.getElementById('form-title').textContent='📝 Новая статья';
      document.getElementById('admin-view-title').textContent='➕ Добавить статью';
      try{sessionStorage.removeItem(CACHE_KEY);}catch(e){}showToast(editingId?'✅ Статья обновлена!':'✅ Статья добавлена!');
      editingId=null;
      loadAll(false); setTimeout(renderAdminList,1200);
    }).catch(function(err){btn.disabled=false;btn.textContent='✅ Сохранить';showToast('❌ '+err.message,true);});
  }

  function doSave(mainUrl) {
    uploadStepsFiles().then(function(){
      persist(mainUrl);
    }).catch(function(err){
      btn.disabled=false; btn.textContent='✅ Сохранить';
      showToast('❌ Ошибка загрузки шага: '+err.message,true);
    });
  }
  if(pendingFile){uploadFile(pendingFile).then(function(url){doSave(url);}).catch(function(err){btn.disabled=false;btn.textContent='✅ Сохранить';showToast('❌ Ошибка загрузки: '+err.message,true);});}
  else{doSave(manualUrl||undefined);}
}

function delArt(id){
  if(!isAdmin)return;
  if(!confirm('Удалить эту статью?'))return;
  apiDelete('/rest/v1/articles?id=eq.'+id)
    .then(function(){showToast('🗑️ Удалено');try{sessionStorage.removeItem(CACHE_KEY);}catch(e){}loadAll(false);setTimeout(renderAdminList,800);})
    .catch(function(err){showToast('❌ '+err.message,true);});
}

// ── ADMIN LIST ────────────────────────────────────────────────────────────────
function renderAdminList(){
  var filterSub=document.getElementById('admin-filter-sub');
  var searchTerm=document.getElementById('admin-search');
  var filterVal=filterSub?parseInt(filterSub.value)||null:null;
  var q=searchTerm?searchTerm.value.toLowerCase():'';
  document.getElementById('ac').textContent=KB.length;
  var items=KB.filter(function(i){
    var ms=filterVal?i.subtopic_id===filterVal:true;
    var mq=q?i.title.toLowerCase().includes(q):true;
    return ms&&mq;
  });
  if(!items.length){document.getElementById('alist').innerHTML='<div style="padding:16px;text-align:center;color:var(--tm);font-size:13px">Нет статей</div>';return;}
  document.getElementById('alist').innerHTML=items.map(function(item){
    var cat=getSubCat(item.subtopic_id)||item.cat;
    var sub=SUBTOPICS.find(function(s){return s.id===item.subtopic_id;});
    return '<div class="alist-item">'
      +(item.media_url?'<img class="alist-gif" src="'+item.media_url+'" alt="">':'<div class="alist-ico">'+item.icon+'</div>')
      +'<div class="alist-info">'
      +'<div class="alist-title">'+item.title+'</div>'
      +'<div class="alist-sub"><span class="tag '+cat+'" style="font-size:9px">'+cat.toUpperCase()+'</span>'+(sub?' · '+sub.icon+' '+sub.name:'')+'</div>'
      +'</div>'
      +'<button class="act-btn" onclick="startEdit('+item.id+')">✏️</button>'
      +'<button class="act-btn del" onclick="delArt('+item.id+')">🗑️</button>'
      +'</div>';
  }).join('');
}

// ── TOPIC MGMT ────────────────────────────────────────────────────────────────
function renderMgmtTopics(){
  document.getElementById('mgmt-topics').innerHTML=TOPICS.map(function(topic){
    var subs=SUBTOPICS.filter(function(s){return s.topic_id===topic.id;});
    return '<div class="topic-section">'
      +'<div class="topic-section-title">'+topic.icon+' '+topic.name
      +'<button class="act-btn del" onclick="delTopic('+topic.id+')" style="margin-left:auto">Удалить топик</button></div>'
      +subs.map(function(s){
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">'
          +'<span>'+s.icon+'</span><span style="flex:1;font-size:13px">'+s.name+'</span>'
          +'<button class="act-btn del" onclick="delSubtopic('+s.id+')">Удалить</button></div>';
      }).join('')
      +'<div class="mgmt-row" style="margin-top:10px">'
      +'<input type="text" placeholder="🍎" style="max-width:60px;flex:none" id="si-'+topic.id+'">'
      +'<input type="text" placeholder="Название подтопика" id="sn-'+topic.id+'">'
      +'<button class="btn btn-p" onclick="addSubtopic('+topic.id+')" style="padding:8px 14px;font-size:12px;flex:none">+ Добавить</button>'
      +'</div></div>';
  }).join('');
}

function addTopic(){
  if(!isAdmin){showToast('🔐 Нужна авторизация',true);return;}
  var name=document.getElementById('new-topic-name').value.trim();
  var icon=document.getElementById('new-topic-icon').value.trim()||'📁';
  if(!name){showToast('❌ Введи название',true);return;}
  apiPost('/rest/v1/topics',{name:name,icon:icon,order_index:TOPICS.length+1})
    .then(function(){document.getElementById('new-topic-name').value='';showToast('✅ Топик добавлен');try{sessionStorage.removeItem(CACHE_KEY);}catch(e){}loadAll(false);setTimeout(renderMgmtTopics,800);})
    .catch(function(err){showToast('❌ '+err.message,true);});
}

function addSubtopic(topicId){
  if(!isAdmin){showToast('🔐 Нужна авторизация',true);return;}
  var name=document.getElementById('sn-'+topicId).value.trim();
  var icon=document.getElementById('si-'+topicId).value.trim()||'📂';
  if(!name){showToast('❌ Введи название',true);return;}
  apiPost('/rest/v1/subtopics',{topic_id:topicId,name:name,icon:icon,order_index:SUBTOPICS.length+1})
    .then(function(){showToast('✅ Подтопик добавлен');try{sessionStorage.removeItem(CACHE_KEY);}catch(e){}loadAll(false);setTimeout(renderMgmtTopics,800);})
    .catch(function(err){showToast('❌ '+err.message,true);});
}

function delTopic(id){
  if(!isAdmin)return;
  if(!confirm('Удалить топик и все его подтопики?'))return;
  apiDelete('/rest/v1/topics?id=eq.'+id)
    .then(function(){showToast('🗑️ Топик удалён');try{sessionStorage.removeItem(CACHE_KEY);}catch(e){}loadAll(false);setTimeout(renderMgmtTopics,800);})
    .catch(function(err){showToast('❌ '+err.message,true);});
}

function delSubtopic(id){
  if(!isAdmin)return;
  if(!confirm('Удалить подтопик?'))return;
  apiDelete('/rest/v1/subtopics?id=eq.'+id)
    .then(function(){showToast('🗑️ Подтопик удалён');try{sessionStorage.removeItem(CACHE_KEY);}catch(e){}loadAll(false);setTimeout(renderMgmtTopics,800);})
    .catch(function(err){showToast('❌ '+err.message,true);});
}

// ── STATS ─────────────────────────────────────────────────────────────────────
function updateStats(){
  var total=KB.length,gifs=KB.filter(function(i){return!!i.media_url;}).length;
  var ios=KB.filter(function(i){return getSubCat(i.subtopic_id)==='ios';}).length;
  var and_=KB.filter(function(i){return getSubCat(i.subtopic_id)==='android';}).length;
  var web=KB.filter(function(i){return getSubCat(i.subtopic_id)==='web';}).length;
  document.getElementById('sv-total').textContent=total;
  document.getElementById('sv-gif').textContent=gifs;
  document.getElementById('sv-ia').textContent=ios+' / '+and_;
  document.getElementById('sv-web').textContent=web;
  document.getElementById('tc').textContent=total+' статей';
}

// ── VIEW ──────────────────────────────────────────────────────────────────────
function showView(v){
  var views={search:'vSearch',admin:'vAdmin',mgmt:'vMgmt'};
  Object.keys(views).forEach(function(k){
    var el=document.getElementById(views[k]); if(!el)return;
    el.style.display=k===v?(k==='search'?'flex':'block'):'none';
  });
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  var m={search:'nn-search',admin:'nn-admin',mgmt:'nn-mgmt'};
  if(m[v])document.getElementById(m[v]).classList.add('active');
  if(v==='admin'){renderAdminList();if(!editingId)renderStepsBuilder();}
  if(v==='mgmt')renderMgmtTopics();
  if(window.innerWidth<=768){var sb=document.getElementById('sidebar');var ov=document.getElementById('sidebar-overlay');sb.classList.remove('open');ov.classList.remove('open');}
}

// ── SIDEBAR MOBILE ────────────────────────────────────────────────────────────
function toggleSidebar(){
  var sb=document.getElementById('sidebar');
  var ov=document.getElementById('sidebar-overlay');
  var open=sb.classList.toggle('open');
  ov.classList.toggle('open',open);
  document.body.style.overflow=open?'hidden':'';
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg,err){
  var t=document.getElementById('toast');
  document.getElementById('tmsg').textContent=msg;
  t.className='toast'+(err?' err':'');
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer=setTimeout(function(){t.classList.remove('show');},3000);
}

// ── KEYBOARD ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();showView('search');document.getElementById('si').focus();}
  if(e.key==='Escape'){closeModal();clearSearch();}
});
document.addEventListener('click',function(e){if(!document.getElementById('sbar').contains(e.target))hideSugg();});

// ── DRAG & DROP UPLOAD ────────────────────────────────────────────────────────
var uz=document.getElementById('upzone');
uz.addEventListener('dragover',function(e){e.preventDefault();uz.classList.add('dragover');});
uz.addEventListener('dragleave',function(){uz.classList.remove('dragover');});
uz.addEventListener('drop',function(e){
  e.preventDefault();uz.classList.remove('dragover');
  var file=e.dataTransfer.files[0];
  if(file){pendingFile=file;previewFile({target:{files:[file]}});}
});

// ── UPLOAD FUNCTION FIX ───────────────────────────────────────────────────────
// Override uploadFile to use base64 body correctly
uploadFile=function(file){
  return new Promise(function(resolve,reject){
    var filename=Date.now()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    var progress=document.getElementById('upload-progress');
    var fill=document.getElementById('progress-fill');
    progress.classList.add('show'); fill.style.width='40%';
    var reader=new FileReader();
    reader.onload=function(ev){
      var base64=ev.target.result.split(',')[1];
      fill.style.width='80%';
      fetch(UPLOAD+'?filename='+encodeURIComponent(filename),{
        method:'POST',
        headers:{'Content-Type':'application/octet-stream','x-user-token':userToken,'x-file-type':file.type},
        body:Uint8Array.from(atob(base64),function(c){return c.charCodeAt(0);})
      }).then(function(r){return r.json();}).then(function(data){
        fill.style.width='100%';
        setTimeout(function(){progress.classList.remove('show');fill.style.width='0%';},500);
        if(!data.url)throw new Error('No URL returned');
        resolve(data.url);
      }).catch(reject);
    };
    reader.readAsDataURL(file);
  });
};


// ── ПОЛНОТЕКСТОВЫЙ ПОИСК (PostgreSQL Russian FTS) ─────────────────────────
var ftsTimer = null;

function handleSearch(val) {
  curSearch = (val||'').trim(); sugFocused = -1;

  // Локальный fuse для подсказок — мгновенно
  if (curSearch.length >= 1) {
    var local = localSearch(curSearch);
    renderSugg(local.slice(0,6));
  } else {
    hideSugg();
  }

  // Debounce FTS запрос
  clearTimeout(ftsTimer);
  if (curSearch.length >= 2) {
    ftsTimer = setTimeout(function(){ doFtsSearch(curSearch); }, 350);
  } else {
    var results = KB.map(function(i){return{item:i,score:0};});
    results = applyFilter(results);
    renderCards(results); renderMeta(results.length);
  }
}

function doFtsSearch(q) {
  // PostgreSQL FTS — понимает русскую морфологию
  var ftsQuery = q.trim().split(/\s+/).map(function(w){return w+':*';}).join(' & ');
  var path = '/rest/v1/articles?select=*&search_vector=fts(russian).'+ftsQuery+'&order=title.asc';

  apiGet(path).then(function(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      // Fallback на fuse если FTS ничего не нашёл
      var fallback = localSearch(q);
      fallback = applyFilter(fallback);
      renderCards(fallback); renderMeta(fallback.length);
      logSearch(q, fallback.length);
      return;
    }
    var results = rows.map(function(row){
      var mapped = {id:row.id,title:row.title||'',cat:row.category||'web',
        subtopic_id:row.subtopic_id||null,media:row.media_type||null,
        desc:row.description||'',icon:row.icon||'📄',
        kw:row.keywords||'',media_url:row.media_url||null,steps:row.steps||[]};
      return {item:mapped, score:0};
    });
    results = applyFilter(results);
    renderCards(results); renderMeta(results.length);
    logSearch(q, results.length);
  }).catch(function() {
    // При ошибке FTS — локальный поиск
    var fallback = localSearch(q);
    fallback = applyFilter(fallback);
    renderCards(fallback); renderMeta(fallback.length);
  });
}

// ── АНАЛИТИКА ────────────────────────────────────────────────────────────────
var logTimer = null;
function logSearch(q, count) {
  if (!q || q.length < 2) return;
  clearTimeout(logTimer);
  logTimer = setTimeout(function(){
    fetch(PROXY+'?path='+encodeURIComponent('/rest/v1/search_logs'), {
      method: 'POST',
      headers: {'Content-Type':'application/json','Prefer':'return=minimal'},
      body: JSON.stringify({query: q, results_count: count})
    }).catch(function(){});
  }, 1000);
}

// ── ПОДЕЛИТЬСЯ ССЫЛКОЙ ───────────────────────────────────────────────────────
function shareArticle() {
  if (!curItem) return;
  var url = window.location.origin + window.location.pathname + '?article=' + curItem.id;
  if (navigator.share) {
    navigator.share({ title: curItem.title, url: url }).catch(function(){});
  } else {
    navigator.clipboard.writeText(url).then(function(){
      showToast('🔗 Ссылка скопирована!');
    }).catch(function(){
      showToast('🔗 ' + url);
    });
  }
}

// Открываем статью по ссылке если есть ?article=ID
function checkUrlArticle() {
  var params = new URLSearchParams(window.location.search);
  var articleId = parseInt(params.get('article'));
  if (articleId) {
    // Ждём загрузки данных
    var attempts = 0;
    var check = setInterval(function(){
      var item = KB.find(function(i){ return i.id === articleId; });
      if (item) { clearInterval(check); openM(articleId); }
      if (++attempts > 20) clearInterval(check);
    }, 200);
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.getElementById('vSearch').style.display='flex';
document.getElementById('vAdmin').style.display='none';
document.getElementById('vMgmt').style.display='none';
checkSavedSession();
loadAll(false);
setTimeout(checkUrlArticle, 800);
