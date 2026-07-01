// ══════════════════════════════════════════════════════════
// PROJECTS SYSTEM
// ══════════════════════════════════════════════════════════

// ── PROJECT LIST ──

async function loadProjects(){
  if(!currentOrg) return;
  document.getElementById('proj-loading').style.display='flex';
  try{
    projectsCache = await dbGet('projects',`?organization_id=eq.${currentOrg.id}&order=created_at.desc`);
    if(projectsCache.length){
      const ids = projectsCache.map(p=>p.id).join(',');
      const assignments = await dbGet('project_language_assignments',`?project_id=in.(${ids})`);
      projectsCache.forEach(p=>{ p.assignments=assignments.filter(a=>a.project_id===p.id); });
    }
    const visibleCount = currentRole === 'translator'
      ? projectsCache.filter(p => (p.assignments||[]).some(a => a.assigned_user_id === currentUser.id)).length
      : projectsCache.length;
    document.getElementById('proj-count').textContent = visibleCount;
    renderProjectList();
    await loadDashMetrics();
  }catch(e){ console.error('loadProjects error:',e); }
  document.getElementById('proj-loading').style.display='none';
}

function renderProjectList(){
  const ft=(document.getElementById('proj-filter')?.value||'').toLowerCase();
  let data=[...projectsCache];
  if(projFilterMode==='active') data=data.filter(p=>p.status==='active');
  else if(projFilterMode==='completed') data=data.filter(p=>p.status==='completed'||p.status==='archived');
  if(ft) data=data.filter(p=>p.name.toLowerCase().includes(ft)||(p.description||'').toLowerCase().includes(ft));
  if(currentRole==='translator'){
    data=data.filter(p=>(p.assignments||[]).some(a=>a.assigned_user_id===currentUser.id));
  }
  const container=document.getElementById('proj-list-container');
  if(!data.length){
    const msg=projFilterMode==='active'?'Brak aktywnych projektów':projFilterMode==='completed'?'Brak ukończonych projektów':'Brak projektów';
    container.innerHTML=`<div class="dash-proj-card" style="padding:40px;text-align:center;color:#888;font-size:13px;cursor:default;">${msg}</div>`;
    return;
  }
  const isDone=projFilterMode==='completed';
  container.innerHTML=data.map(p=>{
    const asgn=p.assignments||[];
    const readyCount=asgn.filter(a=>a.status==='ready'||a.status==='approved').length;
    const total=asgn.length;
    const pct=total>0?Math.round(readyCount/total*100):0;
    const barColor=pct===100?'#4CDE80':'#1a1a1a';
    const statusCls=p.status==='completed'?'status-completed':p.status==='archived'?'status-archived':'status-active';
    const visibleAsgn=currentRole==='translator'?asgn.filter(a=>a.assigned_user_id===currentUser.id):asgn;
    const langPills=visibleAsgn.map(a=>{
      const cls=a.status==='approved'?'dlp-ok':a.status==='ready'?'dlp-ready':a.status==='in_progress'?'dlp-go':'dlp-wait';
      return`<span class="dlp ${cls}">${getLangFlag(a.lang)} ${a.lang.substring(0,2).toUpperCase()} · ${statusLabel(a.status)}</span>`;
    }).join('');
    const svgEdit=`<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const svgDel=`<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    return`<div class="dash-proj-card ${statusCls}" onclick="openProject('${p.id}')">
      <div class="dpc-top">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="dpc-title">${esc(p.name)}</div>
            ${isDone?'<span class="dpc-done-badge">✓ Ukończony</span>':''}
          </div>
          <div class="dpc-meta">${p.file_type?.toUpperCase()||'—'} · ${getLangFlag(p.source_lang)} ${esc(p.source_lang)} · ${fmtDate(p.created_at)}</div>
        </div>
        <div class="dpc-actions" onclick="event.stopPropagation()">
          ${currentRole==='admin'?`${!isDone?`<button class="btn btn-sm hide-viewer" onclick="editProject('${p.id}')" title="Edytuj">${svgEdit}</button>`:''}
          <button class="btn btn-sm btn-red hide-viewer" onclick="deleteProject('${p.id}','${esc(p.name)}')" title="Usuń">${svgDel}</button>`:''}
        </div>
      </div>
      <div class="dpc-bar-wrap"><div class="dpc-bar" style="width:${pct}%;background:${barColor};"></div></div>
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div class="dpc-langs">${langPills||'<span style="color:#ccc;font-size:12px;">Brak przypisanych języków</span>'}</div>
        <div style="font-size:11px;color:#aaa;white-space:nowrap;margin-left:8px;">${readyCount}/${total} języków</div>
      </div>
    </div>`;
  }).join('');
}


function statusLabel(s){ return {pending:'Oczekuje',in_progress:'W toku',ready:'Gotowe do weryfikacji',approved:'Zatwierdzone'}[s]||s; }
function getLangFlag(lang){ return LANGS.find(l=>l.code===lang)?.flag||'🌐'; }

// ── NEW PROJECT MODAL ──

function showNewProjectModal(){
  document.getElementById('new-proj-modal').style.display='flex';
  npLangRows=[];
  document.getElementById('np-lang-assignments').innerHTML='';
  document.getElementById('np-name').value='';
  document.getElementById('np-desc').value='';
  document.getElementById('np-file-label').textContent='Kliknij lub przeciągnij plik';
  document.getElementById('new-proj-error').style.display='none';
  npFile=null;
  addLangAssignment();
}

function closeNewProjectModal(){
  document.getElementById('new-proj-modal').style.display='none';
}

function npFileSelected(file){
  npFile=file;
  document.getElementById('np-file-label').textContent='✓ '+file.name;
  // Auto-detect file type
  if(file.name.endsWith('.pptx')) document.getElementById('np-file-type').value='pptx';
  else document.getElementById('np-file-type').value='xliff';
}

