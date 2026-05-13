// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function toggleKey(id,btn){const i=document.getElementById(id);i.type=i.type==='password'?'text':'password';btn.textContent=i.type==='password'?'Pokaż':'Ukryj';}
function dzOver(e,id){e.preventDefault();document.getElementById(id).classList.add('drag');}
function dzLeave(id){document.getElementById(id).classList.remove('drag');}
function dzDrop(e,id,fn){e.preventDefault();document.getElementById(id).classList.remove('drag');const f=e.dataTransfer.files[0];if(f)fn(f);}
function download(c,fn,m){const b=new Blob([c],{type:m}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(a.href);}
function readFile(file,mode='text'){return new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;mode==='array'?r.readAsArrayBuffer(file):r.readAsText(file,'UTF-8');});}
async function loadQuickFile(file){
  if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();
  document.getElementById('q-target-lang').innerHTML=langOptionsHTML();
  const lang=document.getElementById('q-target-lang').value;
  if(['xliff','xlf','xml'].includes(ext)){quickMode='xliff';document.getElementById('target-lang').value=lang;await loadXliff(file);}
  else if(ext==='pptx'){quickMode='pptx';document.getElementById('pptx-target-lang').value=lang;await loadPptx(file);}
  else if(['srt','vtt'].includes(ext)){quickMode=ext;document.getElementById('sub-target-lang').value=lang;await loadSubtitles(file);}
  else{alert('Nieobsługiwany format: .'+ext);return;}
  showQuickLoaded(file.name);
  renderQuickTable();
  renderQuickCost();
}
function showQuickLoaded(filename){
  document.getElementById('quick-drop').style.display='none';
  const fi=document.getElementById('q-file-info');fi.style.display='flex';
  document.getElementById('q-fname').textContent=filename;
  document.getElementById('q-cost-card').style.display='block';
  document.getElementById('q-lang-card').style.display='block';
  document.getElementById('q-segments-card').style.display='block';
  const fmtLabels={xliff:'XLIFF',pptx:'PowerPoint',srt:'Napisy SRT',vtt:'Napisy VTT'};
  const expLabels={xliff:'↓ XLIFF',pptx:'↓ PPTX',srt:'↓ SRT',vtt:'↓ VTT'};
  const col1Labels={xliff:'ID',pptx:'Slajd',srt:'Nr / Czas',vtt:'Nr / Czas'};
  document.getElementById('q-format-label').textContent=fmtLabels[quickMode]||'Segmenty';
  document.getElementById('q-export-btn').textContent=expLabels[quickMode]||'↓ Pobierz';
  document.getElementById('q-col1').textContent=col1Labels[quickMode]||'ID';
}
function resetQuick(){
  quickMode=null;
  document.getElementById('quick-drop').style.display='block';
  document.getElementById('q-file-info').style.display='none';
  document.getElementById('q-cost-card').style.display='none';
  document.getElementById('q-lang-card').style.display='none';
  document.getElementById('q-segments-card').style.display='none';
  document.getElementById('q-pw').style.display='none';
  document.getElementById('q-pf').style.width='0%';
  document.getElementById('q-status').textContent='';
  document.getElementById('q-tbody').innerHTML='';
  document.getElementById('quick-file').value='';
}
function renderQuickTable(){
  const tbody=document.getElementById('q-tbody');tbody.innerHTML='';
  if(!quickMode)return;
  const ft=(document.getElementById('q-filter')?.value||'').toLowerCase();
  const fs=document.getElementById('q-fs')?.value||'all';
  const canEdit=currentRole!=='viewer';
  if(quickMode==='xliff'){
    xliffSegs.forEach((seg,i)=>{
      const src=xliffSrc(seg),tgt=xliffTgt(seg);
      if(ft&&!src.toLowerCase().includes(ft)&&!tgt.toLowerCase().includes(ft))return;
      if(fs!=='all'){if(fs==='tm'&&!seg.fromTM)return;if(fs!=='tm'&&seg.status!==fs)return;}
      const sc=seg.status==='done'?'b-green':seg.status==='error'?'b-red':'b-yellow';
      const tr=document.createElement('tr');
      tr.innerHTML=`<td class="id-cell">${esc(seg.id)}</td><td class="src-cell">${esc(src).replace(/\n/g,'<br>')}</td><td>${seg.fromTM?'<div class="tm-hint">↩ z TM</div>':''}<textarea id="qta-${i}" rows="2" ${canEdit?`onchange="quickEdit(${i},this.value)"`:'readonly'}>${esc(tgt)}</textarea></td><td><span class="badge ${sc}" id="qbadge-${i}">${seg.status==='done'?'OK':seg.status==='error'?'Błąd':'Oczekuje'}</span></td>`;
      tbody.appendChild(tr);
    });
  } else if(quickMode==='pptx'){
    pptxSegs.forEach((seg,i)=>{
      if(ft&&!seg.source.toLowerCase().includes(ft)&&!seg.target.toLowerCase().includes(ft))return;
      if(fs!=='all'){if(fs==='tm'&&!seg.fromTM)return;if(fs!=='tm'&&seg.status!==fs)return;}
      const sc=seg.status==='done'?'b-green':seg.status==='error'?'b-red':'b-yellow';
      const tr=document.createElement('tr');
      tr.innerHTML=`<td class="id-cell">Slajd ${seg.slideNum}</td><td class="src-cell">${esc(seg.source)}</td><td>${seg.fromTM?'<div class="tm-hint">↩ z TM</div>':''}<textarea id="qta-${i}" rows="2" ${canEdit?`onchange="quickEditPptx(${i},this.value)"`:'readonly'}>${esc(seg.target)}</textarea></td><td><span class="badge ${sc}" id="qbadge-${i}">${seg.status==='done'?'OK':seg.status==='error'?'Błąd':'Oczekuje'}</span></td>`;
      tbody.appendChild(tr);
    });
  } else {
    subtitleSegs.forEach((seg,i)=>{
      if(fs==='pending'&&seg.status==='done')return;
      if(fs==='done'&&seg.status!=='done')return;
      if(fs==='tm'&&!seg.fromTM)return;
      const tr=document.createElement('tr');
      tr.innerHTML=`<td class="id-cell">${seg.num}<br><span style="font-size:10px;color:#aaa">${esc(seg.time).replace('-->','→')}</span></td><td class="src-cell">${seg.fromTM?'<div class="tm-hint">↩ z TM</div>':''}${esc(seg.source).replace(/\n/g,'<br>')}</td><td><textarea id="qta-${i}" rows="${Math.max(2,seg.source.split('\n').length)}" ${canEdit?`onchange="quickEditSub(${i},this.value)"`:'readonly'}>${esc(seg.target)}</textarea></td><td><span class="badge ${seg.status==='done'?'b-green':'b-yellow'}" id="qbadge-${i}">${seg.status==='done'?'OK':'Oczekuje'}</span></td>`;
      tbody.appendChild(tr);
    });
  }
  updateQuickProgress();
}
function renderQuickCost(){
  if(!quickMode)return;
  let totalChars=0,tmChars=0;
  if(quickMode==='xliff'){
    xliffSegs.forEach(s=>{
      if(s.type==='plain'){totalChars+=s.source.length;if(s.fromTM||s.status==='done')tmChars+=s.source.length;}
      else{s.textNodes.forEach((n,i)=>{totalChars+=n.text.length;if(s.fromTM||s.targets[i]?.text?.trim())tmChars+=n.text.length;});}
    });
  } else if(quickMode==='pptx'){
    pptxSegs.forEach(s=>{totalChars+=s.source.length;if(s.fromTM||s.status==='done')tmChars+=s.source.length;});
  } else {
    subtitleSegs.forEach(s=>{totalChars+=s.source.length;if(s.fromTM)tmChars+=s.source.length;});
  }
  const toTranslate=Math.max(0,totalChars-tmChars);
  const cred=estimateCredits(toTranslate);
  const bal=currentOrg?.tokens_balance||0;
  const ok=bal>=cred;
  const credEl=document.getElementById('q-credits');
  const balEl=document.getElementById('q-balance');
  document.getElementById('q-chars').textContent=toTranslate.toLocaleString('pl-PL');
  credEl.textContent=cred;credEl.style.color=ok?'#4CDE80':'#e53e3e';
  balEl.textContent=formatTokens(bal);balEl.style.color=ok?'#4CDE80':'#e53e3e';
  const tn=document.getElementById('q-tm-note');
  if(tmChars>0){tn.style.display='block';tn.textContent=`✓ ${tmChars.toLocaleString('pl-PL')} znaków bezpłatnie z pamięci TM — oszczędność ${estimateCredits(tmChars)} kredytów`;}
  else tn.style.display='none';
}
async function quickLangChange(){
  if(!quickMode)return;
  const lang=document.getElementById('q-target-lang').value;
  if(quickMode==='xliff'){
    document.getElementById('target-lang').value=lang;
    xliffSegs.forEach(seg=>{
      if(seg.type==='plain'){seg.target='';seg.status='pending';seg.fromTM=false;}
      else{seg.targets.forEach(t=>t.text='');seg.status='pending';seg.fromTM=false;}
    });
    await applyTMToSegsAsync(xliffSegs,lang);
  } else if(quickMode==='pptx'){
    document.getElementById('pptx-target-lang').value=lang;
    pptxSegs.forEach(seg=>{seg.target='';seg.status='pending';seg.fromTM=false;});
    const tmMap=await lookupTMBatch(pptxSegs.map(s=>s.source),lang);
    pptxSegs.forEach(seg=>{const f=tmMap[tmKey(seg.source)];if(f){seg.target=f;seg.status='done';seg.fromTM=true;}});
  } else {
    document.getElementById('sub-target-lang').value=lang;
    subtitleSegs.forEach(s=>{s.target='';s.status='pending';s.fromTM=false;});
    await subApplyTM(lang);
  }
  renderQuickTable();
  renderQuickCost();
}
async function startQuickTranslation(){
  if(!quickMode)return;
  const lang=document.getElementById('q-target-lang').value;
  const selMap={xliff:'target-lang',pptx:'pptx-target-lang',srt:'sub-target-lang',vtt:'sub-target-lang'};
  const sel=document.getElementById(selMap[quickMode]);if(sel)sel.value=lang;
  const btn=document.getElementById('q-translate-btn');
  const pw=document.getElementById('q-pw');
  const pf=document.getElementById('q-pf');
  const statusEl=document.getElementById('q-status');
  btn.disabled=true;pw.style.display='block';pf.style.width='0%';
  const srcPfId={xliff:'xliff-pf',pptx:'pptx-pf',srt:'sub-pf',vtt:'sub-pf'}[quickMode];
  const srcStId={xliff:'xliff-status',pptx:'pptx-status',srt:'sub-status',vtt:'sub-status'}[quickMode];
  const poll=setInterval(()=>{
    const sp=document.getElementById(srcPfId);if(sp)pf.style.width=sp.style.width;
    const ss=document.getElementById(srcStId);if(ss)statusEl.textContent=ss.textContent;
  },200);
  try{
    if(quickMode==='xliff')await startXliffTranslation();
    else if(quickMode==='pptx')await startPptxTranslation();
    else await startSubtitleTranslation();
  }finally{
    clearInterval(poll);
    btn.disabled=false;
    pf.style.width='100%';
    renderQuickTable();
    renderQuickCost();
  }
}
function exportQuick(){
  if(quickMode==='xliff')exportXliff();
  else if(quickMode==='pptx')exportPptx();
  else exportSubtitles();
}
function retranslateQuickEmpty(){
  if(quickMode==='xliff')xliffRetranslateEmpty();
  else if(quickMode==='pptx')pptxRetranslateEmpty();
}
function quickEdit(i,val){
  const seg=xliffSegs[i];if(!seg)return;
  if(seg.type==='plain'){seg.target=val;seg.status=val.trim()?'done':'pending';}
  const b=document.getElementById('qbadge-'+i);
  if(b){b.className='badge '+(seg.status==='done'?'b-green':'b-yellow');b.textContent=seg.status==='done'?'OK':'Oczekuje';}
  updateQuickProgress();renderQuickCost();
}
function quickEditPptx(i,val){
  const seg=pptxSegs[i];if(!seg)return;
  seg.target=val;seg.status=val.trim()?'done':'pending';
  const b=document.getElementById('qbadge-'+i);
  if(b){b.className='badge '+(seg.status==='done'?'b-green':'b-yellow');b.textContent=seg.status==='done'?'OK':'Oczekuje';}
  updateQuickProgress();renderQuickCost();
}
function quickEditSub(i,val){
  const seg=subtitleSegs[i];if(!seg)return;
  seg.target=val;seg.status=val.trim()?'done':'pending';
  const b=document.getElementById('qbadge-'+i);
  if(b){b.className='badge '+(seg.status==='done'?'b-green':'b-yellow');b.textContent=seg.status==='done'?'OK':'Oczekuje';}
  updateQuickProgress();renderQuickCost();
}
function updateQuickProgress(){
  const segs=quickMode==='xliff'?xliffSegs:quickMode==='pptx'?pptxSegs:subtitleSegs;
  const done=segs.filter(s=>s.status==='done').length;
  const b=document.getElementById('q-prog-badge');
  if(b){b.textContent=`${done}/${segs.length}`;b.className='badge '+(done===segs.length?'b-green':'b-yellow');}
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function fmtDate(iso){const d=new Date(iso);return d.toLocaleDateString('pl-PL')+' '+d.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});}
function fmtPLN(v){return Number(v).toFixed(2).replace('.',',');}
function orgParam(){return currentOrg?`organization_id=eq.${currentOrg.id}`:'id=eq.00000000-0000-0000-0000-000000000000';}