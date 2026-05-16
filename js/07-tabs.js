// ══════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════
function switchTab(name){
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  if(name==='tm')renderTMList();
  if(name==='dict')renderDict();
  if(name==='stats')loadStats();
  if(name==='team')loadTeam();
  if(name==='shop'){updateShopBalance();loadTokenHistory();}
  if(name==='projects'){loadProjects();}
  if(name==='settings'){buildFavLangsUI();}
  if(name==='subtitles'){renderSubtitleTable();}
  // Close sidebar on mobile after navigation
  document.getElementById('app-shell')?.classList.remove('sidebar-open');
  document.getElementById('sidebar-overlay')?.classList.remove('visible');
}