async function addLangAssignment(){
  // Load team members for dropdown
  if(!teamMembersCache.length && currentOrg){
    teamMembersCache = await dbGet('organization_members',`?organization_id=eq.${currentOrg.id}`);
    const profiles = await dbGet('profiles',`?id=in.(${teamMembersCache.map(m=>m.user_id).join(',')})`);
    let emailMap2={};
    try{
      const ed=await dbGet('member_emails',`?organization_id=eq.${currentOrg.id}`);
      ed.forEach(e=>{ emailMap2[e.user_id]={email:e.email,display_name:e.display_name}; });
    }catch(e){}
    teamMembersCache = teamMembersCache.map(m=>({
      ...m,
      profile:profiles.find(p=>p.id===m.user_id),
      email:emailMap2[m.user_id]?.email||null,
      display_name:emailMap2[m.user_id]?.display_name||null
    }));
  }
  const rowId = 'la-'+Date.now();
  npLangRows.push(rowId);
  const memberOptions = teamMembersCache
    .filter(m=>m.role!=='viewer')
    .map(m=>`<option value="${m.user_id}">${esc(getMemberName(m))} (${m.role})</option>`)
    .join('');
  const langOptions = langOptionsHTML();
  const div=document.createElement('div');
  div.id=rowId;
  div.style.cssText='display:grid;grid-template-columns:1fr 1fr 32px;gap:8px;align-items:center;';
  div.innerHTML=`
    <select class="la-lang" style="width:100%;">${langOptions}</select>
    <select class="la-user" style="width:100%;"><option value="">— bez przypisania —</option>${memberOptions}</select>
    <button class="del-btn" onclick="document.getElementById('${rowId}').remove()" style="font-size:18px;">×</button>`;
  document.getElementById('np-lang-assignments').appendChild(div);
}

async function createProject(){
  const name=document.getElementById('np-name').value.trim();
  const srcLang=document.getElementById('np-src-lang').value;
  const fileType=document.getElementById('np-file-type').value;
  const desc=document.getElementById('np-desc').value.trim();
  const errEl=document.getElementById('new-proj-error');

  if(!name){ errEl.textContent='Wpisz nazwę projektu.'; errEl.style.display='block'; return; }
  if(!npFile){ errEl.textContent='Wgraj plik źródłowy.'; errEl.style.display='block'; return; }

  // Collect lang assignments
  const assignments=[];
  document.querySelectorAll('#np-lang-assignments > div').forEach(row=>{
    const lang=row.querySelector('.la-lang')?.value;
    const userId=row.querySelector('.la-user')?.value;
    if(lang) assignments.push({lang, assigned_user_id:userId||null});
  });
  if(!assignments.length){ errEl.textContent='Dodaj co najmniej jeden język docelowy.'; errEl.style.display='block'; return; }

  errEl.style.display='none';

  try{
    // Create project
    const[proj]=await dbPost('projects',{
      name, description:desc, source_lang:srcLang, file_type:fileType,
      original_filename:npFile.name, organization_id:currentOrg.id, created_by:currentUser.id
    });

    // Upload original file to Supabase Storage
    const filePath=`${currentOrg.id}/${proj.id}/${npFile.name}`;
    const fileContent = fileType==='xliff' ? await readFile(npFile) : await readFile(npFile,'array');
    const{error:uploadErr}=await supa.storage.from('project-files').upload(
      filePath,
      fileType==='xliff' ? new Blob([fileContent],{type:'application/xml'}) : new Blob([fileContent]),
      {upsert:true}
    );
    if(uploadErr) console.warn('File upload warning:',uploadErr.message);
    else {
      // Save file path to project
      await dbPatch('projects',{original_file_path:filePath},`?id=eq.${proj.id}`);
    }

    // Parse file and create segments
    let segments=[];
    if(fileType==='xliff') segments=await parseXliffForProject(npFile, srcLang);
    else segments=await parsePptxForProject(npFile, srcLang);

    // Insert segments in batches
    const BATCH=50;
    for(let i=0;i<segments.length;i+=BATCH){
      const batch=segments.slice(i,i+BATCH).map((s,idx)=>({
        project_id:proj.id, segment_key:s.key, source_text:s.source,
        translations:{}, segment_order:i+idx, metadata:s.metadata||{}
      }));
      await dbPost('project_segments',batch);
    }

    // Create language assignments
    for(const a of assignments){
      await dbPost('project_language_assignments',{
        project_id:proj.id, lang:a.lang,
        assigned_user_id:a.assigned_user_id||null, status:'pending'
      });
    }

    closeNewProjectModal();
    await loadProjects();
    // Open the new project
    openProject(proj.id);
  }catch(e){ errEl.textContent='Błąd: '+e.message; errEl.style.display='block'; }
}

// ── PARSE FILES FOR PROJECT ──

async function parseXliffForProject(file, srcLang){
  const xml=await readFile(file);
  const doc=domParser.parseFromString(xml,'application/xml');
  const units=Array.from(doc.querySelectorAll('trans-unit'));
  const segments=[];
  units.forEach(unit=>{
    const unitId=unit.getAttribute('id')||'';
    const datatype=unit.getAttribute('datatype')||'';
    const srcEl=unit.querySelector('source');
    if(!srcEl) return;
    if(datatype==='plaintext'){
      const text=(srcEl.textContent||'').trim();
      if(!text) return;
      segments.push({key:unitId, source:text, metadata:{type:'plain',unitId}});
    } else {
      const gNodes=Array.from(srcEl.querySelectorAll('g[ctype="x-text"]'));
      // Filter: only non-empty text nodes that are not just whitespace
      const textNodes=gNodes.map(g=>({gId:g.getAttribute('id'),text:g.textContent||''}))
        .filter(n=>n.text.trim().length>0);
      if(!textNodes.length) return;
      // Store each non-empty text node as separate segment for TM compatibility
      textNodes.forEach(n=>{
        // Preserve CR (\r) and LF (\n) - only trim spaces and tabs
        const srcText = n.text.replace(/^[ 	]+|[ 	]+$/g, '');
        if(!srcText) return;
        segments.push({key:unitId+'__'+n.gId, source:srcText, metadata:{type:'rich',unitId,gId:n.gId,allTextNodes:gNodes.map(g=>({gId:g.getAttribute('id'),text:g.textContent||''}))}});
      });
    }
  });
  return segments;
}

async function parsePptxForProject(file, srcLang){
  const buf=await readFile(file,'array');
  const zip=await JSZip.loadAsync(buf);
  const segments=[];
  const slideFiles=Object.keys(zip.files).filter(n=>n.match(/^ppt\/slides\/slide\d+\.xml$/)).sort((a,b)=>parseInt(a.match(/\d+/)[0])-parseInt(b.match(/\d+/)[0]));
  for(let si=0;si<slideFiles.length;si++){
    const path=slideFiles[si];
    const slideNum=parseInt(path.match(/slide(\d+)/)[1]);
    const xml=await zip.file(path).async('string');
    const doc=domParser.parseFromString(xml,'application/xml');
    const extract=(paras,keyPrefix,shapeName)=>{
      paras.forEach((para,pi)=>{
        const runs=Array.from(para.querySelectorAll('r'));
        if(!runs.length) return;
        const text=runs.map(r=>r.querySelector('t')?.textContent||'').join('');
        if(!text.trim()) return;
        segments.push({key:`${keyPrefix}_p${pi}`,source:text,metadata:{slideNum,shapeName,keyPrefix,paraIdx:pi}});
      });
    };
    Array.from(doc.querySelectorAll('sp')).forEach((shape,si)=>{
      const name=shape.querySelector('nvSpPr cNvPr')?.getAttribute('name')||`Shape${si}`;
      extract(Array.from(shape.querySelectorAll('p')),`s${slideNum}_sh${si}`,name);
    });
    Array.from(doc.querySelectorAll('graphicFrame')).forEach((frame,fi)=>{
      const name=frame.querySelector('nvGraphicFramePr cNvPr')?.getAttribute('name')||`Table${fi}`;
      Array.from(frame.querySelectorAll('tr')).forEach((row,ri)=>{
        Array.from(row.querySelectorAll('tc')).forEach((cell,ci)=>{
          extract(Array.from(cell.querySelectorAll('p')),`s${slideNum}_tbl${fi}_r${ri}_c${ci}`,`${name}[W${ri+1}K${ci+1}]`);
        });
      });
    });
  }
  return segments;
}

