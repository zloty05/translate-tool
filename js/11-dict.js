// ══════════════════════════════════════════════════════════
// DICTIONARY
// ══════════════════════════════════════════════════════════
async function loadDictCache(){
  if(!currentOrg)return;
  const data=await dbGet('dictionary',`?${orgParam()}&order=created_at.asc`);
  dictCache=data;document.getElementById('dict-count').textContent=dictCache.length;
}
function buildDictNewRow(){document.getElementById('dict-new-langs').innerHTML=PRIMARY.map(l=>`<div><label>${l.flag} ${l.label}</label><input type="text" class="dict-new-lang" data-lang="${l.code}" placeholder="Tłumaczenie..." /></div>`).join('');}
function buildDictLangFilter(){const sel=document.getElementById('dict-filter-lang');sel.innerHTML='<option value="all">Wszystkie</option>'+PRIMARY.map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('')+'<option value="missing">⚠ Brakujące</option>';}

async function addDictEntry(){
  if(!currentOrg)return;
  const src=document.getElementById('dict-src').value.trim();const note=document.getElementById('dict-note').value.trim();
  if(!src){alert('Wpisz termin.');return;}
  if(dictCache.find(e=>e.src.toLowerCase()===src.toLowerCase())){alert('Termin już istnieje.');return;}
  const translations={};document.querySelectorAll('.dict-new-lang').forEach(inp=>{const v=inp.value.trim();if(v)translations[inp.dataset.lang]=v;});
  const[row]=await dbPost('dictionary',{src,note,translations,organization_id:currentOrg.id});
  dictCache.push(row);document.getElementById('dict-src').value='';document.getElementById('dict-note').value='';
  document.querySelectorAll('.dict-new-lang').forEach(inp=>inp.value='');
  document.getElementById('dict-count').textContent=dictCache.length;renderDict();
}
let _dictModalEditId=null;
function openDictModal(entryId=null){
  _dictModalEditId=entryId;
  document.getElementById('dict-modal-title').textContent=entryId?'Edytuj termin':'Dodaj termin';
  buildDictNewRow();
  document.getElementById('dict-src').value='';
  document.getElementById('dict-note').value='';
  if(entryId){
    const e=dictCache.find(x=>x.id===entryId);
    if(e){
      document.getElementById('dict-src').value=e.src||'';
      document.getElementById('dict-note').value=e.note||'';
      PRIMARY.forEach(l=>{const inp=document.querySelector(`#dict-new-langs [data-lang="${l.code}"]`);if(inp)inp.value=e.translations?.[l.code]||'';});
    }
  }
  document.getElementById('dict-modal').style.display='flex';
  setTimeout(()=>document.getElementById('dict-src').focus(),50);
}
function closeDictModal(){
  document.getElementById('dict-modal').style.display='none';
  _dictModalEditId=null;
}
async function saveDictModal(){
  const btn=document.getElementById('dict-modal-save');
  btn.disabled=true;btn.textContent='Zapisywanie...';
  try{
    if(_dictModalEditId){
      const src=document.getElementById('dict-src').value.trim();
      const note=document.getElementById('dict-note').value.trim();
      const translations={};document.querySelectorAll('.dict-new-lang').forEach(inp=>{const v=inp.value.trim();if(v)translations[inp.dataset.lang]=v;});
      const e=dictCache.find(x=>x.id===_dictModalEditId);
      if(e){e.src=src;e.note=note;e.translations=translations;}
      await dbPatch('dictionary',{src,note,translations},`?id=eq.${_dictModalEditId}`);
      renderDict();
      closeDictModal();
    } else {
      await addDictEntry();
      if(!document.getElementById('dict-src').value.trim())closeDictModal();
    }
  }finally{btn.disabled=false;btn.textContent='Zapisz';}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('dict-modal')?.style.display!=='none')closeDictModal();});
