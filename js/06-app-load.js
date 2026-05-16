// ══════════════════════════════════════════════════════════
// APP LOAD
// ══════════════════════════════════════════════════════════
async function loadApp(){
  showApp();
  // Set header
  const profile=currentUser.user_metadata;
  const name=profile?.full_name||currentUser.email;
  document.getElementById('hdr-org-name').textContent=currentOrg?.name||'—';
  document.getElementById('hdr-avatar').textContent=name.charAt(0).toUpperCase();
  document.getElementById('menu-name').textContent=name;
  document.getElementById('menu-email').textContent=currentUser.email;
  // Set role guard
  document.getElementById('app-shell').setAttribute('data-role',currentRole||'viewer');
  document.body.setAttribute('data-role',currentRole||'viewer');
  // Init UI
  document.getElementById('target-lang').innerHTML=langOptionsHTML();
  document.getElementById('pptx-target-lang').innerHTML=langOptionsHTML();
  document.getElementById('sub-target-lang').innerHTML=langOptionsHTML();
  document.getElementById('q-target-lang').innerHTML=langOptionsHTML();
  const npSrc=document.getElementById('np-src-lang');if(npSrc)npSrc.innerHTML=langOptionsHTML();
  buildDictNewRow();buildDictLangFilter();
  // Load data
  try{
    await Promise.all([loadDictCache(),loadOrgBalance()]);
    await migrateTokensToCredits();
    updateTMUI();
    setDbStatus(true);
  }catch(e){setDbStatus(false);console.error(e);}
  // Init dark mode
  initDarkMode();
  // Load projects (default tab)
  await loadProjects();
  // Load notifications for admins
  if(currentRole==='admin') loadNotifications();
  // Prefill account form
  const accName=currentUser?.user_metadata?.full_name||'';
  const accEmail=currentUser?.email||'';
  const accEl=document.getElementById('account-name');if(accEl)accEl.value=accName;
  const accND=document.getElementById('account-name-display');if(accND)accND.textContent=accName||accEmail;
  const accED=document.getElementById('account-email-display');if(accED)accED.textContent=accEmail;
  const accAv=document.getElementById('account-avatar');if(accAv)accAv.textContent=(accName||accEmail).charAt(0).toUpperCase();
}

async function loadOrgBalance(){
  if(!currentOrg) return;
  try{
    const orgs = await dbGet('organizations', `?id=eq.${currentOrg.id}`);
    if(orgs.length){ currentOrg.tokens_balance = orgs[0].tokens_balance || 0; }
  }catch(e){ console.error('Balance load error:', e); }
  updateTokenBadge();
}

function setDbStatus(ok){
  const dot=document.getElementById('db-dot');
  dot.className='db-dot '+(ok?'ok':'err');
}

function toggleUserMenu(){
  const menu=document.getElementById('user-menu');
  const row=document.querySelector('.sidebar-user');
  const isOpen=menu.classList.toggle('open');
  row.classList.toggle('menu-open',isOpen);
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.sidebar-user')){
    document.getElementById('user-menu')?.classList.remove('open');
    document.querySelector('.sidebar-user')?.classList.remove('menu-open');
  }
});