// ── PROJECT EDITOR ──

async function openProject(projectId){
  const proj=projectsCache.find(p=>p.id===projectId);
  if(!proj) return;
  currentProject=proj;
  currentAssignments=proj.assignments||[];

  // Load segments
  const segs=await dbGet('project_segments',`?project_id=eq.${projectId}&order=segment_order.asc`);
  currentProjectSegs=segs;

  // Show editor
  document.getElementById('proj-list-view').style.display='none';
  document.getElementById('proj-editor-view').style.display='block';
  document.getElementById('editor-proj-title').textContent=proj.name;

  // Show correct export button based on file type
  const isPptx=proj.file_type==='pptx';
  document.getElementById('proj-xliff-btn').style.display=isPptx?'none':'';
  document.getElementById('proj-pptx-btn').style.display=isPptx?'':'none';

  // Build language tabs — admin sees all, translator sees only their langs
  buildEditorLangTabs();
}

function buildEditorLangTabs(){
  const tabs=document.getElementById('editor-lang-tabs');
  let langs=currentAssignments;

  // Translators only see assigned languages
  if(currentRole==='translator'){
    langs=currentAssignments.filter(a=>a.assigned_user_id===currentUser.id);
  }

  if(!langs.length){
    tabs.innerHTML='<span style="font-size:12px;color:#aaa;padding:6px 12px;">Brak przypisanych języków</span>';
    return;
  }

  const statusCls={pending:'etab-pending',in_progress:'etab-in_progress',ready:'etab-ready',approved:'etab-approved'};
  tabs.innerHTML=langs.map((a,i)=>{
    const isApproved=a.status==='approved'||a.status==='ready';
    const cls=statusCls[a.status]||'etab-pending';
    return`<div class="editor-lang-tab${isApproved?' approved':''}" onclick="switchEditorLang('${a.lang}')" id="etab-${a.lang}">
      ${getLangFlag(a.lang)} <span>${a.lang}</span>
      <span class="etab-status ${cls}" id="etab-status-${a.lang}">${statusLabel(a.status)}</span>
    </div>`;
  }).join('');

  // Switch to first language
  switchEditorLang(langs[0].lang);
}

function switchEditorLang(lang){
  currentProjectLang=lang;
  document.querySelectorAll('.editor-lang-tab').forEach(t=>t.classList.remove('active'));
  const tab=document.getElementById('etab-'+lang);
  if(tab) tab.classList.add('active');

  const proj=currentProject;
  document.getElementById('editor-src-header').textContent=`Źródło (${getLangFlag(proj.source_lang)} ${proj.source_lang})`;
  document.getElementById('editor-tgt-header').textContent=`Tłumaczenie (${getLangFlag(lang)} ${lang})`;

  renderEditorTable(lang);
  updateEditorProgress(lang);

  // Update submit button
  const assignment=currentAssignments.find(a=>a.lang===lang);
  const submitBtn=document.getElementById('editor-submit-btn');
  if(submitBtn){
    if(assignment?.status==='approved'){
      submitBtn.textContent='✓ Zatwierdzone';submitBtn.disabled=true;
      submitBtn.className='btn btn-sm b-green';
    } else if(assignment?.status==='ready'){
      if(currentRole==='admin'){
        submitBtn.textContent='Zatwierdź';submitBtn.disabled=false;
        submitBtn.className='btn btn-dark btn-sm';
        submitBtn.onclick=()=>approveLanguage(lang);
      } else {
        submitBtn.textContent='✓ Gotowe do weryfikacji';submitBtn.disabled=true;
        submitBtn.className='btn btn-sm b-green';
      }
    } else {
      submitBtn.textContent='Oznacz jako gotowe';submitBtn.disabled=false;
      submitBtn.className='btn btn-dark btn-sm hide-viewer';
      submitBtn.onclick=()=>submitForReview(lang);
    }
  }
}

function renderEditorTable(lang){
  const tbody=document.getElementById('editor-tbody');
  const canEdit=currentRole!=='viewer';
  const assignment=currentAssignments.find(a=>a.lang===lang);
  const isLocked=assignment?.status==='approved';
  const sortMode=document.getElementById('editor-sort')?.value||'order';

  // Sort segments
  let segs=[...currentProjectSegs];
  if(sortMode==='status-empty'){
    segs.sort((a,b)=>{
      const aHas=!!(a.translations?.[lang]?.text);
      const bHas=!!(b.translations?.[lang]?.text);
      if(aHas!==bHas) return aHas?1:-1;
      return a.segment_order-b.segment_order;
    });
  } else if(sortMode==='status-done'){
    segs.sort((a,b)=>{
      const aHas=!!(a.translations?.[lang]?.text);
      const bHas=!!(b.translations?.[lang]?.text);
      if(aHas!==bHas) return aHas?-1:1;
      return a.segment_order-b.segment_order;
    });
  }

  tbody.innerHTML='';
  segs.forEach((seg,i)=>{
    const tData=seg.translations?.[lang];
    const tText=tData?.text||'';
    const tStatus=tData?.status||'empty';
    const tr=document.createElement('tr');
    const rowCount=Math.max(2,(seg.source_text.split(/\r|\n/).length));
    tr.innerHTML=`
      <td style="color:#ccc;font-size:11px;text-align:center;">${i+1}</td>
      <td><div class="seg-src" style="white-space:pre-wrap;">${esc(seg.source_text)}</div></td>
      <td><textarea class="seg-textarea" id="seg-${seg.id}"
        rows="${rowCount}" ${(!canEdit||isLocked)?'readonly':''}
        onInput="onSegInput('${seg.id}','${lang}',this)"
        >${esc(tText)}</textarea></td>
      <td><span class="status-pill sp-${tStatus==='translated'?'translated':tStatus==='approved'?'approved':'empty'}" id="spill-${seg.id}-${lang}">
        ${tStatus==='translated'?'Tłum.':tStatus==='approved'?'OK':'Puste'}
      </span></td>`;
    tbody.appendChild(tr);
  });
}

