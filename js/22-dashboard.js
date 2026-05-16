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
    // Admin metrics removed (now in top bar)
  }
}