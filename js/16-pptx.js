// ══════════════════════════════════════════════════════════
// PPTX
// ══════════════════════════════════════════════════════════
async function loadPptx(file){
  pptxFilename=file.name;const buf=await readFile(file,'array');pptxZip=await JSZip.loadAsync(buf);pptxSegs=[];
  const slideFiles=Object.keys(pptxZip.files).filter(n=>n.match(/^ppt\/slides\/slide\d+\.xml$/)).sort((a,b)=>parseInt(a.match(/\d+/)[0])-parseInt(b.match(/\d+/)[0]));
  const lang=document.getElementById('pptx-target-lang').value;
  for(let si=0;si<slideFiles.length;si++){
    const path=slideFiles[si],slideNum=parseInt(path.match(/slide(\d+)/)[1]);
    const xml=await pptxZip.file(path).async('string');
    const doc=domParser.parseFromString(xml,'application/xml');
    const extractParas=(paras,keyPrefix,labelName)=>{paras.forEach((para,paraIdx)=>{const runs=Array.from(para.querySelectorAll('r'));if(!runs.length)return;const fullText=runs.map(r=>r.querySelector('t')?.textContent||'').join('');if(!fullText.trim())return;const key=`${keyPrefix}_p${paraIdx}`;pptxSegs.push({key,slideNum,slideFile:path,keyPrefix,paraIdx,shapeName:labelName,source:fullText,target:'',status:'pending',fromTM:false});});};
    Array.from(doc.querySelectorAll('sp')).forEach((shape,shapeIdx)=>{const shapeName=shape.querySelector('nvSpPr cNvPr')?.getAttribute('name')||`Shape${shapeIdx}`;extractParas(Array.from(shape.querySelectorAll('p')),`s${slideNum}_sh${shapeIdx}`,shapeName);});
    Array.from(doc.querySelectorAll('graphicFrame')).forEach((frame,frameIdx)=>{const frameName=frame.querySelector('nvGraphicFramePr cNvPr')?.getAttribute('name')||`Table${frameIdx}`;Array.from(frame.querySelectorAll('tr')).forEach((row,rowIdx)=>{Array.from(row.querySelectorAll('tc')).forEach((cell,cellIdx)=>{extractParas(Array.from(cell.querySelectorAll('p')),`s${slideNum}_tbl${frameIdx}_r${rowIdx}_c${cellIdx}`,`${frameName} [W${rowIdx+1}K${cellIdx+1}]`);});});});
  }
  // Apply TM batch after all slides parsed
  const pptxInitMap=await lookupTMBatch(pptxSegs.map(s=>s.source),lang);
  pptxSegs.forEach(seg=>{
    const f=pptxInitMap[tmKey(seg.source)];
    if(f){seg.target=f;seg.status='done';seg.fromTM=true;tmApiSaved++;}
  });
  const tmHits=pptxSegs.filter(s=>s.fromTM).length;
  document.getElementById('pptx-badges').style.display='flex';
  document.getElementById('pptx-fname').textContent=file.name;
  document.getElementById('pptx-slide-count').textContent=slideFiles.length+' slajdów';
  document.getElementById('pptx-text-count').textContent=pptxSegs.length+' bloków';
  const ptb=document.getElementById('pptx-tm-badge');if(tmHits>0){ptb.style.display='';ptb.textContent=tmHits+' z TM';}else ptb.style.display='none';
  document.getElementById('pptx-lang-card').style.display='block';document.getElementById('pptx-segs-card').style.display='block';
  document.getElementById('pptx-count').textContent=pptxSegs.length;
  buildPptxSlideFilter(slideFiles.length);renderPptxTable();updatePptxProgress();updateTMUI();updatePptxCost();
}

