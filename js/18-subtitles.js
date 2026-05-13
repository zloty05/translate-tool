// ══════════════════════════════════════════════════════════
// SUBTITLES (SRT / VTT)
// ══════════════════════════════════════════════════════════

// ── PARSERS ──

function parseSRT(text){
  const blocks=text.trim().split(/\n\s*\n/);
  const segs=[];
  blocks.forEach(block=>{
    const lines=block.trim().split(/\n/);
    if(lines.length<3) return;
    const num=lines[0].trim();
    const time=lines[1].trim();
    if(!time.includes('-->')) return;
    const txt=lines.slice(2).join('\n').trim();
    if(!txt) return;
    segs.push({num,time,source:txt,target:'',status:'pending',fromTM:false});
  });
  return segs;
}

function parseVTT(text){
  // Remove VTT header
  const body=text.replace(/^WEBVTT[^\n]*\n/,'').trim();
  const blocks=body.split(/\n\s*\n/);
  const segs=[];
  let numCounter=1;
  blocks.forEach(block=>{
    const lines=block.trim().split(/\n/);
    if(!lines.length) return;
    let timeIdx=0;
    let num=String(numCounter);
    // Check if first line is a cue identifier (not a timestamp)
    if(!lines[0].includes('-->') && lines.length>1 && lines[1].includes('-->')){
      num=lines[0].trim();
      timeIdx=1;
    } else if(!lines[0].includes('-->')) return;
    const time=lines[timeIdx].trim();
    const txt=lines.slice(timeIdx+1).join('\n').trim();
    if(!txt) return;
    segs.push({num,time,source:txt,target:'',status:'pending',fromTM:false});
    numCounter++;
  });
  return segs;
}

// ── LOAD FILE ──

async function loadSubtitles(file){
  if(!file) return;
  subtitleFilename=file.name;
  subtitleFormat=file.name.toLowerCase().endsWith('.vtt')?'vtt':'srt';
  const text=await readFile(file);
  subtitleSegs=subtitleFormat==='vtt'?parseVTT(text):parseSRT(text);

  // Apply TM
  const lang=document.getElementById('sub-target-lang').value||'English';
  await subApplyTM(lang);

  // Update badges
  document.getElementById('sub-badges').style.display='flex';
  document.getElementById('sub-fname').textContent=file.name;
  document.getElementById('sub-count').textContent=subtitleSegs.length+' bloków';
  const tmHits=subtitleSegs.filter(s=>s.fromTM).length;
  const thEl=document.getElementById('sub-tm-hits');
  if(tmHits>0){thEl.style.display='';thEl.textContent=tmHits+' z TM';}
  else thEl.style.display='none';

  document.getElementById('sub-lang-card').style.display='block';
  document.getElementById('sub-segs-card').style.display='block';
  document.getElementById('sub-target-lang').innerHTML=langOptionsHTML();
  renderSubtitleTable();
  updateSubtitleProgress();
  updateSubCostBox();
}

async function subApplyTM(lang){
  if(!subtitleSegs.length) return;
  const sources=[...new Set(subtitleSegs.map(s=>s.source))];
  const tmMap=await lookupTMBatch(sources,lang);
  let hits=0;
  subtitleSegs.forEach(seg=>{
    if(seg.status==='done') return;
    const f=tmMap[tmKey(seg.source)];
    if(f){seg.target=f;seg.status='done';seg.fromTM=true;hits++;tmApiSaved++;}
  });
  return hits;
}

async function subLangChange(){
  const lang=document.getElementById('sub-target-lang').value;
  subtitleSegs.forEach(s=>{s.target='';s.status='pending';s.fromTM=false;});
  await subApplyTM(lang);
  renderSubtitleTable();
  updateSubtitleProgress();
  updateSubCostBox();
}

// ── RENDER ──

function renderSubtitleTable(){
  const fs=document.getElementById('sub-filter-status')?.value||'all';
  const lang=document.getElementById('sub-target-lang')?.value||'';
  document.getElementById('sub-src-header').textContent='Źródło';
  document.getElementById('sub-tgt-header').textContent='Tłumaczenie ('+lang+')';
  const tbody=document.getElementById('sub-tbody');
  tbody.innerHTML='';

  subtitleSegs.forEach((seg,i)=>{
    if(fs==='pending'&&seg.status==='done') return;
    if(fs==='done'&&seg.status!=='done') return;
    if(fs==='tm'&&!seg.fromTM) return;

    const div=document.createElement('div');
    div.className='sub-row';
    div.innerHTML=`
      <div class="sub-num">${seg.num}</div>
      <div class="sub-time">${esc(seg.time).replace('-->','→')}</div>
      <div class="sub-src">${seg.fromTM?'<div class="tm-hint">↩ z TM</div>':''}${esc(seg.source).replace(/\n/g,'<br>')}</div>
      <div class="sub-col">
        <textarea class="sub-textarea" id="subta-${i}" rows="${Math.max(2,seg.source.split('\n').length)}"
          onchange="subEdit(${i},this.value)">${esc(seg.target)}</textarea>
      </div>`;
    tbody.appendChild(div);
  });
}

