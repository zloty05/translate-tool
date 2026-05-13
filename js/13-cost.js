// ══════════════════════════════════════════════════════════
// COST  (1 kredyt = 1000 znaków = 1 PLN)
// ══════════════════════════════════════════════════════════
function renderCostBox(boxId,gridId,noteId,tmId,totalChars,tmChars,segCount,doneCount){
  const box=document.getElementById(boxId),grid=document.getElementById(gridId),note=document.getElementById(noteId),tmEl=document.getElementById(tmId);
  const charsToTranslate=Math.max(0,totalChars-tmChars);
  const toTr=segCount-doneCount;
  const creditsNeeded=charsToTranslate>0?estimateCredits(charsToTranslate):0;
  const currentBalance=currentOrg?.tokens_balance||0;
  const hasEnough=currentBalance>=creditsNeeded;
  box.style.display='block';
  box.className='cost-box'+(creditsNeeded>currentBalance?' warn':'');

  if(tmChars>0){
    tmEl.style.display='block';
    tmEl.textContent=`✓ Pamięć TM: ${tmChars.toLocaleString('pl-PL')} znaków bezpłatnie — oszczędność ${estimateCredits(tmChars)} kredytów`;
  } else tmEl.style.display='none';

  if(toTr===0||charsToTranslate===0){
    grid.innerHTML=`<div class="cost-cell"><div class="cost-num green">0</div><div class="cost-lbl">Znaków do tłum.</div></div>
      <div class="cost-cell"><div class="cost-num green">0</div><div class="cost-lbl">Koszt (kredytów)</div></div>`;
    note.innerHTML='Wszystkie znaki uzupełnione z pamięci TM — brak kosztów.';
    return;
  }

  const balColor=hasEnough?'#1a7a3f':'#b32424';
  const balInfo=hasEnough
    ? `<span style="color:#1a7a3f;">✓ Wystarczy (masz ${formatTokens(currentBalance)} kredytów)</span>`
    : `<span style="color:#b32424;">✗ Brakuje ${creditsNeeded-currentBalance} kredytów — <a href="#" onclick="switchTab('shop');return false;">kup tutaj</a></span>`;

  grid.innerHTML=`
    <div class="cost-cell"><div class="cost-num">${charsToTranslate.toLocaleString('pl-PL')}</div><div class="cost-lbl">Znaków do tłum.</div></div>
    <div class="cost-cell"><div class="cost-num ${hasEnough?'green':'orange'}">${creditsNeeded}</div><div class="cost-lbl">Koszt (kredytów)</div></div>
    <div class="cost-cell"><div class="cost-num" style="color:${balColor};">${formatTokens(currentBalance)}</div><div class="cost-lbl">Twoje saldo</div></div>`;

  note.innerHTML=`${balInfo}<br>
    <span style="color:#999;font-size:11px;">1 kredyt = 1 000 znaków = 1 PLN</span>`;
}

function updateXliffCost(){if(!xliffSegs.length)return;let total=0,tm=0;xliffSegs.forEach(s=>{if(s.type==='plain'){total+=s.source.length;if(s.fromTM||s.status==='done')tm+=s.source.length;}else{s.textNodes.forEach((n,i)=>{total+=n.text.length;if(s.fromTM||s.targets[i]?.text?.trim())tm+=n.text.length;});}});renderCostBox('xliff-cost-box','xliff-cost-grid','xliff-cost-note','xliff-cost-tm',total,tm,xliffSegs.length,xliffSegs.filter(s=>s.status==='done').length);}
function updatePptxCost(){if(!pptxSegs.length)return;let total=0,tm=0;pptxSegs.forEach(s=>{total+=s.source.length;if(s.fromTM||s.status==='done')tm+=s.source.length;});renderCostBox('pptx-cost-box','pptx-cost-grid','pptx-cost-note','pptx-cost-tm',total,tm,pptxSegs.length,pptxSegs.filter(s=>s.status==='done').length);}