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

// Język źródłowy dla danego celu — wg mapy org (dict_source_map).
// Każdy cel może mieć własne źródło: dowolny inny język słownika albo
// język bazowy. Brak wpisu / wpis niepoprawny → język bazowy.
function dictSourceLang(targetLang){
  const base=dictBaseLang();
  if(targetLang===base) return base;
  const mapped=currentOrg?.dict_source_map?.[targetLang];
  const valid=mapped&&mapped!==targetLang&&
    (mapped===base||dictLangs().some(l=>l.code===mapped));
  return valid?mapped:base;
}
// Tekst źródłowy wpisu w danym języku źródłowym.
// Termin w języku bazowym mieszka w kolumnie src, reszta w translations.
function dictSourceText(entry, srcLang){
  return srcLang===dictBaseLang() ? (entry.src||'') : (entry.translations?.[srcLang]||'');
}
// Języki słownika przypisane zalogowanemu tłumaczowi.
function myDictLangs(){
  const langs=teamMembersCache.find(m=>m.user_id===currentUser?.id)?.languages||[];
  return dictLangs().filter(l=>langs.includes(l.code));
}
// Obiekt języka bazowego (do etykiet/flag); zastępczy, gdy kod spoza LANGS.
function dictBaseLangObj(){
  const base=dictBaseLang();
  return LANGS.find(l=>l.code===base)||{code:base,label:base,flag:'🌐'};
}
// Tryb edycji całego słownika (admin) — przełącznik inline.
let dictEditMode=false;
function toggleDictEditMode(){ dictEditMode=document.getElementById('dict-edit-mode')?.checked||false; renderDict(); }

// ── Panel konfiguracji słownika (admin) ────────────────────────────
// Stan roboczy — zmiany trafiają do bazy dopiero po „Zapisz konfigurację".
let _dictCfg=null;