function subEdit(i,val){
  subtitleSegs[i].target=val;
  subtitleSegs[i].status=val.trim()?'done':'pending';
  subtitleSegs[i].fromTM=false;
  updateSubtitleProgress();
}

function updateSubtitleProgress(){
  const done=subtitleSegs.filter(s=>s.status==='done').length;
  const b=document.getElementById('sub-prog-badge');
  if(b){b.textContent=done+'/'+subtitleSegs.length;b.className='badge '+(done===subtitleSegs.length?'b-green':'b-yellow');}
}

function updateSubCostBox(){
  const toT=subtitleSegs.filter(s=>s.status!=='done');
  const totalChars=subtitleSegs.reduce((a,s)=>a+s.source.length,0);
  const tmChars=subtitleSegs.filter(s=>s.fromTM).reduce((a,s)=>a+s.source.length,0);
  const charsToT=toT.reduce((a,s)=>a+s.source.length,0);
  const credits=estimateCredits(charsToT);
  const balance=currentOrg?.tokens_balance||0;
  const hasEnough=balance>=credits;
  const box=document.getElementById('sub-cost-box');
  const grid=document.getElementById('sub-cost-grid');
  const note=document.getElementById('sub-cost-note');
  const tmEl=document.getElementById('sub-cost-tm');
  if(!box) return;
  box.style.display='block';
  const done=subtitleSegs.filter(s=>s.fromTM).length;
  if(done>0){tmEl.style.display='block';tmEl.textContent=`✓ TM: ${done} bloków bezpłatnie`;}
  else tmEl.style.display='none';
  if(!toT.length){grid.innerHTML='<div class="cost-cell"><div class="cost-num green">0</div><div class="cost-lbl">Kredytów</div></div>';note.innerHTML='Wszystkie z TM.';return;}
  const balColor=hasEnough?'#1a7a3f':'#b32424';
  const balInfo=hasEnough?`<span style="color:#1a7a3f;">✓ Wystarczy (masz ${formatTokens(balance)} kredytów)</span>`:`<span style="color:#b32424;">✗ Brakuje ${credits-balance} kredytów</span>`;
  grid.innerHTML=`<div class="cost-cell"><div class="cost-num ${hasEnough?'green':'orange'}">${credits}</div><div class="cost-lbl">Kredytów (= PLN)</div></div>
    <div class="cost-cell"><div class="cost-num">${toT.length}</div><div class="cost-lbl">Bloków do tłum.</div></div>
    <div class="cost-cell"><div class="cost-num" style="color:${balColor};">${formatTokens(balance)}</div><div class="cost-lbl">Twoje saldo</div></div>`;
  note.innerHTML=`${balInfo}<br><span style="font-size:11px;color:#999;">1 kredyt = 1 000 znaków · ${charsToT.toLocaleString('pl-PL')} znaków do przetłumaczenia</span>`;
}

// ── TRANSLATION ──

async function startSubtitleTranslation(){
  const toT=subtitleSegs.filter(s=>s.status!=='done');
  if(!toT.length){setSubStatus('Wszystko przetłumaczone!');return;}
  const totalChars=toT.reduce((a,s)=>a+s.source.length,0);
  if(!checkTokenBalance(estimateTokensForTranslation(totalChars))) return;
  await runSubtitleBatch(toT);
}

async function subtitleRetranslateEmpty(){
  const toT=subtitleSegs.filter(s=>!s.target.trim());
  if(!toT.length){setSubStatus('Brak pustych bloków.');return;}
  const totalChars=toT.reduce((a,s)=>a+s.source.length,0);
  if(!checkTokenBalance(estimateTokensForTranslation(totalChars))) return;
  await runSubtitleBatch(toT);
}

