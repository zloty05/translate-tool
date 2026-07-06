// ══════════════════════════════════════════════════════════
// DICTIONARY
// ══════════════════════════════════════════════════════════
async function loadDictCache(){
  if(!currentOrg)return;
  const data=await dbGet('dictionary',`?${orgParam()}&order=created_at.asc`);
  dictCache=data;document.getElementById('dict-count').textContent=dictCache.length;
  // Potrzebne do myDictLangs() (przypisania języków tłumacza)
  if(!teamMembersCache.length){
    try{ teamMembersCache=await dbGet('organization_members',`?${orgParam()}`); }catch(e){}
  }
}

// Język źródłowy dla danego celu (mapa org lub fallback).
// English tłumaczymy zawsze z PL (src). Dla reszty: mapa dict_source_map,
// a gdy brak wpisu — EN jeśli dostępne w danym terminie, inaczej PL.
function dictSourceLang(targetLang, entry){
  if(targetLang==='English') return 'Polish';
  const mapped=currentOrg?.dict_source_map?.[targetLang];
  if(mapped==='Polish'||mapped==='English') return mapped;
  if(entry) return entry.translations?.English ? 'English' : 'Polish';
  return 'English';
}
// Tekst źródłowy wpisu w danym języku źródłowym.
function dictSourceText(entry, srcLang){
  return srcLang==='Polish' ? (entry.src||'') : (entry.translations?.[srcLang]||'');
}
// Języki PRIMARY przypisane zalogowanemu tłumaczowi.
function myDictLangs(){
  const langs=teamMembersCache.find(m=>m.user_id===currentUser?.id)?.languages||[];
  return PRIMARY.filter(l=>langs.includes(l.code));
}
// Tryb edycji całego słownika (admin) — przełącznik inline.
let dictEditMode=false;
function toggleDictEditMode(){ dictEditMode=document.getElementById('dict-edit-mode')?.checked||false; renderDict(); }

// Panel mapy źródeł (admin): dla każdego celu ≠ EN wybór PL/EN.
function buildDictSourceMap(){
  const body=document.getElementById('dict-srcmap-body');
  if(!body||currentRole!=='admin')return;
  const map=currentOrg?.dict_source_map||{};
  body.innerHTML=PRIMARY.filter(l=>l.code!=='English').map(l=>{
    const cur=map[l.code]||dictSourceLang(l.code); // domyślne wg fallbacku
    return`<div class="dict-srcmap-row">
      <span>${l.flag} ${l.label}</span>
      <select onchange="saveDictSourceMap('${l.code}',this.value)">
        <option value="Polish"${cur==='Polish'?' selected':''}>🇵🇱 z PL</option>
        <option value="English"${cur==='English'?' selected':''}>🇬🇧 z EN</option>
      </select>
    </div>`;
  }).join('');
}
async function saveDictSourceMap(targetLang, srcLang){
  if(!currentOrg)return;
  const map={...(currentOrg.dict_source_map||{}),[targetLang]:srcLang};
  try{
    await dbPatch('organizations',{dict_source_map:map},`?id=eq.${currentOrg.id}`);
    currentOrg.dict_source_map=map;
    renderDict();
  }catch(e){alert('Błąd zapisu mapy źródeł: '+e.message);}
}
function buildDictNewRow(){document.getElementById('dict-new-langs').innerHTML=PRIMARY.map(l=>`<div><label>${l.flag} ${l.label}</label><input type="text" class="dict-new-lang" data-lang="${l.code}" placeholder="Tłumaczenie..." /></div>`).join('');}
function buildDictLangFilter(){const sel=document.getElementById('dict-filter-lang');sel.innerHTML='<option value="all">Wszystkie</option>'+PRIMARY.map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('')+'<option value="missing">⚠ Brakujące</option>';}