// Liczba wpisów z tłumaczeniem w danym języku (blokada usunięcia).
function dictLangUsage(code){
  return dictCache.filter(e=>(e.translations?.[code]||'').trim()).length;
}
function dictCfgMsg(text,cls){
  const el=document.getElementById('dict-cfg-msg');
  if(el){el.textContent=text||'';el.className='dict-cfg-msg'+(cls?' '+cls:'');}
}
// Wykrycie cyklu w grafie źródeł: od każdego celu musimy dojść do bazy.
// Zwraca kod języka rozpoczynającego cykl albo null.
function dictCfgFindCycle(langs, base, map){
  for(const code of langs){
    let cur=code,steps=0;
    while(true){
      cur=map[cur]||base;
      if(cur===base)break;
      if(++steps>langs.length)return code;
    }
  }
  return null;
}
// Obiekt języka z LANGS; zastępczy, gdy kod spoza listy (np. ze starych danych).
function langObj(code){
  return LANGS.find(l=>l.code===code)||{code,label:code,flag:'🌐'};
}
function buildDictConfigPanel(){
  const tbody=document.getElementById('dict-cfg-tbody');
  if(!tbody||currentRole!=='admin')return;
  // Kopia robocza — zapis do bazy dopiero po „Zapisz konfigurację"
  _dictCfg={
    base:dictBaseLang(),
    langs:dictLangs().map(l=>l.code),
    map:{...(currentOrg?.dict_source_map||{})}
  };
  const baseSel=document.getElementById('dict-cfg-base');
  if(baseSel)baseSel.innerHTML=LANGS.map(l=>`<option value="${l.code}"${l.code===_dictCfg.base?' selected':''}>${l.flag} ${l.label}</option>`).join('');
  dictCfgMsg('');
  renderDictCfgTable();
}
// Tabela: wiersz = język docelowy + z czego jest tłumaczony.
function renderDictCfgTable(){
  const tbody=document.getElementById('dict-cfg-tbody');
  if(!tbody||!_dictCfg)return;
  const base=_dictCfg.base, baseO=langObj(base);

  if(!_dictCfg.langs.length){
    tbody.innerHTML='<tr><td colspan="3" class="dict-cfg-empty">Brak języków docelowych — dodaj pierwszy z listy powyżej.</td></tr>';
  }else{
    tbody.innerHTML=_dictCfg.langs.map(code=>{
      const l=langObj(code);
      const cur=_dictCfg.map[code]||base;
      const used=dictLangUsage(code);
      // Źródłem może być język bazowy albo inny język docelowy (nie on sam)
      const opts=[base,..._dictCfg.langs.filter(c=>c!==code)]
        .map(c=>{const o=langObj(c);return`<option value="${c}"${cur===c?' selected':''}>${o.flag} ${esc(o.label)}${c===base?' — bazowy':''}</option>`;}).join('');
      const del=used
        ? `<span class="dict-cfg-lock" title="${used} tłumaczeń w słowniku — usuń je najpierw">🔒</span>`
        : `<button class="del-btn" title="Usuń język" onclick="removeDictCfgLang('${code}')">×</button>`;
      return`<tr>
        <td><b>${l.flag} ${esc(l.label)}</b>${used?`<span class="dict-cfg-count">${used} tłum.</span>`:''}</td>
        <td><select onchange="setDictCfgSource('${code}',this.value)">${opts}</select></td>
        <td style="text-align:center;">${del}</td>
      </tr>`;
    }).join('');
  }

  // Lista do dodania — języki jeszcze nieużyte i różne od bazowego
  const add=document.getElementById('dict-cfg-add-lang');
  if(add){
    const free=LANGS.filter(l=>l.code!==base&&!_dictCfg.langs.includes(l.code));
    add.innerHTML=free.length
      ? free.map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('')
      : '<option value="">— wszystkie języki już dodane —</option>';
    add.disabled=!free.length;
  }
  const hint=document.getElementById('dict-cfg-base-hint');
  if(hint)hint.textContent=`${baseO.flag} ${baseO.label}`;
}
function addDictCfgLang(){
  if(!_dictCfg)return;
  const code=document.getElementById('dict-cfg-add-lang')?.value;
  if(!code)return;
  if(!_dictCfg.langs.includes(code))_dictCfg.langs.push(code);
  dictCfgMsg('');
  renderDictCfgTable();
}
function removeDictCfgLang(code){
  if(!_dictCfg)return;
  const used=dictLangUsage(code);
  if(used){dictCfgMsg(`Nie można usunąć „${langObj(code).label}" — ma ${used} tłumaczeń w słowniku.`,'error');return;}
  _dictCfg.langs=_dictCfg.langs.filter(c=>c!==code);
  delete _dictCfg.map[code];
  // wyczyść wpisy, które brały z usuniętego języka
  Object.keys(_dictCfg.map).forEach(k=>{if(_dictCfg.map[k]===code)delete _dictCfg.map[k];});
  dictCfgMsg('');
  renderDictCfgTable();
}
function onDictCfgBaseChange(){
  if(!_dictCfg)return;
  const val=document.getElementById('dict-cfg-base')?.value;
  if(!val)return;
  const used=dictLangUsage(val);
  if(used&&!confirm(`Język „${langObj(val).label}" ma ${used} tłumaczeń jako język docelowy.\n\nUstawienie go jako bazowego usunie go z kolumn docelowych, ale tłumaczenia zostaną w bazie.\n\nKontynuować?`)){
    document.getElementById('dict-cfg-base').value=_dictCfg.base;return;
  }
  _dictCfg.base=val;
  _dictCfg.langs=_dictCfg.langs.filter(c=>c!==val);
  delete _dictCfg.map[val];
  Object.keys(_dictCfg.map).forEach(k=>{if(_dictCfg.map[k]===val)delete _dictCfg.map[k];});
  dictCfgMsg('');
  renderDictCfgTable();
}
function setDictCfgSource(targetLang, srcLang){
  if(!_dictCfg)return;
  const prev=_dictCfg.map[targetLang];
  if(srcLang===_dictCfg.base) delete _dictCfg.map[targetLang];
  else _dictCfg.map[targetLang]=srcLang;
  const cyc=dictCfgFindCycle(_dictCfg.langs,_dictCfg.base,_dictCfg.map);
  if(cyc){
    if(prev===undefined) delete _dictCfg.map[targetLang]; else _dictCfg.map[targetLang]=prev;
    dictCfgMsg(`„${langObj(targetLang).label}" nie może być tłumaczony z „${langObj(srcLang).label}" — powstałoby błędne koło.`,'error');
    renderDictCfgTable();return;
  }
  dictCfgMsg('');
}
// Zachowane dla switchTab i starszych wywołań
function buildDictSourceMap(){ buildDictConfigPanel(); }
// Zapis całej konfiguracji jednym wywołaniem RPC (atomowo, z walidacją w bazie).
async function saveDictConfig(){
  if(!currentOrg||!_dictCfg)return;
  if(!_dictCfg.langs.length){dictCfgMsg('Wybierz co najmniej jeden język docelowy.','error');return;}
  const cyc=dictCfgFindCycle(_dictCfg.langs,_dictCfg.base,_dictCfg.map);
  if(cyc){dictCfgMsg(`Cykl w źródłach tłumaczenia (zaczyna się na „${cyc}").`,'error');return;}
  const btn=document.getElementById('dict-cfg-save');
  if(btn){btn.disabled=true;btn.textContent='Zapisywanie...';}
  try{
    const{data,error}=await supa.rpc('save_org_dict_config',{
      org_id:currentOrg.id,
      langs:_dictCfg.langs,
      base_lang:_dictCfg.base,
      source_map:_dictCfg.map
    });
    if(error)throw new Error(error.message);
    if(data){
      currentOrg.dict_langs=data.dict_langs||_dictCfg.langs;
      currentOrg.dict_base_lang=data.dict_base_lang||_dictCfg.base;
      currentOrg.dict_source_map=data.dict_source_map||_dictCfg.map;
    }
    // Odśwież wszystko, co zależy od zestawu języków
    buildDictNewRow();buildDictLangFilter();
    buildDictConfigPanel();
    renderDict();
    dictCfgMsg('Zapisano.','ok');
  }catch(e){
    dictCfgMsg('Błąd zapisu: '+e.message,'error');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Zapisz konfigurację';}
  }
}
function buildDictNewRow(){const el=document.getElementById('dict-new-langs');if(!el)return;el.innerHTML=dictLangs().map(l=>`<div><label>${l.flag} ${l.label}</label><input type="text" class="dict-new-lang" data-lang="${l.code}" placeholder="Tłumaczenie..." /></div>`).join('');}
function buildDictLangFilter(){const sel=document.getElementById('dict-filter-lang');if(!sel)return;sel.innerHTML='<option value="all">Wszystkie</option>'+dictLangs().map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('')+'<option value="missing">⚠ Brakujące</option>';}

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
      dictLangs().forEach(l=>{const inp=document.querySelector(`#dict-new-langs [data-lang="${l.code}"]`);if(inp)inp.value=e.translations?.[l.code]||'';});
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
  const langs=dictLangs();
  let filtered=dictCache.filter(e=>{
    if(ft&&!e.src.toLowerCase().includes(ft)&&!Object.values(e.translations||{}).some(v=>v.toLowerCase().includes(ft)))return false;
    if(fl==='missing'&&!langs.some(l=>!e.translations?.[l.code]))return false;
    if(fl!=='all'&&fl!=='missing'&&e.translations?.[fl])return false; // brakujący dany język
    if(fs!=='all'){const fsLangs=fl!=='all'&&fl!=='missing'?[fl]:langs.map(l=>l.code);if(!fsLangs.some(c=>e.status?.[c]===fs))return false;}
    return true;
  });
  const canEdit=currentRole!=='viewer';
  const baseObj=dictBaseLangObj();
  document.getElementById('dict-thead').innerHTML=`<tr><th style="min-width:150px;">${baseObj.flag} Termin (${esc(baseObj.label)})</th>`+langs.map(l=>`<th style="min-width:110px;">${l.flag} ${l.label}</th>`).join('')+'<th style="min-width:100px;">Uwaga</th>'+(canEdit?'<th style="width:70px;"></th>':'')+'</tr>';
  const tbody=document.getElementById('dict-tbody');
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="${langs.length+(canEdit?3:2)}" style="padding:18px;text-align:center;color:#ccc;font-size:12px;">Brak wpisów w słowniku</td></tr>`;return;}
  const editing=canEdit&&dictEditMode;
  tbody.innerHTML=filtered.map(e=>{
    const cells=langs.map(l=>{const v=e.translations?.[l.code]||'';const cls=dictCellClass(e.status?.[l.code]);
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
  // Aktualnie edytowany język (pierwszy z przypisanych lub z selecta).
  // Przebuduj, gdy zmienił się zestaw języków (np. admin zmienił konfigurację).
  const sel=document.getElementById('dict-tr-lang');
  const sig=myLangs.map(l=>l.code).join(',');
  if(sel&&sel.dataset.sig!==sig){
    const prev=sel.value;
    sel.innerHTML=myLangs.map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('');
    if(myLangs.some(l=>l.code===prev))sel.value=prev; // zachowaj wybór, jeśli nadal dostępny
    sel.dataset.sig=sig;
    sel.style.display=myLangs.length>1?'':'none';
  }
  const myLang=(sel&&sel.value)||myLangs[0].code;
  const myLangObj=myLangs.find(l=>l.code===myLang)||myLangs[0];
  const srcLang=dictSourceLang(myLang);
  const srcObj=LANGS.find(l=>l.code===srcLang)||{code:srcLang,label:srcLang,flag:'🌐'};
  // Podgląd pomocniczy — termin w języku bazowym, gdy tłumaczymy z innego
  const showBoth=document.getElementById('dict-show-both')?.checked;
  const otherSrc=dictBaseLang();
  const otherObj=dictBaseLangObj();
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

// Wrapper for backward compatibility (bez chunku — źródłem język bazowy org)
function buildDictPrompt(lang){return buildDictPromptForChunk(lang,[],dictBaseLang());}

function exportDictExcel(){
  if(!dictCache.length){alert('Słownik jest pusty.');return;}
  const langs=dictLangs();
  const hdr=['Termin '+dictBaseLangObj().label,...langs.map(l=>l.label),'Uwaga'];
  const rows=[hdr,...dictCache.map(e=>[e.src,...langs.map(l=>e.translations?.[l.code]||''),e.note||''])];
  const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:28},...langs.map(()=>({wch:22})),{wch:28}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Słownik');XLSX.writeFile(wb,'slownik.xlsx');
}
async function importDictExcel(e){
  const f=e.target.files[0];if(!f)return;
  const buf=await readFile(f,'array');const wb=XLSX.read(buf,{type:'array'});
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
  const hdr=rows[0]||[];const colMap={};dictLangs().forEach(l=>{let i=hdr.findIndex(h=>String(h).includes(l.label));if(i<0)i=hdr.findIndex(h=>String(h).includes(l.code));if(i>=0)colMap[l.code]=i;});
  const toAdd=[];rows.slice(1).forEach(row=>{const src=String(row[0]||'').trim();if(!src||dictCache.find(e=>e.src.toLowerCase()===src.toLowerCase()))return;const tr={},st={};Object.entries(colMap).forEach(([lang,i])=>{const v=String(row[i]||'').trim();if(v){tr[lang]=v;st[lang]='accepted';}});toAdd.push({src,note:String(row[hdr.length-1]||'').trim(),translations:tr,status:st,organization_id:currentOrg.id});});
  if(toAdd.length){const res=await dbPost('dictionary',toAdd);dictCache.push(...res);}
  renderDict();alert('Zaimportowano '+toAdd.length+' wpisów.');e.target.value='';
}
function exportDictJSON(){download(JSON.stringify(dictCache,null,2),'slownik.json','application/json');}
async function importDictJSON(e){const f=e.target.files[0];if(!f)return;const data=JSON.parse(await readFile(f));const toAdd=data.filter(x=>!dictCache.find(y=>y.src.toLowerCase()===x.src.toLowerCase())).map(x=>{const tr=x.translations||{};const st=x.status||Object.fromEntries(Object.keys(tr).map(k=>[k,'accepted']));return{src:x.src,note:x.note||'',translations:tr,status:st,organization_id:currentOrg.id};});if(toAdd.length){const res=await dbPost('dictionary',toAdd);dictCache.push(...res);}renderDict();alert('Zaimportowano.');e.target.value='';}
async function clearDict(){if(!confirm('Wyczyścić słownik?'))return;await dbDelete('dictionary',`?${orgParam()}`);dictCache=[];renderDict();}
async function fillDictWithAI(){
  const toFill=[];
  // Kolejność wg grafu źródeł: język idzie po swoim źródle
  // (np. EN musi być gotowe, zanim ruszy CZ tłumaczone z EN).
  // Pętla po JĘZYKACH z zewnątrz — inaczej terminy przeplatałyby języki
  // i tłumaczenie z EN startowałoby, zanim EN zostanie zapisane.
  const ordered=dictLangOrder();
  const base=dictBaseLang();
  ordered.forEach(l=>dictCache.forEach(entry=>{
    if(entry.translations?.[l.code]) return;
    // źródło wg mapy org; tekst źródłowy sprawdzamy dopiero w pętli
    // wykonania (może powstać w tym samym przebiegu — patrz niżej)
    toFill.push({id:entry.id,lang:l.code,note:entry.note||'',srcLang:dictSourceLang(l.code)});
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

  // Tekst źródłowy rozwiązujemy dopiero tuż przed wysłaniem — źródło mogło
  // zostać uzupełnione we wcześniejszym chunku tego samego przebiegu.
  // Gdy nadal pusto → fallback na język bazowy; gdy i tam pusto → pomiń.
  const resolveSrc=t=>{
    const entry=dictCache.find(e=>e.id===t.id);
    if(!entry||entry.translations?.[t.lang]) return null; // zniknął albo już przetłumaczony
    let srcLang=t.srcLang;
    if(srcLang!==base && !dictSourceText(entry,srcLang)) srcLang=base;
    const src=dictSourceText(entry,srcLang);
    return src?{...t,src,srcLang}:null;
  };

  for(let i=0;i<toFill.length;i+=CHUNK){
    const chunk=toFill.slice(i,i+CHUNK).map(resolveSrc).filter(Boolean);
    done+=Math.min(CHUNK,toFill.length-i)-chunk.length; // pominięte liczą się do postępu
    if(!chunk.length) continue;
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
      if(!t.src) continue; // brak tekstu źródłowego — nie ma czego ponawiać
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
    const l=dictLangs().find(x=>x.code===langCode);
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
  // Liczymy faktycznie zapisane — część wpisów mogła zostać pominięta
  // (brak tekstu źródłowego nawet po fallbacku na język bazowy).
  const filled=toFill.filter(t=>dictCache.find(e=>e.id===t.id)?.translations?.[t.lang]).length;
  const skipped=toFill.length-filled;
  alert(`Uzupełniono! ${filled}/${toFill.length} tłumaczeń.`+
    (skipped?`\n\nPominięto ${skipped} — brak tekstu źródłowego lub błąd API.`:''));
}