function onSegInput(segId, lang, textarea){
  // Mark as changed visually
  textarea.className='seg-textarea changed';
  // Autosave after 1.5s of inactivity
  clearTimeout(autosaveTimers[segId+lang]);
  autosaveTimers[segId+lang]=setTimeout(()=>saveSegment(segId,lang,textarea),1500);
}

async function saveSegment(segId, lang, textarea){
  const text=textarea.value;
  try{
    const{data,error}=await supa.rpc('save_segment_translation',{seg_id:segId,lang,new_text:text});
    if(error) throw new Error(error.message);
    textarea.className='seg-textarea saved';
    setTimeout(()=>textarea.className='seg-textarea',2000);
    // Update local cache
    const seg=currentProjectSegs.find(s=>s.id===segId);
    if(seg){
      if(!seg.translations) seg.translations={};
      seg.translations[lang]={text,status:text?'translated':'empty',updated_by:currentUser.id,updated_at:new Date().toISOString()};
    }
    // Detect manual correction vs AI translation
    if(seg && seg.ai_translation !== undefined){
      const isEdited=text.trim()!==(seg.ai_translation||'').trim();
      if(isEdited!==seg.manually_edited){
        await dbPatch('project_segments',{manually_edited:isEdited},`?id=eq.${segId}`);
        seg.manually_edited=isEdited;
      }
    }
    // Save to TM if text is not empty
    if(text.trim()&&seg){
      pushTMBatch([{src:seg.source_text,tgt:text}],lang,'xliff');
    }
    // Update status pill
    const pill=document.getElementById(`spill-${segId}-${lang}`);
    if(pill){
      pill.className='status-pill '+(text?'sp-translated':'sp-empty');
      pill.textContent=text?'Tłum.':'Puste';
    }
    updateEditorProgress(lang);
    setAutosaveIndicator('● Zapisano '+new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'}));
  }catch(e){
    textarea.className='seg-textarea';
    setAutosaveIndicator('⚠ Błąd zapisu: '+e.message);
  }
}

function setAutosaveIndicator(msg){
  const el=document.getElementById('autosave-indicator');
  if(el) el.textContent=msg;
}

function showEditorProgress(label, pct){
  const wrap=document.getElementById('editor-progress-wrap');
  const bar=document.getElementById('editor-progress-bar');
  const labelEl=document.getElementById('editor-progress-label');
  const pctEl=document.getElementById('editor-progress-pct');
  if(!wrap) return;
  wrap.style.display='block';
  if(labelEl) labelEl.textContent=label;
  if(pctEl) pctEl.textContent=Math.round(pct)+'%';
  if(bar) bar.style.width=Math.round(pct)+'%';
}

function hideEditorProgress(){
  const wrap=document.getElementById('editor-progress-wrap');
  if(wrap) wrap.style.display='none';
}

function updateEditorProgress(lang){
  const total=currentProjectSegs.length;
  const done=currentProjectSegs.filter(s=>s.translations?.[lang]?.text).length;
  const badge=document.getElementById('editor-progress-badge');
  if(badge){ badge.textContent=`${done}/${total}`; badge.className='badge '+(done===total?'b-green':'b-yellow'); }
}

async function runAITranslation(toTranslate, lang){
  if(!toTranslate.length) return;
  const CHUNK=15; // smaller chunks = fewer missing segments
  let done=0, totalCostUsd=0;
  const failed=[]; // track failed segments for retry

  for(let i=0;i<toTranslate.length;i+=CHUNK){
    const chunk=toTranslate.slice(i,i+CHUNK);
    const charsIn=chunk.reduce((a,s)=>a+s.source_text.length,0);

    // Context: 3 segments before and after chunk
    const CONTEXT=3;
    const firstIdx=toTranslate.indexOf(chunk[0]);
    const lastIdx=toTranslate.indexOf(chunk[chunk.length-1]);
    const ctxBefore=toTranslate.slice(Math.max(0,firstIdx-CONTEXT),firstIdx).map(s=>s.source_text);
    const ctxAfter=toTranslate.slice(lastIdx+1,lastIdx+1+CONTEXT).map(s=>s.source_text);

    // Content type based on file type + project description
    const fileType=currentProject?.file_type||'xliff';
    const projDesc=currentProject?.description||'';
    const contentType=fileType==='pptx'
      ? 'prezentację PowerPoint'
      : 'interaktywne szkolenie e-learningowe SCORM (Articulate Storyline)';
    const contextLine=projDesc
      ? 'Kontekst projektu: "'+projDesc+'"'
      : '';

    const dict=buildDictPromptForChunk(lang,chunk.map(s=>s.source_text),currentProject?.source_lang);
    const ctxBeforeStr=ctxBefore.length
      ? '\nKontekst poprzedzający (nie tłumacz — użyj jako kontekst):\n'+ctxBefore.map((t,i)=>'['+(firstIdx-ctxBefore.length+i+1)+'] '+t).join('\n')
      : '';
    const ctxAfterStr=ctxAfter.length
      ? '\nKontekst następujący (nie tłumacz — użyj jako kontekst):\n'+ctxAfter.map((t,i)=>'['+(lastIdx+i+2)+'] '+t).join('\n')
      : '';

    const prompt=`Jesteś tłumaczem materiałów e-learningowych. Przetłumacz KAŻDY segment na: ${lang}.
Tłumaczysz: ${contentType}.${contextLine?'\n'+contextLine:''}
WAŻNE:
- Odpowiedź musi zawierać tłumaczenie dla KAŻDEGO podanego klucza
- Zachowaj wszystkie znaki nowej linii (\r, \n) dokładnie w tych samych miejscach co w oryginale
- Znak \r to miękki enter (Shift+Enter) — musi pozostać w tłumaczeniu
- Zachowaj styl, zmienne %...% przepisuj bez zmian
- Jeśli termin ze słownika zaczyna zdanie lub występuje z wielką literą w oryginale — zachowaj wielką literę w tłumaczeniu
- Styl: techniczny, zdania zwięzłe${dict}${ctxBeforeStr}

Do tłumaczenia (${chunk.length} szt.):
${JSON.stringify(chunk.map(s=>({key:s.id,text:s.source_text})))}${ctxAfterStr}

Odpowiedz TYLKO JSON: [{"key":"...","translation":"..."}] — bez markdown, bez preambuły.`;

        try{
      const raw=await apiCall(prompt);
      const res=JSON.parse(raw.replace(/```json|```/g,'').trim());
      const charsOut=res.reduce((a,r)=>a+(r.translation?.length||0),0);
      totalCostUsd+=((charsIn/CPT)/1e6)*PRICE_IN+((charsOut/CPT)/1e6)*PRICE_OUT;

      // Track which keys came back
      const returnedKeys=new Set(res.map(r=>r.key));
      const missingInChunk=chunk.filter(s=>!returnedKeys.has(s.id));
      if(missingInChunk.length) failed.push(...missingInChunk);

      for(const r of res){
        if(!r.translation) continue;
        const seg=currentProjectSegs.find(s=>s.id===r.key);
        if(!seg) continue;
        await supa.rpc('save_segment_translation',{seg_id:seg.id,lang,new_text:r.translation});
        await dbPatch('project_segments',{ai_translation:r.translation,manually_edited:false},`?id=eq.${seg.id}`);
        if(!seg.translations) seg.translations={};
        seg.translations[lang]={text:r.translation,status:'translated',updated_by:currentUser.id,updated_at:new Date().toISOString()};
        seg.ai_translation=r.translation;
        seg.manually_edited=false;
        const ta=document.getElementById('seg-'+seg.id);
        if(ta){ ta.value=r.translation; ta.className='seg-textarea saved'; setTimeout(()=>ta.className='seg-textarea',2000); }
        const pill=document.getElementById(`spill-${seg.id}-${lang}`);
        if(pill){ pill.className='status-pill sp-translated'; pill.textContent='Tłum.'; }
      }
    }catch(err){
      console.error('AI chunk error:',err);
      failed.push(...chunk);
    }

    done+=chunk.length;
    const aiPct=Math.round(done/toTranslate.length*100);
    showEditorProgress(`Tłumaczenie AI: ${done}/${toTranslate.length} segmentów`,aiPct);
    setAutosaveIndicator(`⏳ Tłumaczenie AI: ${done}/${toTranslate.length} segmentów...`);
    updateEditorProgress(lang);
    await sleep(200);
  }

  // Retry failed segments one by one
  if(failed.length>0){
    setAutosaveIndicator(`⏳ Ponawiam ${failed.length} brakujących segmentów...`);
    for(const seg of failed){
      const prompt=`Przetłumacz ten jeden segment na ${lang}. Odpowiedz TYLKO JSON: {"translation":"..."}

Tekst: ${JSON.stringify(seg.source_text)}`;
      try{
        const raw=await apiCall(prompt);
        const res=JSON.parse(raw.replace(/```json|```/g,'').trim());
        const tText=res.translation||res.text||'';
        if(!tText) continue;
        await supa.rpc('save_segment_translation',{seg_id:seg.id,lang,new_text:tText});
        await dbPatch('project_segments',{ai_translation:tText,manually_edited:false},`?id=eq.${seg.id}`);
        if(!seg.translations) seg.translations={};
        seg.translations[lang]={text:tText,status:'translated',updated_by:currentUser.id,updated_at:new Date().toISOString()};
        seg.ai_translation=tText;
        seg.manually_edited=false;
        const ta=document.getElementById('seg-'+seg.id);
        if(ta){ ta.value=tText; ta.className='seg-textarea saved'; setTimeout(()=>ta.className='seg-textarea',2000); }
        const pill=document.getElementById(`spill-${seg.id}-${lang}`);
        if(pill){ pill.className='status-pill sp-translated'; pill.textContent='Tłum.'; }
      }catch(err){ console.error('Retry error:',err); }
      await sleep(200);
    }
  }

  return totalCostUsd;
}

async function translateCurrentLangAI(){
  const lang=currentProjectLang;
  if(!lang){ alert('Wybierz język.'); return; }
  const toTranslate=currentProjectSegs.filter(s=>!s.translations?.[lang]?.text);
  if(!toTranslate.length){ alert('Wszystkie segmenty już przetłumaczone.'); return; }
  const totalChars=toTranslate.reduce((a,s)=>a+s.source_text.length,0);
  const needed=estimateTokensForTranslation(totalChars);
  if(!checkTokenBalance(needed)) return;
  await dbPatch('project_language_assignments',{status:'in_progress',ai_translated_at:new Date().toISOString()},`?project_id=eq.${currentProject.id}&lang=eq.${encodeURIComponent(lang)}`);
  const asgn=currentAssignments.find(a=>a.lang===lang);
  if(asgn) asgn.status='in_progress';
  setAutosaveIndicator('⏳ Tłumaczenie AI w toku...');
  await runAITranslation(toTranslate,lang);
  await deductCredits(totalChars,currentProject.name+' → '+lang,lang);
  updateEditorProgress(lang);
  hideEditorProgress();
  setAutosaveIndicator(`✓ Gotowe! Użyto ${estimateCredits(totalChars)} kredytów. Saldo: ${formatTokens(currentOrg?.tokens_balance||0)}`);
}

async function translateEmptyAI(){
  const lang=currentProjectLang;
  if(!lang){ alert('Wybierz język.'); return; }
  const toTranslate=currentProjectSegs.filter(s=>!s.translations?.[lang]?.text);
  if(!toTranslate.length){ setAutosaveIndicator('✓ Brak pustych segmentów.'); return; }
  const totalChars=toTranslate.reduce((a,s)=>a+s.source_text.length,0);
  const needed=estimateTokensForTranslation(totalChars);
  if(!checkTokenBalance(needed)) return;
  setAutosaveIndicator(`⏳ Tłumaczenie ${toTranslate.length} pustych segmentów...`);
  await runAITranslation(toTranslate,lang);
  await deductCredits(totalChars,currentProject.name+' → '+lang+' (puste)',lang);
  updateEditorProgress(lang);
  hideEditorProgress();
  setAutosaveIndicator(`✓ Gotowe! Przetłumaczono ${toTranslate.length} segmentów. Użyto ${estimateCredits(totalChars)} kredytów.`);
}

async function submitForReview(lang){
  if(!lang) lang=currentProjectLang;
  const done=currentProjectSegs.filter(s=>s.translations?.[lang]?.text).length;
  const total=currentProjectSegs.length;
  if(!confirm(`Oznaczyć język ${lang} jako gotowy do pobrania?\n\nPrzetłumaczono: ${done}/${total} segmentów.\n\nAdmin zostanie poinformowany że może pobrać plik XLIFF.`)) return;
  try{
    await dbPatch('project_language_assignments',{status:'ready',submitted_at:new Date().toISOString()},`?project_id=eq.${currentProject.id}&lang=eq.${encodeURIComponent(lang)}`);
    const asgn=currentAssignments.find(a=>a.lang===lang);
    if(asgn) asgn.status='ready';
    switchEditorLang(lang);
    setAutosaveIndicator('✓ Oznaczono jako gotowe do pobrania — admin może teraz pobrać XLIFF');
    // Notify admins
    await createNotification('lang_ready',
      `${getLangFlag(lang)} ${lang} gotowy do pobrania`,
      `Projekt: ${currentProject.name}`,
      currentProject.id, lang);
    await loadNotifications();
  }catch(e){ alert('Błąd: '+e.message); }
}

async function approveLanguage(lang){
  // "Approve" = admin marks as downloaded/done after getting XLIFF
  if(!confirm(`Zatwierdzić tłumaczenie dla języka ${lang}?\n\nStatus zmieni się na Zatwierdzone.`)) return;
  try{
    await dbPatch('project_language_assignments',{status:'approved',approved_at:new Date().toISOString(),approved_by:currentUser.id},`?project_id=eq.${currentProject.id}&lang=eq.${encodeURIComponent(lang)}`);
    const asgn=currentAssignments.find(a=>a.lang===lang);
    if(asgn) asgn.status='approved';
    // Save all translations to TM
    const pairs=currentProjectSegs
      .filter(s=>s.translations?.[lang]?.text)
      .map(s=>({src:s.source_text,tgt:s.translations[lang].text}));
    await pushTMBatch(pairs,lang,'xliff');
    switchEditorLang(lang);
    setAutosaveIndicator(`✓ Zatwierdzono. Zapisano ${pairs.length} tłumaczeń do TM.`);
  }catch(e){ alert('Błąd: '+e.message); }
}

// ── APPLY TM TO PROJECT ──
async function applyTMToProject(){
  const lang=currentProjectLang;
  if(!lang) return;

  // Batch lookup all untranslated segments at once
  const untranslated=currentProjectSegs.filter(s=>!s.translations?.[lang]?.text);
  if(!untranslated.length){
    setAutosaveIndicator('Brak pustych segmentów.');
    return;
  }
  setAutosaveIndicator('⏳ Sprawdzanie pamięci TM...');
  const sources=[...new Set(untranslated.map(s=>s.source_text))];
  const tmMap=await lookupTMBatch(sources,lang);

  const toUpdate=[];
  for(const seg of untranslated){
    const found=tmMap[tmKey(seg.source_text)];
    if(!found) continue;
    toUpdate.push({seg,text:found});
  }

  if(!toUpdate.length){
    setAutosaveIndicator('Brak dopasowań w pamięci TM dla tego języka');
    return;
  }

  setAutosaveIndicator(`⏳ Uzupełnianie z TM: 0/${toUpdate.length}...`);
  showEditorProgress('Uzupełnianie z pamięci TM...',0);

  // Batch save in groups of 20 (parallel within batch)
  const BATCH=20;
  let done=0;
  for(let i=0;i<toUpdate.length;i+=BATCH){
    const chunk=toUpdate.slice(i,i+BATCH);
    // Save all in parallel
    await Promise.all(chunk.map(async({seg,text})=>{
      try{
        await supa.rpc('save_segment_translation',{seg_id:seg.id,lang,new_text:text});
        // Update local cache
        if(!seg.translations) seg.translations={};
        seg.translations[lang]={text,status:'translated',updated_by:currentUser.id,updated_at:new Date().toISOString()};
        // Update DOM immediately
        const ta=document.getElementById('seg-'+seg.id);
        if(ta){ ta.value=text; ta.className='seg-textarea saved'; setTimeout(()=>ta.className='seg-textarea',1500); }
        const pill=document.getElementById(`spill-${seg.id}-${lang}`);
        if(pill){ pill.className='status-pill sp-translated'; pill.textContent='Tłum.'; }
      }catch(e){ console.error('TM save error:',e); }
    }));
    done+=chunk.length;
    const pct=Math.round(done/toUpdate.length*100);
    showEditorProgress(`Uzupełnianie z TM: ${done}/${toUpdate.length}`,pct);
    setAutosaveIndicator(`⏳ Uzupełnianie z TM: ${done}/${toUpdate.length}...`);
    updateEditorProgress(lang);
  }

  hideEditorProgress();
  setAutosaveIndicator(`✓ Uzupełniono ${toUpdate.length} segmentów z pamięci TM`);
}

// ── AI SUMMARY BEFORE TRANSLATION ──
function showAISummary(){
  const lang=currentProjectLang;
  if(!lang){ alert('Wybierz język.'); return; }
  const toTranslate=currentProjectSegs.filter(s=>!s.translations?.[lang]?.text);
  if(!toTranslate.length){ alert('Wszystkie segmenty już przetłumaczone!'); return; }
  const totalChars=toTranslate.reduce((a,s)=>a+s.source_text.length,0);
  const tokensNeeded=estimateCredits(totalChars);
  const balance=currentOrg?.tokens_balance||0;
  const hasEnough=balance>=tokensNeeded;
  const msg=`Podsumowanie tłumaczenia AI:\n\n` +
    `Język: ${lang}\n` +
    `Do przetłumaczenia: ${totalChars.toLocaleString('pl-PL')} znaków\n` +
    `Koszt: ${tokensNeeded} kredytów (= ${tokensNeeded} PLN)\n` +
    `Twoje saldo: ${balance.toLocaleString('pl-PL')} kredytów\n` +
    `${hasEnough ? '✓ Saldo wystarczy' : '✗ Brakuje ' + (tokensNeeded-balance) + ' kredytów'}\n\n` +
    `${hasEnough ? 'Uruchomić tłumaczenie AI?' : 'Przejdź do zakupu kredytów.'}`;
  if(hasEnough){
    if(confirm(msg)) translateCurrentLangAI();
  } else {
    alert(msg);
    switchTab('shop');
  }
}

// ── EXPORT XLIFF FROM PROJECT ──
async function exportProjectXliff(){
  if(!currentProject||!currentProjectLang){ alert('Brak projektu lub języka.'); return; }
  const lang=currentProjectLang;
  const proj=currentProject;

  // Check if we have original file in Storage
  if(!proj.original_file_path){
    alert('Brak oryginalnego pliku XLIFF — ten projekt był utworzony bez uploadu pliku.\n\nUtwórz projekt ponownie aby eksport zachował strukturę Storyline.');
    return;
  }

  try{
    // Download original file from Storage
    const{data,error}=await supa.storage.from('project-files').download(proj.original_file_path);
    if(error) throw new Error('Błąd pobierania pliku: '+error.message);

    const originalXml=await data.text();
    const workDoc=domParser.parseFromString(originalXml,'application/xml');
    const NS='urn:oasis:names:tc:xliff:document:1.2';

    // Inject translations into original XML structure
    // Build lookup: segment_key -> translated text
    const translationMap={};
    currentProjectSegs.forEach(seg=>{
      const tText=seg.translations?.[lang]?.text||'';
      if(tText) translationMap[seg.segment_key]=tText;
    });

    // Process each trans-unit
    Array.from(workDoc.querySelectorAll('trans-unit')).forEach(unit=>{
      const unitId=unit.getAttribute('id')||'';
      const datatype=unit.getAttribute('datatype')||'';
      const srcEl=unit.querySelector('source');
      if(!srcEl) return;

      // Remove existing target
      const existingTarget=unit.querySelector('target');
      if(existingTarget) existingTarget.remove();

      const targetEl=workDoc.createElementNS(NS,'target');
      targetEl.setAttribute('state','translated');

      if(datatype==='plaintext'){
        const tText=translationMap[unitId]||srcEl.textContent||'';
        targetEl.textContent=tText;
      } else {
        // Rich segment — clone source structure and inject per-gId translations
        const sourceClone=srcEl.cloneNode(true);
        sourceClone.querySelectorAll('g[ctype="x-text"]').forEach(g=>{
          const gId=g.getAttribute('id');
          const segKey=unitId+'__'+gId;
          const tText=translationMap[segKey];
          if(tText) g.textContent=tText;
        });
        while(sourceClone.firstChild) targetEl.appendChild(sourceClone.firstChild);
      }

      srcEl.after(targetEl);
    });

    let xmlStr=xmlSer.serializeToString(workDoc);
    if(!xmlStr.startsWith('<?xml')) xmlStr='<?xml version="1.0" encoding="utf-8"?>'+xmlStr;
    const fname=`${proj.name}_${lang}.xliff`.replace(/[^a-z0-9_.-]/gi,'_');
    download(xmlStr, fname, 'application/xliff+xml');

  }catch(e){
    alert('Błąd eksportu: '+e.message);
    console.error(e);
  }
}

// ── EXPORT PPTX FROM PROJECT ──
async function exportProjectPptx(){
  if(!currentProject||!currentProjectLang){ alert('Brak projektu lub języka.'); return; }
  const lang=currentProjectLang;
  const proj=currentProject;

  if(!proj.original_file_path){
    alert('Brak oryginalnego pliku PPTX — ten projekt był utworzony bez uploadu pliku.');
    return;
  }

  try{
    const{data,error}=await supa.storage.from('project-files').download(proj.original_file_path);
    if(error) throw new Error('Błąd pobierania pliku: '+error.message);

    const buf=await data.arrayBuffer();
    const zip=await JSZip.loadAsync(buf);

    // Build map: segment_key → translated text
    const translationMap={};
    currentProjectSegs.forEach(seg=>{
      const tText=seg.translations?.[lang]?.text||'';
      if(tText) translationMap[seg.segment_key]=tText;
    });

    // Group project segs by slide file (extract slideNum from segment_key)
    const bySlide={};
    currentProjectSegs.forEach(seg=>{
      const m=seg.segment_key?.match(/^s(\d+)_/);
      if(!m) return;
      const slideNum=parseInt(m[1]);
      const slideFile=`ppt/slides/slide${slideNum}.xml`;
      if(!bySlide[slideFile]) bySlide[slideFile]=[];
      bySlide[slideFile].push({
        key:seg.segment_key,
        slideNum,
        target:translationMap[seg.segment_key]||''
      });
    });

    const newZip=new JSZip();
    for(const path of Object.keys(zip.files)){
      const entry=zip.files[path];
      if(entry.dir){newZip.folder(path);continue;}
      if(bySlide[path]){
        const xml=await zip.file(path).async('string');
        newZip.file(path,applyPptxTranslations(xml,bySlide[path]));
      }else{
        newZip.file(path,await zip.file(path).async('arraybuffer'));
      }
    }

    const blob=await newZip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',compression:'DEFLATE',compressionOptions:{level:6}});
    const fname=`${proj.name}_${lang}.pptx`.replace(/[^a-z0-9_.-]/gi,'_');
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fname;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(a.href);

  }catch(e){
    alert('Błąd eksportu: '+e.message);
    console.error(e);
  }
}

// ── EDIT PROJECT ──

async function editProject(projectId){
  if(currentRole!=='admin'){ alert('Tylko administrator może edytować projekty.'); return; }
  const proj = projectsCache.find(p=>p.id===projectId);
  if(!proj) return;
  editingProjectId = projectId;

  // Load team members if not cached
  if(!teamMembersCache.length && currentOrg){
    teamMembersCache = await dbGet('organization_members',`?organization_id=eq.${currentOrg.id}`);
    const profiles = await dbGet('profiles',`?id=in.(${teamMembersCache.map(m=>m.user_id).join(',')})`);
    let emailMap2={};
    try{
      const ed=await dbGet('member_emails',`?organization_id=eq.${currentOrg.id}`);
      ed.forEach(e=>{ emailMap2[e.user_id]={email:e.email,display_name:e.display_name}; });
    }catch(e){}
    teamMembersCache = teamMembersCache.map(m=>({
      ...m,
      profile:profiles.find(p=>p.id===m.user_id),
      email:emailMap2[m.user_id]?.email||null,
      display_name:emailMap2[m.user_id]?.display_name||null
    }));
  }

  // Fill form
  document.getElementById('ep-name').value = proj.name;
  document.getElementById('ep-desc').value = proj.description||'';
  document.getElementById('ep-status').value = proj.status||'active';
  document.getElementById('ep-src-lang').value = proj.source_lang;
  document.getElementById('edit-proj-error').style.display='none';

  // Fill assignments
  const assignments = proj.assignments||[];
  const container = document.getElementById('ep-assignments');
  container.innerHTML = '';
  assignments.forEach(a => addEpLangRow(a.lang, a.assigned_user_id, a.status));
  if(!assignments.length) addEpLangRow();

  document.getElementById('edit-proj-modal').style.display='flex';
}

function addEpLangRow(lang='', userId='', status='pending'){
  const memberOptions = teamMembersCache
    .filter(m=>m.role!=='viewer')
    .map(m=>`<option value="${m.user_id}" ${m.user_id===userId?'selected':''}>${esc(getMemberName(m))} (${m.role})</option>`)
    .join('');
  const langOptions = langOptionsHTML(lang);
  const statusOptions = ['pending','in_progress','review','approved']
    .map(s=>`<option value="${s}" ${s===status?'selected':''}>${statusLabel(s)}</option>`).join('');
  const rowId='ep-'+Date.now()+Math.random().toString(36).slice(2,6);
  const div=document.createElement('div');
  div.id=rowId;
  div.style.cssText='display:grid;grid-template-columns:1fr 1fr 130px 32px;gap:8px;align-items:center;background:#fafaf8;padding:8px;border-radius:6px;border:1px solid #eee;';
  div.innerHTML=`
    <div>
      <div style="font-size:10px;color:#999;margin-bottom:2px;">Język</div>
      <select class="ep-lang" style="width:100%;">${langOptions}</select>
    </div>
    <div>
      <div style="font-size:10px;color:#999;margin-bottom:2px;">Tłumacz / weryfikator</div>
      <select class="ep-user" style="width:100%;"><option value="">— bez przypisania —</option>${memberOptions}</select>
    </div>
    <div>
      <div style="font-size:10px;color:#999;margin-bottom:2px;">Status</div>
      <select class="ep-status-row" style="width:100%;">${statusOptions}</select>
    </div>
    <button class="del-btn" onclick="document.getElementById('${rowId}').remove()" style="font-size:18px;margin-top:16px;">×</button>`;
  document.getElementById('ep-assignments').appendChild(div);
}

async function saveProjectEdits(){
  const name = document.getElementById('ep-name').value.trim();
  const desc = document.getElementById('ep-desc').value.trim();
  const status = document.getElementById('ep-status').value;
  const errEl = document.getElementById('edit-proj-error');

  if(!name){ errEl.textContent='Wpisz nazwę projektu.'; errEl.style.display='block'; return; }
  errEl.style.display='none';

  try{
    // Update project
    await dbPatch('projects',{name,description:desc,status},`?id=eq.${editingProjectId}`);

    // Collect new assignments from form
    const rows = document.querySelectorAll('#ep-assignments > div');
    const newAssignments = [];
    rows.forEach(row=>{
      const lang = row.querySelector('.ep-lang')?.value;
      const userId = row.querySelector('.ep-user')?.value||null;
      const rowStatus = row.querySelector('.ep-status-row')?.value||'pending';
      if(lang) newAssignments.push({lang, assigned_user_id:userId||null, status:rowStatus});
    });

    // Get existing assignments
    const existing = await dbGet('project_language_assignments',`?project_id=eq.${editingProjectId}`);
    const existingLangs = existing.map(a=>a.lang);
    const newLangs = newAssignments.map(a=>a.lang);
    // Delete removed languages
    for(const a of existing){
      if(!newLangs.includes(a.lang)){
        const { error } = await supa.rpc('delete_lang_assignment', {assignment_id: a.id});
        if(error) throw new Error('Błąd usuwania języka: ' + error.message);
      }
    }

    // Update existing or insert new
    for(const a of newAssignments){
      const ex = existing.find(e=>e.lang===a.lang);
      if(ex){
        // Update existing assignment
        await dbPatch('project_language_assignments',{
          assigned_user_id:a.assigned_user_id,
          status:a.status
        },`?id=eq.${ex.id}`);
      } else {
        // Insert new
        await dbPost('project_language_assignments',{
          project_id:editingProjectId,
          lang:a.lang,
          assigned_user_id:a.assigned_user_id||null,
          status:a.status
        });
      }
    }

    closeEditProjectModal();
    await loadProjects();

  }catch(e){ errEl.textContent='Błąd: '+e.message; errEl.style.display='block'; }
}

function closeEditProjectModal(){
  document.getElementById('edit-proj-modal').style.display='none';
  editingProjectId=null;
}

async function deleteProject(projectId, projectName){
  if(currentRole!=='admin'){ alert('Tylko administrator może usuwać projekty.'); return; }
  if(!confirm(`Usunąć projekt "${projectName}"?\n\nTo działanie jest nieodwracalne — usuwa projekt, wszystkie segmenty i przypisania.`)) return;
  try{
    await dbDelete('projects',`?id=eq.${projectId}`);
    projectsCache=projectsCache.filter(p=>p.id!==projectId);
    const visibleCount = currentRole === 'translator'
      ? projectsCache.filter(p => (p.assignments||[]).some(a => a.assigned_user_id === currentUser.id)).length
      : projectsCache.length;
    document.getElementById('proj-count').textContent=visibleCount;
    renderProjectList();
  }catch(e){ alert('Błąd usuwania projektu: '+e.message); }
}

function closeProjectEditor(){
  document.getElementById('proj-editor-view').style.display='none';
  document.getElementById('proj-list-view').style.display='block';
  currentProject=null; currentProjectLang=null; currentProjectSegs=[];
  autosaveTimers={};
  loadProjects();
}

// ── PROJECT EXCEL EXPORT/IMPORT ──

function exportProjectExcel(){
  if(!currentProject||!currentProjectLang) return;
  const lang=currentProjectLang;
  const rows=[['#','Klucz segmentu','Tekst źródłowy ('+currentProject.source_lang+')','Tłumaczenie ('+lang+')','Status']];
  currentProjectSegs.forEach((seg,i)=>{
    const t=seg.translations?.[lang];
    rows.push([i+1, seg.segment_key, seg.source_text, t?.text||'', t?.status||'empty']);
  });
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:5},{wch:20},{wch:45},{wch:45},{wch:12}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Tłumaczenia');
  XLSX.writeFile(wb,`${currentProject.name}_${lang}.xlsx`);
}

async function importProjectExcel(e){
  const f=e.target.files[0]; if(!f) return;
  const buf=await readFile(f,'array');
  const rows=XLSX.utils.sheet_to_json(XLSX.read(buf,{type:'array'}).Sheets[XLSX.read(buf,{type:'array'}).SheetNames[0]],{header:1});
  const lang=currentProjectLang;
  let n=0;
  const tmPairs=[];
  for(const row of rows.slice(1)){
    const key=String(row[1]||'').trim();
    const translation=String(row[3]||'').trim();
    if(!key||!translation) continue;
    const seg=currentProjectSegs.find(s=>s.segment_key===key);
    if(!seg) continue;
    await supa.rpc('save_segment_translation',{seg_id:seg.id,lang,new_text:translation});
    if(!seg.translations) seg.translations={};
    seg.translations[lang]={text:translation,status:'translated',updated_by:currentUser.id,updated_at:new Date().toISOString()};
    tmPairs.push({src:seg.source_text,tgt:translation});
    n++;
  }
  if(tmPairs.length>0) await pushTMBatch(tmPairs,lang,'xliff');
  renderEditorTable(lang);
  updateEditorProgress(lang);
  alert('Zaimportowano '+n+' tłumaczeń.');
  e.target.value='';
}