async function addDictEntry(){
  if(!currentOrg)return;
  const src=document.getElementById('dict-src').value.trim();const note=document.getElementById('dict-note').value.trim();
  if(!src){alert('Wpisz termin.');return;}
  if(dictCache.find(e=>e.src.toLowerCase()===src.toLowerCase())){alert('Termin już istnieje.');return;}
  const translations={},status={};document.querySelectorAll('.dict-new-lang').forEach(inp=>{const v=inp.value.trim();if(v){translations[inp.dataset.lang]=v;status[inp.dataset.lang]='accepted';}});
  const[row]=await dbPost('dictionary',{src,note,translations,status,organization_id:currentOrg.id});
  dictCache.push(row);document.getElementById('dict-src').value='';document.getElementById('dict-note').value='';
  document.querySelectorAll('.dict-new-lang').forEach(inp=>inp.value='');
  document.getElementById('dict-count').textContent=dictCache.length;renderDict();
}
// Masowe wklejanie listy terminów PL (jeden termin na wiersz).
async function addDictBulk(){
  if(!currentOrg)return;
  const ta=document.getElementById('dict-bulk-input');
  const raw=(ta?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  if(!raw.length){alert('Wklej listę terminów (jeden na wiersz).');return;}
  const seen=new Set();
  const toAdd=[];
  raw.forEach(src=>{
    const key=src.toLowerCase();
    if(seen.has(key))return;
    if(dictCache.find(e=>e.src.toLowerCase()===key))return;
    seen.add(key);
    toAdd.push({src,note:'',translations:{},status:{},organization_id:currentOrg.id});
  });
  if(!toAdd.length){alert('Wszystkie terminy już istnieją.');return;}
  const res=await dbPost('dictionary',toAdd);
  dictCache.push(...res);
  document.getElementById('dict-count').textContent=dictCache.length;
  if(ta)ta.value='';
  renderDict();
  alert(`Dodano ${toAdd.length} terminów. Kliknij ✦ AI, aby je przetłumaczyć.`);
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
      const e=dictCache.find(x=>x.id===_dictModalEditId);
      const translations={},status={...(e?.status||{})};
      document.querySelectorAll('.dict-new-lang').forEach(inp=>{const v=inp.value.trim();if(v){translations[inp.dataset.lang]=v;status[inp.dataset.lang]='accepted';}else{delete status[inp.dataset.lang];}});
      if(e){e.src=src;e.note=note;e.translations=translations;e.status=status;}
      await dbPatch('dictionary',{src,note,translations,status},`?id=eq.${_dictModalEditId}`);
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
async function updateDictCell(id,lang,val){const e=dictCache.find(e=>e.id===id);if(!e)return;e.translations={...e.translations,[lang]:val};const patch={translations:e.translations};if(val.trim()){e.status={...e.status,[lang]:'accepted'};patch.status=e.status;}await dbPatch('dictionary',patch,`?id=eq.${id}`);}
async function updateDictNote(id,val){const e=dictCache.find(e=>e.id===id);if(!e)return;e.note=val;await dbPatch('dictionary',{note:val},`?id=eq.${id}`);}
async function updateDictSrc(id,val){const e=dictCache.find(e=>e.id===id);if(!e||!val.trim())return;e.src=val.trim();await dbPatch('dictionary',{src:val.trim()},`?id=eq.${id}`);}

// Klasa CSS komórki wg statusu tłumaczenia (kolor tła).
function dictCellClass(status){
  if(status==='accepted')return'dict-cell-ok';
  if(status==='ai')return'dict-cell-ai';
  return'';
}
function renderDict(){
  document.getElementById('dict-count').textContent=dictCache.length;
  if(currentRole==='translator'){ renderDictTranslator(); return; }
  // Tryb admin/viewer — ukryj elementy tłumacza
  const trInfo=document.getElementById('dict-translator-info');if(trInfo)trInfo.style.display='none';
  const trLang=document.getElementById('dict-tr-lang');if(trLang)trLang.style.display='none';
  const bothWrap=document.getElementById('dict-show-both-wrap');if(bothWrap)bothWrap.style.display='none';
  const ft=(document.getElementById('dict-filter')?.value||'').toLowerCase();
  const fl=document.getElementById('dict-filter-lang')?.value||'all';
  const fs=document.getElementById('dict-filter-status')?.value||'all'; // all|ai|accepted
  let filtered=dictCache.filter(e=>{
    if(ft&&!e.src.toLowerCase().includes(ft)&&!Object.values(e.translations||{}).some(v=>v.toLowerCase().includes(ft)))return false;
    if(fl==='missing'&&!PRIMARY.some(l=>!e.translations?.[l.code]))return false;
    if(fl!=='all'&&fl!=='missing'&&e.translations?.[fl])return false; // brakujący dany język
    if(fs!=='all'){const langs=fl!=='all'&&fl!=='missing'?[fl]:PRIMARY.map(l=>l.code);if(!langs.some(c=>e.status?.[c]===fs))return false;}
    return true;
  });
  const canEdit=currentRole!=='viewer';
  document.getElementById('dict-thead').innerHTML='<tr><th style="min-width:150px;">Termin PL</th>'+PRIMARY.map(l=>`<th style="min-width:110px;">${l.flag} ${l.label}</th>`).join('')+'<th style="min-width:100px;">Uwaga</th>'+(canEdit?'<th style="width:70px;"></th>':'')+'</tr>';
  const tbody=document.getElementById('dict-tbody');
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="${PRIMARY.length+(canEdit?3:2)}" style="padding:18px;text-align:center;color:#ccc;font-size:12px;">Brak wpisów w słowniku</td></tr>`;return;}
  const editing=canEdit&&dictEditMode;
  tbody.innerHTML=filtered.map(e=>{
    const cells=PRIMARY.map(l=>{const v=e.translations?.[l.code]||'';const cls=dictCellClass(e.status?.[l.code]);
      if(editing)return`<td class="${cls}" style="padding:4px 5px;"><input class="dict-inp ${v?'':'missing'}" value="${esc(v)}" onchange="updateDictCell('${e.id}','${l.code}',this.value)" placeholder="—" /></td>`;
      return`<td class="${cls}" style="padding:4px 5px;"><span style="font-size:12px;color:${v?'inherit':'#ddd'}">${v?esc(v):'—'}</span></td>`;}).join('');
    const noteTxt=e.note?`<span style="font-size:11px;color:#aaa;">${esc(e.note)}</span>`:'';
    return`<tr>
      <td style="padding:4px 8px;font-weight:600;font-size:13px;">${editing?`<input class="dict-inp" value="${esc(e.src)}" onchange="updateDictSrc('${e.id}',this.value)" />`:esc(e.src)}</td>
      ${cells}
      <td style="padding:4px 5px;">${editing?`<input class="dict-inp" value="${esc(e.note||'')}" onchange="updateDictNote('${e.id}',this.value)" placeholder="Uwaga..." />`:noteTxt}</td>
      ${canEdit?`<td style="padding:2px 5px;white-space:nowrap;">
        <button class="btn btn-sm" style="padding:2px 7px;font-size:11px;" onclick="openDictModal('${e.id}')">✏️</button>
        <button class="del-btn" onclick="deleteDict('${e.id}')">×</button>
      </td>`:''}
    </tr>`;
  }).join('');
}

// Widok tłumacza: tylko przypisane języki, kolumna źródłowa + akceptacja.
function renderDictTranslator(){
  const myLangs=myDictLangs();
  const info=document.getElementById('dict-translator-info');
  const thead=document.getElementById('dict-thead');
  const tbody=document.getElementById('dict-tbody');
  if(info)info.style.display='';
  const bothWrap=document.getElementById('dict-show-both-wrap');if(bothWrap)bothWrap.style.display='inline-flex';
  if(!myLangs.length){
    if(info)info.innerHTML='<span style="color:#b32424;">Nie masz przypisanego żadnego języka słownika. Skontaktuj się z adminem.</span>';
    const trLang=document.getElementById('dict-tr-lang');if(trLang)trLang.style.display='none';
    if(bothWrap)bothWrap.style.display='none';
    thead.innerHTML='';tbody.innerHTML='';return;
  }
  // Aktualnie edytowany język (pierwszy z przypisanych lub z selecta)
  const sel=document.getElementById('dict-tr-lang');
  if(sel&&sel.dataset.built!=='1'){
    sel.innerHTML=myLangs.map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('');
    sel.dataset.built='1';
    sel.style.display=myLangs.length>1?'':'none';
  }
  const myLang=(sel&&sel.value)||myLangs[0].code;
  const myLangObj=PRIMARY.find(l=>l.code===myLang);
  const srcLang=dictSourceLang(myLang);
  const srcObj=LANGS.find(l=>l.code===srcLang);
  // Drugie źródło (podgląd) — inny język niż oficjalne źródło
  const showBoth=document.getElementById('dict-show-both')?.checked;
  const otherSrc=srcLang==='Polish'?'English':'Polish';
  const otherObj=LANGS.find(l=>l.code===otherSrc);
  const withPreview=showBoth&&otherSrc!==srcLang;

  if(info)info.innerHTML=`Tłumaczysz: <b>${myLangObj.flag} ${myLangObj.label}</b> &nbsp;·&nbsp; źródło: <b>${srcObj?.flag||''} ${srcObj?.label||srcLang}</b>`;

  const ft=(document.getElementById('dict-filter')?.value||'').toLowerCase();
  const fs=document.getElementById('dict-filter-status')?.value||'all';
  let filtered=dictCache.filter(e=>{
    const srcTxt=dictSourceText(e,srcLang).toLowerCase();
    const myTxt=(e.translations?.[myLang]||'').toLowerCase();
    if(ft&&!srcTxt.includes(ft)&&!myTxt.includes(ft)&&!e.src.toLowerCase().includes(ft))return false;
    if(fs==='ai'&&e.status?.[myLang]!=='ai')return false;
    if(fs==='accepted'&&e.status?.[myLang]!=='accepted')return false;
    // pokazuj tylko wpisy, które mają tekst źródłowy do tłumaczenia
    if(!dictSourceText(e,srcLang))return false;
    return true;
  });
  thead.innerHTML='<tr>'+
    `<th style="min-width:160px;">${srcObj?.flag||''} Źródło (${srcObj?.label||srcLang})</th>`+
    (withPreview?`<th style="min-width:140px;color:#999;">${otherObj?.flag||''} Podgląd (${otherObj?.label||otherSrc})</th>`:'')+
    `<th style="min-width:180px;">${myLangObj.flag} Twoje tłumaczenie</th>`+
    '<th style="min-width:90px;">Uwaga</th>'+
    '<th style="width:120px;">Status</th>'+
    '</tr>';
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="${withPreview?5:4}" style="padding:18px;text-align:center;color:#ccc;font-size:12px;">Brak terminów do sprawdzenia</td></tr>`;return;}
  tbody.innerHTML=filtered.map(e=>{
    const srcTxt=dictSourceText(e,srcLang);
    const prevTxt=withPreview?dictSourceText(e,otherSrc):'';
    const myVal=e.translations?.[myLang]||'';
    const st=e.status?.[myLang];
    const cls=dictCellClass(st);
    const badge=st==='accepted'?'<span class="dict-badge dict-badge-ok">Zaakceptowane</span>':(st==='ai'?'<span class="dict-badge dict-badge-ai">Do sprawdzenia</span>':'<span class="dict-badge">—</span>');
    const noteTxt=e.note?`<span style="font-size:11px;color:#aaa;">${esc(e.note)}</span>`:'';
    return`<tr>
      <td style="padding:6px 8px;font-weight:600;font-size:13px;">${esc(srcTxt)}</td>
      ${withPreview?`<td style="padding:6px 8px;font-size:12px;color:#999;">${prevTxt?esc(prevTxt):'—'}</td>`:''}
      <td class="${cls}" style="padding:4px 6px;">
        <input type="text" value="${esc(myVal)}" class="dict-tr-input" style="width:100%;font-size:13px;padding:5px 7px;border:1px solid #e5e5e5;border-radius:5px;"
          onchange="saveDictTranslation('${e.id}','${myLang}',this.value,false)" placeholder="Tłumaczenie..." />
      </td>
      <td style="padding:4px 6px;">${noteTxt}</td>
      <td style="padding:4px 6px;white-space:nowrap;">
        ${badge}
        <button class="btn btn-sm" style="padding:2px 8px;font-size:11px;margin-top:3px;${st==='accepted'?'opacity:.5;':''}" onclick="acceptDictTranslation('${e.id}','${myLang}',this)">✓ Akceptuj</button>
      </td>
    </tr>`;
  }).join('');
}

// Zapis tłumaczenia (przez RPC z walidacją uprawnień). accepted=true → oznacz jako zaakceptowane.
async function saveDictTranslation(id,lang,text,accepted){
  const val=(text||'').trim();
  const e=dictCache.find(x=>x.id===id);
  if(!e)return;
  try{
    const{data,error}=await supa.rpc('save_dict_translation',{dict_id:id,lang,new_text:val,mark_accepted:!!accepted});
    if(error)throw new Error(error.message);
    if(data){e.translations=data.translations||e.translations;e.status=data.status||e.status;}
    renderDict();
  }catch(err){alert('Błąd zapisu: '+err.message);}
}
async function acceptDictTranslation(id,lang,btn){
  const e=dictCache.find(x=>x.id===id);
  const val=e?.translations?.[lang]||'';
  if(!val.trim()){alert('Najpierw wpisz tłumaczenie.');return;}
  if(btn){btn.disabled=true;btn.textContent='...';}
  await saveDictTranslation(id,lang,val,true);
}

function buildDictPromptForChunk(lang, chunkTexts, sourceLang){
  // Do tłumaczenia kursów/prezentacji używamy TYLKO zaakceptowanych terminów.
  const d=dictCache.filter(e=>e.translations?.[lang]&&e.status?.[lang]==='accepted');
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
  const toAdd=[];rows.slice(1).forEach(row=>{const src=String(row[0]||'').trim();if(!src||dictCache.find(e=>e.src.toLowerCase()===src.toLowerCase()))return;const tr={},st={};Object.entries(colMap).forEach(([lang,i])=>{const v=String(row[i]||'').trim();if(v){tr[lang]=v;st[lang]='accepted';}});toAdd.push({src,note:String(row[hdr.length-1]||'').trim(),translations:tr,status:st,organization_id:currentOrg.id});});
  if(toAdd.length){const res=await dbPost('dictionary',toAdd);dictCache.push(...res);}
  renderDict();alert('Zaimportowano '+toAdd.length+' wpisów.');e.target.value='';
}
function exportDictJSON(){download(JSON.stringify(dictCache,null,2),'slownik.json','application/json');}
async function importDictJSON(e){const f=e.target.files[0];if(!f)return;const data=JSON.parse(await readFile(f));const toAdd=data.filter(x=>!dictCache.find(y=>y.src.toLowerCase()===x.src.toLowerCase())).map(x=>{const tr=x.translations||{};const st=x.status||Object.fromEntries(Object.keys(tr).map(k=>[k,'accepted']));return{src:x.src,note:x.note||'',translations:tr,status:st,organization_id:currentOrg.id};});if(toAdd.length){const res=await dbPost('dictionary',toAdd);dictCache.push(...res);}renderDict();alert('Zaimportowano.');e.target.value='';}
async function clearDict(){if(!confirm('Wyczyścić słownik?'))return;await dbDelete('dictionary',`?${orgParam()}`);dictCache=[];renderDict();}
async function fillDictWithAI(){
  const toFill=[];
  // EN najpierw (część języków tłumaczymy z EN — musi być gotowe wcześniej)
  const ordered=[...PRIMARY].sort((a,b)=>(a.code==='English'?-1:0)-(b.code==='English'?-1:0));
  dictCache.forEach(entry=>ordered.forEach(l=>{
    if(entry.translations?.[l.code]) return;
    // źródło wg mapy org; jeśli mapa wskazuje EN, a termin nie ma EN → fallback PL
    let srcLang=dictSourceLang(l.code,entry);
    if(srcLang==='English' && !entry.translations?.English) srcLang='Polish';
    const src=dictSourceText(entry,srcLang);
    if(!src) return; // brak tekstu źródłowego — pomiń
    toFill.push({id:entry.id,src,lang:l.code,note:entry.note||'',srcLang});
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
  const filledLangs=new Set(); // języki, w których dodano nowe tłumaczenia (do powiadomień)
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
        entry.status={...entry.status,[r.lang]:'ai'};
        await dbPatch('dictionary',{translations:entry.translations,status:entry.status},`?id=eq.${r.id}`);
        filledLangs.add(r.lang);
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
        entry.status={...entry.status,[t.lang]:'ai'};
        await dbPatch('dictionary',{translations:entry.translations,status:entry.status},`?id=eq.${t.id}`);
        filledLangs.add(t.lang);
      }catch(err){console.error('Dict retry error:',err);}
      await sleep(150);
    }
  }

  // Powiadom tłumaczy o nowych terminach do sprawdzenia (per język)
  for(const langCode of filledLangs){
    const l=PRIMARY.find(x=>x.code===langCode);
    try{
      await supa.rpc('notify_translators',{
        org_id:currentOrg.id,
        target_lang:langCode,
        notif_type:'dict_review',
        notif_title:'Nowe terminy do sprawdzenia',
        notif_message:`Słownik: nowe tłumaczenia AI (${l?.label||langCode}) czekają na akceptację`
      });
    }catch(e){console.error('notify_translators error:',e);}
  }

  // Cleanup progress UI
  statusEl?.remove();
  progressWrap?.remove();
  renderDict();
  alert(`Uzupełniono! ${toFill.length-failed.length}/${toFill.length} tłumaczeń.`);
}