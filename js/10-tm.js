// ══════════════════════════════════════════════════════════
// TRANSLATION MEMORY
// ══════════════════════════════════════════════════════════
async function loadTMCache(){ await updateTMUI(); }

function tmKey(t){return t.trim().toLowerCase().replace(/\s+/g,' ');}

function lookupTM(src,lang){
  const k=tmKey(src);
  return tmCache.find(e=>e.key===k&&e.lang===lang)?.target||null;
}

async function lookupTMBatch(sources,lang){
  if(!currentOrg||!sources.length) return {};
  try{
    const keys=sources.map(s=>tmKey(s));
    const{data,error}=await supa.rpc('lookup_tm_batch',{org_id:currentOrg.id,source_keys:keys,target_lang:lang});
    if(error) throw error;
    const map={};
    (data||[]).forEach(r=>{ map[r.key]=r.target; });
    return map;
  }catch(e){console.error('TM batch error:',e);return{};}
}


async function pushTMBatch(pairs,lang,source){
  if(!currentOrg||!pairs.length)return;
  const rows=[];
  pairs.forEach(({src,tgt})=>{
    if(!src?.trim()||!tgt?.trim()) return;
    const k=tmKey(src);
    rows.push({key:k,source:src,target:tgt,lang,src:source,organization_id:currentOrg.id});
    const cached=tmCache.find(e=>e.key===k&&e.lang===lang);
    if(cached) cached.target=tgt;
    else{if(tmCache.length>1000)tmCache.shift();tmCache.push({key:k,source:src,target:tgt,lang,organization_id:currentOrg.id});}
  });
  if(!rows.length)return;
  try{
    await dbUpsert('translation_memory',rows,'key,lang,organization_id');
    updateTMUI();
  }catch(e){}
}

async function updateTMUI(){
  document.getElementById('tm-saved-count').textContent=tmApiSaved;
  if(!currentOrg) return;
  try{
    const{data}=await supa.rpc('get_tm_stats',{org_id:currentOrg.id});
    if(!data) return;
    const total=data.total||0;
    const langs=data.langs_list||[];
    document.getElementById('tm-count').textContent=total;
    document.getElementById('tm-total').textContent=total;
    document.getElementById('tm-langs-count').textContent=data.langs||0;
    const sel=document.getElementById('tm-filter-lang');const cur=sel?.value;
    if(sel) sel.innerHTML='<option value="all">Wszystkie języki</option>'+langs.map(l=>`<option value="${esc(l)}"${l===cur?' selected':''}>${esc(l)}</option>`).join('');
  }catch(e){console.error('TM stats error:',e);}
}

async function renderTMList(){
  if(!currentOrg) return;
  const ft=(document.getElementById('tm-filter')?.value||'').toLowerCase();
  const fl=document.getElementById('tm-filter-lang')?.value||'all';
  const fs=document.getElementById('tm-filter-src')?.value||'all';
  const list=document.getElementById('tm-list');
  list.innerHTML='<div style="padding:16px;text-align:center;color:#aaa;font-size:12px;"><div class="spinner" style="margin:0 auto 8px;"></div>Ładowanie...</div>';
  try{
    let params=`?${orgParam()}&order=created_at.desc&limit=200`;
    if(fl!=='all') params+=`&lang=eq.${encodeURIComponent(fl)}`;
    if(fs!=='all') params+=`&src=eq.${fs}`;
    let data=await dbGet('translation_memory',params);
    if(ft) data=data.filter(e=>e.source.toLowerCase().includes(ft)||e.target.toLowerCase().includes(ft));
    if(!data.length){list.innerHTML='<div style="padding:20px;text-align:center;color:#ccc;font-size:12px;">Brak wpisów</div>';return;}
    list.innerHTML=data.map(e=>`
      <div class="tm-row" id="tmrow-${e.id}">
        <div class="tm-col">${esc(e.source)}</div>
        <div class="tm-col" id="tmtgt-${e.id}">
          <span class="tm-tgt-text" data-tm-edit="${e.id}" title="Kliknij aby edytować" style="cursor:pointer;">${esc(e.target)}</span>
        </div>
        <div class="tm-col"><span class="badge b-gray" style="font-size:10px;">${esc(e.lang.substring(0,8))}</span></div>
        <div class="tm-col"><span class="badge ${e.src==='pptx'?'b-orange':'b-blue'}" style="font-size:10px;">${esc(e.src||'xliff')}</span></div>
        <div class="tm-col" style="text-align:right;">
          <button class="btn btn-sm" data-tm-edit="${e.id}" style="padding:2px 7px;font-size:10px;" title="Edytuj">✏️</button>
          <button class="btn btn-sm" data-tm-delete="${e.id}" style="padding:2px 7px;font-size:10px;color:#b32424;" title="Usuń">×</button>
        </div>
      </div>`).join('');
  }catch(e){list.innerHTML='<div style="padding:16px;text-align:center;color:#b32424;font-size:12px;">Błąd ładowania</div>';}
}

