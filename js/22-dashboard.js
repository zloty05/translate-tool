// ══════════════════════════════════════════════════════════
// DASHBOARD METRICS
// ══════════════════════════════════════════════════════════

function setProjFilter(mode, el){
  projFilterMode = mode;
  document.querySelectorAll('.ftab').forEach(t=>t.classList.remove('active'));
  if(el) el.classList.add('active');
  renderProjectList();
}

async function loadDashMetrics(){
  if(!currentOrg) return;
  // Active projects
  const active = projectsCache.filter(p=>p.status==='active').length;
  const done = projectsCache.filter(p=>p.status==='completed').length;
  const elA = document.getElementById('dash-active');
  const elD = document.getElementById('dash-done');
  const elT = document.getElementById('dash-tokens');
  const elC = document.getElementById('dash-cost');
  if(elA) elA.textContent = active;
  if(elD) elD.textContent = done;
  if(elT) elT.textContent = formatTokens(currentOrg.tokens_balance||0);
  // Monthly cost from history
  try{
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const hist = await dbGet('translation_history',
      `?${orgParam()}&created_at=gte.${monthStart}&select=cost_pln`);
    const total = hist.reduce((a,h)=>a+Number(h.cost_pln||0),0);
    if(elC) elC.textContent = Math.round(total)+' kr.';
  }catch(e){}

  // Show translator token limit bar
  if(currentRole === 'translator'){
    const members = await dbGet('organization_members',
      `?user_id=eq.${currentUser.id}&organization_id=eq.${currentOrg.id}`);
    const m = members[0];
    const bar = document.getElementById('proj-token-bar');
    const fill = document.getElementById('tlb-fill');
    const val = document.getElementById('tlb-val');
    if(bar && m){
      if(m.monthly_token_limit){
        bar.style.display='flex';
        const pct = Math.min(100, Math.round((m.tokens_used_this_month||0)/m.monthly_token_limit*100));
        if(fill){fill.style.width=pct+'%';fill.style.background=pct>90?'#b32424':'#2451b3';}
        if(val) val.textContent=`${formatTokens(m.tokens_used_this_month||0)} / ${formatTokens(m.monthly_token_limit)}`;
      }
    }
    // Hide admin metrics
    const metrics = document.getElementById('proj-metrics');
    if(metrics) metrics.style.display='none';
  }
}