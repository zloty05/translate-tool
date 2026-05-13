// ══════════════════════════════════════════════════════════
// HISTORIA
// ══════════════════════════════════════════════════════════
async function loadHistory(){
  if(!currentOrg)return;
  document.getElementById('hist-loading').style.display='flex';
  document.getElementById('hist-list').innerHTML='';
  try{histCache=await dbGet('translation_history',`?${orgParam()}&order=created_at.desc&limit=200`);renderHistory();}
  catch(e){document.getElementById('hist-list').innerHTML='<div class="hist-empty">Błąd ładowania</div>';}
  document.getElementById('hist-loading').style.display='none';
}

function renderHistory(){
  const ft=(document.getElementById('hist-filter')?.value||'').toLowerCase();
  const ftype=document.getElementById('hist-ftype')?.value||'all';
  const flang=document.getElementById('hist-flang')?.value||'all';
  let data=histCache;
  if(ft)data=data.filter(h=>h.filename.toLowerCase().includes(ft));
  if(ftype!=='all')data=data.filter(h=>h.filetype===ftype);
  if(flang!=='all')data=data.filter(h=>h.lang===flang);
  const totalCost=histCache.reduce((a,h)=>a+Number(h.cost_pln||0),0);
  const totalTM=histCache.reduce((a,h)=>a+Number(h.segments_from_tm||0),0);
  document.getElementById('hist-count').textContent=histCache.length;
  document.getElementById('hist-total').textContent=histCache.length;
  document.getElementById('hist-xliff-c').textContent=histCache.filter(h=>h.filetype==='xliff').length;
  document.getElementById('hist-pptx-c').textContent=histCache.filter(h=>h.filetype==='pptx').length;
  document.getElementById('hist-cost-total').textContent=Math.round(totalCost);
  document.getElementById('hist-tm-total').textContent=totalTM;
  const langs=[...new Set(histCache.map(h=>h.lang))];
  const lsel=document.getElementById('hist-flang');const lcur=lsel.value;
  lsel.innerHTML='<option value="all">Wszystkie języki</option>'+langs.map(l=>`<option value="${esc(l)}"${l===lcur?' selected':''}>${esc(l)}</option>`).join('');
  const list=document.getElementById('hist-list');
  if(!data.length){list.innerHTML='<div class="hist-empty">Brak historii</div>';return;}
  list.innerHTML=`<div class="hist-thead" style="border-left:3px solid transparent;"><div class="hist-th">Plik</div><div class="hist-th">Typ</div><div class="hist-th">Język</div><div class="hist-th">Segmenty</div><div class="hist-th">Koszt</div><div class="hist-th">Status</div><div class="hist-th">Data</div></div>`+
    data.map(h=>`<div class="hist-row type-${h.filetype||'xliff'}">
      <div class="hist-col" title="${esc(h.filename)}" style="font-weight:500;">${esc(h.filename)}</div>
      <div class="hist-col"><span class="ft-${h.filetype}">${(h.filetype||'').toUpperCase()}</span></div>
      <div class="hist-col">${esc(h.lang)}</div>
      <div class="hist-col"><span style="font-weight:600;">${h.segments_done||0}</span><span style="color:#aaa;">/${h.segments_total||0}</span>${h.segments_from_tm>0?` <span style="color:#6b21a8;font-size:10px;">+${h.segments_from_tm}TM</span>`:''}</div>
      <div class="hist-col"><strong>${Math.round(h.cost_pln||0)}</strong><span style="color:#aaa;font-size:11px;"> kr.</span></div>
      <div class="hist-col">${h.status==='completed'?'<span class="hist-pill-done">✓ Ukończone</span>':'<span class="hist-pill-prog">W toku</span>'}</div>
      <div class="hist-col" style="color:#aaa;font-size:11px;">${fmtDate(h.created_at)}</div>
    </div>`).join('');
}

async function createHistoryEntry(filename,filetype,lang,total,fromTM){
  if(!currentOrg)return null;
  try{const[row]=await dbPost('translation_history',{filename,filetype,lang,segments_total:total,segments_done:0,segments_from_tm:fromTM,cost_usd:0,cost_pln:0,status:'in_progress',organization_id:currentOrg.id,user_id:currentUser.id});return row.id;}
  catch(e){console.error(e);return null;}
}
async function updateHistoryEntry(id,done,fromTM,costUsd,costPln){
  if(!id)return;
  try{await dbPatch('translation_history',{segments_done:done,segments_from_tm:fromTM,cost_usd:costUsd,cost_pln:costPln,status:'completed'},`?id=eq.${id}`);}
  catch(e){console.error(e);}
}