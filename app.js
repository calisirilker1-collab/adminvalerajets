(() => {
  'use strict';

  const cfg = window.VALERA_ADMIN_CONFIG || {};
  const $ = id => document.getElementById(id);
  const loginView = $('loginView');
  const appView = $('appView');
  const loginForm = $('loginForm');
  const loginButton = $('loginButton');
  const loginError = $('loginError');
  const requestsBody = $('requestsBody');
  const loadingState = $('loadingState');
  const emptyState = $('emptyState');
  const tableWrap = $('tableWrap');
  const searchInput = $('searchInput');
  const statusSelect = $('statusSelect');
  const toast = $('toast');
  const workspace = $('dealWorkspace');
  const workspaceBackdrop = $('workspaceBackdrop');

  if (!cfg.supabaseUrl || !cfg.publishableKey || !window.supabase) {
    alert('Admin panel Supabase bağlantısı yapılandırılmamış.');
    return;
  }

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let rows = [];
  let activeFilter = 'all';
  let activeDeal = null;
  let activeUser = null;
  let dealRfqs = [];
  let dealOperatorQuotes = [];
  let dealClientQuotes = [];
  let dealTimeline = [];
  let operatorDirectory = [];
  let mainView = 'deals';

  const STATUS = {
    new: ['Yeni', 'status-new'],
    qualified: ['Qualified', 'status-qualified'],
    sourcing: ['Sourcing', 'status-sourcing'],
    quote_ready: ['Quote Ready', 'status-quote-ready'],
    quoted: ['Quote Sent', 'status-quoted'],
    client_confirmed: ['Client Confirmed', 'status-client-confirmed'],
    payment_pending: ['Payment Pending', 'status-payment-pending'],
    booked: ['Booked', 'status-booked'],
    flown: ['Flown', 'status-flown'],
    won: ['Won', 'status-won'],
    lost: ['Lost', 'status-lost']
  };
  const LOST_REASONS = ['Price','No response','Changed travel plan','Commercial airline','Competitor','Aircraft unavailable','Date changed','Lead not qualified','Other'];
  const CURRENCIES = ['EUR','USD','GBP','TRY'];

  const esc = (x='') => String(x).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const val = (row, ...keys) => { for (const k of keys) if (row?.[k] !== undefined && row?.[k] !== null && row?.[k] !== '') return row[k]; return ''; };
  const origin = r => val(r,'origin','from_location','from_city','from');
  const destination = r => val(r,'destination','to_location','to_city','to');
  const fullName = r => val(r,'full_name','name');
  const departure = r => val(r,'departure_date','departure');
  const returnDate = r => val(r,'return_date','returnDate');
  const tripType = r => val(r,'trip_type','tripType');
  const jetType = r => val(r,'jet_type','jetType');
  const normalizeStatus = s => STATUS[s] ? s : 'new';
  const leadNo = r => r?.lead_number ? `VJ-${String(r.lead_number).padStart(4,'0')}` : `VJ-${String(r?.id || '').split('-')[0].toUpperCase()}`;
  const money = (n,c='EUR') => n === null || n === undefined || n === '' ? '—' : new Intl.NumberFormat('tr-TR',{style:'currency',currency:c,maximumFractionDigits:0}).format(Number(n));
  const fmtDate = date => { if(!date) return '—'; const d=new Date(String(date).length===10?`${date}T12:00:00`:date); return Number.isNaN(d.getTime())?esc(date):new Intl.DateTimeFormat('tr-TR',{day:'2-digit',month:'short',year:'numeric'}).format(d); };
  const fmtDateTime = date => { if(!date) return '—'; const d=new Date(date); return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('tr-TR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d); };
  const localInputValue = date => { if(!date) return ''; const d=new Date(date); if(Number.isNaN(d.getTime())) return ''; const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  function notify(message){ toast.textContent=message; toast.classList.add('show'); clearTimeout(notify.timer); notify.timer=setTimeout(()=>toast.classList.remove('show'),2400); }
  function statusOptions(selected){ return Object.entries(STATUS).map(([k,m])=>`<option value="${k}" ${k===selected?'selected':''}>${m[0]}</option>`).join(''); }
  function currencyOptions(selected='EUR'){ return CURRENCIES.map(c=>`<option ${c===selected?'selected':''}>${c}</option>`).join(''); }

  async function isAdmin(){ const {data,error}=await db.rpc('is_valera_admin'); if(error){console.error(error);return false;} return data===true; }

  async function showDashboard(session){
    const ok=await isAdmin();
    if(!ok){ await db.auth.signOut(); loginView.hidden=false; appView.hidden=true; loginError.hidden=false; loginError.textContent='Bu kullanıcı yönetici olarak yetkilendirilmemiş.'; return; }
    activeUser=session.user;
    loginView.hidden=true; appView.hidden=false;
    $('userEmail').textContent=session.user?.email||'Yönetici';
    $('userAvatar').textContent=(session.user?.email?.[0]||'V').toUpperCase();
    await Promise.all([loadRequests(), loadOperatorDirectory()]);
  }

  async function loadOperatorDirectory(){
    const {data,error}=await db.from('operator_directory').select('*').eq('is_active',true).order('preferred',{ascending:false}).order('name',{ascending:true});
    if(error){ console.error('operator_directory',error); operatorDirectory=[]; const s=$('operatorDirectoryState'); if(s){s.hidden=false;s.textContent='Operatör listesi yüklenemedi. Önce upgrade-operators.sql dosyasını Supabase SQL Editor’da çalıştırın.';} return; }
    operatorDirectory=data||[];
    if($('navOperatorCount')) $('navOperatorCount').textContent=operatorDirectory.length;
    renderOperatorDirectory();
  }

  function operatorLabel(o){return `${o.preferred?'★ ':''}${o.name}${o.aoc_no?` · ${o.aoc_no}`:''}${o.email?` · ${o.email}`:' · e-posta yok'}`;}
  function operatorOptions(selected=''){
    return '<option value="">— Kayıtlı operatörden seç —</option>'+operatorDirectory.map(o=>`<option value="${esc(o.id)}" ${o.id===selected?'selected':''}>${esc(operatorLabel(o))}</option>`).join('');
  }
  function filteredOperators(){
    const q=String($('operatorSearch')?.value||'').trim().toLocaleLowerCase('tr-TR');
    const filter=$('operatorFilter')?.value||'all';
    return operatorDirectory.filter(o=>{
      if(filter==='email'&&!o.email)return false;
      if(filter==='preferred'&&!o.preferred)return false;
      if(!q)return true;
      return [o.name,o.aoc_no,o.email,o.phone,o.notes].join(' ').toLocaleLowerCase('tr-TR').includes(q);
    });
  }
  function renderOperatorDirectory(){
    if(!$('operatorDirectoryBody'))return;
    const list=filteredOperators();
    $('operatorTotalCount').textContent=operatorDirectory.length;
    $('operatorEmailCount').textContent=operatorDirectory.filter(o=>o.email).length;
    $('operatorVerifiedCount').textContent=operatorDirectory.filter(o=>o.email&&o.email_verified).length;
    $('operatorDirectoryBody').innerHTML=list.length?list.map(o=>`<tr>
      <td><button class="star-button toggle-preferred ${o.preferred?'on':''}" data-id="${esc(o.id)}" title="Favori">${o.preferred?'★':'☆'}</button></td>
      <td class="customer-cell"><strong>${esc(o.name)}</strong><span>${o.website?`<a href="${esc(o.website)}" target="_blank" rel="noopener">Website ↗</a>`:'—'}</span></td>
      <td><span class="request-id">${esc(o.aoc_no||'—')}</span></td>
      <td>${o.email?`<a class="operator-email" href="mailto:${esc(o.email)}">${esc(o.email)}</a><br><span class="contact-badge ${o.email_verified?'verified':'thirdparty'}">${o.email_verified?'Kamuya açık / teyitli':'Teyit önerilir'}</span>`:'<span class="missing-contact">E-posta yok</span>'}</td>
      <td>${esc(o.phone||'—')}</td>
      <td>${o.source_url?`<a href="${esc(o.source_url)}" target="_blank" rel="noopener">Kaynak ↗</a>`:'—'}</td>
      <td>${esc(fmtDateTime(o.last_contacted_at))}</td>
      <td><button class="mini-button edit-operator" data-id="${esc(o.id)}">Düzenle</button></td>
    </tr>`).join(''):'<tr><td colspan="8"><div class="empty-inline">Bu filtreye uygun operatör yok.</div></td></tr>';
    $('operatorDirectoryBody').querySelectorAll('.edit-operator').forEach(b=>b.addEventListener('click',()=>openOperatorForm(b.dataset.id)));
    $('operatorDirectoryBody').querySelectorAll('.toggle-preferred').forEach(b=>b.addEventListener('click',()=>togglePreferredOperator(b.dataset.id)));
  }
  function showDealList(){
    mainView='deals'; $('statsGrid').hidden=false; $('dealsPanel').hidden=false; $('operatorDirectoryView').hidden=true;
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    const current=document.querySelector(`.nav-item[data-filter="${activeFilter}"]`)||document.querySelector('.nav-item[data-filter="all"]'); if(current)current.classList.add('active');
  }
  function showOperatorDirectory(){
    mainView='operators'; $('statsGrid').hidden=true; $('dealsPanel').hidden=true; $('operatorDirectoryView').hidden=false;
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active')); $('operatorDirectoryNav').classList.add('active'); renderOperatorDirectory();
  }
  function openOperatorForm(id=''){
    const o=operatorDirectory.find(x=>x.id===id)||{}; const form=$('operatorForm'); $('operatorFormWrap').hidden=false;
    form.elements.id.value=o.id||''; form.elements.name.value=o.name||''; form.elements.aoc_no.value=o.aoc_no||''; form.elements.email.value=o.email||''; form.elements.phone.value=o.phone||''; form.elements.website.value=o.website||''; form.elements.source_url.value=o.source_url||''; form.elements.email_verified.checked=!!o.email_verified; form.elements.preferred.checked=!!o.preferred; form.elements.notes.value=o.notes||'';
    $('operatorFormWrap').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function closeOperatorForm(){ $('operatorFormWrap').hidden=true; $('operatorForm').reset(); $('operatorForm').elements.id.value=''; }
  async function saveOperator(e){
    e.preventDefault(); const fd=new FormData(e.currentTarget),id=String(fd.get('id')||'');
    const payload={name:String(fd.get('name')||'').trim(),aoc_no:String(fd.get('aoc_no')||'').trim()||null,email:String(fd.get('email')||'').trim().toLowerCase()||null,phone:String(fd.get('phone')||'').trim()||null,website:String(fd.get('website')||'').trim()||null,source_url:String(fd.get('source_url')||'').trim()||null,email_verified:fd.get('email_verified')==='on',preferred:fd.get('preferred')==='on',notes:String(fd.get('notes')||'').trim()||null,last_verified_at:fd.get('email_verified')==='on'?new Date().toISOString().slice(0,10):null};
    const res=id?await db.from('operator_directory').update(payload).eq('id',id):await db.from('operator_directory').insert(payload);
    if(res.error){notify(`Operatör kaydedilemedi: ${res.error.message}`);return;} closeOperatorForm(); await loadOperatorDirectory(); notify(id?'Operatör güncellendi.':'Operatör eklendi.');
  }
  async function togglePreferredOperator(id){const o=operatorDirectory.find(x=>x.id===id);if(!o)return;const {error}=await db.from('operator_directory').update({preferred:!o.preferred}).eq('id',id);if(error){notify(error.message);return;}await loadOperatorDirectory();}

  async function loadRequests(){
    loadingState.hidden=false; emptyState.hidden=true; tableWrap.hidden=true;
    const {data,error}=await db.from('flight_requests').select('*').order('created_at',{ascending:false}).limit(2000);
    loadingState.hidden=true;
    if(error){ console.error(error); emptyState.hidden=false; emptyState.textContent=`Talepler yüklenemedi: ${error.message}`; return; }
    rows=data||[]; renderStats(); renderRows();
  }

  function renderStats(){
    const now=Date.now(); const todayEnd=new Date(); todayEnd.setHours(23,59,59,999);
    const active=rows.filter(r=>!['lost','flown','won'].includes(normalizeStatus(r.status))).length;
    const due=rows.filter(r=>r.follow_up_at && new Date(r.follow_up_at).getTime()<=todayEnd.getTime() && !['lost','flown','won'].includes(normalizeStatus(r.status))).length;
    $('statTotal').textContent=rows.length;
    $('statNew').textContent=rows.filter(r=>normalizeStatus(r.status)==='new').length;
    $('statActive').textContent=active;
    $('statFollowup').textContent=due;
    $('navAllCount').textContent=rows.length;
    $('navNewCount').textContent=rows.filter(r=>normalizeStatus(r.status)==='new').length;
  }

  function filteredRows(){
    const q=searchInput.value.trim().toLocaleLowerCase('tr-TR'); const select=statusSelect.value;
    return rows.filter(r=>{
      const s=normalizeStatus(r.status);
      const statusOk=activeFilter==='all' ? (select==='all'||s===select) : s===activeFilter;
      if(!statusOk) return false;
      if(!q) return true;
      const hay=[leadNo(r),fullName(r),r.email,r.phone,origin(r),destination(r),jetType(r),r.lead_source,r.referral_partner].join(' ').toLocaleLowerCase('tr-TR');
      return hay.includes(q);
    });
  }

  function followupLabel(r){
    if(!r.follow_up_at) return '<span>—</span>';
    const t=new Date(r.follow_up_at).getTime(); const now=Date.now(); const cls=t<now?'follow-overdue':(new Date(r.follow_up_at).toDateString()===new Date().toDateString()?'follow-today':'');
    return `<span class="${cls}">${esc(fmtDateTime(r.follow_up_at))}</span>`;
  }

  function renderRows(){
    const list=filteredRows(); requestsBody.innerHTML='';
    if(!list.length){tableWrap.hidden=true;emptyState.hidden=false;return;}
    emptyState.hidden=true;tableWrap.hidden=false;
    requestsBody.innerHTML=list.map(r=>{ const s=normalizeStatus(r.status),m=STATUS[s]; return `<tr>
      <td><span class="request-id">#${esc(leadNo(r))}</span><br><small>${esc(fmtDateTime(r.created_at))}</small></td>
      <td class="customer-cell"><strong>${esc(fullName(r)||'İsimsiz')}</strong><span>${esc(r.phone||r.email||'—')}</span></td>
      <td class="route-cell"><strong>${esc(origin(r)||'—')} <span class="route-arrow">→</span> ${esc(destination(r)||'—')}</strong><span>${esc(tripType(r)||'—')} · ${esc(r.passengers??'—')} pax</span></td>
      <td>${esc(fmtDate(departure(r)))}</td>
      <td>${followupLabel(r)}</td>
      <td><span class="status-pill ${m[1]}">${m[0]}</span></td>
      <td><button class="detail-button" data-id="${esc(r.id)}">Deal'i Aç →</button></td>
    </tr>`; }).join('');
  }

  async function addTimeline(requestId,eventType,title,detail=''){
    const payload={request_id:requestId,event_type:eventType,title,detail:detail||null,actor_user_id:activeUser?.id||null};
    const {error}=await db.from('deal_timeline').insert(payload); if(error) console.error('timeline',error);
  }

  async function openDeal(id){
    activeDeal=rows.find(r=>String(r.id)===String(id)); if(!activeDeal) return;
    workspaceBackdrop.hidden=false; requestAnimationFrame(()=>workspace.classList.add('open')); workspace.setAttribute('aria-hidden','false');
    $('dealLeadNo').textContent=leadNo(activeDeal); $('dealTitle').textContent=`${origin(activeDeal)||'—'} → ${destination(activeDeal)||'—'}`;
    $('dealSubline').textContent=`${fullName(activeDeal)||'İsimsiz'} · ${fmtDate(departure(activeDeal))} · ${activeDeal.passengers||'—'} pax`;
    $('dealStatus').innerHTML=statusOptions(normalizeStatus(activeDeal.status));
    $('dealCall').href=activeDeal.phone?`tel:${encodeURIComponent(activeDeal.phone)}`:'#';
    $('dealMail').href=activeDeal.email?`mailto:${encodeURIComponent(activeDeal.email)}`:'#';
    setActiveTab('overview');
    await loadDealRelations();
    renderAllDealPanels();
  }

  async function loadDealRelations(){
    const id=activeDeal.id;
    const [rfq,oq,cq,tl]=await Promise.all([
      db.from('rfq_requests').select('*').eq('request_id',id).order('created_at',{ascending:false}),
      db.from('operator_quotes').select('*').eq('request_id',id).order('created_at',{ascending:false}),
      db.from('client_quotes').select('*').eq('request_id',id).order('created_at',{ascending:false}),
      db.from('deal_timeline').select('*').eq('request_id',id).order('created_at',{ascending:false})
    ]);
    for(const result of [rfq,oq,cq,tl]) if(result.error) console.error(result.error);
    dealRfqs=rfq.data||[]; dealOperatorQuotes=oq.data||[]; dealClientQuotes=cq.data||[]; dealTimeline=tl.data||[];
    $('rfqCount').textContent=dealRfqs.length; $('operatorCount').textContent=dealOperatorQuotes.length; $('clientQuoteCount').textContent=dealClientQuotes.length; $('timelineCount').textContent=dealTimeline.length;
  }

  function renderAllDealPanels(){ renderOverview(); renderRfqs(); renderOperators(); renderClientQuotes(); renderFinance(); renderFollowup(); renderTimeline(); }

  function renderOverview(){
    const r=activeDeal; const lost=normalizeStatus(r.status)==='lost';
    $('overviewPanel').innerHTML=`<div class="crm-grid">
      <article class="crm-card"><div class="card-head"><h3>Müşteri</h3><small>Lead contact</small></div><div class="info-grid">
        <div class="info-item"><span>Ad Soyad</span><strong>${esc(fullName(r)||'—')}</strong></div><div class="info-item"><span>Telefon</span><strong>${esc(r.phone||'—')}</strong></div>
        <div class="info-item"><span>E-posta</span><strong>${esc(r.email||'—')}</strong></div><div class="info-item"><span>Lead Source</span><strong>${esc(r.lead_source||r.source||'—')}</strong></div>
      </div></article>
      <article class="crm-card"><div class="card-head"><h3>Uçuş</h3><small>${esc(tripType(r)||'—')}</small></div><div class="info-grid">
        <div class="info-item"><span>Rota</span><strong>${esc(origin(r)||'—')} → ${esc(destination(r)||'—')}</strong></div><div class="info-item"><span>Tarih</span><strong>${esc(fmtDate(departure(r)))}</strong></div>
        <div class="info-item"><span>Dönüş</span><strong>${esc(fmtDate(returnDate(r)))}</strong></div><div class="info-item"><span>Yolcu / Jet</span><strong>${esc(r.passengers??'—')} · ${esc(jetType(r)||'—')}</strong></div>
      </div></article>
      <article class="crm-card full"><div class="card-head"><h3>Müşteri, uçuş ve deal bilgilerini düzenle</h3><small>CRM</small></div>
        <form id="dealMetaForm" class="field-grid">
          <label class="field"><span>Ad Soyad</span><input name="full_name" required value="${esc(fullName(r)||'')}"></label>
          <label class="field"><span>Telefon</span><input name="phone" required value="${esc(r.phone||'')}"></label>
          <label class="field full"><span>E-posta</span><input name="email" type="email" required value="${esc(r.email||'')}"></label>
          <label class="field"><span>Nereden</span><input name="origin" required value="${esc(origin(r)||'')}"></label>
          <label class="field"><span>Nereye</span><input name="destination" required value="${esc(destination(r)||'')}"></label>
          <label class="field"><span>Uçuş tipi</span><select name="trip_type"><option ${tripType(r)==='Tek Yön'?'selected':''}>Tek Yön</option><option ${tripType(r)==='Gidiş Dönüş'?'selected':''}>Gidiş Dönüş</option></select></label>
          <label class="field"><span>Yolcu</span><input name="passengers" type="number" min="1" max="30" required value="${esc(r.passengers||1)}"></label>
          <label class="field"><span>Gidiş tarihi</span><input name="departure_date" type="date" required value="${esc(departure(r)||'')}"></label>
          <label class="field"><span>Dönüş tarihi</span><input name="return_date" type="date" value="${esc(returnDate(r)||'')}"></label>
          <label class="field"><span>Jet tercihi</span><input name="jet_type" value="${esc(jetType(r)||'')}"></label>
          <label class="field"><span>Tercih edilen kalkış saati</span><input name="preferred_departure_time" value="${esc(r.preferred_departure_time||'')}" placeholder="Örn. 11:00 LT / ±2 saat"></label>
          <label class="field"><span>Lead source</span><input name="lead_source" value="${esc(r.lead_source||'')}" placeholder="Google Ads, referral, organic…"></label>
          <label class="field"><span>Referral partner</span><input name="referral_partner" value="${esc(r.referral_partner||'')}" placeholder="Otel / concierge / kişi"></label>
          <label class="field"><span>Lost reason</span><select name="lost_reason"><option value="">—</option>${LOST_REASONS.map(x=>`<option ${x===r.lost_reason?'selected':''}>${x}</option>`).join('')}</select></label>
          <label class="field full"><span>Müşteri özel talepleri</span><textarea name="notes" placeholder="Bagaj, evcil hayvan, catering, transfer…">${esc(r.notes||'')}</textarea></label>
          <label class="field full"><span>İç not</span><textarea name="internal_notes" placeholder="Müşteri profili, saat esnekliği, satış notları…">${esc(r.internal_notes||'')}</textarea></label>
          <div class="form-actions full"><button class="primary-button compact" type="submit">Değişiklikleri Kaydet</button></div>
        </form>${lost?'<div class="lost-box">Bu deal Lost durumunda. Lost reason alanını doldurmak raporlama için önemlidir.</div>':''}
      </article>
    </div>`;
    $('dealMetaForm').addEventListener('submit',saveDealMeta);
  }

  async function saveDealMeta(e){
    e.preventDefault(); const fd=new FormData(e.currentTarget);
    const patch={
      full_name:String(fd.get('full_name')||'').trim(),
      phone:String(fd.get('phone')||'').trim(),
      email:String(fd.get('email')||'').trim().toLowerCase(),
      origin:String(fd.get('origin')||'').trim(),
      destination:String(fd.get('destination')||'').trim(),
      trip_type:fd.get('trip_type'),
      passengers:Number(fd.get('passengers')),
      departure_date:fd.get('departure_date'),
      return_date:fd.get('return_date')||null,
      jet_type:String(fd.get('jet_type')||'Farketmez / En uygun seçenek').trim(),
      preferred_departure_time:fd.get('preferred_departure_time')||null,
      lead_source:fd.get('lead_source')||null,
      referral_partner:fd.get('referral_partner')||null,
      lost_reason:fd.get('lost_reason')||null,
      notes:fd.get('notes')||null,
      internal_notes:fd.get('internal_notes')||null
    };
    const {data,error}=await db.from('flight_requests').update(patch).eq('id',activeDeal.id).select().single();
    if(error){notify(`Kaydedilemedi: ${error.message}`);return;} activeDeal=Object.assign(activeDeal,data); syncRow(activeDeal); $('dealTitle').textContent=`${origin(activeDeal)||'—'} → ${destination(activeDeal)||'—'}`; $('dealSubline').textContent=`${fullName(activeDeal)||'İsimsiz'} · ${fmtDate(departure(activeDeal))} · ${activeDeal.passengers||'—'} pax`; $('dealCall').href=activeDeal.phone?`tel:${encodeURIComponent(activeDeal.phone)}`:'#'; $('dealMail').href=activeDeal.email?`mailto:${encodeURIComponent(activeDeal.email)}`:'#'; await addTimeline(activeDeal.id,'deal_updated','Müşteri / uçuş / deal bilgileri güncellendi'); await reloadTimelineOnly(); renderOverview(); renderRows(); notify('Deal bilgileri kaydedildi.');
  }


  const airportCode = text => {
    const m=String(text||'').match(/\(([A-Z0-9]{3,4})\)\s*$/i);
    return m?m[1].toUpperCase():String(text||'—');
  };
  const regexEscape = text => String(text||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rfqSpecial = request => {
    let special=String(request?.notes||'').trim();
    if(!special)return 'None advised at this stage.';
    [fullName(request),request?.email,request?.phone].filter(x=>String(x||'').trim().length>2).forEach(x=>{special=special.replace(new RegExp(regexEscape(String(x).trim()),'gi'),'[redacted]');});
    return special.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[redacted]').replace(/\+?\d[\d\s().-]{7,}\d/g,'[redacted]');
  };
  const rfqDate = date => {
    if(!date) return 'TBD';
    const d=new Date(String(date).length===10?`${date}T12:00:00`:date);
    if(Number.isNaN(d.getTime())) return String(date);
    const parts=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric'}).formatToParts(d);
    const get=t=>parts.find(x=>x.type===t)?.value||'';
    return `${get('day')} ${get('month').toUpperCase()} ${get('year')}`;
  };
  function buildRfqDraft(){
    const r=activeDeal;
    const from=origin(r)||'—', to=destination(r)||'—';
    const fromCode=airportCode(from), toCode=airportCode(to);
    const date=rfqDate(departure(r));
    const pax=r.passengers||'—';
    const aircraft=!jetType(r)||/farketmez|open|uygun/i.test(jetType(r))?'Open / Best suitable option':jetType(r);
    const time=r.preferred_departure_time||'TBD / Flexible';
    const special=rfqSpecial(r);
    const returnLine=returnDate(r)?`\nReturn date: ${rfqDate(returnDate(r))}`:'';
    const subject=`RFQ ${leadNo(r)} | ${fromCode} → ${toCode} | ${date} | ${pax} PAX`;
    const body=`Hello,\n\nPlease provide your best charter quotation for the following request:\n\nRFQ Reference: ${leadNo(r)}\nRoute: ${from} → ${to}\nDate: ${date}${returnLine}\nPreferred departure time: ${time}\nPassengers: ${pax}\nTrip type: ${tripType(r)||'—'}\nAircraft category: ${aircraft}\n\nSpecial requirements:\n${special}\n\nPlease include in your quotation:\n- Aircraft type and model\n- Aircraft registration, if available\n- Year of manufacture / refurbishment, if available\n- Total charter price including applicable taxes and handling fees\n- Aircraft availability\n- Estimated flight time\n- Quote validity\n- Cancellation terms\n- Payment terms\n- Repositioning costs, if any\n- Catering included / excluded\n\nPlease also advise if you have any suitable empty-leg or repositioning opportunity for this route.\n\nBest regards,\nValera Jets\nCharter Desk`;
    return {subject,body};
  }
  const RFQ_STATUS={draft:'Draft',sent:'Sent',responded:'Responded',declined:'Declined',no_availability:'No Availability'};
  function rfqStatusOptions(selected='draft'){return Object.entries(RFQ_STATUS).map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${v}</option>`).join('');}
  function gmailComposeUrl(to,subject,body){return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to||'')}&su=${encodeURIComponent(subject||'')}&body=${encodeURIComponent(body||'')}`;}

  function renderRfqs(){
    const draft=buildRfqDraft();
    const availableOperators=operatorDirectory.filter(o=>o.email);
    $('rfqPanel').innerHTML=`<div class="crm-grid">
      <article class="crm-card full"><div class="card-head"><h3>RFQ Gönder</h3><small>${esc(leadNo(activeDeal))} · müşteri iletişim bilgileri paylaşılmaz</small></div>
        <form id="rfqForm" class="field-grid">
          <div class="field full"><span>Gönderilecek AOC / operatörler</span>
            <div class="rfq-operator-toolbar"><label class="search-box"><span>⌕</span><input id="rfqOperatorSearch" type="search" placeholder="Operatör, AOC veya e-posta ara…"></label><strong id="rfqSelectedCount">0 operatör seçildi</strong></div>
            <div class="rfq-operator-list" id="rfqOperatorList">${availableOperators.length?availableOperators.map(o=>`<label class="rfq-operator-option" data-search="${esc([o.name,o.aoc_no,o.email].join(' ').toLocaleLowerCase('tr-TR'))}"><input type="checkbox" name="operator_ids" value="${esc(o.id)}" ${o.preferred?'checked':''}><span><strong>${o.preferred?'★ ':''}${esc(o.name)}</strong><small>${esc(o.aoc_no||'AOC no yok')} · ${esc(o.email)}</small></span></label>`).join(''):'<div class="empty-inline">RFQ e-postası kayıtlı aktif operatör bulunamadı.</div>'}</div>
          </div>
          <label class="field full"><span>E-posta subject · uçuş kaydından otomatik oluşturulur</span><input name="subject" readonly value="${esc(draft.subject)}"></label>
          <label class="field full"><span>RFQ önizleme · gönderimde sunucu aynı metni güvenli biçimde yeniden oluşturur</span><textarea class="rfq-body" name="body" readonly>${esc(draft.body)}</textarea></label>
          <div class="rfq-actions full">
            <button type="button" id="copyRfq" class="secondary-button">RFQ'yu Kopyala</button>
            <button type="submit" id="sendRfqButton" class="primary-button compact" disabled>ONAYLA VE GÖNDER</button>
          </div>
        </form>
        <p class="rfq-hint">Seçilen her operatöre ayrı e-posta gönderilir. Operatörler birbirini ve müşteri adı, telefonu veya e-postasını görmez.</p>
      </article>
      <article class="crm-card full"><div class="card-head"><h3>Gönderilen / hazırlanan RFQ'lar</h3><small>${dealRfqs.length} kayıt</small></div>
        <div class="quote-list">${dealRfqs.length?dealRfqs.map(r=>rfqCard(r)).join(''):'<div class="empty-inline">Henüz operatöre RFQ kaydedilmedi.</div>'}</div>
      </article>
    </div>`;
    $('rfqForm').addEventListener('submit',sendRfqBatch);
    $('rfqOperatorList').querySelectorAll('input[name="operator_ids"]').forEach(x=>x.addEventListener('change',updateRfqSelection));
    $('rfqOperatorSearch').addEventListener('input',filterRfqOperators);
    $('copyRfq').addEventListener('click',copyCurrentRfq);
    updateRfqSelection();
    $('rfqPanel').querySelectorAll('.rfq-status').forEach(s=>s.addEventListener('change',()=>updateRfqStatus(s.dataset.id,s.value)));
    $('rfqPanel').querySelectorAll('.rfq-gmail').forEach(b=>b.addEventListener('click',()=>{const r=dealRfqs.find(x=>x.id===b.dataset.id);if(r)window.open(gmailComposeUrl(r.operator_email,r.subject,r.body),'_blank','noopener');}));
    $('rfqPanel').querySelectorAll('.rfq-copy').forEach(b=>b.addEventListener('click',()=>{const r=dealRfqs.find(x=>x.id===b.dataset.id);if(r)copyText(`${r.subject}\n\n${r.body}`,'RFQ kopyalandı.');}));
    $('rfqPanel').querySelectorAll('.delete-rfq').forEach(b=>b.addEventListener('click',()=>deleteRfq(b.dataset.id)));
  }
  function rfqCard(r){const failed=r.delivery_status==='failed';return `<div class="quote-card rfq-card ${failed?'rfq-failed':''}"><div class="rfq-summary"><div><strong>${esc(r.operator_name)}</strong><span>${esc(r.operator_email)}</span></div><div><strong>${esc(r.subject)}</strong><span>${esc(fmtDateTime(r.sent_at||r.created_at))}${failed?` · Gönderilemedi: ${esc(r.error_message||'Bilinmeyen hata')}`:''}</span></div><div><select class="rfq-status" data-id="${esc(r.id)}">${rfqStatusOptions(r.status)}</select></div><div class="rfq-card-actions"><button class="mini-button rfq-copy" data-id="${esc(r.id)}">Kopyala</button><button class="mini-button rfq-gmail" data-id="${esc(r.id)}">Gmail ↗</button><button class="danger-button delete-rfq" data-id="${esc(r.id)}">Sil</button></div></div></div>`;}
  async function copyText(text,message='Kopyalandı.'){
    try{await navigator.clipboard.writeText(text);notify(message);}catch(_){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();notify(message);}
  }
  function selectedRfqOperatorIds(){return [...$('rfqOperatorList').querySelectorAll('input[name="operator_ids"]:checked')].map(x=>x.value);}
  function updateRfqSelection(){const count=selectedRfqOperatorIds().length;$('rfqSelectedCount').textContent=`${count} operatör seçildi`;$('sendRfqButton').disabled=count===0;$('sendRfqButton').textContent=count?`ONAYLA VE ${count} OPERATÖRE GÖNDER`:'ONAYLA VE GÖNDER';}
  function filterRfqOperators(){const q=String($('rfqOperatorSearch').value||'').trim().toLocaleLowerCase('tr-TR');$('rfqOperatorList').querySelectorAll('.rfq-operator-option').forEach(x=>{x.hidden=!!q&&!x.dataset.search.includes(q);});}
  function currentRfqFormData(){const f=$('rfqForm'),fd=new FormData(f);return {subject:String(fd.get('subject')||'').trim(),body:String(fd.get('body')||'').trim()};}
  function copyCurrentRfq(){const p=currentRfqFormData();copyText(`${p.subject}\n\n${p.body}`,'RFQ kopyalandı.');}
  async function sendRfqBatch(e){
    e.preventDefault();
    const operatorIds=selectedRfqOperatorIds();
    if(!operatorIds.length){notify('En az bir operatör seç.');return;}
    const names=operatorIds.map(id=>operatorDirectory.find(o=>o.id===id)?.name).filter(Boolean);
    if(!confirm(`${names.length} operatöre ayrı ayrı RFQ gönderilecek:\n\n${names.join('\n')}\n\nGönderimi onaylıyor musun?`))return;
    const button=$('sendRfqButton');button.disabled=true;button.textContent='GÖNDERİLİYOR…';
    const batchId=crypto.randomUUID();
    try{
      const {data,error}=await db.functions.invoke('send-rfq',{body:{request_id:activeDeal.id,operator_ids:operatorIds,batch_id:batchId}});
      if(error){let message=error.message||'Sunucu hatası';try{const detail=await error.context?.json?.();if(detail?.error)message=detail.error;}catch(_){}throw new Error(message);}
      const sent=Number(data?.sent_count||0),failed=Number(data?.failed_count||0);
      await Promise.all([loadDealRelations(),loadOperatorDirectory(),loadRequests()]);
      const refreshed=rows.find(r=>r.id===activeDeal.id);if(refreshed)activeDeal=refreshed;
      renderAllDealPanels();setActiveTab('rfq');
      notify(failed?`${sent} RFQ gönderildi, ${failed} gönderim başarısız.`:`${sent} RFQ başarıyla gönderildi.`);
    }catch(error){console.error('send-rfq',error);notify(`RFQ gönderilemedi: ${error?.message||'Sunucu hatası'}`);button.disabled=false;updateRfqSelection();}
  }
  async function updateRfqStatus(id,status){
    const patch={status,responded_at:['responded','declined','no_availability'].includes(status)?new Date().toISOString():null};
    const {error}=await db.from('rfq_requests').update(patch).eq('id',id);if(error){notify(error.message);return;}
    const r=dealRfqs.find(x=>x.id===id);await addTimeline(activeDeal.id,'rfq_status_changed',`RFQ durumu · ${r?.operator_name||'Operator'}`,RFQ_STATUS[status]||status);
    await loadDealRelations();renderAllDealPanels();setActiveTab('rfq');notify(`RFQ: ${RFQ_STATUS[status]||status}`);
  }
  async function deleteRfq(id){if(!confirm('Bu RFQ kaydı silinsin mi?'))return;const {error}=await db.from('rfq_requests').delete().eq('id',id);if(error){notify(error.message);return;}await addTimeline(activeDeal.id,'rfq_deleted','RFQ kaydı silindi');await loadDealRelations();renderAllDealPanels();setActiveTab('rfq');notify('RFQ silindi.');}

  function operatorForm(q={}){ const id=q.id||''; return `<form class="operator-quote-form field-grid" data-id="${esc(id)}">
    <label class="field"><span>Operator</span><input name="operator_name" required value="${esc(q.operator_name||'')}"></label>
    <label class="field"><span>Aircraft</span><input name="aircraft_model" required value="${esc(q.aircraft_model||'')}"></label>
    <label class="field"><span>Aircraft year</span><input name="aircraft_year" type="number" min="1950" max="2100" value="${esc(q.aircraft_year||'')}"></label>
    <label class="field"><span>Seats</span><input name="seats" type="number" min="1" max="50" value="${esc(q.seats||'')}"></label>
    <label class="field"><span>Operator cost</span><input name="operator_cost" type="number" min="0" step="0.01" required value="${esc(q.operator_cost??'')}"></label>
    <label class="field"><span>Currency</span><select name="currency">${currencyOptions(q.currency||'EUR')}</select></label>
    <label class="field"><span>Quote valid until</span><input name="quote_valid_until" type="datetime-local" value="${esc(localInputValue(q.quote_valid_until))}"></label>
    <label class="field"><span>Reposition</span><select name="reposition_included"><option value="">Bilinmiyor</option><option value="true" ${q.reposition_included===true?'selected':''}>Dahil</option><option value="false" ${q.reposition_included===false?'selected':''}>Hariç</option></select></label>
    <label class="field"><span>Catering</span><select name="catering_included"><option value="">Bilinmiyor</option><option value="true" ${q.catering_included===true?'selected':''}>Dahil</option><option value="false" ${q.catering_included===false?'selected':''}>Hariç</option></select></label>
    <label class="field full"><span>Cancellation terms</span><textarea name="cancellation_terms">${esc(q.cancellation_terms||'')}</textarea></label>
    <label class="field full"><span>Notlar</span><textarea name="notes">${esc(q.notes||'')}</textarea></label>
    <div class="form-actions full">${id?`<button type="button" class="danger-button delete-operator" data-id="${esc(id)}">Sil</button>`:''}<button class="primary-button compact" type="submit">${id?'Güncelle':'Operator Quote Ekle'}</button></div>
  </form>`; }

  function renderOperators(){
    $('operatorsPanel').innerHTML=`<div class="crm-grid">
      <article class="crm-card full"><div class="card-head"><h3>Operator teklifleri</h3><small>${dealOperatorQuotes.length} seçenek</small></div>
        <div class="quote-list">${dealOperatorQuotes.length?dealOperatorQuotes.map(q=>`<div class="quote-card"><div class="quote-summary"><div><strong>${esc(q.aircraft_model)}</strong><span>${esc(q.operator_name)}</span></div><div><strong>${money(q.operator_cost,q.currency)}</strong><span>Operator cost</span></div><div><strong>${esc(q.aircraft_year||'—')}</strong><span>Year</span></div><div><strong>${esc(q.seats||'—')}</strong><span>Seats</span></div><button class="mini-button toggle-quote">Düzenle</button></div><div class="quote-edit" hidden>${operatorForm(q)}</div></div>`).join(''):'<div class="empty-inline">Henüz operator quote eklenmedi.</div>'}</div>
      </article>
      <article class="crm-card full"><div class="card-head"><h3>Yeni operator quote</h3><small>RFQ sonucu</small></div>${operatorForm()}</article>
    </div>`;
    $('operatorsPanel').querySelectorAll('.toggle-quote').forEach(b=>b.addEventListener('click',()=>{const x=b.closest('.quote-card').querySelector('.quote-edit');x.hidden=!x.hidden;}));
    $('operatorsPanel').querySelectorAll('.operator-quote-form').forEach(f=>f.addEventListener('submit',saveOperatorQuote));
    $('operatorsPanel').querySelectorAll('.delete-operator').forEach(b=>b.addEventListener('click',()=>deleteOperatorQuote(b.dataset.id)));
  }

  const tri = v => v==='true'?true:(v==='false'?false:null);
  async function saveOperatorQuote(e){
    e.preventDefault(); const f=e.currentTarget,fd=new FormData(f),id=f.dataset.id;
    const p={request_id:activeDeal.id,operator_name:fd.get('operator_name'),aircraft_model:fd.get('aircraft_model'),aircraft_year:fd.get('aircraft_year')?Number(fd.get('aircraft_year')):null,seats:fd.get('seats')?Number(fd.get('seats')):null,operator_cost:Number(fd.get('operator_cost')),currency:fd.get('currency'),quote_valid_until:fd.get('quote_valid_until')?new Date(fd.get('quote_valid_until')).toISOString():null,reposition_included:tri(fd.get('reposition_included')),catering_included:tri(fd.get('catering_included')),cancellation_terms:fd.get('cancellation_terms')||null,notes:fd.get('notes')||null};
    const res=id?await db.from('operator_quotes').update(p).eq('id',id):await db.from('operator_quotes').insert(p);
    if(res.error){notify(`Quote kaydedilemedi: ${res.error.message}`);return;} await addTimeline(activeDeal.id,id?'operator_quote_updated':'operator_quote_added',`${p.operator_name} · ${p.aircraft_model}`,`${money(p.operator_cost,p.currency)} operator cost`); await loadDealRelations(); renderAllDealPanels(); notify(id?'Operator quote güncellendi.':'Operator quote eklendi.');
  }
  async function deleteOperatorQuote(id){ if(!confirm('Bu operator quote silinsin mi?')) return; const q=dealOperatorQuotes.find(x=>x.id===id); const {error}=await db.from('operator_quotes').delete().eq('id',id); if(error){notify(error.message);return;} await addTimeline(activeDeal.id,'operator_quote_deleted','Operator quote silindi',q?`${q.operator_name} · ${q.aircraft_model}`:''); await loadDealRelations();renderAllDealPanels();notify('Operator quote silindi.'); }

  function renderClientQuotes(){
    const nextVersion=Math.max(0,...dealClientQuotes.map(q=>Number(q.version)||0))+1;
    $('clientQuotePanel').innerHTML=`<div class="crm-grid">
      <article class="crm-card full"><div class="card-head"><h3>Müşteriye verilen teklifler</h3><small>Versiyon geçmişi</small></div>
        <div class="quote-list">${dealClientQuotes.length?dealClientQuotes.map(q=>clientQuoteCard(q)).join(''):'<div class="empty-inline">Henüz müşteri teklifi oluşturulmadı.</div>'}</div>
      </article>
      <article class="crm-card full"><div class="card-head"><h3>Yeni client quote</h3><small>Version ${nextVersion}</small></div>${clientQuoteForm({version:nextVersion})}</article>
    </div>`;
    $('clientQuotePanel').querySelectorAll('.toggle-client-quote').forEach(b=>b.addEventListener('click',()=>{const x=b.closest('.quote-card').querySelector('.quote-edit');x.hidden=!x.hidden;}));
    $('clientQuotePanel').querySelectorAll('.client-quote-form').forEach(f=>f.addEventListener('submit',saveClientQuote));
    $('clientQuotePanel').querySelectorAll('.delete-client-quote').forEach(b=>b.addEventListener('click',()=>deleteClientQuote(b.dataset.id)));
  }
  function clientQuoteCard(q){ const linked=dealOperatorQuotes.find(o=>o.id===q.operator_quote_id); return `<div class="quote-card"><div class="quote-summary"><div><strong>Version ${esc(q.version)}</strong><span>${esc(q.aircraft_model||linked?.aircraft_model||'Aircraft belirtilmedi')}</span></div><div><strong>${money(q.client_price,q.currency)}</strong><span>Client price</span></div><div><span class="tag ${esc(q.status)}">${esc(q.status.toUpperCase())}</span></div><div><strong>${esc(fmtDateTime(q.valid_until))}</strong><span>Valid until</span></div><button class="mini-button toggle-client-quote">Düzenle</button></div><div class="quote-edit" hidden>${clientQuoteForm(q)}</div></div>`; }
  function clientQuoteForm(q={}){ const id=q.id||''; return `<form class="client-quote-form field-grid" data-id="${esc(id)}">
    <input type="hidden" name="version" value="${esc(q.version||1)}">
    <label class="field"><span>Bağlı operator quote</span><select name="operator_quote_id"><option value="">— Manuel / seçilmedi —</option>${dealOperatorQuotes.map(o=>`<option value="${esc(o.id)}" ${o.id===q.operator_quote_id?'selected':''}>${esc(o.operator_name)} · ${esc(o.aircraft_model)} · ${money(o.operator_cost,o.currency)}</option>`).join('')}</select></label>
    <label class="field"><span>Aircraft</span><input name="aircraft_model" value="${esc(q.aircraft_model||'')}" placeholder="Boşsa operator quote'tan alınır"></label>
    <label class="field"><span>Client price</span><input name="client_price" type="number" min="0" step="0.01" required value="${esc(q.client_price??'')}"></label>
    <label class="field"><span>Currency</span><select name="currency">${currencyOptions(q.currency||'EUR')}</select></label>
    <label class="field"><span>Status</span><select name="status"><option value="draft" ${q.status==='draft'?'selected':''}>Draft</option><option value="sent" ${q.status==='sent'?'selected':''}>Sent</option><option value="accepted" ${q.status==='accepted'?'selected':''}>Accepted</option><option value="rejected" ${q.status==='rejected'?'selected':''}>Rejected</option></select></label>
    <label class="field"><span>Valid until</span><input name="valid_until" type="datetime-local" value="${esc(localInputValue(q.valid_until))}"></label>
    <label class="field full"><span>Teklif notları</span><textarea name="notes" placeholder="Kabin, bagaj, cancellation, quote validity…">${esc(q.notes||'')}</textarea></label>
    <div class="form-actions full">${id?`<button type="button" class="danger-button delete-client-quote" data-id="${esc(id)}">Sil</button>`:''}<button class="primary-button compact" type="submit">${id?'Teklifi Güncelle':'Client Quote Oluştur'}</button></div>
  </form>`; }
  async function saveClientQuote(e){
    e.preventDefault(); const f=e.currentTarget,fd=new FormData(f),id=f.dataset.id; const operatorId=fd.get('operator_quote_id')||null; const op=dealOperatorQuotes.find(x=>x.id===operatorId);
    const p={request_id:activeDeal.id,operator_quote_id:operatorId,version:Number(fd.get('version'))||1,aircraft_model:fd.get('aircraft_model')||op?.aircraft_model||null,client_price:Number(fd.get('client_price')),currency:fd.get('currency'),valid_until:fd.get('valid_until')?new Date(fd.get('valid_until')).toISOString():null,status:fd.get('status'),notes:fd.get('notes')||null};
    const existingClientQuote=id?dealClientQuotes.find(x=>x.id===id):null;
    if(p.status==='sent') p.sent_at=existingClientQuote?.sent_at||new Date().toISOString();
    const res=id?await db.from('client_quotes').update(p).eq('id',id):await db.from('client_quotes').insert(p);
    if(res.error){notify(`Client quote kaydedilemedi: ${res.error.message}`);return;}
    if(p.status==='sent' && normalizeStatus(activeDeal.status)!=='quoted') await updateDealStatus('quoted',false);
    if(p.status==='accepted' && normalizeStatus(activeDeal.status)!=='client_confirmed') await updateDealStatus('client_confirmed',false);
    await addTimeline(activeDeal.id,id?'client_quote_updated':'client_quote_created',`Client quote v${p.version} · ${p.status}`,`${money(p.client_price,p.currency)} · ${p.aircraft_model||'Aircraft'}`);
    await loadDealRelations();renderAllDealPanels();notify(id?'Client quote güncellendi.':'Client quote oluşturuldu.');
  }
  async function deleteClientQuote(id){ if(!confirm('Bu client quote silinsin mi?'))return; const {error}=await db.from('client_quotes').delete().eq('id',id);if(error){notify(error.message);return;}await addTimeline(activeDeal.id,'client_quote_deleted','Client quote silindi');await loadDealRelations();renderAllDealPanels();notify('Client quote silindi.'); }

  function financeBasis(){
    const accepted=dealClientQuotes.find(q=>q.status==='accepted')||dealClientQuotes.find(q=>q.status==='sent')||dealClientQuotes[0]||null;
    const op=accepted?.operator_quote_id?dealOperatorQuotes.find(o=>o.id===accepted.operator_quote_id):null;
    const clientPrice=accepted?Number(accepted.client_price):null; const operatorCost=op?Number(op.operator_cost):null; const referral=Number(activeDeal.referral_fee||0);
    const currency=accepted?.currency||op?.currency||'EUR'; const currencyMismatch=Boolean(accepted&&op&&accepted.currency!==op.currency);
    const gross=(!currencyMismatch&&clientPrice!==null&&operatorCost!==null)?clientPrice-operatorCost-referral:null; const margin=(gross!==null&&clientPrice)?gross/clientPrice*100:null;
    return {accepted,op,clientPrice,operatorCost,referral,gross,margin,currency,currencyMismatch};
  }
  function renderFinance(){
    const f=financeBasis();
    $('financePanel').innerHTML=`${!f.accepted?'<div class="warning-box">Finans özeti için önce Client Quote oluştur. Operator quote ile bağlarsan marj otomatik hesaplanır.</div>':''}${f.currencyMismatch?'<div class="warning-box">Client quote ile operator quote farklı para biriminde. FX dönüşümü girilmediği için gross revenue / marj otomatik hesaplanmıyor.</div>':''}
      <div class="finance-hero"><div class="finance-stat"><span>Operator Cost</span><strong>${money(f.operatorCost,f.currency)}</strong></div><div class="finance-stat"><span>Client Price</span><strong>${money(f.clientPrice,f.currency)}</strong></div><div class="finance-stat"><span>Referral Fee</span><strong>${money(f.referral,f.currency)}</strong></div><div class="finance-stat accent"><span>Gross Revenue</span><strong>${money(f.gross,f.currency)}</strong></div></div>
      <div class="crm-grid" style="margin-top:14px"><article class="crm-card"><div class="card-head"><h3>Marj</h3></div><div class="info-item"><span>Gross margin</span><strong class="money">${f.margin===null?'—':`${f.margin.toFixed(1)}%`}</strong></div><p class="muted" style="font-size:11px">Client price − operator cost − referral fee.</p></article>
      <article class="crm-card"><div class="card-head"><h3>Referral</h3></div><form id="financeForm" class="field-grid"><label class="field"><span>Referral fee (${esc(f.currency)})</span><input name="referral_fee" type="number" min="0" step="0.01" value="${esc(activeDeal.referral_fee||0)}"></label><label class="field"><span>Referral partner</span><input name="referral_partner" value="${esc(activeDeal.referral_partner||'')}"></label><div class="form-actions full"><button class="primary-button compact">Kaydet</button></div></form></article></div>`;
    $('financeForm').addEventListener('submit',saveFinance);
  }
  async function saveFinance(e){ e.preventDefault();const fd=new FormData(e.currentTarget),patch={referral_fee:Number(fd.get('referral_fee')||0),referral_partner:fd.get('referral_partner')||null};const {data,error}=await db.from('flight_requests').update(patch).eq('id',activeDeal.id).select().single();if(error){notify(error.message);return;}activeDeal=Object.assign(activeDeal,data);syncRow(activeDeal);await addTimeline(activeDeal.id,'finance_updated','Finans bilgisi güncellendi',`Referral fee: ${patch.referral_fee}`);await reloadTimelineOnly();renderFinance();renderOverview();notify('Finans bilgisi kaydedildi.'); }

  function renderFollowup(){
    const overdue=activeDeal.follow_up_at&&new Date(activeDeal.follow_up_at).getTime()<Date.now();
    $('followupPanel').innerHTML=`<div class="crm-grid"><article class="crm-card"><div class="card-head"><h3>Next Follow-up</h3><small>${overdue?'GECİKMİŞ':'Planlama'}</small></div><form id="followupForm" class="field-grid">
      <label class="field full"><span>Tarih / saat</span><input name="follow_up_at" type="datetime-local" value="${esc(localInputValue(activeDeal.follow_up_at))}"></label>
      <label class="field full"><span>Follow-up notu</span><textarea name="follow_up_note" placeholder="Availability yeniden kontrol edilecek, müşteri öğleden sonra dönecek…">${esc(activeDeal.follow_up_note||'')}</textarea></label>
      <div class="form-actions full"><button type="button" id="clearFollowup" class="secondary-button">Tamamlandı / Temizle</button><button class="primary-button compact">Planla</button></div></form></article>
      <article class="crm-card"><div class="card-head"><h3>Satış ritmi</h3></div><div class="info-grid"><div class="info-item"><span>Lead oluşturuldu</span><strong>${esc(fmtDateTime(activeDeal.created_at))}</strong></div><div class="info-item"><span>Son güncelleme</span><strong>${esc(fmtDateTime(activeDeal.updated_at))}</strong></div><div class="info-item"><span>Şu anki aşama</span><strong>${esc(STATUS[normalizeStatus(activeDeal.status)][0])}</strong></div><div class="info-item"><span>Sonraki aksiyon</span><strong>${esc(activeDeal.follow_up_note||'—')}</strong></div></div></article></div>`;
    $('followupForm').addEventListener('submit',saveFollowup);$('clearFollowup').addEventListener('click',clearFollowup);
  }
  async function saveFollowup(e){e.preventDefault();const fd=new FormData(e.currentTarget),patch={follow_up_at:fd.get('follow_up_at')?new Date(fd.get('follow_up_at')).toISOString():null,follow_up_note:fd.get('follow_up_note')||null};const {data,error}=await db.from('flight_requests').update(patch).eq('id',activeDeal.id).select().single();if(error){notify(error.message);return;}activeDeal=Object.assign(activeDeal,data);syncRow(activeDeal);await addTimeline(activeDeal.id,'follow_up_scheduled','Follow-up planlandı',`${fmtDateTime(patch.follow_up_at)} · ${patch.follow_up_note||''}`);await reloadTimelineOnly();renderFollowup();renderTimeline();renderRows();renderStats();notify('Follow-up planlandı.');}
  async function clearFollowup(){const {data,error}=await db.from('flight_requests').update({follow_up_at:null,follow_up_note:null}).eq('id',activeDeal.id).select().single();if(error){notify(error.message);return;}activeDeal=Object.assign(activeDeal,data);syncRow(activeDeal);await addTimeline(activeDeal.id,'follow_up_completed','Follow-up tamamlandı');await reloadTimelineOnly();renderFollowup();renderTimeline();renderRows();renderStats();notify('Follow-up tamamlandı.');}

  function renderTimeline(){
    $('timelinePanel').innerHTML=`<div class="crm-grid"><article class="crm-card"><div class="card-head"><h3>Aktivite</h3><small>${dealTimeline.length} kayıt</small></div>${dealTimeline.length?`<div class="timeline">${dealTimeline.map(t=>`<div class="timeline-item"><span class="timeline-dot"></span><strong>${esc(t.title)}</strong>${t.detail?`<p>${esc(t.detail)}</p>`:''}<time>${esc(fmtDateTime(t.created_at))}</time></div>`).join('')}</div>`:'<div class="empty-inline">Timeline henüz boş.</div>'}</article><article class="crm-card"><div class="card-head"><h3>Manuel not ekle</h3></div><form id="timelineForm" class="field-grid"><label class="field full"><span>Başlık</span><input name="title" required placeholder="Müşteri ile görüşüldü"></label><label class="field full"><span>Detay</span><textarea name="detail" placeholder="Görüşme notları…"></textarea></label><div class="form-actions full"><button class="primary-button compact">Timeline'a Ekle</button></div></form></article></div>`;
    $('timelineForm').addEventListener('submit',saveTimelineNote);
  }
  async function saveTimelineNote(e){e.preventDefault();const fd=new FormData(e.currentTarget);await addTimeline(activeDeal.id,'note',fd.get('title'),fd.get('detail'));await reloadTimelineOnly();renderTimeline();notify('Not timeline’a eklendi.');}
  async function reloadTimelineOnly(){const {data,error}=await db.from('deal_timeline').select('*').eq('request_id',activeDeal.id).order('created_at',{ascending:false});if(!error){dealTimeline=data||[];$('timelineCount').textContent=dealTimeline.length;}}

  async function updateDealStatus(status,recordTimeline=true){
    const previous=activeDeal.status; const {data,error}=await db.from('flight_requests').update({status,lost_reason:status==='lost'?activeDeal.lost_reason:null}).eq('id',activeDeal.id).select().single();
    if(error){$('dealStatus').value=previous;notify(`Durum güncellenemedi: ${error.message}`);return;}
    activeDeal=Object.assign(activeDeal,data); syncRow(activeDeal); if(recordTimeline) await addTimeline(activeDeal.id,'status_changed','Pipeline aşaması değişti',`${STATUS[normalizeStatus(previous)]?.[0]||previous} → ${STATUS[status][0]}`); await reloadTimelineOnly(); renderStats();renderRows();renderOverview();renderFinance();renderFollowup();renderTimeline();notify(`Durum: ${STATUS[status][0]}`);
  }
  function syncRow(updated){const idx=rows.findIndex(r=>r.id===updated.id);if(idx>=0)rows[idx]=Object.assign(rows[idx],updated);}

  function setActiveTab(tab){document.querySelectorAll('#dealTabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab));}
  function closeWorkspace(){workspace.classList.remove('open');workspace.setAttribute('aria-hidden','true');setTimeout(()=>workspaceBackdrop.hidden=true,180);activeDeal=null;}

  statusSelect.innerHTML='<option value="all">Tüm durumlar</option>'+statusOptions('');
  loginForm.addEventListener('submit',async e=>{e.preventDefault();loginError.hidden=true;loginButton.disabled=true;loginButton.textContent='Giriş yapılıyor…';const email=$('loginEmail').value.trim(),password=$('loginPassword').value;const {data,error}=await db.auth.signInWithPassword({email,password});if(error){loginError.hidden=false;loginError.textContent='E-posta veya şifre hatalı.';}else if(data.session){await showDashboard(data.session);}loginButton.disabled=false;loginButton.innerHTML='Giriş Yap <span>→</span>';});
  $('logoutButton').addEventListener('click',async()=>{await db.auth.signOut();rows=[];appView.hidden=true;loginView.hidden=false;});
  $('refreshButton').addEventListener('click',async()=>{await Promise.all([loadRequests(),loadOperatorDirectory()]);notify(mainView==='operators'?'Operatör listesi yenilendi.':'Talepler yenilendi.');});
  requestsBody.addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)openDeal(b.dataset.id);});
  searchInput.addEventListener('input',renderRows);
  statusSelect.addEventListener('change',()=>{showDealList();activeFilter='all';document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));document.querySelector('[data-filter="all"]').classList.add('active');renderRows();});
  document.querySelectorAll('.nav-item[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{showDealList();activeFilter=btn.dataset.filter;statusSelect.value='all';document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n===btn));$('panelTitle').textContent=btn.textContent.replace(/\d+/g,'').trim();renderRows();}));
  $('operatorDirectoryNav').addEventListener('click',showOperatorDirectory);
  $('operatorSearch').addEventListener('input',renderOperatorDirectory);
  $('operatorFilter').addEventListener('change',renderOperatorDirectory);
  $('newOperatorButton').addEventListener('click',()=>openOperatorForm());
  $('cancelOperatorEdit').addEventListener('click',closeOperatorForm);
  $('operatorForm').addEventListener('submit',saveOperator);
  $('closeWorkspace').addEventListener('click',closeWorkspace);workspaceBackdrop.addEventListener('click',closeWorkspace);
  $('dealTabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)setActiveTab(b.dataset.tab);});
  $('dealStatus').addEventListener('change',e=>updateDealStatus(e.target.value,true));

  db.channel('valera-admin-flight-requests').on('postgres_changes',{event:'INSERT',schema:'public',table:'flight_requests'},async()=>{await loadRequests();notify('Yeni uçuş talebi geldi.');}).subscribe();

  (async()=>{const {data}=await db.auth.getSession();if(data.session)await showDashboard(data.session);})();
})();