async function editTMEntry(id){
  const tgtEl=document.getElementById('tmtgt-'+id);
  if(!tgtEl) return;
  const currentText=tgtEl.querySelector('.tm-tgt-text')?.textContent||'';
  tgtEl.innerHTML=`
    <div style="display:flex;gap:4px;align-items:center;">
      <input id="tmedit-${id}" class="seg-textarea" value="${esc(currentText)}" style="flex:1;padding:3px 6px;font-size:12px;min-height:unset;" />
      <button class="btn btn-dark btn-sm" data-tm-save="${id}" style="padding:3px 8px;font-size:11px;">✓</button>
      <button class="btn btn-sm" data-tm-cancel="${id}" data-tm-original="${esc(currentText)}" style="padding:3px 8px;font-size:11px;">✕</button>
    </div>`;
  document.getElementById('tmedit-'+id)?.focus();
}

function cancelTMEdit(id, originalText){
  const tgtEl=document.getElementById('tmtgt-'+id);
  if(tgtEl) tgtEl.innerHTML=`<span class="tm-tgt-text" data-tm-edit="${id}" title="Kliknij aby edytować" style="cursor:pointer;">${esc(originalText)}</span>`;
}

async function saveTMEntry(id){
  const input=document.getElementById('tmedit-'+id);
  if(!input) return;
  const newText=input.value.trim();
  if(!newText){ alert('Tłumaczenie nie może być puste.'); return; }
  try{
    await dbPatch('translation_memory',{target:newText},`?id=eq.${id}`);
    // Also update tmCache
    const entry=tmCache.find(e=>e.id===id);
    if(entry) entry.target=newText;
    const tgtEl=document.getElementById('tmtgt-'+id);
    if(tgtEl) tgtEl.innerHTML=`<span class="tm-tgt-text" onclick="editTMEntry('${id}')" title="Kliknij aby edytować" style="cursor:pointer;">${esc(newText)}</span>`;
    setDbStatus(true);
  }catch(e){ alert('Błąd zapisu: '+e.message); }
}

async function deleteTMEntry(id, preview){
  if(!confirm(`Usunąć wpis TM:\n"${preview}..."?`)) return;
  try{
    await dbDelete('translation_memory',`?id=eq.${id}`);
    tmCache=tmCache.filter(e=>e.id!==id);
    document.getElementById('tmrow-'+id)?.remove();
    await updateTMUI();
  }catch(e){ alert('Błąd usuwania: '+e.message); }
}


async function importTM(e){
  const f=e.target.files[0];if(!f)return;
  const data=JSON.parse(await readFile(f));
  const toIns=data.filter(x=>!tmCache.find(y=>y.key===x.key&&y.lang===x.lang)).map(x=>({...x,organization_id:currentOrg.id}));
  if(toIns.length){await dbPost('translation_memory',toIns);await loadTMCache();}
  alert('Zaimportowano '+toIns.length+' wpisów.');e.target.value='';
}
async function clearTM(){
  if(!confirm('Wyczyścić całą pamięć TM?'))return;
  await dbDelete('translation_memory',`?${orgParam()}`);
  tmCache=[];updateTMUI();renderTMList();
}

function applyTMToSegs(segs,lang){return 0;} // stub — use applyTMToSegsAsync

async function applyTMToSegsAsync(segs,lang){
  if(!segs.length) return 0;
  // Collect all source texts for batch lookup
  const sources=[];
  segs.forEach(seg=>{
    if(seg.status==='done') return;
    if(seg.type==='plain') sources.push(seg.source);
    else seg.textNodes.forEach(n=>{if(n.text.trim()) sources.push(n.text);});
  });
  if(!sources.length) return 0;

  // Single batch query to DB
  const tmMap=await lookupTMBatch([...new Set(sources)],lang);
  if(!Object.keys(tmMap).length) return 0;

  let hits=0;
  segs.forEach(seg=>{
    if(seg.status==='done') return;
    if(seg.type==='plain'){
      const f=tmMap[tmKey(seg.source)];
      if(f){seg.target=f;seg.status='done';seg.fromTM=true;hits++;tmApiSaved++;}
    } else {
      let any=false;
      seg.textNodes.forEach((n,i)=>{
        if(!seg.targets[i].text.trim()){
          const f=tmMap[tmKey(n.text)];
          if(f){seg.targets[i].text=f;any=true;}
        }
      });
      if(any&&seg.targets.every(t=>t.text.trim())){seg.status='done';seg.fromTM=true;hits++;tmApiSaved++;}
    }
  });
  updateTMUI();
  return hits;
}

// Event delegation for TM list
document.addEventListener('click',(e)=>{
  const tmEdit=e.target.closest('[data-tm-edit]');
  if(tmEdit){
    e.preventDefault();
    editTMEntry(tmEdit.dataset.tmEdit);
    return;
  }
  const tmDel=e.target.closest('[data-tm-delete]');
  if(tmDel){
    e.preventDefault();
    const id=tmDel.dataset.tmDelete;
    const entry=tmCache.find(x=>x.id===id);
    const preview=entry?entry.source.substring(0,30):'...';
    deleteTMEntry(id,preview);
    return;
  }
  const tmSave=e.target.closest('[data-tm-save]');
  if(tmSave){
    e.preventDefault();
    saveTMEntry(tmSave.dataset.tmSave);
    return;
  }
  const tmCancel=e.target.closest('[data-tm-cancel]');
  if(tmCancel){
    e.preventDefault();
    cancelTMEdit(tmCancel.dataset.tmCancel,tmCancel.dataset.tmOriginal);
    return;
  }
});
