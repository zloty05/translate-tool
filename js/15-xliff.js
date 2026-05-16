// ══════════════════════════════════════════════════════════
// XLIFF
// ══════════════════════════════════════════════════════════
async function loadXliff(file){
  const xml=await readFile(file);xliffRawXml=xml;xliffXmlDoc=domParser.parseFromString(xml,'application/xml');
  const units=Array.from(xliffXmlDoc.querySelectorAll('trans-unit'));xliffSegs=[];
  units.forEach(unit=>{
    const unitId=unit.getAttribute('id')||'',datatype=unit.getAttribute('datatype')||'';
    const srcEl=unit.querySelector('source');if(!srcEl)return;
    if(datatype==='plaintext'){const text=(srcEl.textContent||'').trim();if(!text)return;const tgt=unit.querySelector('target');xliffSegs.push({id:unitId,unitId,type:'plain',source:text,target:tgt?(tgt.textContent||''):'',status:(tgt&&tgt.textContent.trim())?'done':'pending',fromTM:false});}
    else{const gNodes=Array.from(srcEl.querySelectorAll('g[ctype="x-text"]'));const textNodes=gNodes.map(g=>({gId:g.getAttribute('id'),text:(g.textContent||'').replace(/^[ \t]+|[ \t]+$/g,'')})).filter(n=>n.text.length>0);if(!textNodes.length)return;const tgt=unit.querySelector('target');const exT=tgt?Array.from(tgt.querySelectorAll('g[ctype="x-text"]')).map(g=>({gId:g.getAttribute('id'),text:g.textContent||''})):[];const targets=textNodes.map(n=>{const ex=exT.find(t=>t.gId===n.gId);return{gId:n.gId,text:ex?ex.text:''};});xliffSegs.push({id:unitId,unitId,type:'rich',textNodes,targets,status:targets.every(t=>t.text.trim())?'done':'pending',fromTM:false});}
  });
  const tmHits=await applyTMToSegsAsync(xliffSegs,document.getElementById('target-lang').value);
  const totalChars=xliffSegs.reduce((a,s)=>s.type==='plain'?a+s.source.length:a+s.textNodes.reduce((b,n)=>b+n.text.length,0),0);
  document.getElementById('xliff-badges').style.display='flex';
  document.getElementById('xliff-fname').textContent=file.name;
  document.getElementById('xliff-chars').textContent=totalChars.toLocaleString('pl-PL');
  document.getElementById('xliff-segs').textContent=xliffSegs.length;
  const tmSep=document.getElementById('xliff-tm-sep');
  const th=document.getElementById('xliff-tm-hits');
  if(tmHits>0){th.style.display='';th.textContent=tmHits+' z TM';if(tmSep)tmSep.style.display='';}
  else{th.style.display='none';if(tmSep)tmSep.style.display='none';}
  document.getElementById('lang-card').style.display='block';document.getElementById('segments-card').style.display='block';
  renderXliffTable();updateXliffProgress();updateXliffCost();
}

async function xliffLangChange(){
  const lang=document.getElementById('target-lang').value;
  // Reset all targets to empty, then re-apply TM for new language
  xliffSegs.forEach(seg=>{
    if(seg.type==='plain'){seg.target='';seg.status='pending';seg.fromTM=false;}
    else{seg.targets.forEach(t=>t.text='');seg.status='pending';seg.fromTM=false;}
  });
  await applyTMToSegsAsync(xliffSegs,lang);
  renderXliffTable();
  updateXliffProgress();
  updateXliffCost();
}
function xliffSrc(s){return s.type==='plain'?s.source:s.textNodes.map(n=>n.text).join('\n');}
function xliffTgt(s){return s.type==='plain'?s.target:s.targets.map(n=>n.text).join('\n');}

