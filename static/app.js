(function(){
"use strict";

/* ---------- etichette ---------- */
const PERSON_KIND = {triennale:['Bachelor’s student','Bachelor’s'], magistrale:['Master’s student','Master’s'], dottorando:['PhD student','PhD'],
  postdoc:['Postdoc','Postdoc'], assegnista:['Research fellow','Fellow'], visiting:['Visiting','Visiting'], altro:['Other','Other']};
const PROJECT_KIND = {aziendale:'Industry', europeo:'European', nazionale:'National', regionale:'Regional', interno:'Internal', altro:'Other'};
const PROJECT_STATUS = {proposta:['Proposal','p-warn'], attivo:['Active','p-ok'], sospeso:['On hold','p-idle'], concluso:['Closed','p-idle']};
const DL_KIND = {tappa:'Milestone', deliverable:'Deliverable', report:'Report', rendicontazione:'Financial report', scadenza:'Deadline'};
const PUB_KIND = {conferenza:'Conference', rivista:'Journal', workshop:'Workshop', capitolo:'Book chapter', tesi:'Thesis', altro:'Other'};
const PUB_STATUS = {idea:['Idea','p-idle'], scrittura:['Writing','p-acc'], sottomesso:['Submitted','p-proj'], revisione:['Under revision','p-warn'],
  accettato:['Accepted','p-ok'], pubblicato:['Published','p-ok'], rifiutato:['Rejected','p-idle']};
const PUB_OPEN = ['idea','scrittura','revisione'];
const EXP_CAT = {personale:'Personnel', attrezzature:'Equipment', materiali:'Consumables', missioni:'Travel', servizi:'Services', altro:'Other'};
const TASK_STATUS = {todo:'To do', doing:'In progress', done:'Done'};
const TASK_PRIO = {alta:'High', normale:'Normal', bassa:'Low'};
const MIN_PASSWORD = 10;
const MEET_GAP = 21;   // giorni senza incontri oltre i quali una persona finisce in "Da sentire"

/* ---------- date ---------- */
const MESI = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MESI_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const GIORNI = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const pad = n => String(n).padStart(2,'0');
const isoLocal = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
let TODAY = isoLocal(new Date());
function addDays(iso,n){ const [y,m,d]=iso.split('-').map(Number); return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10); }
function daysBetween(a,b){ return Math.round((Date.parse(b)-Date.parse(a))/86400000); }
function fmt(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-'); return (+d)+' '+MESI[+m-1]+' '+y; }
function fmtShort(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-'); return (+d)+' '+MESI[+m-1]+(y!==TODAY.slice(0,4)?' '+y:''); }
function fmtDateTime(ts){ const d=new Date(ts); return isNaN(d)?'':fmt(isoLocal(d))+', '+pad(d.getHours())+':'+pad(d.getMinutes()); }
function rel(iso){ const n=daysBetween(TODAY,iso); if(n===0) return 'today'; if(n===1) return 'tomorrow'; if(n===-1) return 'yesterday'; return n>0?'in '+n+' days':(-n)+' days ago'; }
function whenHtml(iso,done){
  if(!iso) return '';
  const n=daysBetween(TODAY,iso);
  const cls=done?'':(n<0?' late':(n<=3?' soon':''));
  const txt=done?fmtShort(iso):(n<0?'overdue · '+fmtShort(iso):(n<=7?rel(iso):fmtShort(iso)));
  return `<span class="when${cls}" title="${fmt(iso)}">${txt}</span>`;
}

/* ---------- utilità ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const initials = n => { const w=String(n||'').trim().split(/\s+/).filter(Boolean); return w.length?(w[0][0]+(w.length>1?w[w.length-1][0]:'')).toUpperCase():'?'; };
const EUR = new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'});
const money = c => EUR.format((c||0)/100);
const moneyInput = c => c ? (c/100).toFixed(2) : '';
const isUrl = s => /^https?:\/\//i.test(s||'');
let toastT;
function toast(m){ const t=$('#toast'); t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>{t.hidden=true;},3800); }
function armed(el,label){
  if(el.dataset.armed==='1') return true;
  el.dataset.armed='1'; const old=el.textContent; el.textContent=label;
  setTimeout(()=>{ if(el.isConnected){ el.dataset.armed=''; el.textContent=old; } },4000);
  return false;
}

/* ---------- stato ---------- */
const S = {
  me:null, d:null, tab:'today', detail:null,
  taskView:'lista', taskPerson:'', taskProject:'', taskQ:'', showDone:false,
  pFilter:'attivi', pQ:'', prFilter:'attivi', pubPerson:'', pubQ:'',
  calMonth:TODAY.slice(0,7), calView:'mese', calWeek:null, drawer:null
};
try{ const v=localStorage.getItem('compass.taskView'); if(v==='lista'||v==='bacheca') S.taskView=v; const c=localStorage.getItem('compass.calView'); if(c==='mese'||c==='settimana') S.calView=c; }catch(e){}

/* ---------- API ---------- */
async function api(method, path, data){
  const opt={method, credentials:'same-origin', headers:{}};
  if(method!=='GET'){ opt.headers['X-Compass']='1'; opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(data||{}); }
  let res;
  try{ res=await fetch(path,opt); }catch(e){ throw {status:0, message:'Compass is not responding: check that it is running.'}; }
  let j=null; try{ j=await res.json(); }catch(e){}
  if(!res.ok){
    if(res.status===401 && path!=='api/login' && S.me){ S.me=null; showLogin('Your session has expired: please sign in again.'); }
    throw {status:res.status, message:(j&&j.error)||('Error ('+res.status+').')};
  }
  return j;
}
async function mutate(method, path, data, okMsg){
  try{
    const j=await api(method,path,data);
    if(j && j.state) applyState(j.state);
    if(okMsg) toast(okMsg);
    return {ok:true, data:j};
  }catch(e){ return {ok:false, error:e.message}; }
}
function applyState(st){
  S.d=st;
  if(st.today && st.today!==TODAY){ if(S.calMonth===TODAY.slice(0,7)) S.calMonth=st.today.slice(0,7); TODAY=st.today; }
  renderAll();
}

/* ---------- ricerche nei dati ---------- */
const byId = (list,id) => id ? (S.d[list]||[]).find(x=>x.id===id) : null;
const person = id => byId('people',id);
const project = id => byId('projects',id);
const projLabel = p => p ? (p.acronym || p.title) : '';
const projBadge = p => ((p.acronym||p.title).replace(/[^A-Za-z0-9]/g,'').slice(0,4) || '?').toUpperCase();
const activePeople = () => S.d.people.filter(p=>!p.archived);
const sortDue = (a,b) => (a.due||'9999').localeCompare(b.due||'9999');
const prioRank = {alta:0, normale:1, bassa:2};
const openTasks = () => S.d.tasks.filter(t=>t.status!=='done');
function lastMeeting(personId){ return S.d.meetings.filter(m=>m.person_id===personId).map(m=>m.date).sort().pop() || null; }
function personProjects(pid){ return S.d.projects.filter(pr=>pr.members.some(m=>m.person_id===pid)); }
function spent(prId){ return S.d.expenses.filter(e=>e.project_id===prId).reduce((s,e)=>s+e.amount_cents,0); }
function upcomingItems(days){
  // scadenze aperte (anche in ritardo) e scadenze delle pubblicazioni in lavorazione
  const lim=addDays(TODAY,days);
  const dl=S.d.deadlines.filter(d=>!d.done_at && d.due<=lim).map(d=>({type:'dl', due:d.due, item:d}));
  const pb=S.d.pubs.filter(p=>p.deadline && PUB_OPEN.includes(p.status) && p.deadline<=lim && p.deadline>=addDays(TODAY,-14)).map(p=>({type:'pub', due:p.deadline, item:p}));
  return dl.concat(pb).sort((a,b)=>a.due.localeCompare(b.due));
}

/* ---------- avvio e accesso ---------- */
async function boot(){
  try{ const j=await api('GET','api/me'); S.me=j.me; await startApp(); }
  catch(e){ showLogin(e.status===401?'':e.message); }
}
function showLogin(msg, okMsg){
  closeDrawer();
  $('#app').hidden=true; $('#login-screen').hidden=false; $('#setup-form').hidden=true; $('#login-form').hidden=false;
  const err=$('#login-err'); err.hidden=!msg; err.textContent=msg||'';
  const ok=$('#login-ok'); ok.hidden=!okMsg; ok.textContent=okMsg||'';
  checkSetup();
  setTimeout(()=>{ const u=$('#l-user'); (u.value?$('#l-pass'):u).focus(); },30);
}
async function checkSetup(){
  let need=false; try{ need=(await api('GET','api/setup')).needed; }catch(e){}
  if(!need) return;
  $('#login-form').hidden=true; $('#setup-form').hidden=false;
  setTimeout(()=>$('#s-name').focus(),30);
}
async function login(){
  const username=$('#l-user').value.trim(), password=$('#l-pass').value;
  const err=$('#login-err'); err.hidden=true;
  if(!username||!password){ err.textContent='Enter your username and password.'; err.hidden=false; return; }
  const btn=$('#login-btn'); btn.disabled=true;
  try{ const j=await api('POST','api/login',{username,password}); S.me=j.me; $('#l-pass').value=''; await startApp(); }
  catch(e){ err.textContent=e.message; err.hidden=false; }
  btn.disabled=false;
}
function setupFields(){
  const name=$('#s-name').value.trim(), username=$('#s-user').value.trim(), p1=$('#s-pass').value, p2=$('#s-pass2').value;
  const err=$('#setup-err'), fail=m=>{ err.textContent=m; err.hidden=false; return null; };
  if(!name) return fail('Enter your full name.');
  if(!/^[A-Za-z0-9._@-]{3,60}$/.test(username)) return fail('Username: 3 to 60 characters among letters, digits, dot, hyphen, @ (no spaces).');
  if(p1.length<MIN_PASSWORD) return fail('The password must be at least '+MIN_PASSWORD+' characters long.');
  if(p1!==p2) return fail('The two passwords do not match.');
  err.hidden=true; return {name, username, password:p1};
}
async function setup(){
  const v=setupFields(); if(!v) return;
  const err=$('#setup-err'), fail=m=>{ err.textContent=m; err.hidden=false; };
  const btn=$('#setup-btn'); btn.disabled=true;
  try{ const j=await api('POST','api/setup',v); S.me=j.me; await startApp(); toast('Compass is ready. Start from the sample data or add your own people.'); }
  catch(e){ fail(e.message); }
  btn.disabled=false;
}
async function startApp(){
  $('#login-screen').hidden=true; $('#app').hidden=false;
  const d=new Date(); $('#today').textContent=GIORNI[d.getDay()]+', '+d.getDate()+' '+MESI_L[d.getMonth()]+' '+d.getFullYear();
  readHash();
  const j=await api('GET','api/state'); applyState(j.state);
}

/* ---------- navigazione (indirizzo #scheda/id) ---------- */
const TABS=['today','tasks','calendar','people','projects','publications'];
function readHash(){
  const [t,id]=(location.hash||'').slice(1).split('/');
  S.tab = TABS.includes(t) ? t : 'today';
  S.detail = (id && (t==='people'||t==='projects')) ? {type:t, id:decodeURIComponent(id)} : null;
}
function go(tab,id){ const h='#'+tab+(id?'/'+encodeURIComponent(id):''); if(location.hash!==h) location.hash=h; else { readHash(); renderAll(); } }
window.addEventListener('hashchange',()=>{ readHash(); if(S.d){ renderAll(); window.scrollTo(0,0); } });

/* ---------- componenti ---------- */
const refPerson = id => { const p=person(id); return p?`<button class="ref" type="button" data-action="goto" data-tab="people" data-id="${esc(p.id)}">${esc(p.name)}</button>`:''; };
const refProject = id => { const p=project(id); return p?`<button class="ref proj" type="button" data-action="goto" data-tab="projects" data-id="${esc(p.id)}">${esc(projLabel(p))}</button>`:''; };
function exampleTag(x){ return x.example?' <span class="tag">sample</span>':''; }

function taskRow(t,opts){
  opts=opts||{};
  const done=t.status==='done';
  const meta=[ t.status==='doing'?'<span class="pill p-acc">In progress</span>':'', t.priority==='alta'&&!done?'<span class="prio">High priority</span>':'',
    opts.noPerson?'':refPerson(t.person_id), opts.noProject?'':refProject(t.project_id) ].filter(Boolean).join('');
  return `<div class="row${done?' done':''}">
    <input class="check" type="checkbox" data-action="toggle-task" data-id="${esc(t.id)}" ${done?'checked':''} aria-label="Done: ${esc(t.title)}">
    <div class="row-main"><button class="row-title" type="button" data-action="edit" data-ent="tasks" data-id="${esc(t.id)}">${esc(t.title)}</button>${meta?`<div class="row-meta">${meta}</div>`:''}</div>
    ${whenHtml(done?t.done_at:t.due, done)}
  </div>`;
}
function deadlineRow(d,opts){
  opts=opts||{};
  const done=!!d.done_at;
  const meta=[`<span class="kind">${DL_KIND[d.kind]||d.kind}</span>`, opts.noPerson?'':refPerson(d.person_id), opts.noProject?'':refProject(d.project_id)].filter(Boolean).join('');
  return `<div class="row${done?' done':''}">
    <input class="check round" type="checkbox" data-action="toggle-dl" data-id="${esc(d.id)}" ${done?'checked':''} aria-label="Done: ${esc(d.title)}">
    <div class="row-main"><button class="row-title" type="button" data-action="edit" data-ent="deadlines" data-id="${esc(d.id)}">${esc(d.title)}</button><div class="row-meta">${meta}</div></div>
    ${whenHtml(d.due, done)}
  </div>`;
}
function pubDeadlineRow(p){
  return `<div class="row">
    <span class="paper-dot" aria-hidden="true"></span>
    <div class="row-main"><button class="row-title" type="button" data-action="edit" data-ent="pubs" data-id="${esc(p.id)}">${esc(p.title)}</button>
      <div class="row-meta"><span class="kind">Paper · ${esc(PUB_STATUS[p.status][0])}</span>${p.venue?'<span>'+esc(p.venue)+'</span>':''}${p.person_ids.map(refPerson).join('')}</div></div>
    ${whenHtml(p.deadline,false)}
  </div>`;
}
function periodBar(start,end,cls){
  if(!start||!end||end<start) return '';
  const tot=Math.max(1,daysBetween(start,end)), el=Math.min(tot,Math.max(0,daysBetween(start,TODAY)));
  const pct=Math.round(el/tot*100);
  const left=daysBetween(TODAY,end);
  const lbl = TODAY<start ? 'starts '+rel(start) : (left<0 ? 'ended' : (left>60 ? Math.round(left/30.4)+' months left' : left+' days left'));
  return `<div><div class="bar${cls?' '+cls:''}" role="img" aria-label="Time elapsed: ${pct}%"><i style-w="${pct}"></i></div><div class="bar-lbl"><span>${fmtShort(start)}</span><span>${lbl}</span><span>${fmtShort(end)}</span></div></div>`;
}
function budgetBar(pr){
  if(!pr.budget_cents) return '';
  const sp=spent(pr.id), pct=Math.round(sp/pr.budget_cents*100);
  return `<div><div class="bar proj${sp>pr.budget_cents?' over':''}" role="img" aria-label="Budget spent: ${pct}%"><i style-w="${Math.min(100,pct)}"></i></div><div class="bar-lbl"><span>spent ${money(sp)}</span><span>${pct}% of ${money(pr.budget_cents)}</span></div></div>`;
}
/* le larghezze delle barre si applicano da script: la Content-Security-Policy non ammette stili inline */
function applyWidths(root){ (root||document).querySelectorAll('[style-w]').forEach(el=>{ el.style.width=el.getAttribute('style-w')+'%'; }); }
function meetingHtml(m,opts){
  opts=opts||{};
  const steps=(m.next_steps||'').split('\n').map(s=>s.trim()).filter(Boolean);
  return `<div class="meet">
    <div class="meet-head"><button class="linkbtn" type="button" data-action="edit" data-ent="meetings" data-id="${esc(m.id)}">${esc(m.title||'Meeting')}</button><span class="d">${fmt(m.date)}</span></div>
    ${(opts.noPerson&&opts.noProject)?'':`<div class="row-meta">${opts.noPerson?'':refPerson(m.person_id)}${opts.noProject?'':refProject(m.project_id)}</div>`}
    ${m.notes?`<p>${esc(m.notes)}</p>`:''}
    ${steps.length?`<div class="next"><b>Next steps</b>${steps.map((s,i)=>`<div class="row-meta"><span>${esc(s)}</span><button class="btn ghost small" type="button" data-action="step-task" data-id="${esc(m.id)}" data-i="${i}" title="Create a task from this step">+ task</button></div>`).join('')}</div>`:''}
  </div>`;
}
function emptyLine(t){ return `<p class="empty">${t}</p>`; }

/* ---------- disegno generale ---------- */
function renderAll(){
  if(!S.d) return;
  document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected', String(t.dataset.tab===S.tab)));
  const late=openTasks().filter(t=>t.due && t.due<TODAY).length;
  const ct=$('#c-tasks'); ct.textContent=openTasks().length; ct.classList.toggle('alert',late>0); ct.title=late?late+' overdue':'';
  $('#c-people').textContent=activePeople().length;
  $('#c-projects').textContent=S.d.projects.filter(p=>p.status==='attivo').length;
  $('#c-pub').textContent=S.d.pubs.filter(p=>PUB_OPEN.includes(p.status)||p.status==='sottomesso').length;
  renderView();
  refreshDrawer();
}
function renderView(){
  const v=$('#view');
  const bar = S.d.examples ? `<div class="example-bar"><span>You are looking at sample data (marked <b>sample</b>). Remove it when you start adding your own.</span><button class="btn" type="button" data-action="clear-examples">Remove sample data</button></div>` : '';
  let html;
  if(S.detail && S.detail.type==='people') html=viewPerson(S.detail.id);
  else if(S.detail && S.detail.type==='projects') html=viewProject(S.detail.id);
  else html=({today:viewOggi, tasks:viewTasks, calendar:viewCalendar, people:viewPeople, projects:viewProjects, publications:viewPubs}[S.tab])();
  const keep=document.activeElement && document.activeElement.id && v.contains(document.activeElement) ? document.activeElement.id : null;
  const sel=keep && document.activeElement.selectionStart;
  v.innerHTML=bar+html;
  applyWidths(v);
  if(keep){ const el=document.getElementById(keep); if(el){ el.focus(); try{ if(sel!=null) el.setSelectionRange(sel,sel); }catch(e){} } }
}

/* --- Oggi --- */
function viewOggi(){
  const d=S.d;
  if(!d.people.length && !d.projects.length && !d.tasks.length){
    return `<div class="notice"><h2>Welcome to Compass</h2>
      <p class="muted">Keep your students, PhD candidates, projects, deadlines, meetings, publications and tasks in one place. Start from the sample data to see how it works, or add your own people right away.</p>
      <div class="top-actions"><button class="btn primary" type="button" data-action="load-examples">Load sample data</button><button class="btn" type="button" data-action="new" data-ent="people">+ Person</button><button class="btn" type="button" data-action="new" data-ent="projects">+ Project</button></div></div>`;
  }
  const open=openTasks();
  const late=open.filter(t=>t.due && t.due<TODAY).sort(sortDue);
  const today=open.filter(t=>t.due===TODAY);
  const week=open.filter(t=>t.due>TODAY && t.due<=addDays(TODAY,7)).sort(sortDue);
  const doing=open.filter(t=>t.status==='doing' && !(t.due && t.due<=addDays(TODAY,7)));
  const up=upcomingItems(30);
  const people=activePeople();
  const phd=people.filter(p=>p.kind==='dottorando').length, th=people.filter(p=>p.kind==='magistrale'||p.kind==='triennale').length;
  const toMeet=people.filter(p=>['dottorando','magistrale','triennale'].includes(p.kind) && (!p.start || p.start<=TODAY))
    .map(p=>({p, last:lastMeeting(p.id)})).filter(x=>!x.last || daysBetween(x.last,TODAY)>MEET_GAP)
    .sort((a,b)=>(a.last||'').localeCompare(b.last||''));
  const grp=(title,list,cls)=>list.length?`<div class="group${cls?' '+cls:''}"><h3>${title} <span class="n">${list.length}</span></h3>${list.map(t=>taskRow(t)).join('')}</div>`:'';
  const tasksHtml = grp('Overdue',late,'late')+grp('Today',today)+grp('Next 7 days',week)+grp('In progress',doing);
  return `<div class="stats">
      <button class="stat" type="button" data-action="tab" data-tab="tasks"><span class="lbl">Overdue tasks</span><span class="num${late.length?' bad':''}">${late.length}</span><span class="sub">${open.length} open tasks in total</span></button>
      <button class="stat" type="button" data-action="tab" data-tab="tasks"><span class="lbl">Tasks in the next 7 days</span><span class="num">${today.length+week.length}</span><span class="sub">${today.length} due today</span></button>
      <button class="stat" type="button" data-action="tab" data-tab="calendar"><span class="lbl">Deadlines in the next 30 days</span><span class="num">${up.filter(x=>x.due>=TODAY).length}</span><span class="sub">${up.filter(x=>x.due<TODAY).length} past due, still open</span></button>
      <button class="stat" type="button" data-action="tab" data-tab="people"><span class="lbl">People you supervise</span><span class="num">${people.length}</span><span class="sub">${phd} PhD · ${th} thesis students</span></button>
    </div>
    <div class="cols">
      <section class="panel"><div class="panel-head"><h2>To do</h2><button class="btn small" type="button" data-action="new" data-ent="tasks">+ Task</button></div>
        ${tasksHtml || '<p class="allgood">Nothing due in the next 7 days.</p>'}
        <div><button class="linkbtn" type="button" data-action="tab" data-tab="tasks">All tasks →</button></div>
      </section>
      <div class="stack">
        <section class="panel"><div class="panel-head"><h2>Deadlines</h2><button class="btn small" type="button" data-action="new" data-ent="deadlines">+ Deadline</button></div>
          ${up.length?`<div>${up.map(x=>x.type==='dl'?deadlineRow(x.item):pubDeadlineRow(x.item)).join('')}</div>`:'<p class="allgood">No deadlines in the next 30 days.</p>'}
        </section>
        <section class="panel"><div class="panel-head"><h2>Check in with</h2><span class="hint">no meeting in over ${MEET_GAP} days</span></div>
          ${toMeet.length?`<div>${toMeet.map(x=>`<div class="row"><span class="avatar">${esc(initials(x.p.name))}</span><div class="row-main">${refPerson(x.p.id)}<div class="row-meta">${PERSON_KIND[x.p.kind][1]} · ${x.last?'last meeting '+rel(x.last):'no meetings recorded'}</div></div><button class="btn small" type="button" data-action="new" data-ent="meetings" data-person="${esc(x.p.id)}">+ Meeting</button></div>`).join('')}</div>`:'<p class="allgood">You have met everyone recently.</p>'}
        </section>
      </div>
    </div>`;
}

/* --- Task: lista e bacheca --- */
function filteredTasks(){
  const q=norm(S.taskQ);
  return S.d.tasks.filter(t=>(!S.taskPerson || t.person_id===S.taskPerson) && (!S.taskProject || t.project_id===S.taskProject)
    && (!q || norm(t.title+' '+t.notes).includes(q)));
}
function taskToolbar(){
  const ppl=S.d.people.slice().sort((a,b)=>a.name.localeCompare(b.name,'en')), prj=S.d.projects.slice().sort((a,b)=>projLabel(a).localeCompare(projLabel(b),'en'));
  return `<div class="toolbar"><div class="left">
      <div class="seg" role="group" aria-label="View"><button type="button" data-action="task-view" data-v="lista" aria-pressed="${S.taskView==='lista'}">List</button><button type="button" data-action="task-view" data-v="bacheca" aria-pressed="${S.taskView==='bacheca'}">Board</button></div>
      <select id="task-person" aria-label="Filter by person"><option value="">All people</option>${ppl.map(p=>`<option value="${esc(p.id)}" ${p.id===S.taskPerson?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      <select id="task-project" aria-label="Filter by project"><option value="">All projects</option>${prj.map(p=>`<option value="${esc(p.id)}" ${p.id===S.taskProject?'selected':''}>${esc(projLabel(p))}</option>`).join('')}</select>
      <input id="task-q" class="search" type="search" placeholder="Search tasks…" value="${esc(S.taskQ)}">
    </div><div class="right">${S.taskView==='lista'?`<label class="check-inline"><input type="checkbox" id="show-done" ${S.showDone?'checked':''}> Show completed</label>`:''}<button class="btn primary" type="button" data-action="new" data-ent="tasks">+ Task</button></div></div>`;
}
function viewTasks(){ return taskToolbar() + (S.taskView==='bacheca' ? boardHtml() : listHtml()); }
function listHtml(){
  const all=filteredTasks(), open=all.filter(t=>t.status!=='done');
  const order=(a,b)=>sortDue(a,b)||(prioRank[a.priority]-prioRank[b.priority]);
  const g={late:[],today:[],week:[],later:[],none:[]};
  open.forEach(t=>{ if(!t.due) g.none.push(t); else if(t.due<TODAY) g.late.push(t); else if(t.due===TODAY) g.today.push(t); else if(t.due<=addDays(TODAY,7)) g.week.push(t); else g.later.push(t); });
  g.none.sort((a,b)=>prioRank[a.priority]-prioRank[b.priority]);
  const done=all.filter(t=>t.status==='done').sort((a,b)=>(b.done_at||'').localeCompare(a.done_at||''));
  const sec=(title,list,cls)=>list.length?`<div class="group${cls?' '+cls:''}"><h3>${title} <span class="n">${list.length}</span></h3>${list.map(t=>taskRow(t)).join('')}</div>`:'';
  const body=sec('Overdue',g.late.sort(order),'late')+sec('Today',g.today.sort(order))+sec('Next 7 days',g.week.sort(order))+sec('Later',g.later.sort(order))+sec('No due date',g.none)
    +(S.showDone?sec('Completed',done.slice(0,50)):'');
  return `<section class="panel">${body || '<p class="allgood">No open tasks'+(S.taskPerson||S.taskProject||S.taskQ?' with these filters':'')+'.</p>'}</section>`;
}
function boardHtml(){
  const all=filteredTasks();
  const cols=['todo','doing','done'].map(st=>{
    let list=all.filter(t=>t.status===st).sort((a,b)=>a.position-b.position);
    let hidden=0;
    if(st==='done'){ const lim=addDays(TODAY,-30); const recent=list.filter(t=>!t.done_at||t.done_at>=lim); hidden=list.length-recent.length; list=recent; }
    return `<section class="col" data-col="${st}" aria-label="${TASK_STATUS[st]}">
      <div class="col-head"><h2>${TASK_STATUS[st]}</h2><span class="count">${list.length}</span></div>
      ${list.map(t=>cardHtml(t)).join('')}
      ${hidden?`<p class="hint">${hidden} tasks completed more than 30 days ago are hidden.</p>`:''}
      ${st==='todo'?'<button class="btn ghost small" type="button" data-action="new" data-ent="tasks">+ Add</button>':''}
    </section>`;
  }).join('');
  return `<div class="board">${cols}</div><p class="hint">Drag cards between columns, or use the ‹ › arrows on each card.</p>`;
}
function cardHtml(t){
  const i=['todo','doing','done'].indexOf(t.status);
  return `<article class="card" draggable="true" data-card="${esc(t.id)}">
    <button class="row-title" type="button" data-action="edit" data-ent="tasks" data-id="${esc(t.id)}">${esc(t.title)}</button>
    <div class="row-meta">${t.priority==='alta'&&t.status!=='done'?'<span class="prio">High</span>':''}${refPerson(t.person_id)}${refProject(t.project_id)}</div>
    <div class="card-foot">${t.status==='done'?whenHtml(t.done_at,true):whenHtml(t.due,false)||'<span></span>'}
      <span class="card-moves">${i>0?`<button type="button" data-action="move-task" data-id="${esc(t.id)}" data-dir="-1" aria-label="Move to ${TASK_STATUS[['todo','doing','done'][i-1]]}">‹</button>`:''}${i<2?`<button type="button" data-action="move-task" data-id="${esc(t.id)}" data-dir="1" aria-label="Move to ${TASK_STATUS[['todo','doing','done'][i+1]]}">›</button>`:''}</span></div>
  </article>`;
}

/* --- Calendario --- */
function calItems(){
  const items={};
  const add=(day,html)=>{ (items[day]=items[day]||[]).push(html); };
  S.d.deadlines.forEach(d=>add(d.due,`<button class="ev dl${d.done_at?' done':''}" type="button" data-action="edit" data-ent="deadlines" data-id="${esc(d.id)}" title="${esc(DL_KIND[d.kind]+': '+d.title)}">${esc(d.title)}</button>`));
  S.d.pubs.filter(p=>p.deadline).forEach(p=>add(p.deadline,`<button class="ev pub${PUB_OPEN.includes(p.status)?'':' done'}" type="button" data-action="edit" data-ent="pubs" data-id="${esc(p.id)}" title="${esc('Paper: '+p.title)}">${esc(p.venue||p.title)}</button>`));
  S.d.tasks.filter(t=>t.due).forEach(t=>add(t.due,`<button class="ev${t.status==='done'?' done':''}" type="button" data-action="edit" data-ent="tasks" data-id="${esc(t.id)}" title="${esc('Task: '+t.title)}">${esc(t.title)}</button>`));
  return items;
}
const mondayOf = iso => addDays(iso, -((new Date(iso+'T00:00:00Z').getUTCDay()+6)%7));
const CAL_LEGEND = '<div class="cal-legend"><span><i class="lg-task"></i>Task</span><span><i class="lg-dl"></i>Deadlines and milestones</span><span><i class="lg-pub"></i>Paper deadlines</span></div>';
function calSwitch(){ return `<div class="seg" role="group" aria-label="Calendar view"><button type="button" data-action="cal-view" data-v="mese" aria-pressed="${S.calView==='mese'}">Month</button><button type="button" data-action="cal-view" data-v="settimana" aria-pressed="${S.calView==='settimana'}">Week</button></div>`; }
function viewCalendar(){ if(!S.calWeek) S.calWeek=mondayOf(TODAY); return S.calView==='settimana' ? viewWeek() : viewMonth(); }
function viewMonth(){
  const [y,m]=S.calMonth.split('-').map(Number);
  const start=mondayOf(S.calMonth+'-01');
  const items=calItems();
  let cells='';
  for(let i=0;i<42;i++){
    const day=addDays(start,i);
    if(i>=35 && day.slice(0,7)!==S.calMonth) break;
    const other=day.slice(0,7)!==S.calMonth;
    cells+=`<div class="day${other?' other':''}${day===TODAY?' today':''}"><div class="day-top"><button class="dnum" type="button" data-action="cal-week" data-day="${day}" title="Show this week">${+day.slice(8)}</button><button class="day-add" type="button" data-action="new" data-ent="tasks" data-due="${day}" aria-label="New task for ${fmt(day)}">+</button></div>${(items[day]||[]).join('')}</div>`;
  }
  return `<div class="toolbar"><div class="cal-head">${calSwitch()}
      <button class="btn" type="button" data-action="cal" data-d="-1" aria-label="Previous month">‹</button>
      <h2>${MESI_L[m-1]} ${y}</h2>
      <button class="btn" type="button" data-action="cal" data-d="1" aria-label="Next month">›</button>
      ${S.calMonth!==TODAY.slice(0,7)?'<button class="btn ghost" type="button" data-action="cal" data-d="0">Today</button>':''}
    </div>${CAL_LEGEND}</div>
    <div class="cal">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(g=>`<div class="cal-dow">${g}</div>`).join('')}${cells}</div>
    <p class="hint">Click a day number to open its week. To see these dates in Outlook or Google Calendar: Settings › Download calendar.</p>`;
}
/* settimana: per ogni giorno l'elenco completo, con persona e progetto */
function weekItems(){
  const items={};
  const add=(day,o)=>{ (items[day]=items[day]||[]).push(o); };
  const meta=(kind,pid,prid)=>`<div class="row-meta"><span class="kind">${kind}</span>${refPerson(pid)}${refProject(prid)}</div>`;
  S.d.deadlines.forEach(d=>add(d.due,{o:0, html:`<div class="wev w-dl${d.done_at?' done':''}"><button class="row-title" type="button" data-action="edit" data-ent="deadlines" data-id="${esc(d.id)}">${esc(d.title)}</button>${meta(DL_KIND[d.kind],d.person_id,d.project_id)}</div>`}));
  S.d.pubs.filter(p=>p.deadline).forEach(p=>add(p.deadline,{o:1, html:`<div class="wev w-pub${PUB_OPEN.includes(p.status)?'':' done'}"><button class="row-title" type="button" data-action="edit" data-ent="pubs" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="row-meta"><span class="kind">Paper${p.venue?' · '+esc(p.venue):''}</span>${p.person_ids.map(refPerson).join('')}</div></div>`}));
  S.d.tasks.filter(t=>t.due).forEach(t=>add(t.due,{o:t.status==='done'?3:2, html:`<div class="wev${t.status==='done'?' done':''}"><button class="row-title" type="button" data-action="edit" data-ent="tasks" data-id="${esc(t.id)}">${esc(t.title)}</button>${meta(t.status==='done'?'Task done':(t.priority==='alta'?'Task · high priority':(t.status==='doing'?'Task · in progress':'Task')),t.person_id,t.project_id)}</div>`}));
  Object.values(items).forEach(l=>l.sort((a,b)=>a.o-b.o));
  return items;
}
function viewWeek(){
  const start=S.calWeek, end=addDays(start,6);
  const items=weekItems();
  const [y1,m1,d1]=start.split('-'), [y2,m2,d2]=end.split('-');
  const title = m1===m2 ? `${+d1}–${+d2} ${MESI_L[m2-1]} ${y2}` : `${+d1} ${MESI[m1-1]}${y1!==y2?' '+y1:''} – ${+d2} ${MESI[m2-1]} ${y2}`;
  const late = S.calWeek===mondayOf(TODAY) ? openTasks().filter(t=>t.due && t.due<start).length : 0;
  let cols='';
  for(let i=0;i<7;i++){
    const day=addDays(start,i), list=items[day]||[];
    cols+=`<section class="wday${day===TODAY?' today':''}${i>4?' weekend':''}" aria-label="${GIORNI[(i+1)%7]} ${fmt(day)}">
      <div class="wday-head"><span class="dow">${GIORNI[(i+1)%7].slice(0,3)}</span><span class="dn">${+day.slice(8)}</span></div>
      ${list.map(x=>x.html).join('') || '<p class="hint">—</p>'}
      <button class="btn ghost small add" type="button" data-action="new" data-ent="tasks" data-due="${day}" aria-label="New task for ${GIORNI[(i+1)%7]} ${fmt(day)}">+ Task</button>
    </section>`;
  }
  return `<div class="toolbar"><div class="cal-head">${calSwitch()}
      <button class="btn" type="button" data-action="calw" data-d="-7" aria-label="Previous week">‹</button>
      <h2 class="nocap">${title}</h2>
      <button class="btn" type="button" data-action="calw" data-d="7" aria-label="Next week">›</button>
      ${S.calWeek!==mondayOf(TODAY)?'<button class="btn ghost" type="button" data-action="calw" data-d="0">This week</button>':''}
    </div>${CAL_LEGEND}</div>
    ${late?`<p class="hint late-note">There are also ${late} overdue tasks from previous weeks: <button class="linkbtn" type="button" data-action="tab" data-tab="tasks">see tasks</button>.</p>`:''}
    <div class="week">${cols}</div>`;
}

/* --- Persone --- */
const PFILTERS=[['attivi','All'],['dottorandi','PhD students'],['tesisti','Thesis students'],['postdoc','Postdocs and fellows'],['altri','Others'],['archiviati','Archived']];
function peopleFiltered(f){
  return S.d.people.filter(p=>{
    if(f==='archiviati') return p.archived;
    if(p.archived) return false;
    if(f==='dottorandi') return p.kind==='dottorando';
    if(f==='tesisti') return p.kind==='magistrale'||p.kind==='triennale';
    if(f==='postdoc') return p.kind==='postdoc'||p.kind==='assegnista';
    if(f==='altri') return p.kind==='visiting'||p.kind==='altro';
    return true;
  });
}
function viewPeople(){
  const q=norm(S.pQ);
  const list=peopleFiltered(S.pFilter).filter(p=>!q||norm([p.name,p.topic,p.cosupervisors,p.ciclo].join(' ')).includes(q))
    .sort((a,b)=>(['dottorando','postdoc','assegnista','magistrale','triennale','visiting','altro'].indexOf(a.kind)-['dottorando','postdoc','assegnista','magistrale','triennale','visiting','altro'].indexOf(b.kind))||a.name.localeCompare(b.name,'en'));
  const cards=list.map(p=>{
    const next=S.d.deadlines.filter(d=>d.person_id===p.id && !d.done_at).sort(sortDue)[0];
    const last=lastMeeting(p.id);
    const tasks=openTasks().filter(t=>t.person_id===p.id).length;
    const prj=personProjects(p.id);
    const stale=!p.archived && (!last || daysBetween(last,TODAY)>MEET_GAP);
    return `<button class="pcard" type="button" data-action="goto" data-tab="people" data-id="${esc(p.id)}">
      <div class="pcard-top"><div class="dh-left"><span class="avatar">${esc(initials(p.name))}</span><div><h3>${esc(p.name)}${exampleTag(p)}</h3><p class="dh-sub">${PERSON_KIND[p.kind][0]}${p.ciclo?' · cycle '+esc(p.ciclo):''}</p></div></div></div>
      ${p.topic?`<p class="topic">${esc(p.topic)}</p>`:''}
      ${periodBar(p.start,p.end)}
      <div class="facts">
        <div><span class="k">Next milestone</span><span class="v">${next?esc(next.title)+' · '+whenHtml(next.due):'—'}</span></div>
        <div><span class="k">Last meeting</span><span class="v${stale?' when soon':''}">${last?rel(last):'never'}</span></div>
        <div><span class="k">Open tasks</span><span class="v">${tasks}</span></div>
        ${prj.length?`<div><span class="k">Projects</span><span class="v">${prj.map(x=>esc(projLabel(x))).join(', ')}</span></div>`:''}
      </div>
    </button>`;
  }).join('');
  return `<div class="toolbar"><div class="left"><div class="filters" role="group" aria-label="Filter">${PFILTERS.map(([k,l])=>`<button class="chip" type="button" data-action="pfilter" data-v="${k}" aria-pressed="${S.pFilter===k}">${l} <span class="count">${peopleFiltered(k).length}</span></button>`).join('')}</div></div>
    <div class="right"><input id="people-q" class="search" type="search" placeholder="Search name, topic…" value="${esc(S.pQ)}"><button class="btn primary" type="button" data-action="new" data-ent="people">+ Person</button></div></div>
    ${list.length?`<div class="grid-cards">${cards}</div>`:'<div class="notice"><h2>No people here</h2><p class="muted">Add your thesis and PhD students with “+ Person”.</p></div>'}`;
}
function viewPerson(id){
  const p=person(id);
  if(!p) return `<div class="back"><button class="linkbtn" type="button" data-action="tab" data-tab="people">← People</button></div><div class="notice"><h2>Person not found</h2><p class="muted">It may have been deleted.</p></div>`;
  const dls=S.d.deadlines.filter(d=>d.person_id===id);
  const dOpen=dls.filter(d=>!d.done_at).sort(sortDue), dDone=dls.filter(d=>d.done_at).sort((a,b)=>b.due.localeCompare(a.due));
  const meets=S.d.meetings.filter(m=>m.person_id===id).sort((a,b)=>b.date.localeCompare(a.date));
  const tasks=S.d.tasks.filter(t=>t.person_id===id);
  const tOpen=tasks.filter(t=>t.status!=='done').sort(sortDue), tDone=tasks.filter(t=>t.status==='done').length;
  const prj=personProjects(id);
  const pubs=S.d.pubs.filter(x=>x.person_ids.includes(id));
  const info=[['Email',p.email?`<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`:''],['Phone',esc(p.phone)],['Student ID',esc(p.matricola)],['Topic',esc(p.topic)],
    ['Co-supervisors',esc(p.cosupervisors)],['Funding',esc(p.funding)],['Period',p.start||p.end?fmt(p.start)+' → '+fmt(p.end):''],
    ['Folder',p.folder?(isUrl(p.folder)?`<a href="${esc(p.folder)}" target="_blank" rel="noopener">${esc(p.folder)}</a>`:`<span class="mono">${esc(p.folder)}</span>`):''],['Notes',esc(p.notes)]].filter(x=>x[1]);
  return `<div class="back"><button class="linkbtn" type="button" data-action="tab" data-tab="people">← People</button></div>
    <div class="detail-head"><div class="dh-left"><span class="avatar lg">${esc(initials(p.name))}</span><div><h2>${esc(p.name)}${exampleTag(p)}${p.archived?' <span class="pill p-idle">Archived</span>':''}</h2>
      <p class="dh-sub">${PERSON_KIND[p.kind][0]}${p.ciclo?' · cycle '+esc(p.ciclo):''}${p.funding?' · '+esc(p.funding):''}</p></div></div>
      <div class="dh-actions"><button class="btn primary" type="button" data-action="new" data-ent="meetings" data-person="${esc(id)}">+ Meeting</button><button class="btn" type="button" data-action="new" data-ent="tasks" data-person="${esc(id)}">+ Task</button><button class="btn" type="button" data-action="new" data-ent="deadlines" data-person="${esc(id)}">+ Milestone</button><button class="btn" type="button" data-action="edit" data-ent="people" data-id="${esc(id)}">Edit</button></div></div>
    <div class="detail">
      <div class="stack">
        ${p.start&&p.end?`<section class="panel">${periodBar(p.start,p.end)}</section>`:''}
        <section class="panel"><div class="panel-head"><h2>Milestones and deadlines</h2><button class="btn small" type="button" data-action="new" data-ent="deadlines" data-person="${esc(id)}">+ Milestone</button></div>
          ${dOpen.length||dDone.length?`<div>${dOpen.map(d=>deadlineRow(d,{noPerson:true})).join('')}${dDone.map(d=>deadlineRow(d,{noPerson:true})).join('')}</div>`:emptyLine('No milestones yet: add the key dates (annual reviews, submission, defence…).')}
        </section>
        <section class="panel"><div class="panel-head"><h2>Meetings</h2><button class="btn small" type="button" data-action="new" data-ent="meetings" data-person="${esc(id)}">+ Meeting</button></div>
          ${meets.length?meets.map(m=>meetingHtml(m,{noPerson:true})).join(''):emptyLine('No meetings recorded.')}
        </section>
        <section class="panel"><div class="panel-head"><h2>Tasks</h2><button class="btn small" type="button" data-action="new" data-ent="tasks" data-person="${esc(id)}">+ Task</button></div>
          ${tOpen.length?`<div>${tOpen.map(t=>taskRow(t,{noPerson:true})).join('')}</div>`:emptyLine('No open tasks.')}
          ${tDone?`<p class="hint">${tDone} completed tasks.</p>`:''}
        </section>
      </div>
      <div class="stack">
        <section class="panel info"><h2>Profile</h2>${info.length?`<dl>${info.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`:emptyLine('Fill in the profile with “Edit”.')}</section>
        <section class="panel"><h2>Projects</h2>${prj.length?prj.map(x=>`<div class="contact">${refProject(x.id)}<span class="r">${esc((x.members.find(m=>m.person_id===id)||{}).role||'')}</span></div>`).join(''):emptyLine('Not on any project.')}</section>
        <section class="panel"><h2>Publications</h2>${pubs.length?pubs.map(x=>`<div class="contact"><button class="linkbtn" type="button" data-action="edit" data-ent="pubs" data-id="${esc(x.id)}">${esc(x.title)}</button><span class="r">${esc(x.venue)} · ${PUB_STATUS[x.status][0]}</span></div>`).join(''):emptyLine('No publications.')}</section>
      </div>
    </div>`;
}

/* --- Progetti --- */
const PRFILTERS=[['attivi','Active'],['proposte','Proposals'],['conclusi','Closed and on hold'],['tutti','All']];
function projectsFiltered(f){
  return S.d.projects.filter(p=> f==='tutti' || (f==='attivi'&&p.status==='attivo') || (f==='proposte'&&p.status==='proposta') || (f==='conclusi'&&(p.status==='concluso'||p.status==='sospeso')));
}
function viewProjects(){
  const list=projectsFiltered(S.prFilter).sort((a,b)=>(a.end||'9999').localeCompare(b.end||'9999'));
  const cards=list.map(pr=>{
    const next=S.d.deadlines.filter(d=>d.project_id===pr.id && !d.done_at).sort(sortDue)[0];
    const st=PROJECT_STATUS[pr.status];
    return `<button class="pcard" type="button" data-action="goto" data-tab="projects" data-id="${esc(pr.id)}">
      <div class="pcard-top"><div class="dh-left"><span class="avatar proj">${esc(projBadge(pr))}</span><div><h3>${esc(pr.acronym||pr.title)}${exampleTag(pr)}</h3><p class="dh-sub">${PROJECT_KIND[pr.kind]}${pr.partner?' · '+esc(pr.partner):''}</p></div></div><span class="pill dot ${st[1]}">${st[0]}</span></div>
      ${pr.acronym?`<p class="topic">${esc(pr.title)}</p>`:''}
      ${periodBar(pr.start,pr.end,'proj')}
      ${budgetBar(pr)}
      <div class="facts">
        <div><span class="k">Next deadline</span><span class="v">${next?esc(next.title)+' · '+whenHtml(next.due):'—'}</span></div>
        <div><span class="k">People</span><span class="v">${pr.members.length?`<span class="avatars">${pr.members.slice(0,6).map(m=>{ const p=person(m.person_id); return p?`<span class="avatar" title="${esc(p.name)}">${esc(initials(p.name))}</span>`:''; }).join('')}</span>`:'—'}</span></div>
      </div>
    </button>`;
  }).join('');
  return `<div class="toolbar"><div class="left"><div class="filters" role="group" aria-label="Filter">${PRFILTERS.map(([k,l])=>`<button class="chip" type="button" data-action="prfilter" data-v="${k}" aria-pressed="${S.prFilter===k}">${l} <span class="count">${projectsFiltered(k).length}</span></button>`).join('')}</div></div>
    <div class="right"><button class="btn primary" type="button" data-action="new" data-ent="projects">+ Project</button></div></div>
    ${list.length?`<div class="grid-cards">${cards}</div>`:'<div class="notice"><h2>No projects here</h2><p class="muted">Add industry and research projects with “+ Project”.</p></div>'}`;
}
function viewProject(id){
  const pr=project(id);
  if(!pr) return `<div class="back"><button class="linkbtn" type="button" data-action="tab" data-tab="projects">← Projects</button></div><div class="notice"><h2>Project not found</h2><p class="muted">It may have been deleted.</p></div>`;
  const dls=S.d.deadlines.filter(d=>d.project_id===id);
  const dOpen=dls.filter(d=>!d.done_at).sort(sortDue), dDone=dls.filter(d=>d.done_at).sort((a,b)=>b.due.localeCompare(a.due));
  const exps=S.d.expenses.filter(e=>e.project_id===id).sort((a,b)=>b.date.localeCompare(a.date));
  const sp=exps.reduce((s,e)=>s+e.amount_cents,0);
  const tOpen=S.d.tasks.filter(t=>t.project_id===id && t.status!=='done').sort(sortDue);
  const meets=S.d.meetings.filter(m=>m.project_id===id).sort((a,b)=>b.date.localeCompare(a.date));
  const contacts=S.d.contacts.filter(c=>c.project_id===id);
  const pubs=S.d.pubs.filter(x=>x.project_id===id);
  const st=PROJECT_STATUS[pr.status];
  const byCat={}; exps.forEach(e=>{ byCat[e.category]=(byCat[e.category]||0)+e.amount_cents; });
  const info=[['Title',esc(pr.title)],['Partner / funder',esc(pr.partner)],['Contract',esc(pr.contract)],['Period',pr.start||pr.end?fmt(pr.start)+' → '+fmt(pr.end):''],
    ['Folder',pr.folder?(isUrl(pr.folder)?`<a href="${esc(pr.folder)}" target="_blank" rel="noopener">${esc(pr.folder)}</a>`:`<span class="mono">${esc(pr.folder)}</span>`):''],['Notes',esc(pr.notes)]].filter(x=>x[1]);
  return `<div class="back"><button class="linkbtn" type="button" data-action="tab" data-tab="projects">← Projects</button></div>
    <div class="detail-head"><div class="dh-left"><span class="avatar lg proj">${esc(projBadge(pr))}</span><div><h2>${esc(pr.acronym||pr.title)}${exampleTag(pr)} <span class="pill dot ${st[1]}">${st[0]}</span></h2>
      <p class="dh-sub">${PROJECT_KIND[pr.kind]}${pr.partner?' · '+esc(pr.partner):''}</p></div></div>
      <div class="dh-actions"><button class="btn primary" type="button" data-action="new" data-ent="tasks" data-project="${esc(id)}">+ Task</button><button class="btn" type="button" data-action="new" data-ent="deadlines" data-project="${esc(id)}">+ Deadline</button><button class="btn" type="button" data-action="new" data-ent="meetings" data-project="${esc(id)}">+ Meeting</button><button class="btn" type="button" data-action="edit" data-ent="projects" data-id="${esc(id)}">Edit</button></div></div>
    <div class="detail">
      <div class="stack">
        ${pr.start&&pr.end?`<section class="panel">${periodBar(pr.start,pr.end,'proj')}</section>`:''}
        <section class="panel"><div class="panel-head"><h2>Deliverables and deadlines</h2><button class="btn small" type="button" data-action="new" data-ent="deadlines" data-project="${esc(id)}">+ Deadline</button></div>
          ${dls.length?`<div>${dOpen.map(d=>deadlineRow(d,{noProject:true})).join('')}${dDone.map(d=>deadlineRow(d,{noProject:true})).join('')}</div>`:emptyLine('No deadlines yet: add deliverables, reports and financial reports.')}
        </section>
        <section class="panel"><div class="panel-head"><h2>Budget</h2><button class="btn small" type="button" data-action="new" data-ent="expenses" data-project="${esc(id)}">+ Expense</button></div>
          <div class="budget-big"><div><span class="k">Budget</span><span class="money">${money(pr.budget_cents)}</span></div><div><span class="k">Spent</span><span class="money">${money(sp)}</span></div><div><span class="k">Available</span><span class="money${pr.budget_cents-sp<0?' when late':''}">${money(pr.budget_cents-sp)}</span></div></div>
          ${budgetBar(pr)}
          ${Object.keys(byCat).length>1?`<div class="row-meta">${Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span>${EXP_CAT[k]} <span class="money">${money(v)}</span></span>`).join('')}</div>`:''}
          ${exps.length?`<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${exps.map(e=>`<tr class="clickable" data-action="edit" data-ent="expenses" data-id="${esc(e.id)}" tabindex="0"><td class="mono">${fmtShort(e.date)}</td><td>${esc(e.item)}</td><td class="muted">${EXP_CAT[e.category]}</td><td class="num money">${money(e.amount_cents)}</td></tr>`).join('')}</tbody></table></div>`:emptyLine('No expenses recorded.')}
        </section>
        <section class="panel"><div class="panel-head"><h2>Tasks</h2><button class="btn small" type="button" data-action="new" data-ent="tasks" data-project="${esc(id)}">+ Task</button></div>
          ${tOpen.length?`<div>${tOpen.map(t=>taskRow(t,{noProject:true})).join('')}</div>`:emptyLine('No open tasks.')}
        </section>
        <section class="panel"><div class="panel-head"><h2>Meetings</h2><button class="btn small" type="button" data-action="new" data-ent="meetings" data-project="${esc(id)}">+ Meeting</button></div>
          ${meets.length?meets.map(m=>meetingHtml(m,{noProject:true})).join(''):emptyLine('No meetings recorded.')}
        </section>
      </div>
      <div class="stack">
        <section class="panel info"><h2>Profile</h2>${info.length?`<dl>${info.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`:''}</section>
        <section class="panel"><div class="panel-head"><h2>People</h2><button class="btn small" type="button" data-action="edit" data-ent="projects" data-id="${esc(id)}">Edit</button></div>${pr.members.length?pr.members.map(m=>`<div class="contact">${refPerson(m.person_id)}<span class="r">${esc(m.role)}</span></div>`).join(''):emptyLine('No people on this project.')}</section>
        <section class="panel"><div class="panel-head"><h2>Contacts</h2><button class="btn small" type="button" data-action="new" data-ent="contacts" data-project="${esc(id)}">+ Contact</button></div>
          ${contacts.length?contacts.map(c=>`<div class="contact"><button class="linkbtn" type="button" data-action="edit" data-ent="contacts" data-id="${esc(c.id)}">${esc(c.name)}</button>${c.role?`<span class="r">${esc(c.role)}</span>`:''}${c.email?`<a class="r" href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:''}${c.phone?`<span class="r mono">${esc(c.phone)}</span>`:''}</div>`).join(''):emptyLine('No contacts.')}
        </section>
        <section class="panel"><h2>Publications</h2>${pubs.length?pubs.map(x=>`<div class="contact"><button class="linkbtn" type="button" data-action="edit" data-ent="pubs" data-id="${esc(x.id)}">${esc(x.title)}</button><span class="r">${esc(x.venue)} · ${PUB_STATUS[x.status][0]}</span></div>`).join(''):emptyLine('No linked publications.')}</section>
      </div>
    </div>`;
}

/* --- Pubblicazioni --- */
function viewPubs(){
  const q=norm(S.pubQ);
  const list=S.d.pubs.filter(p=>(!S.pubPerson||p.person_ids.includes(S.pubPerson)) && (!q||norm([p.title,p.authors,p.venue].join(' ')).includes(q)));
  const ppl=S.d.people.slice().sort((a,b)=>a.name.localeCompare(b.name,'en'));
  const groups=Object.keys(PUB_STATUS).map(st=>{
    const g=list.filter(p=>p.status===st).sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999')||(b.year||'').localeCompare(a.year||''));
    if(!g.length) return '';
    return `<section class="panel"><div class="panel-head"><h2>${PUB_STATUS[st][0]}</h2><span class="count">${g.length}</span></div><div>${g.map(p=>`<div class="pub">
      <div class="row-main"><div><button class="row-title" type="button" data-action="edit" data-ent="pubs" data-id="${esc(p.id)}">${esc(p.title)}</button>${exampleTag(p)}</div>
        <span class="venue">${[p.venue, PUB_KIND[p.kind], p.year].filter(Boolean).map(esc).join(' · ')}</span>
        ${p.authors?`<span class="venue">${esc(p.authors)}</span>`:''}
        <div class="row-meta">${p.person_ids.map(refPerson).join('')}${refProject(p.project_id)}${isUrl(p.link)?`<a href="${esc(p.link)}" target="_blank" rel="noopener">link</a>`:''}</div></div>
      ${PUB_OPEN.includes(st)&&p.deadline?whenHtml(p.deadline,false):''}
    </div>`).join('')}</div></section>`;
  }).join('');
  return `<div class="toolbar"><div class="left"><select id="pub-person" aria-label="Filter by person"><option value="">All people</option>${ppl.map(p=>`<option value="${esc(p.id)}" ${p.id===S.pubPerson?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
    <input id="pub-q" class="search" type="search" placeholder="Search title, authors, venue…" value="${esc(S.pubQ)}"></div>
    <div class="right"><button class="btn primary" type="button" data-action="new" data-ent="pubs">+ Publication</button></div></div>
    ${groups?`<div class="pub-groups">${groups}</div>`:'<div class="notice"><h2>No publications</h2><p class="muted">Track papers from idea to publication, with deadlines and authors.</p></div>'}`;
}

/* ---------- moduli ---------- */
const opts = o => Object.entries(o).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]);
const FORMS = {
  tasks:{title:'task', nu:'New task', rows:[['title'],['due','priority'],['status'],['person_id','project_id'],['notes']],
    f:{title:['What needs doing','text'], due:['Due date','date'], priority:['Priority','select',opts(TASK_PRIO)], status:['Status','select',opts(TASK_STATUS)],
       person_id:['Person','person'], project_id:['Project','project'], notes:['Notes','textarea']}},
  people:{title:'person', nu:'New person', rows:[['name'],['kind','ciclo'],['topic'],['start','end'],['email','phone'],['matricola','funding'],['cosupervisors'],['folder'],['notes'],['archived']],
    f:{name:['Full name','text'], kind:['Role','select',opts(PERSON_KIND)], ciclo:['PhD cycle','text','e.g. XL'], topic:['Topic / thesis title','text'],
       start:['Start','date'], end:['Expected end','date'], email:['Email','email'], phone:['Phone','text'], matricola:['Student ID','text'], funding:['Funding / scholarship','text'],
       cosupervisors:['Co-supervisors','text'], folder:['Folder or link (Drive, OneDrive, path)','text'], notes:['Notes','textarea'], archived:['Archived (no longer supervised)','check']}},
  projects:{title:'project', nu:'New project', rows:[['title'],['acronym','kind'],['partner'],['status','contract'],['start','end'],['budget_cents'],['members'],['folder'],['notes']],
    f:{title:['Title','text'], acronym:['Acronym','text'], kind:['Type','select',opts(PROJECT_KIND)], partner:['Company / funder','text'], status:['Status','select',opts(PROJECT_STATUS)],
       contract:['Contract / reference','text'], start:['Start','date'], end:['End','date'], budget_cents:['Budget (€)','money'], members:['People involved','members'],
       folder:['Folder or link','text'], notes:['Notes','textarea']}},
  deadlines:{title:'deadline', nu:'New deadline', rows:[['title'],['due','kind'],['person_id','project_id'],['done'],['notes']],
    f:{title:['Title','text','e.g. Annual review, D2.1, M18 report'], due:['Date','date'], kind:['Type','select',opts(DL_KIND)], person_id:['Person','person'], project_id:['Project','project'],
       done:['Done','check'], notes:['Notes','textarea']}},
  meetings:{title:'meeting', nu:'New meeting', rows:[['date','title'],['person_id','project_id'],['notes'],['next_steps']],
    f:{date:['Date','date'], title:['Subject','text'], person_id:['Person','person'], project_id:['Project','project'], notes:['What we discussed','textarea'],
       next_steps:['Next steps (one per line)','textarea']}},
  pubs:{title:'publication', nu:'New publication', rows:[['title'],['venue','kind'],['status','deadline'],['authors'],['person_ids'],['project_id','year'],['link'],['notes']],
    f:{title:['Title','text'], venue:['Conference / journal','text'], kind:['Type','select',opts(PUB_KIND)], status:['Status','select',opts(PUB_STATUS)], deadline:['Deadline','date'],
       authors:['Authors','text','e.g. M. Rossi, A. Bianchi, et al.'], person_ids:['Group members','authors'], project_id:['Project','project'], year:['Year','text'], link:['Link (DOI, arXiv, Overleaf)','text'], notes:['Notes','textarea']}},
  contacts:{title:'contact', nu:'New contact', rows:[['name'],['role'],['email','phone'],['notes']],
    f:{name:['Name','text'], role:['Role','text','e.g. Technical lead, administration'], email:['Email','email'], phone:['Phone','text'], notes:['Notes','textarea']}},
  expenses:{title:'expense', nu:'New expense', rows:[['item'],['date','amount_cents'],['category'],['notes']],
    f:{item:['Item','text'], date:['Date','date'], amount_cents:['Amount (€)','money'], category:['Category','select',opts(EXP_CAT)], notes:['Notes','textarea']}},
};
const REQUIRED={tasks:['title'],people:['name'],projects:['title'],deadlines:['title','due'],meetings:['date'],pubs:['title'],contacts:['name'],expenses:['item','date']};

function fieldHtml(ent,key,val){
  const [label,type,extra]=FORMS[ent].f[key];
  const id='f-'+key, req=REQUIRED[ent].includes(key)?' required':'';
  if(type==='textarea') return `<label class="field"><span>${label}</span><textarea id="${id}" rows="${key==='notes'&&ent==='meetings'?6:3}">${esc(val)}</textarea></label>`;
  if(type==='select') return `<label class="field"><span>${label}</span><select id="${id}">${extra.map(([k,l])=>`<option value="${k}" ${k===val?'selected':''}>${l}</option>`).join('')}</select></label>`;
  if(type==='check') return `<label class="check-inline"><input type="checkbox" id="${id}" ${val?'checked':''}> ${label}</label>`;
  if(type==='person'){ const ppl=S.d.people.filter(p=>!p.archived||p.id===val).sort((a,b)=>a.name.localeCompare(b.name,'en'));
    return `<label class="field"><span>${label}</span><select id="${id}"><option value="">—</option>${ppl.map(p=>`<option value="${esc(p.id)}" ${p.id===val?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`; }
  if(type==='project'){ const prj=S.d.projects.filter(p=>p.status!=='concluso'||p.id===val).sort((a,b)=>projLabel(a).localeCompare(projLabel(b),'en'));
    return `<label class="field"><span>${label}</span><select id="${id}"><option value="">—</option>${prj.map(p=>`<option value="${esc(p.id)}" ${p.id===val?'selected':''}>${esc(projLabel(p))}</option>`).join('')}</select></label>`; }
  if(type==='money') return `<label class="field"><span>${label}</span><input id="${id}" type="text" inputmode="decimal" class="mono" placeholder="e.g. 12,500.00" value="${esc(moneyInput(val))}"></label>`;
  if(type==='members'){ const sel={}; (val||[]).forEach(m=>{ sel[m.person_id]=m.role; });
    const ppl=S.d.people.filter(p=>!p.archived||p.id in sel).sort((a,b)=>a.name.localeCompare(b.name,'en'));
    return `<fieldset><legend>${label}</legend>${ppl.length?`<div class="pick" id="${id}">${ppl.map(p=>`<label><input type="checkbox" value="${esc(p.id)}" ${p.id in sel?'checked':''}><span>${esc(p.name)} <span class="k">${PERSON_KIND[p.kind][1]}</span></span><input type="text" placeholder="role" aria-label="Role of ${esc(p.name)}" value="${esc(sel[p.id]||'')}"></label>`).join('')}</div>`:'<p class="hint">Add people first.</p>'}</fieldset>`; }
  if(type==='authors'){ const sel=new Set(val||[]); const ppl=S.d.people.filter(p=>!p.archived||sel.has(p.id)).sort((a,b)=>a.name.localeCompare(b.name,'en'));
    return `<fieldset><legend>${label}</legend>${ppl.length?`<div class="pick simple" id="${id}">${ppl.map(p=>`<label><input type="checkbox" value="${esc(p.id)}" ${sel.has(p.id)?'checked':''}><span>${esc(p.name)}</span></label>`).join('')}</div>`:'<p class="hint">No people yet.</p>'}</fieldset>`; }
  return `<label class="field"><span>${label}</span><input id="${id}" type="${type==='email'?'email':(type==='date'?'date':'text')}"${type==='text'&&extra?` placeholder="${esc(extra)}"`:''} value="${esc(val)}"${req}></label>`;
}
function openForm(ent,id,preset){
  const it=id?byId(ent,id):null;
  if(id && !it) return;
  const base={tasks:{status:'todo',priority:'normale'}, people:{kind:'dottorando'}, projects:{kind:'aziendale',status:'attivo',members:[]}, deadlines:{kind:'tappa'},
    meetings:{date:TODAY}, pubs:{kind:'conferenza',status:'scrittura',person_ids:[]}, contacts:{}, expenses:{date:TODAY,category:'altro'}}[ent];
  const v=Object.assign({}, base, preset||{}, it||{});
  if(ent==='deadlines') v.done=!!v.done_at;
  const F=FORMS[ent];
  const rows=F.rows.map(r=>{ const cells=r.map(k=>fieldHtml(ent,k,v[k])); return cells.length>1?`<div class="row2">${cells.join('')}</div>`:cells[0]; }).join('');
  const ctx = (ent==='contacts'||ent==='expenses') && v.project_id ? `<p class="hint">Project: <b>${esc(projLabel(project(v.project_id)))}</b></p>` : '';
  const extra = ent==='meetings' && it ? `<p class="hint">Each “next step” can become a task with one click, from the person’s or project’s page.</p>` : '';
  const html=`<div class="dr-head"><div><p class="eyebrow">${it?'Edit '+F.title:'Compass'}</p><h2 id="dr-title">${it?esc(it.title||it.name||it.item||('Meeting on '+fmt(it.date))):F.nu}</h2></div><button class="btn ghost" type="button" data-action="close">Close</button></div>
    <form class="dr-body" id="item-form" data-ent="${ent}" data-id="${esc(id||'')}" data-project="${esc(v.project_id||'')}" novalidate>${ctx}${rows}${extra}<p class="form-err" id="form-err" hidden></p>
      ${it&&it.updated_at?`<p class="stamp">Last changed: ${fmtDateTime(it.updated_at)}</p>`:''}</form>
    <div class="dr-foot"><div class="right">${it?`<button class="btn danger" type="button" data-action="delete" data-ent="${ent}" data-id="${esc(id)}">Delete</button>`:''}</div>
      <div class="right"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn primary" type="submit" form="item-form" id="save-btn">${it?'Save':'Add'}</button></div></div>`;
  openDrawer(html,{type:'form',ent,id:id||null});
}
function readForm(ent){
  const out={};
  FORMS[ent].rows.flat().forEach(k=>{
    const type=FORMS[ent].f[k][1], el=document.getElementById('f-'+k);
    if(type==='check') out[k]=!!(el&&el.checked);
    else if(type==='members') out[k]=el?[...el.querySelectorAll('label')].filter(l=>l.querySelector('input[type=checkbox]').checked).map(l=>({person_id:l.querySelector('input[type=checkbox]').value, role:l.querySelector('input[type=text]').value.trim()})):[];
    else if(type==='authors') out[k]=el?[...el.querySelectorAll('input:checked')].map(i=>i.value):[];
    else out[k]=el?el.value.trim():'';
  });
  return out;
}
async function saveForm(){
  const f=$('#item-form'); const ent=f.dataset.ent, id=f.dataset.id||null;
  const data=readForm(ent);
  if(f.dataset.project && (ent==='contacts'||ent==='expenses')) data.project_id=f.dataset.project;
  const miss=REQUIRED[ent].find(k=>!data[k]);
  if(miss) return formError(FORMS[ent].f[miss][0]+': required.');
  const btn=$('#save-btn'); btn.disabled=true;
  const r=await mutate(id?'PATCH':'POST','api/'+ent+(id?'/'+encodeURIComponent(id):''),data, id?'Saved':'Added');
  btn.disabled=false;
  if(!r.ok) return formError(r.error);
  closeDrawer();
  if(!id && (ent==='people'||ent==='projects') && r.data && r.data.id) go(ent==='people'?'people':'projects', r.data.id);
}
function formError(m){ const e=$('#form-err'); if(e){ e.textContent=m; e.hidden=!m; } }

/* ---------- impostazioni ---------- */
function openSettings(){
  const html=`<div class="dr-head"><div><p class="eyebrow">${esc(S.me.displayName)} · ${esc(S.me.username)}</p><h2 id="dr-title">Settings</h2></div><button class="btn ghost" type="button" data-action="close">Close</button></div>
    <div class="dr-body settings-list">
      <section><h3>Calendar</h3><p class="hint">Download open deadlines, tasks and paper deadlines as an .ics file to import into Outlook, Google Calendar or Apple Calendar. It is a snapshot: download it again to update.</p><div><a class="btn" href="api/calendar.ics" download>Download calendar (.ics)</a></div></section>
      <section><h3>Export and import</h3><p class="hint">A single .compass file with all the data: people, projects, deadlines, meetings, publications and tasks. Your username and password are not in it. Use it to move Compass to another PC, keep a copy or share the data with someone who uses Compass.</p>
        <div class="top-actions"><button class="btn primary" type="button" data-action="archive-export">Export everything</button><button class="btn" type="button" data-action="archive-pick">Import…</button></div>
        <div id="archive-confirm"></div></section>
      <section><h3>Sample data</h3>${S.d.examples?'<div><button class="btn" type="button" data-action="clear-examples">Remove sample data</button></div>':'<p class="hint">Try the features without touching your data: everything loaded is marked “sample” and can be removed with one click.</p><div><button class="btn" type="button" data-action="load-examples">Load sample data</button></div>'}</section>
      <section><h3>Change password</h3>
        <form id="pass-form" class="form-grid" novalidate>
          <label class="field"><span>Current password</span><input id="pw-cur" type="password" autocomplete="current-password"></label>
          <div class="row2"><label class="field"><span>New password</span><input id="pw-new" type="password" autocomplete="new-password" placeholder="at least 10 characters"></label>
          <label class="field"><span>Repeat</span><input id="pw-new2" type="password" autocomplete="new-password"></label></div>
          <p class="form-err" id="form-err" hidden></p><div><button class="btn" type="submit">Change password</button></div>
        </form></section>
    </div>`;
  openDrawer(html,{type:'settings'});
}
async function changePassword(){
  const cur=$('#pw-cur').value, n1=$('#pw-new').value, n2=$('#pw-new2').value;
  if(n1.length<MIN_PASSWORD) return formError('The new password must be at least '+MIN_PASSWORD+' characters long.');
  if(n1!==n2) return formError('The two passwords do not match.');
  try{ await api('POST','api/me/password',{current:cur,new:n1}); toast('Password changed.'); closeDrawer(); }
  catch(e){ formError(e.message); }
}
async function downloadBlob(url, fallback){
  const res=await fetch(url,{credentials:'same-origin'});
  if(!res.ok){ let m='Download failed ('+res.status+').'; try{ m=(await res.json()).error||m; }catch(e){} throw new Error(m); }
  const m=/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition')||'');
  const a=document.createElement('a'); a.href=URL.createObjectURL(await res.blob()); a.download=m?m[1]:fallback;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
  return a.download;
}
async function uploadArchive(url,file){
  if(file.size>64e6) throw new Error('This file is too large to be a Compass backup.');
  let res;
  try{ res=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'X-Compass':'1','Content-Type':'application/octet-stream'},body:file}); }
  catch(e){ throw new Error('Compass is not responding: check that it is running and try again.'); }
  let j=null; try{ j=await res.json(); }catch(e){}
  if(!res.ok) throw new Error((j&&j.error)||('Import failed ('+res.status+').'));
  return j.imported;
}
const importedMsg = i => `Imported: ${i.people} people, ${i.projects} projects, ${i.tasks} tasks.`;

/* ---------- pannello laterale ---------- */
function openDrawer(html,state){
  S.drawer=state;
  const dr=$('#drawer'); dr.innerHTML=html; dr.classList.add('open'); $('#scrim').hidden=false;
  const f=dr.querySelector('.dr-body input:not([type=checkbox]):not([type=hidden]),.dr-body select,.dr-body textarea'); if(f) setTimeout(()=>f.focus(),60);
}
function closeDrawer(){ S.drawer=null; S.archiveFile=null; $('#drawer').classList.remove('open'); $('#scrim').hidden=true; }
function refreshDrawer(){ /* i moduli restano come sono: si aggiornano solo alla riapertura */ }

/* ---------- bacheca: trascinamento ---------- */
let dragId=null;
function dropIndex(col,y){
  const cards=[...col.querySelectorAll('.card:not(.dragging)')];
  for(let i=0;i<cards.length;i++){ const r=cards[i].getBoundingClientRect(); if(y<r.top+r.height/2) return i; }
  return cards.length;
}
function clearDrop(){ document.querySelectorAll('.drop-line').forEach(x=>x.remove()); document.querySelectorAll('.col.over').forEach(c=>c.classList.remove('over')); }
document.addEventListener('dragstart',e=>{ const c=e.target.closest&&e.target.closest('.card'); if(!c) return; dragId=c.dataset.card; c.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain',dragId); }catch(err){} });
document.addEventListener('dragend',()=>{ document.querySelectorAll('.card.dragging').forEach(c=>c.classList.remove('dragging')); clearDrop(); dragId=null; });
document.addEventListener('dragover',e=>{
  const col=e.target.closest&&e.target.closest('.col'); if(!col||!dragId) return;
  e.preventDefault(); clearDrop(); col.classList.add('over');
  const i=dropIndex(col,e.clientY), cards=[...col.querySelectorAll('.card:not(.dragging)')];
  const line=document.createElement('div'); line.className='drop-line';
  if(i<cards.length) col.insertBefore(line,cards[i]); else { const after=cards[cards.length-1]; if(after) after.after(line); else col.querySelector('.col-head').after(line); }
});
document.addEventListener('drop',async e=>{
  const col=e.target.closest&&e.target.closest('.col'); if(!col||!dragId) return;
  e.preventDefault();
  const id=dragId, status=col.dataset.col, i=dropIndex(col,e.clientY);
  clearDrop();
  await moveTask(id,status,i);
});
async function moveTask(id,status,index){
  const others=S.d.tasks.filter(t=>t.status===status && t.id!==id).sort((a,b)=>a.position-b.position);
  if(index==null) index=others.length;
  const prev=others[index-1], next=others[index];
  const position = prev&&next ? (prev.position+next.position)/2 : prev ? prev.position+1 : next ? next.position-1 : 1;
  await mutate('PATCH','api/tasks/'+encodeURIComponent(id),{status,position}, status==='done'?'Task done':'');
}

/* ---------- eventi ---------- */
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]'); if(!el) return;
  const a=el.dataset.action, id=el.dataset.id;
  if(el.tagName==='A') return;
  switch(a){
    case 'tab': closeDrawer(); go(el.dataset.tab); break;
    case 'goto': closeDrawer(); go(el.dataset.tab, id); break;
    case 'close': closeDrawer(); break;
    case 'new': { const preset={}; if(el.dataset.person) preset.person_id=el.dataset.person; if(el.dataset.project) preset.project_id=el.dataset.project; if(el.dataset.due) preset.due=el.dataset.due;
      if(!el.dataset.person && !el.dataset.project && S.detail){ if(S.detail.type==='people' && ['tasks','deadlines','meetings'].includes(el.dataset.ent)) preset.person_id=S.detail.id; if(S.detail.type==='projects' && ['tasks','deadlines','meetings','pubs'].includes(el.dataset.ent)) preset.project_id=S.detail.id; }
      if(el.dataset.ent==='tasks' && !preset.person_id && S.tab==='tasks' && S.taskPerson) preset.person_id=S.taskPerson;
      openForm(el.dataset.ent,null,preset); break; }
    case 'edit': openForm(el.dataset.ent,id); break;
    case 'delete': {
      if(!armed(el,'Confirm: delete')) break;
      const ent=el.dataset.ent; el.disabled=true;
      const r=await mutate('DELETE','api/'+ent+'/'+encodeURIComponent(id),{},'Deleted');
      if(r.ok){ closeDrawer(); if((ent==='people'&&S.detail&&S.detail.id===id)) go('people'); if(ent==='projects'&&S.detail&&S.detail.id===id) go('projects'); }
      else { el.disabled=false; formError(r.error); }
      break; }
    case 'task-view': S.taskView=el.dataset.v; try{ localStorage.setItem('compass.taskView',S.taskView); }catch(err){} renderView(); break;
    case 'move-task': { const t=byId('tasks',id); if(!t) break; const order=['todo','doing','done']; const st=order[order.indexOf(t.status)+Number(el.dataset.dir)]; if(st) await moveTask(id,st,null); break; }
    case 'pfilter': S.pFilter=el.dataset.v; renderView(); break;
    case 'prfilter': S.prFilter=el.dataset.v; renderView(); break;
    case 'cal-view': S.calView=el.dataset.v; if(S.calView==='settimana' && !S.calWeek) S.calWeek=mondayOf(S.calMonth===TODAY.slice(0,7)?TODAY:S.calMonth+'-01'); try{ localStorage.setItem('compass.calView',S.calView); }catch(err){} renderView(); break;
    case 'calw': { const d=Number(el.dataset.d); S.calWeek = d===0 ? mondayOf(TODAY) : addDays(S.calWeek,d); S.calMonth=addDays(S.calWeek,3).slice(0,7); renderView(); break; }
    case 'cal-week': S.calWeek=mondayOf(el.dataset.day); S.calView='settimana'; try{ localStorage.setItem('compass.calView',S.calView); }catch(err){} renderView(); break;
    case 'cal': { const d=Number(el.dataset.d); if(d===0) S.calMonth=TODAY.slice(0,7); else { const [y,m]=S.calMonth.split('-').map(Number); const nd=new Date(Date.UTC(y,m-1+d,1)); S.calMonth=nd.toISOString().slice(0,7); } S.calWeek = S.calMonth===TODAY.slice(0,7) ? mondayOf(TODAY) : mondayOf(S.calMonth+'-01'); renderView(); break; }
    case 'step-task': {
      const m=byId('meetings',id); if(!m) break;
      const step=(m.next_steps||'').split('\n').map(s=>s.trim()).filter(Boolean)[Number(el.dataset.i)]; if(!step) break;
      el.disabled=true;
      const r=await mutate('POST','api/tasks',{title:step, person_id:m.person_id||'', project_id:m.project_id||''},'Task created: '+step);
      if(!r.ok){ el.disabled=false; toast(r.error); }
      break; }
    case 'settings': openSettings(); break;
    case 'logout': try{ await api('POST','api/logout',{}); }catch(err){} location.hash=''; location.reload(); break;
    case 'load-examples': el.disabled=true; { const r=await mutate('POST','api/examples',{},'Sample data loaded'); if(!r.ok){ el.disabled=false; toast(r.error); } else if(S.drawer&&S.drawer.type==='settings') closeDrawer(); } break;
    case 'clear-examples': if(armed(el,'Confirm: remove samples')){ el.disabled=true; await mutate('DELETE','api/examples',{},'Sample data removed'); if(S.drawer&&S.drawer.type==='settings') closeDrawer(); if(S.detail&&!byId(S.detail.type,S.detail.id)) go(S.detail.type); } break;
    case 'archive-export': { const old=el.textContent; el.disabled=true; el.textContent='Preparing the file…'; try{ toast('Exported: '+await downloadBlob('api/archive','Compass-backup.compass')); }catch(err){ toast(err.message); } el.disabled=false; el.textContent=old; break; }
    case 'archive-pick': $('#archive-file').click(); break;
    case 'archive-cancel': S.archiveFile=null; $('#archive-confirm').innerHTML=''; break;
    case 'archive-import': {
      if(!S.archiveFile) break; el.disabled=true; el.textContent='Importing…';
      try{ const info=await uploadArchive('api/archive',S.archiveFile); closeDrawer(); const j=await api('GET','api/state'); applyState(j.state); go('today'); toast(importedMsg(info)+(info.backup?' Your previous data was saved as '+info.backup.split(/[\\/]/).pop()+'.':'')); }
      catch(err){ el.disabled=false; el.textContent='Yes, import'; toast(err.message); }
      break; }
    case 'setup-import': if(setupFields()) $('#setup-archive').click(); break;
  }
});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.dataset && t.dataset.action==='toggle-task'){
    t.disabled=true;
    const r=await mutate('PATCH','api/tasks/'+encodeURIComponent(t.dataset.id),{status:t.checked?'done':'todo'}, t.checked?'Task done':'Task reopened');
    if(!r.ok){ t.checked=!t.checked; t.disabled=false; toast(r.error); }
    return;
  }
  if(t.dataset && t.dataset.action==='toggle-dl'){
    t.disabled=true;
    const r=await mutate('PATCH','api/deadlines/'+encodeURIComponent(t.dataset.id),{done:t.checked}, t.checked?'Marked as done':'Reopened');
    if(!r.ok){ t.checked=!t.checked; t.disabled=false; toast(r.error); }
    return;
  }
  if(t.id==='task-person'){ S.taskPerson=t.value; renderView(); }
  else if(t.id==='task-project'){ S.taskProject=t.value; renderView(); }
  else if(t.id==='show-done'){ S.showDone=t.checked; renderView(); }
  else if(t.id==='pub-person'){ S.pubPerson=t.value; renderView(); }
  else if(t.id==='archive-file'){
    const f=t.files[0]; t.value=''; if(!f) return;
    S.archiveFile=f; const box=$('#archive-confirm'); if(!box) return;
    box.innerHTML=`<div class="panel"><p><b>Replace all Compass data with the contents of ${esc(f.name)}?</b><br><span class="hint">Your current data is saved to a backup first. Your username and password stay the same.</span></p>
      <div class="top-actions"><button class="btn" type="button" data-action="archive-cancel">Cancel</button><button class="btn danger" type="button" data-action="archive-import">Yes, import</button></div></div>`;
  }
  else if(t.id==='setup-archive'){
    const f=t.files[0]; t.value=''; if(!f) return;
    const v=setupFields(); if(!v) return;
    const err=$('#setup-err'); err.hidden=true; const b=$('#setup-import-btn'); b.disabled=true; b.textContent='Importing '+f.name+'…';
    let created=false;
    try{
      const j=await api('POST','api/setup',v); S.me=j.me; created=true;
      const info=await uploadArchive('api/archive',f);
      await startApp(); toast(importedMsg(info));
    }catch(x){
      if(created){ await startApp(); toast('Your user was created, but the import failed: '+x.message+' Try again from Settings.'); }
      else { err.textContent=x.message; err.hidden=false; }
    }
    b.disabled=false; b.textContent='Import a .compass file';
  }
});
let searchT;
document.addEventListener('input',e=>{
  const t=e.target, map={'task-q':'taskQ','people-q':'pQ','pub-q':'pubQ'};
  if(!map[t.id]) return;
  S[map[t.id]]=t.value; clearTimeout(searchT); searchT=setTimeout(renderView,150);
});
document.addEventListener('submit',e=>{
  e.preventDefault();
  const id=e.target.id;
  if(id==='login-form') login();
  else if(id==='setup-form') setup();
  else if(id==='item-form') saveForm();
  else if(id==='pass-form') changePassword();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && S.drawer){ closeDrawer(); return; }
  if(e.key==='Enter' && e.target.matches && e.target.matches('tr.clickable')){ e.target.click(); }
  // shortcut: "n" opens a new task, outside text fields
  if(e.key==='n' && !S.drawer && S.me && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); openForm('tasks',null,{}); }
});

boot();
})();
