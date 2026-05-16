// ══════════════════════════════════════════════════════════
// STATYSTYKI
// ══════════════════════════════════════════════════════════
async function loadStats(){
  if(!currentOrg) return;
  document.getElementById('stats-loading').style.display='flex';
  try{
    const [txs, tmData, corrections] = await Promise.all([
      dbGet('token_transactions',`?organization_id=eq.${currentOrg.id}&order=created_at.desc&limit=500`),
      supa.rpc('get_tm_stats',{org_id:currentOrg.id}),
      projectsCache.length
        ? dbGet('project_segments',`?project_id=in.(${projectsCache.map(p=>p.id).join(',')})&ai_translation=not.is.null&select=project_id,manually_edited`)
        : Promise.resolve([])
    ]);
    renderStats(txs, tmData?.data||null, corrections);
  }catch(e){ console.error('Stats error:',e); }
  document.getElementById('stats-loading').style.display='none';
}

function renderStats(txs, tmData, corrections){
  // ── FINANSE ──
  const usageTxs=txs.filter(t=>t.type==='usage');
  const totalSpent=usageTxs.reduce((a,t)=>a+Math.abs(t.tokens||0),0);
  const avgCost=usageTxs.length ? Math.round(totalSpent/usageTxs.length*10)/10 : 0;

  const now=new Date();
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
  const monthSpent=usageTxs
    .filter(t=>new Date(t.created_at)>=monthStart)
    .reduce((a,t)=>a+Math.abs(t.tokens||0),0);

  document.getElementById('stats-balance').textContent=formatTokens(currentOrg?.tokens_balance||0);
  document.getElementById('stats-spent-total').textContent=totalSpent.toLocaleString('pl-PL');
  document.getElementById('stats-spent-month').textContent=monthSpent.toLocaleString('pl-PL');
  document.getElementById('stats-avg-cost').textContent=avgCost>0 ? avgCost+' kr.' : '—';
  document.getElementById('stats-translations-count').textContent=usageTxs.length;

  // ── PAMIĘĆ TM ──
  const tmTotal=tmData?.total||0;
  const tmLangs=tmData?.langs||0;
  document.getElementById('stats-tm-total').textContent=tmTotal.toLocaleString('pl-PL');
  document.getElementById('stats-tm-langs').textContent=tmLangs;
  document.getElementById('stats-tm-savings').textContent=tmTotal>0 ? '~'+tmTotal.toLocaleString('pl-PL')+' kr.' : '—';

  // ── JAKOŚĆ AI ──
  const aiSection=document.getElementById('stats-ai-section');
  if(!corrections||!corrections.length){ aiSection.style.display='none'; return; }
  aiSection.style.display='block';

  const totalAI=corrections.length;
  const totalEdited=corrections.filter(c=>c.manually_edited).length;
  const pctGlobal=totalAI>0 ? Math.round(totalEdited/totalAI*100) : 0;

  document.getElementById('stats-ai-pct').textContent=pctGlobal+'%';
  document.getElementById('stats-ai-desc').textContent=
    `${totalEdited.toLocaleString('pl-PL')} z ${totalAI.toLocaleString('pl-PL')} segmentów AI zostało poprawionych przez tłumaczy`;

  // per-projekt
  const byProject={};
  corrections.forEach(c=>{
    if(!byProject[c.project_id]) byProject[c.project_id]={total:0,edited:0};
    byProject[c.project_id].total++;
    if(c.manually_edited) byProject[c.project_id].edited++;
  });

  const rows=Object.entries(byProject).map(([pid,d])=>{
    const proj=projectsCache.find(p=>p.id===pid);
    const name=proj?.name||'Projekt';
    const pct=d.total>0 ? Math.round(d.edited/d.total*100) : 0;
    const color=pct>=50?'#b32424':pct>=20?'#c97a00':'#2a7a2a';
    return `<tr>
      <td style="font-weight:500;">${esc(name)}</td>
      <td style="text-align:center;">${d.total}</td>
      <td style="text-align:center;">${d.edited}</td>
      <td style="text-align:center;font-weight:700;color:${color};">${pct}%</td>
    </tr>`;
  }).join('');

  document.getElementById('stats-ai-table-body').innerHTML=rows||
    '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:12px;">Brak danych</td></tr>';
}

async function createHistoryEntry(filename,fileType,lang,totalSegs,tmSegs){
  if(!currentOrg) return null;
  try{
    const rows=await dbPost('translation_history',{
      organization_id:currentOrg.id,
      filename,
      file_type:fileType,
      target_lang:lang,
      total_segments:totalSegs,
      tm_segments:tmSegs,
      status:'in_progress'
    });
    return rows?.[0]?.id||null;
  }catch(e){console.error('createHistoryEntry:',e);return null;}
}

async function updateHistoryEntry(histId,finalDone,tmCount,creditsUsed,costPln){
  if(!histId) return;
  try{
    await dbPatch('translation_history',{
      translated_segments:finalDone,
      tm_segments:tmCount,
      credits_used:creditsUsed,
      cost_pln:costPln,
      status:'done',
      finished_at:new Date().toISOString()
    },`?id=eq.${histId}`);
  }catch(e){console.error('updateHistoryEntry:',e);}
}