async function deleteDict(id){await dbDelete('dictionary',`?id=eq.${id}`);dictCache=dictCache.filter(e=>e.id!==id);document.getElementById('dict-count').textContent=dictCache.length;renderDict();}
async function updateDictCell(id,lang,val){const e=dictCache.find(e=>e.id===id);if(!e)return;e.translations={...e.translations,[lang]:val};await dbPatch('dictionary',{translations:e.translations},`?id=eq.${id}`);}
async function updateDictNote(id,val){const e=dictCache.find(e=>e.id===id);if(!e)return;e.note=val;await dbPatch('dictionary',{note:val},`?id=eq.${id}`);}
async function updateDictSrc(id,val){const e=dictCache.find(e=>e.id===id);if(!e||!val.trim())return;e.src=val.trim();await dbPatch('dictionary',{src:val.trim()},`?id=eq.${id}`);}

function renderDict(){
  document.getElementById('dict-count').textContent=dictCache.length;
  const ft=(document.getElementById('dict-filter')?.value||'').toLowerCase();
  const fl=document.getElementById('dict-filter-lang')?.value||'all';
  let filtered=dictCache.filter(e=>{
    if(ft&&!e.src.toLowerCase().includes(ft)&&!Object.values(e.translations||{}).some(v=>v.toLowerCase().includes(ft)))return false;
    if(fl==='missing')return PRIMARY.some(l=>!e.translations?.[l.code]);
    if(fl!=='all')return!e.translations?.[fl];
    return true;
  });
  const canEdit=currentRole!=='viewer';
  document.getElementById('dict-thead').innerHTML='<tr><th style="min-width:150px;">Termin PL</th>'+PRIMARY.map(l=>`<th style="min-width:110px;">${l.flag} ${l.label}</th>`).join('')+'<th style="min-width:100px;">Uwaga</th>'+(canEdit?'<th style="width:70px;"></th>':'')+'</tr>';
  const tbody=document.getElementById('dict-tbody');
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="${PRIMARY.length+(canEdit?3:2)}" style="padding:18px;text-align:center;color:#ccc;font-size:12px;">Brak wpisów w słowniku</td></tr>`;return;}
  tbody.innerHTML=filtered.map(e=>{
    const cells=PRIMARY.map(l=>{const v=e.translations?.[l.code]||'';return`<td style="padding:4px 5px;"><span style="font-size:12px;color:${v?'inherit':'#ddd'}">${v?esc(v):'—'}</span></td>`;}).join('');
    const noteTxt=e.note?`<span style="font-size:11px;color:#aaa;">${esc(e.note)}</span>`:'';
    return`<tr>
      <td style="padding:4px 8px;font-weight:600;font-size:13px;">${esc(e.src)}</td>
      ${cells}
      <td style="padding:4px 5px;">${noteTxt}</td>
      ${canEdit?`<td style="padding:2px 5px;white-space:nowrap;">
        <button class="btn btn-sm" style="padding:2px 7px;font-size:11px;" onclick="openDictModal('${e.id}')">✏️</button>
        <button class="del-btn" onclick="deleteDict('${e.id}')">×</button>
      </td>`:''}
    </tr>`;
  }).join('');
}

function buildDictPromptForChunk(lang, chunkTexts, sourceLang){
  const d=dictCache.filter(e=>e.translations?.[lang]);
  if(!d.length)return'';
  const combined=chunkTexts.length?chunkTexts.join(' ').toLowerCase():'';

  // Determine source term field based on sourceLang
  // If sourceLang is PL (or undefined) → use e.src
  // Otherwise → use e.translations[sourceLang]
  const isPL=!sourceLang||sourceLang.toLowerCase().includes('pol')||sourceLang.toLowerCase()==='pl';
  const slang=isPL?'pl':'en';

  const getTermSrc=e=>isPL?e.src:(e.translations?.[sourceLang]||e.src);

  const relevant=combined?d.filter(e=>{
    const termSrc=getTermSrc(e);
    if(!termSrc)return false;
    const termLower=termSrc.toLowerCase();
    if(combined.includes(termLower))return true;
    const words=termLower.split(' ').filter(w=>w.length>3);
    if(!words.length)return false;
    return words.every(w=>{
      const stem=getWordStem(w,slang);
      return combined.includes(stem);
    });
  }):d;
  if(!relevant.length)return'';
  // Show source term in source language for Claude
  return'\n\nSłownik terminologii — stosuj obowiązkowo:\n'+
    relevant.map(e=>`  "${getTermSrc(e)}" → "${e.translations[lang]}"${e.note?' ('+e.note+')':''}`).join('\n');
}

// Wrapper for backward compatibility (no sourceLang = assume PL)
function buildDictPrompt(lang){return buildDictPromptForChunk(lang,[],'Polish');}
function buildDictPrompt(lang){return buildDictPromptForChunk(lang,[]);}

function exportDictExcel(){
  if(!dictCache.length){alert('Słownik jest pusty.');return;}
  const hdr=['Termin PL',...PRIMARY.map(l=>l.label),'Uwaga'];
  const rows=[hdr,...dictCache.map(e=>[e.src,...PRIMARY.map(l=>e.translations?.[l.code]||''),e.note||''])];
  const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:28},...PRIMARY.map(()=>({wch:22})),{wch:28}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Słownik');XLSX.writeFile(wb,'slownik.xlsx');
}
async function importDictExcel(e){
  const f=e.target.files[0];if(!f)return;
  const buf=await readFile(f,'array');const wb=XLSX.read(buf,{type:'array'});
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
  const hdr=rows[0]||[];const colMap={};PRIMARY.forEach(l=>{const i=hdr.findIndex(h=>String(h).includes(l.label));if(i>=0)colMap[l.code]=i;});
  const toAdd=[];rows.slice(1).forEach(row=>{const src=String(row[0]||'').trim();if(!src||dictCache.find(e=>e.src.toLowerCase()===src.toLowerCase()))return;const tr={};Object.entries(colMap).forEach(([lang,i])=>{const v=String(row[i]||'').trim();if(v)tr[lang]=v;});toAdd.push({src,note:String(row[hdr.length-1]||'').trim(),translations:tr,organization_id:currentOrg.id});});
  if(toAdd.length){const res=await dbPost('dictionary',toAdd);dictCache.push(...res);}
  renderDict();alert('Zaimportowano '+toAdd.length+' wpisów.');e.target.value='';
}
function exportDictJSON(){download(JSON.stringify(dictCache,null,2),'slownik.json','application/json');}
async function importDictJSON(e){const f=e.target.files[0];if(!f)return;const data=JSON.parse(await readFile(f));const toAdd=data.filter(x=>!dictCache.find(y=>y.src.toLowerCase()===x.src.toLowerCase())).map(x=>({src:x.src,note:x.note||'',translations:x.translations||{},organization_id:currentOrg.id}));if(toAdd.length){const res=await dbPost('dictionary',toAdd);dictCache.push(...res);}renderDict();alert('Zaimportowano.');e.target.value='';}
async function clearDict(){if(!confirm('Wyczyścić słownik?'))return;await dbDelete('dictionary',`?${orgParam()}`);dictCache=[];renderDict();}
async function fillDictWithAI(){
  const toFill=[];
  const enKey='English'; // Use EN as source for non-PL languages
  dictCache.forEach(entry=>PRIMARY.forEach(l=>{
    if(l.code===enKey) {
      // EN: translate from PL source
      if(!entry.translations?.[l.code]) toFill.push({id:entry.id,src:entry.src,lang:l.code,note:entry.note||'',srcLang:'Polish'});
    } else {
      // Other languages: translate from EN if available, fallback to PL
      const enTerm=entry.translations?.[enKey];
      if(!entry.translations?.[l.code]) toFill.push({
        id:entry.id,
        src:enTerm||entry.src,
        lang:l.code,
        note:entry.note||'',
        srcLang:enTerm?'English':'Polish'
      });
    }
  }));
  if(!toFill.length){alert('Brak brakujących tłumaczeń.');return;}
  if(!confirm(`Uzupełnić ${toFill.length} brakujących tłumaczeń AI?\n\nTo może chwilę potrwać.`)) return;

  // Show progress in dict filter row
  const statusEl=document.createElement('div');
  statusEl.id='dict-ai-status';
  statusEl.style.cssText='font-size:12px;color:#888;margin-bottom:8px;';
  const progressWrap=document.createElement('div');
  progressWrap.style.cssText='height:4px;background:#eee;border-radius:2px;overflow:hidden;margin-bottom:10px;';
  const progressBar=document.createElement('div');
  progressBar.style.cssText='height:100%;background:#2a8a4a;border-radius:2px;transition:width .2s;width:0%;';
  progressWrap.appendChild(progressBar);
  const filterRow=document.querySelector('#tab-dict .filter-row');
  if(filterRow){filterRow.before(statusEl);filterRow.before(progressWrap);}

  const setStatus=(msg,pct)=>{
    if(statusEl) statusEl.textContent=msg;
    if(progressBar) progressBar.style.width=pct+'%';
  };

  const CHUNK=15; // smaller chunks = fewer missing
  const failed=[];
  let done=0;

  for(let i=0;i<toFill.length;i+=CHUNK){
    const chunk=toFill.slice(i,i+CHUNK);
    setStatus(`⏳ Uzupełnianie: ${done}/${toFill.length} terminów...`, Math.round(done/toFill.length*100));

    const prompt=`Przetłumacz terminy słownikowe na podane języki. Termin źródłowy jest w języku wskazanym przez srcLang.\nWAŻNE: Odpowiedz dla KAŻDEGO podanego elementu.\nTYLKO JSON: [{"id":"...","lang":"...","translation":"..."}]. Bez markdown, bez preambuły.\n\nTerminy:\n${JSON.stringify(chunk.map(t=>({id:t.id,src:t.src,srcLang:t.srcLang||'Polish',lang:t.lang,note:t.note})))}`;

    try{
      const raw=(await apiCall(prompt)).replace(/\`\`\`json|\`\`\`/g,'').trim();
      const res=JSON.parse(raw);
      const returnedIds=new Set(res.map(r=>r.id+'__'+r.lang));
      // Track missing
      chunk.forEach(t=>{if(!returnedIds.has(t.id+'__'+t.lang)) failed.push(t);});
      // Save returned
      for(const r of res){
        if(!r.translation) continue;
        const entry=dictCache.find(e=>e.id===r.id);
        if(!entry) continue;
        entry.translations={...entry.translations,[r.lang]:r.translation};
        await dbPatch('dictionary',{translations:entry.translations},`?id=eq.${r.id}`);
      }
    }catch(err){
      console.error('Dict AI chunk error:',err);
      failed.push(...chunk);
    }
    done+=chunk.length;
    await sleep(200);
  }

  // Retry failed one by one
  if(failed.length){
    setStatus(`⏳ Ponawiam ${failed.length} brakujących...`, 90);
    for(const t of failed){
      const prompt=`Przetłumacz termin "${t.src}" na język ${t.lang}${t.note?' (kontekst: '+t.note+')':''}. Odpowiedz TYLKO JSON: {"translation":"..."}`;
      try{
        const raw=(await apiCall(prompt)).replace(/\`\`\`json|\`\`\`/g,'').trim();
        const res=JSON.parse(raw);
        const tText=res.translation||'';
        if(!tText) continue;
        const entry=dictCache.find(e=>e.id===t.id);
        if(!entry) continue;
        entry.translations={...entry.translations,[t.lang]:tText};
        await dbPatch('dictionary',{translations:entry.translations},`?id=eq.${t.id}`);
      }catch(err){console.error('Dict retry error:',err);}
      await sleep(150);
    }
  }

  // Cleanup progress UI
  statusEl?.remove();
  progressWrap?.remove();
  renderDict();
  alert(`Uzupełniono! ${toFill.length-failed.length}/${toFill.length} tłumaczeń.`);
}