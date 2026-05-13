// ══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════

async function loadNotifications(){
  if(!currentOrg||!currentUser) return;
  try{
    const data = await dbGet('notifications',
      `?user_id=eq.${currentUser.id}&order=created_at.desc&limit=20`);
    notificationsCache = data;
    renderNotifications();
    updateNotifDot();
  }catch(e){ console.error('Notifications error:', e); }
}

function updateNotifDot(){
  const unread = notificationsCache.filter(n=>!n.is_read).length;
  const dot = document.getElementById('notif-dot');
  if(dot) dot.style.display = unread > 0 ? 'block' : 'none';
}

function renderNotifications(){
  const list = document.getElementById('notif-list');
  if(!list) return;
  if(!notificationsCache.length){
    list.innerHTML = '<div class="notif-empty">Brak powiadomień</div>';
    return;
  }
  const icons = {
    lang_ready: {icon:'✓', cls:'ni-green'},
    tokens_low: {icon:'🪙', cls:'ni-yellow'},
    project_created: {icon:'📁', cls:'ni-blue'},
    project_done: {icon:'✓', cls:'ni-green'},
  };
  list.innerHTML = notificationsCache.map(n => {
    const ic = icons[n.type] || {icon:'●', cls:'ni-blue'};
    const timeStr = fmtTimeAgo(n.created_at);
    return `<div class="notif-item${n.is_read?'':' unread'}" onclick="onNotifClick('${n.id}','${n.link_project_id||''}')">
      <div class="notif-icon ${ic.cls}">${ic.icon}</div>
      <div style="flex:1;min-width:0;">
        <div class="notif-text">${esc(n.title)}</div>
        ${n.message?`<div class="notif-text" style="color:#888;margin-top:2px;">${esc(n.message)}</div>`:''}
        ${n.link_project_id?`<div class="notif-action">Otwórz projekt →</div>`:''}
        <div class="notif-time">${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

function fmtTimeAgo(iso){
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff/60000);
  if(mins < 1) return 'przed chwilą';
  if(mins < 60) return `przed ${mins} min`;
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return `przed ${hrs} godz.`;
  const days = Math.floor(hrs/24);
  return `przed ${days} dni`;
}

async function onNotifClick(notifId, projectId){
  // Mark as read
  await dbPatch('notifications', {is_read: true}, `?id=eq.${notifId}`);
  notificationsCache = notificationsCache.map(n => n.id===notifId?{...n,is_read:true}:n);
  renderNotifications();
  updateNotifDot();
  // Navigate to project if applicable
  if(projectId && projectId !== 'null'){
    document.getElementById('notif-dropdown').classList.remove('open');
    switchTab('projects');
    setTimeout(()=>openProject(projectId), 300);
  }
}

async function markAllRead(){
  if(!notificationsCache.length) return;
  const unread = notificationsCache.filter(n=>!n.is_read);
  for(const n of unread){
    await dbPatch('notifications', {is_read:true}, `?id=eq.${n.id}`);
  }
  notificationsCache = notificationsCache.map(n=>({...n,is_read:true}));
  renderNotifications();
  updateNotifDot();
}

function toggleNotifications(){
  const dd = document.getElementById('notif-dropdown');
  dd.classList.toggle('open');
  if(dd.classList.contains('open')) loadNotifications();
  document.getElementById('user-menu')?.classList.remove('open');
}

// Close notifications when clicking outside
document.addEventListener('click', e=>{
  if(!e.target.closest('#notif-dropdown') && !e.target.closest('[onclick="toggleNotifications()"]')){
    document.getElementById('notif-dropdown')?.classList.remove('open');
  }
});

async function createNotification(type, title, message, projectId=null, lang=null){
  if(!currentOrg) return;
  try{
    await supa.rpc('notify_admins', {
      org_id: currentOrg.id,
      notif_type: type,
      notif_title: title,
      notif_message: message,
      proj_id: projectId || null,
      lang: lang || null
    });
  }catch(e){ console.error('Notification error:', e); }
}