async function runSubtitleBatch(toT){
  const lang=document.getElementById('sub-target-lang').value;
  document.getElementById('sub-pw').style.display='block';
  document.getElementById('sub-pf').style.width='0%';
  setSubStatus('Tłumaczenie '+toT.length+' bloków na '+lang+'...');

  const CHUNK=15;
  const CONTEXT=3; // bloki kontekstu przed/po
  const failed=[];
  let done=0,totalCostUsd=0;

  for(let i=0;i<toT.length;i+=CHUNK){
    const chunk=toT.slice(i,i+CHUNK);

    // Build context - 3 blocks before and after chunk in original array
    const firstIdx=subtitleSegs.indexOf(chunk[0]);
    const lastIdx=subtitleSegs.indexOf(chunk[chunk.length-1]);
    const ctxBefore=subtitleSegs.slice(Math.max(0,firstIdx-CONTEXT),firstIdx).map(s=>s.source);
    const ctxAfter=subtitleSegs.slice(lastIdx+1,lastIdx+1+CONTEXT).map(s=>s.source);

    const dict=buildDictPromptForChunk(lang,chunk.map(s=>s.source),null);
    const charsIn=chunk.reduce((a,s)=>a+s.source.length,0);

    const ctxBeforeStr=ctxBefore.length?'Kontekst poprzedzający (tylko do odczytu):\n'+ctxBefore.map(t=>'"'+t+'"').join('\n')+'\n\n':'';
    const ctxAfterStr=ctxAfter.length?'\nKontekst następujący (tylko do odczytu):\n'+ctxAfter.map(t=>'"'+t+'"').join('\n'):'';
    const prompt='Tłumacz napisy wideo na: '+lang+'.\n\nZasady:\n- Tłumacz KAŻDY blok z listy "do tłumaczenia"\n- Zachowaj zbliżoną długość tekstu\n- Nie łącz ani nie dziel bloków\n- Zachowaj styl mówiony, interpunkcję\n- Zmienne %...% przepisuj bez zmian'+dict+'\n\n'+ctxBeforeStr+'Do tłumaczenia ('+chunk.length+' bloków):\n'+JSON.stringify(chunk.map(s=>({key:subtitleSegs.indexOf(s),text:s.source})))+ctxAfterStr+'\n\nOdpowiedz TYLKO JSON: [{"key":0,"translation":"..."}] — bez markdown.';

    try{
      const raw=await apiCall(prompt,2000);
      const res=JSON.parse(raw.replace(/```json|```/g,'').trim());
      const charsOut=res.reduce((a,r)=>a+(r.translation?.length||0),0);
      totalCostUsd+=((charsIn/CPT)/1e6)*PRICE_IN+((charsOut/CPT)/1e6)*PRICE_OUT;

      const returnedKeys=new Set(res.map(r=>r.key));
      chunk.forEach(s=>{if(!returnedKeys.has(subtitleSegs.indexOf(s))) failed.push(s);});

      res.forEach(r=>{
        const seg=subtitleSegs[r.key];
        if(!seg||!r.translation) return;
        seg.target=r.translation;seg.status='done';seg.fromTM=false;
        const idx=subtitleSegs.indexOf(seg);
        const ta=document.getElementById('subta-'+idx);
        if(ta){ta.value=r.translation;ta.className='sub-textarea saved';setTimeout(()=>ta.className='sub-textarea',2000);}
      });
    }catch(err){
      console.error('Subtitle chunk error:',err);
      failed.push(...chunk);
    }

    done+=chunk.length;
    document.getElementById('sub-pf').style.width=Math.round(done/toT.length*100)+'%';
    updateSubtitleProgress();
    await sleep(150);
  }

  // Retry failed
  if(failed.length){
    setSubStatus('Ponawiam '+failed.length+' brakujących bloków...');
    for(const seg of failed){
      const prompt=`Przetłumacz ten napis na ${lang}. Odpowiedz TYLKO JSON: {"translation":"..."}\n\nTekst: ${JSON.stringify(seg.source)}`;
      try{
        const raw=await apiCall(prompt,500);
        const res=JSON.parse(raw.replace(/```json|```/g,'').trim());
        const t=res.translation||'';
        if(!t) continue;
        seg.target=t;seg.status='done';
        const idx=subtitleSegs.indexOf(seg);
        const ta=document.getElementById('subta-'+idx);
        if(ta){ta.value=t;ta.className='sub-textarea saved';setTimeout(()=>ta.className='sub-textarea',2000);}
      }catch(e){console.error('Sub retry error:',e);}
      await sleep(150);
    }
  }

  const pairs=subtitleSegs.filter(s=>s.status==='done'&&s.target.trim()).map(s=>({src:s.source,tgt:s.target}));
  await pushTMBatch(pairs,lang,'srt');
  const totalChars=toT.reduce((a,s)=>a+s.source.length,0);
  const creditsUsed=estimateCredits(totalChars);
  await deductCredits(totalChars,subtitleFilename+' → '+lang,lang);
  updateSubCostBox();
  setSubStatus(`Gotowe! Użyto ${creditsUsed} kredytów. Saldo: ${formatTokens(currentOrg?.tokens_balance||0)} kredytów.`);
}

function setSubStatus(m){document.getElementById('sub-status').textContent=m;}

// ── EXPORT ──

function exportSubtitles(fmt){
  if(!subtitleSegs.length){alert('Brak napisów.');return;}
  const lang=document.getElementById('sub-target-lang')?.value||'translated';
  let output='';

  if(fmt==='srt'){
    output=subtitleSegs.map(seg=>`${seg.num}\n${seg.time}\n${seg.target||seg.source}`).join('\n\n');
  } else {
    // VTT
    output='WEBVTT\n\n'+subtitleSegs.map(seg=>`${seg.num}\n${seg.time}\n${seg.target||seg.source}`).join('\n\n');
  }

  const baseName=subtitleFilename.replace(/\.(srt|vtt)$/i,'');
  download(output, `${baseName}_${lang.toLowerCase().replace(/\s+/g,'_')}.${fmt}`, 'text/plain;charset=utf-8');
}