function renderXliffTable(){
  const ft=(document.getElementById('xliff-filter')?.value||'').toLowerCase();
  const fs=document.getElementById('xliff-fs')?.value||'all';
  const tbody=document.getElementById('xliff-tbody');tbody.innerHTML='';
  const canEdit=currentRole!=='viewer';
  xliffSegs.forEach((seg,i)=>{
    const src=xliffSrc(seg),tgt=xliffTgt(seg);
    if(ft&&!src.toLowerCase().includes(ft)&&!tgt.toLowerCase().includes(ft))return;
    if(fs!=='all'){if(fs==='tm'&&!seg.fromTM)return;if(fs!=='tm'&&seg.status!==fs)return;}
    const sc=seg.status==='done'?'b-green':seg.status==='error'?'b-red':'b-yellow';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="id-cell" title="${esc(seg.id)}">${esc(seg.id)}</td><td class="src-cell">${esc(src).replace(/\n/g,'<br>')}</td><td>${seg.fromTM?'<div class="tm-hint">↩ z TM</div>':''}<textarea id="xta-${i}" rows="2" ${canEdit?`onchange="xliffEdit(${i},this.value)"`:' readonly'}>${esc(tgt)}</textarea></td><td><span class="badge ${sc}" id="xbadge-${i}">${seg.status==='done'?'OK':seg.status==='error'?'Błąd':'Oczekuje'}</span></td>`;
    tbody.appendChild(tr);
  });
}

function xliffEdit(i,val){const seg=xliffSegs[i];if(seg.type==='plain')seg.target=val;else{const lines=val.split('\n');seg.targets.forEach((t,j)=>{t.text=lines[j]!==undefined?lines[j]:'';});}seg.status=val.trim()?'done':'pending';seg.fromTM=false;const b=document.getElementById('xbadge-'+i);if(b){b.className='badge '+(val.trim()?'b-green':'b-yellow');b.textContent=val.trim()?'OK':'Oczekuje';}updateXliffProgress();}
function updateXliffProgress(){const done=xliffSegs.filter(s=>s.status==='done').length;const b=document.getElementById('xliff-prog-badge');if(b){b.textContent=done+'/'+xliffSegs.length;b.className='badge '+(done===xliffSegs.length?'b-green':'b-yellow');}}

async function startXliffTranslation(){
  const toT=xliffSegs.filter(s=>s.status!=='done');if(!toT.length){setXS('Wszystko przetłumaczone!');return;}
  // Count ONLY chars from segments that need translation
  const charsToTranslate=toT.reduce((a,s)=>a+(s.type==='plain'?s.source.length:s.textNodes.reduce((b,n)=>b+n.text.length,0)),0);
  const needed=estimateTokensForTranslation(charsToTranslate);
  if(!checkTokenBalance(needed))return;
  await runXliffBatch(toT);
}
async function xliffRetranslateEmpty(){const toT=xliffSegs.filter(s=>s.type==='plain'?!s.target.trim():s.targets.every(t=>!t.text.trim()));if(!toT.length){setXS('Brak pustych.');return;}await runXliffBatch(toT);}

async function runXliffBatch(toT){
  const lang=document.getElementById('target-lang').value;
  const histId=await createHistoryEntry(document.getElementById('xliff-fname').textContent,'xliff',lang,xliffSegs.length,xliffSegs.filter(s=>s.fromTM).length);
  document.getElementById('xliff-pw').style.display='block';document.getElementById('xliff-pf').style.width='0%';
  const items=[];toT.forEach(seg=>{const idx=xliffSegs.indexOf(seg);if(seg.type==='plain')items.push({key:idx+'__p',segIndex:idx,gId:null,text:seg.source});else seg.textNodes.forEach(n=>items.push({key:idx+'__'+n.gId,segIndex:idx,gId:n.gId,text:n.text}));});
  setXS('Tłumaczenie '+items.length+' fragmentów na '+lang+'...');
  let done=0,totalCostUsd=0;
  for(let i=0;i<items.length;i+=CHUNK){
    const chunk=items.slice(i,i+CHUNK);
    const dict=buildDictPromptForChunk(lang,chunk.map(it=>it.text),document.getElementById('source-lang')?.value);
    const charsIn=chunk.reduce((a,it)=>a+it.text.length,0);
    const prompt=`Tłumacz materiały e-learningowe na: ${lang}.\nZachowaj zmienne %...% bez zmian.${dict}\nJSON: [{"key":"...","translation":"..."}] — bez markdown.\n\nFragmenty:\n${JSON.stringify(chunk.map(it=>({key:it.key,text:it.text})))}`;
    try{
      const res=JSON.parse((await apiCall(prompt)).replace(/```json|```/g,'').trim());
      const charsOut=res.reduce((a,r)=>a+(r.translation?.length||0),0);
      totalCostUsd+=((charsIn/CPT)/1e6)*PRICE_IN+((charsOut/CPT)/1e6)*PRICE_OUT;
      res.forEach(r=>{const item=chunk.find(it=>it.key===r.key);if(!item)return;const seg=xliffSegs[item.segIndex];if(!seg)return;if(seg.type==='plain'){seg.target=r.translation;seg.status='done';}else{const tn=seg.targets.find(t=>t.gId===item.gId);if(tn)tn.text=r.translation;if(seg.targets.every(t=>t.text.trim()))seg.status='done';}const ta=document.getElementById('xta-'+item.segIndex);if(ta)ta.value=xliffTgt(xliffSegs[item.segIndex]);const b=document.getElementById('xbadge-'+item.segIndex);if(b&&xliffSegs[item.segIndex].status==='done'){b.className='badge b-green';b.textContent='OK';}});
    }catch(err){chunk.forEach(it=>{xliffSegs[it.segIndex].status='error';const b=document.getElementById('xbadge-'+it.segIndex);if(b){b.className='badge b-red';b.textContent='Błąd';}});setXS('Błąd: '+err.message);}
    done+=chunk.length;document.getElementById('xliff-pf').style.width=Math.round(done/items.length*100)+'%';updateXliffProgress();if(typeof quickMode!=='undefined'&&quickMode==='xliff')renderQuickTable();await sleep(150);
  }
  const finalDone=xliffSegs.filter(s=>s.status==='done').length;
  await pushTMBatch(xliffSegs.filter(s=>s.status==='done').flatMap(s=>s.type==='plain'?[{src:s.source,tgt:s.target}]:s.textNodes.map((n,i)=>({src:n.text,tgt:s.targets[i]?.text||''}))),lang,'xliff');
  const charsThisBatch=items.reduce((a,it)=>a+it.text.length,0);
  const creditsUsed=estimateCredits(charsThisBatch);
  await updateHistoryEntry(histId,finalDone,xliffSegs.filter(s=>s.fromTM).length,creditsUsed,creditsUsed);
  updateXliffCost();
  await deductCredits(charsThisBatch, document.getElementById('xliff-fname').textContent, lang);
  setXS(`Gotowe! Użyto ${creditsUsed} kredytów. Saldo: ${formatTokens(currentOrg?.tokens_balance||0)} kredytów.`);
}
function setXS(m){document.getElementById('xliff-status').textContent=m;}

function xliffExportExcel(){if(!xliffSegs.length){alert('Brak segmentów.');return;}const lang=document.getElementById('target-lang').value;const rows=[['ID','Typ','gID','Źródło (PL)','Tłumaczenie ('+lang+')','Status']];xliffSegs.forEach(s=>{if(s.type==='plain')rows.push([s.id,'plain','',s.source,s.target,s.status]);else s.textNodes.forEach((n,i)=>rows.push([s.id,'rich',n.gId,n.text,s.targets[i]?.text||'',s.status]));});const ws=XLSX.utils.aoa_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Tłumaczenia');XLSX.writeFile(wb,'xliff_'+lang.toLowerCase()+'.xlsx');}
async function xliffImportExcel(e){const f=e.target.files[0];if(!f)return;const buf=await readFile(f,'array');const rows=XLSX.utils.sheet_to_json(XLSX.read(buf,{type:'array'}).Sheets[XLSX.read(buf,{type:'array'}).SheetNames[0]],{header:1});let n=0;rows.slice(1).forEach(row=>{const sid=String(row[0]||'').trim(),type=String(row[1]||'').trim(),gId=String(row[2]||'').trim(),tr=String(row[4]||'').trim();if(!sid||!tr)return;const seg=xliffSegs.find(s=>s.id===sid);if(!seg)return;if(type==='plain'){seg.target=tr;seg.status='done';seg.fromTM=false;n++;}else if(type==='rich'&&gId){const tn=seg.targets.find(t=>t.gId===gId);if(tn){tn.text=tr;n++;}if(seg.targets.every(t=>t.text.trim()))seg.status='done';}});renderXliffTable();updateXliffProgress();e.target.value='';alert('Zaimportowano '+n+' tłumaczeń.');}

function exportXliff(){
  if(!xliffXmlDoc){alert('Brak pliku.');return;}
  const lang=document.getElementById('target-lang').value;
  const workDoc=domParser.parseFromString(xliffRawXml,'application/xml');
  xliffSegs.forEach(seg=>{let unit=null;for(const u of workDoc.querySelectorAll('trans-unit')){if(u.getAttribute('id')===seg.unitId){unit=u;break;}}if(!unit)return;const srcEl=unit.querySelector('source');if(!srcEl)return;const ex=unit.querySelector('target');if(ex)ex.remove();const tgt=workDoc.createElementNS(XLIFF_NS,'target');tgt.setAttribute('state','translated');if(seg.type==='plain'){tgt.textContent=seg.target||seg.source;}else{const cl=srcEl.cloneNode(true);cl.querySelectorAll('g[ctype="x-text"]').forEach(g=>{const tn=seg.targets.find(t=>t.gId===g.getAttribute('id'));if(tn&&tn.text)g.textContent=tn.text;});while(cl.firstChild)tgt.appendChild(cl.firstChild);}srcEl.after(tgt);});
  let s=xmlSer.serializeToString(workDoc);if(!s.startsWith('<?xml'))s='<?xml version="1.0" encoding="utf-8"?>'+s;
  download(s,'translated_'+lang.toLowerCase().replace(/\s+/g,'_')+'.xliff','application/xliff+xml');
}