function buildPptxSlideFilter(count){const sel=document.getElementById('pptx-filter-slide');sel.innerHTML='<option value="all">Wszystkie slajdy</option>'+Array.from({length:count},(_,i)=>`<option value="${i+1}">Slajd ${i+1}</option>`).join('');}
async function pptxLangChange(){
  const lang=document.getElementById('pptx-target-lang').value;
  // Reset all, then re-apply TM for new language
  pptxSegs.forEach(seg=>{seg.target='';seg.status='pending';seg.fromTM=false;});
  const pptxTmMap=await lookupTMBatch(pptxSegs.map(s=>s.source),lang);
  pptxSegs.forEach(seg=>{
    const f=pptxTmMap[tmKey(seg.source)];
    if(f){seg.target=f;seg.status='done';seg.fromTM=true;tmApiSaved++;}
  });
  renderPptxTable();
  updatePptxProgress();
  updatePptxCost();
}

function renderPptxTable(){
  const ft=(document.getElementById('pptx-filter')?.value||'').toLowerCase();
  const fs=document.getElementById('pptx-fs')?.value||'all';
  const fslide=document.getElementById('pptx-filter-slide')?.value||'all';
  const tbody=document.getElementById('pptx-tbody');tbody.innerHTML='';
  const canEdit=currentRole!=='viewer';
  pptxSegs.forEach((seg,i)=>{
    if(ft&&!seg.source.toLowerCase().includes(ft)&&!seg.target.toLowerCase().includes(ft))return;
    if(fslide!=='all'&&String(seg.slideNum)!==fslide)return;
    if(fs!=='all'){if(fs==='tm'&&!seg.fromTM)return;if(fs!=='tm'&&seg.status!==fs)return;}
    const sc=seg.status==='done'?'b-green':seg.status==='error'?'b-red':'b-yellow';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><span class="slide-badge">Slajd ${seg.slideNum}</span><div style="font-size:10px;color:#ccc;margin-top:2px;">${esc(seg.shapeName)}</div></td><td class="src-cell">${esc(seg.source)}</td><td>${seg.fromTM?'<div class="tm-hint">↩ z TM</div>':''}<textarea id="pta-${i}" rows="2" ${canEdit?`onchange="pptxEdit(${i},this.value)"`:' readonly'}>${esc(seg.target)}</textarea></td><td><span class="badge ${sc}" id="pbadge-${i}">${seg.status==='done'?'OK':seg.status==='error'?'Błąd':'Oczekuje'}</span></td>`;
    tbody.appendChild(tr);
  });
}

function pptxEdit(i,val){pptxSegs[i].target=val;pptxSegs[i].status=val.trim()?'done':'pending';pptxSegs[i].fromTM=false;const b=document.getElementById('pbadge-'+i);if(b){b.className='badge '+(val.trim()?'b-green':'b-yellow');b.textContent=val.trim()?'OK':'Oczekuje';}updatePptxProgress();}
function updatePptxProgress(){const done=pptxSegs.filter(s=>s.status==='done').length;const b=document.getElementById('pptx-prog-badge');if(b){b.textContent=done+'/'+pptxSegs.length;b.className='badge '+(done===pptxSegs.length?'b-green':'b-yellow');}}

async function startPptxTranslation(){
  const toT=pptxSegs.filter(s=>s.status!=='done');if(!toT.length){setPPS('Wszystko przetłumaczone!');return;}
  // Count ONLY chars from segments that need translation
  const charsToTranslate=toT.reduce((a,s)=>a+s.source.length,0);
  const needed=estimateTokensForTranslation(charsToTranslate);
  if(!checkTokenBalance(needed))return;
  await runPptxBatch(toT);
}
async function pptxRetranslateEmpty(){const toT=pptxSegs.filter(s=>!s.target.trim());if(!toT.length){setPPS('Brak pustych.');return;}await runPptxBatch(toT);}

async function runPptxBatch(toT){
  const lang=document.getElementById('pptx-target-lang').value;
  const histId=await createHistoryEntry(pptxFilename,'pptx',lang,pptxSegs.length,pptxSegs.filter(s=>s.fromTM).length);
  document.getElementById('pptx-pw').style.display='block';document.getElementById('pptx-pf').style.width='0%';
  setPPS('Tłumaczenie '+toT.length+' bloków na '+lang+'...');
  let done=0,totalCostUsd=0;const C=25;
  for(let i=0;i<toT.length;i+=C){
    const chunk=toT.slice(i,i+C);const charsIn=chunk.reduce((a,s)=>a+s.source.length,0);
    const dict=buildDictPromptForChunk(lang,chunk.map(s=>s.text),document.getElementById('pptx-source-lang')?.value);
    const prompt=`Jesteś profesjonalnym tłumaczem prezentacji biznesowych i szkoleniowych. Przetłumacz na język: ${lang}.\n\nZasady:\n- Zachowaj styl oryginału (formalny/zwięzły)\n- Nie dodawaj ani nie skracaj tekstu\n- Zachowaj interpunkcję i wielkość liter\n- Zmienne %...% przepisuj bez zmian\n- Tytuły slajdów: zwięźle i rzeczowo\n- Punkty listy: zachowaj równoległy styl${dict}\n\nJSON: [{"key":"...","translation":"..."}] — bez markdown.\n\nBloki:\n${JSON.stringify(chunk.map(s=>({key:s.key,text:s.source})))}`;
    try{
      const res=JSON.parse((await apiCall(prompt)).replace(/```json|```/g,'').trim());
      const charsOut=res.reduce((a,r)=>a+(r.translation?.length||0),0);
      totalCostUsd+=((charsIn/CPT)/1e6)*PRICE_IN+((charsOut/CPT)/1e6)*PRICE_OUT;
      res.forEach(r=>{const seg=pptxSegs.find(s=>s.key===r.key);if(!seg)return;seg.target=r.translation;seg.status='done';const idx=pptxSegs.indexOf(seg);const ta=document.getElementById('pta-'+idx);if(ta)ta.value=r.translation;const b=document.getElementById('pbadge-'+idx);if(b){b.className='badge b-green';b.textContent='OK';}});
    }catch(err){chunk.forEach(s=>{s.status='error';const idx=pptxSegs.indexOf(s);const b=document.getElementById('pbadge-'+idx);if(b){b.className='badge b-red';b.textContent='Błąd';}});setPPS('Błąd: '+err.message);}
    done+=chunk.length;document.getElementById('pptx-pf').style.width=Math.round(done/toT.length*100)+'%';updatePptxProgress();await sleep(150);
  }
  const finalDone=pptxSegs.filter(s=>s.status==='done').length;
  await pushTMBatch(pptxSegs.filter(s=>s.status==='done'&&s.target.trim()).map(s=>({src:s.source,tgt:s.target})),lang,'pptx');
  const charsThisBatch=toT.reduce((a,s)=>a+s.source.length,0);
  const creditsUsed=estimateCredits(charsThisBatch);
  await updateHistoryEntry(histId,finalDone,pptxSegs.filter(s=>s.fromTM).length,creditsUsed,creditsUsed);
  updatePptxCost();
  await deductCredits(charsThisBatch, pptxFilename, lang);
  setPPS(`Gotowe! Użyto ${creditsUsed} kredytów. Saldo: ${formatTokens(currentOrg?.tokens_balance||0)} kredytów.`);
}
function setPPS(m){document.getElementById('pptx-status').textContent=m;}

function pptxExportExcel(){if(!pptxSegs.length){alert('Brak segmentów.');return;}const lang=document.getElementById('pptx-target-lang').value;const rows=[['Slajd','Kształt','Klucz','Tekst źródłowy','Tłumaczenie ('+lang+')','Status']];pptxSegs.forEach(s=>rows.push([s.slideNum,s.shapeName,s.key,s.source,s.target,s.status]));const ws=XLSX.utils.aoa_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Tłumaczenia');XLSX.writeFile(wb,'pptx_'+lang.toLowerCase()+'.xlsx');}
async function pptxImportExcel(e){const f=e.target.files[0];if(!f)return;const buf=await readFile(f,'array');const rows=XLSX.utils.sheet_to_json(XLSX.read(buf,{type:'array'}).Sheets[XLSX.read(buf,{type:'array'}).SheetNames[0]],{header:1});let n=0;rows.slice(1).forEach(row=>{const key=String(row[2]||'').trim(),tr=String(row[4]||'').trim();if(!key||!tr)return;const seg=pptxSegs.find(s=>s.key===key);if(!seg)return;seg.target=tr;seg.status='done';seg.fromTM=false;n++;});renderPptxTable();updatePptxProgress();e.target.value='';alert('Zaimportowano '+n+' tłumaczeń.');}

async function exportPptx(){
  if(!pptxZip){alert('Brak pliku.');return;}setPPS('Generowanie PPTX...');
  const lang=document.getElementById('pptx-target-lang').value;
  const bySlide={};pptxSegs.forEach(seg=>{if(!bySlide[seg.slideFile])bySlide[seg.slideFile]=[];bySlide[seg.slideFile].push(seg);});
  const newZip=new JSZip();
  for(const path of Object.keys(pptxZip.files)){const entry=pptxZip.files[path];if(entry.dir){newZip.folder(path);continue;}if(bySlide[path]){const xml=await pptxZip.file(path).async('string');newZip.file(path,applyPptxTranslations(xml,bySlide[path]));}else{newZip.file(path,await pptxZip.file(path).async('arraybuffer'));}}
  const blob=await newZip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',compression:'DEFLATE',compressionOptions:{level:6}});
  const fname=pptxFilename.replace(/\.pptx$/i,'')+'_'+lang.toLowerCase().replace(/\s+/g,'_')+'.pptx';
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fname;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(a.href);setPPS('Plik PPTX pobrany.');
}

function applyRunText(para,translated){
  const runs=Array.from(para.querySelectorAll('r'));if(!runs.length)return;
  const totalSrcLen=runs.reduce((a,r)=>{const t=r.querySelector('t');return a+(t?t.textContent.length:0);},0);
  if(runs.length===1){const t=runs[0].querySelector('t');if(t)t.textContent=translated;}
  else if(totalSrcLen===0){const t=runs[0].querySelector('t');if(t)t.textContent=translated;runs.slice(1).forEach(r=>{const t=r.querySelector('t');if(t)t.textContent='';});}
  else{let remaining=translated;runs.forEach((run,ri)=>{const t=run.querySelector('t');if(!t)return;const origLen=t.textContent.length;if(ri===runs.length-1){t.textContent=remaining;}else if(origLen===0){t.textContent='';}else{const ratio=origLen/totalSrcLen;let splitAt=Math.min(Math.round(translated.length*ratio),remaining.length);if(splitAt>0&&splitAt<remaining.length){const win=Math.max(4,Math.round(splitAt*0.2));let best=splitAt;for(let d=1;d<=win;d++){if(splitAt-d>=0&&remaining[splitAt-d]===' '){best=splitAt-d;break;}if(splitAt+d<=remaining.length&&remaining[splitAt+d-1]===' '){best=splitAt+d;break;}}splitAt=best;}t.textContent=remaining.slice(0,splitAt);remaining=remaining.slice(splitAt);}});}
}

function applyPptxTranslations(xml,segs){
  const doc=domParser.parseFromString(xml,'application/xml');
  const slideNum=segs[0]?.slideNum;
  const findSeg=key=>segs.find(s=>s.key===key);
  Array.from(doc.querySelectorAll('sp')).forEach((shape,shapeIdx)=>{Array.from(shape.querySelectorAll('p')).forEach((para,paraIdx)=>{const seg=findSeg(`s${slideNum}_sh${shapeIdx}_p${paraIdx}`);if(!seg||!seg.target.trim())return;applyRunText(para,seg.target);});});
  Array.from(doc.querySelectorAll('graphicFrame')).forEach((frame,frameIdx)=>{Array.from(frame.querySelectorAll('tr')).forEach((row,rowIdx)=>{Array.from(row.querySelectorAll('tc')).forEach((cell,cellIdx)=>{Array.from(cell.querySelectorAll('p')).forEach((para,paraIdx)=>{const seg=findSeg(`s${slideNum}_tbl${frameIdx}_r${rowIdx}_c${cellIdx}_p${paraIdx}`);if(!seg||!seg.target.trim())return;applyRunText(para,seg.target);});});});});
  return xmlSer.serializeToString(doc);
}
