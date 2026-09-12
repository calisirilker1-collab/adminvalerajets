(() => {
  'use strict';

  const cfg = window.VALERA_ADMIN_CONFIG || {};
  const loginView = document.getElementById('loginView');
  const appView = document.getElementById('appView');
  const loginForm = document.getElementById('loginForm');
  const loginButton = document.getElementById('loginButton');
  const loginError = document.getElementById('loginError');
  const requestsBody = document.getElementById('requestsBody');
  const loadingState = document.getElementById('loadingState');
  const emptyState = document.getElementById('emptyState');
  const tableWrap = document.getElementById('tableWrap');
  const searchInput = document.getElementById('searchInput');
  const statusSelect = document.getElementById('statusSelect');
  const toast = document.getElementById('toast');
  const drawer = document.getElementById('detailDrawer');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const detailContent = document.getElementById('detailContent');
  const detailTitle = document.getElementById('detailTitle');

  if (!cfg.supabaseUrl || !cfg.publishableKey || !window.supabase) {
    alert('Admin panel Supabase bağlantısı yapılandırılmamış.');
    return;
  }

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let rows = [];
  let activeFilter = 'all';
  let activeDetailId = null;

  const statusMeta = {
    new: ['Yeni', 'status-new'],
    contacted: ['İletişime Geçildi', 'status-contacted'],
    quoted: ['Teklif Verildi', 'status-quoted'],
    won: ['Kazanıldı', 'status-won'],
    lost: ['Kaybedildi', 'status-lost']
  };

  const value = (row, ...keys) => {
    for (const k of keys) if (row?.[k] !== undefined && row?.[k] !== null && row?.[k] !== '') return row[k];
    return '';
  };
  const origin = r => value(r, 'origin', 'from_location', 'from_city', 'from');
  const destination = r => value(r, 'destination', 'to_location', 'to_city', 'to');
  const fullName = r => value(r, 'full_name', 'name');
  const departure = r => value(r, 'departure_date', 'departure');
  const returnDate = r => value(r, 'return_date', 'returnDate');
  const tripType = r => value(r, 'trip_type', 'tripType');
  const jetType = r => value(r, 'jet_type', 'jetType');

  const esc = (x='') => String(x).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const fmtDate = date => {
    if (!date) return '—';
    const d = new Date(String(date).length === 10 ? `${date}T12:00:00` : date);
    return Number.isNaN(d.getTime()) ? esc(date) : new Intl.DateTimeFormat('tr-TR',{day:'2-digit',month:'short',year:'numeric'}).format(d);
  };
  const fmtTime = date => {
    if (!date) return '—';
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
  };
  const shortId = id => id ? String(id).split('-')[0].toUpperCase() : '—';
  const normalizeStatus = s => statusMeta[s] ? s : 'new';

  function notify(message){
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 2300);
  }

  async function isAdmin(){
    const { data, error } = await db.rpc('is_valera_admin');
    if (error) { console.error(error); return false; }
    return data === true;
  }

  async function showDashboard(session){
    const ok = await isAdmin();
    if (!ok){
      await db.auth.signOut();
      loginView.hidden = false;
      appView.hidden = true;
      loginError.hidden = false;
      loginError.textContent = 'Bu kullanıcı yönetici olarak yetkilendirilmemiş.';
      return;
    }
    loginView.hidden = true;
    appView.hidden = false;
    const email = session?.user?.email || '';
    document.getElementById('userEmail').textContent = email || 'Yönetici';
    document.getElementById('userAvatar').textContent = (email[0] || 'V').toUpperCase();
    await loadRequests();
  }

  async function loadRequests(){
    loadingState.hidden = false;
    emptyState.hidden = true;
    tableWrap.hidden = true;
    const { data, error } = await db.from('flight_requests').select('*').order('created_at',{ascending:false}).limit(1000);
    loadingState.hidden = true;
    if (error){
      console.error(error);
      emptyState.hidden = false;
      emptyState.textContent = `Talepler yüklenemedi: ${error.message}`;
      return;
    }
    rows = data || [];
    renderStats();
    renderRows();
  }

  function renderStats(){
    const count = s => rows.filter(r => normalizeStatus(r.status) === s).length;
    document.getElementById('statTotal').textContent = rows.length;
    document.getElementById('statNew').textContent = count('new');
    document.getElementById('statQuoted').textContent = count('quoted');
    document.getElementById('statWon').textContent = count('won');
    document.getElementById('navAllCount').textContent = rows.length;
    document.getElementById('navNewCount').textContent = count('new');
  }

  function filteredRows(){
    const q = searchInput.value.trim().toLocaleLowerCase('tr-TR');
    const selectStatus = statusSelect.value;
    return rows.filter(r => {
      const s = normalizeStatus(r.status);
      const statusOk = activeFilter === 'all' ? (selectStatus === 'all' || s === selectStatus) : s === activeFilter;
      if (!statusOk) return false;
      if (!q) return true;
      const hay = [fullName(r),r.email,r.phone,origin(r),destination(r),jetType(r),r.notes,shortId(r.id)].join(' ').toLocaleLowerCase('tr-TR');
      return hay.includes(q);
    });
  }

  function renderRows(){
    const list = filteredRows();
    requestsBody.innerHTML = '';
    if (!list.length){
      tableWrap.hidden = true;
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;
    tableWrap.hidden = false;
    requestsBody.innerHTML = list.map(r => {
      const s = normalizeStatus(r.status), meta = statusMeta[s];
      return `<tr>
        <td><span class="request-id">#${esc(shortId(r.id))}</span><br><small>${esc(fmtTime(r.created_at))}</small></td>
        <td class="customer-cell"><strong>${esc(fullName(r) || 'İsimsiz')}</strong><span>${esc(r.phone || r.email || '—')}</span></td>
        <td class="route-cell"><strong>${esc(origin(r) || '—')} <span class="route-arrow">→</span> ${esc(destination(r) || '—')}</strong><span>${esc(tripType(r) || '—')}</span></td>
        <td>${esc(fmtDate(departure(r)))}</td>
        <td>${esc(r.passengers ?? '—')}</td>
        <td>${esc(jetType(r) || '—')}</td>
        <td><span class="status-pill ${meta[1]}">${meta[0]}</span></td>
        <td><button class="detail-button" data-id="${esc(r.id)}">Detay →</button></td>
      </tr>`;
    }).join('');
  }

  function openDetail(id){
    const r = rows.find(x => String(x.id) === String(id));
    if (!r) return;
    activeDetailId = r.id;
    const s = normalizeStatus(r.status);
    detailTitle.textContent = `${origin(r) || '—'} → ${destination(r) || '—'}`;
    detailContent.innerHTML = `
      <section class="detail-section">
        <h3>Durum</h3>
        <select id="detailStatus" class="status-control">
          ${Object.entries(statusMeta).map(([key,m]) => `<option value="${key}" ${key===s?'selected':''}>${m[0]}</option>`).join('')}
        </select>
      </section>
      <section class="detail-section">
        <h3>Uçuş Bilgileri</h3>
        <div class="detail-grid">
          <div class="detail-item"><span>Nereden</span><strong>${esc(origin(r) || '—')}</strong></div>
          <div class="detail-item"><span>Nereye</span><strong>${esc(destination(r) || '—')}</strong></div>
          <div class="detail-item"><span>Uçuş Tipi</span><strong>${esc(tripType(r) || '—')}</strong></div>
          <div class="detail-item"><span>Yolcu</span><strong>${esc(r.passengers ?? '—')}</strong></div>
          <div class="detail-item"><span>Gidiş</span><strong>${esc(fmtDate(departure(r)))}</strong></div>
          <div class="detail-item"><span>Dönüş</span><strong>${esc(fmtDate(returnDate(r)))}</strong></div>
          <div class="detail-item full"><span>Jet Tercihi</span><strong>${esc(jetType(r) || '—')}</strong></div>
        </div>
      </section>
      <section class="detail-section">
        <h3>Müşteri</h3>
        <div class="detail-grid">
          <div class="detail-item full"><span>Ad Soyad</span><strong>${esc(fullName(r) || '—')}</strong></div>
          <div class="detail-item"><span>Telefon</span><strong>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</strong></div>
          <div class="detail-item"><span>E-posta</span><strong>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '—'}</strong></div>
        </div>
      </section>
      <section class="detail-section">
        <h3>Özel Talepler</h3>
        <div class="note-box">${esc(r.notes || 'Özel talep belirtilmemiş.')}</div>
      </section>
      <section class="detail-section">
        <h3>Kayıt</h3>
        <div class="detail-grid">
          <div class="detail-item"><span>Talep No</span><strong>#${esc(shortId(r.id))}</strong></div>
          <div class="detail-item"><span>Oluşturuldu</span><strong>${esc(fmtTime(r.created_at))}</strong></div>
        </div>
      </section>`;
    document.getElementById('detailStatus').addEventListener('change', e => updateStatus(r.id, e.target.value));
    drawerBackdrop.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('open'));
    drawer.setAttribute('aria-hidden','false');
  }

  async function updateStatus(id, status){
    const oldRow = rows.find(r => String(r.id) === String(id));
    if (!oldRow) return;
    const previous = oldRow.status;
    oldRow.status = status;
    renderStats(); renderRows();
    const { error } = await db.from('flight_requests').update({status}).eq('id',id);
    if (error){
      oldRow.status = previous;
      renderStats(); renderRows();
      notify(`Durum güncellenemedi: ${error.message}`);
      return;
    }
    notify(`Durum: ${statusMeta[status][0]}`);
  }

  function closeDetail(){
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    setTimeout(() => { drawerBackdrop.hidden = true; activeDetailId = null; }, 220);
  }

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginError.hidden = true;
    loginButton.disabled = true;
    loginButton.textContent = 'Giriş yapılıyor…';
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const { data, error } = await db.auth.signInWithPassword({email,password});
    if (error){
      loginError.hidden = false;
      loginError.textContent = 'E-posta veya şifre hatalı.';
    } else if (data.session) {
      await showDashboard(data.session);
    }
    loginButton.disabled = false;
    loginButton.innerHTML = 'Giriş Yap <span>→</span>';
  });

  document.getElementById('logoutButton').addEventListener('click', async () => {
    await db.auth.signOut();
    rows = [];
    appView.hidden = true;
    loginView.hidden = false;
  });
  document.getElementById('refreshButton').addEventListener('click', async () => { await loadRequests(); notify('Talepler yenilendi.'); });
  document.getElementById('closeDrawer').addEventListener('click', closeDetail);
  drawerBackdrop.addEventListener('click', closeDetail);
  requestsBody.addEventListener('click', e => { const b=e.target.closest('[data-id]'); if(b) openDetail(b.dataset.id); });
  searchInput.addEventListener('input', renderRows);
  statusSelect.addEventListener('change', () => { activeFilter='all'; document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active')); document.querySelector('[data-filter="all"]').classList.add('active'); renderRows(); });
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    statusSelect.value = 'all';
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n===btn));
    document.getElementById('panelTitle').textContent = btn.childNodes[2]?.textContent?.trim() || btn.textContent.trim();
    renderRows();
  }));

  // Optional live refresh when Realtime is enabled for flight_requests.
  db.channel('valera-admin-flight-requests')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'flight_requests'}, async () => { await loadRequests(); notify('Yeni uçuş talebi geldi.'); })
    .subscribe();

  (async () => {
    const { data } = await db.auth.getSession();
    if (data.session) await showDashboard(data.session);
  })();
})();
