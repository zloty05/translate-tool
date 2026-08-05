// ══════════════════════════════════════════════════════════
// DICTIONARY VERIFICATION (Pass 2)
// ══════════════════════════════════════════════════════════

function getVerifySegments(mode){
  if(mode==='project'){
    const lang=currentProjectLang;
    const sourceLang=currentProject?.source_lang||'Polish';
    if(!lang) return [];
    return currentProjectSegs
      .filter(s=>s.translations?.[lang]?.text)
      .map(s=>({id:s.id, source:s.source_text, translation:s.translations[lang].text, lang, sourceLang, mode}));
  }
  if(mode==='xliff'){
    const lang=document.getElementById('target-lang')?.value||'';
    const sourceLang=document.getElementById('source-lang')?.value||'Polish';
    return xliffSegs.filter(s=>s.status==='done').map((s,i)=>({
      id:i,
      source:s.type==='plain'?s.source:s.textNodes.map(n=>n.text).join(' '),
      translation:s.type==='plain'?s.target:s.targets.map(t=>t.text).join(' '),
      lang, sourceLang, mode
    }));
  }
  if(mode==='pptx'){
    const lang=document.getElementById('pptx-target-lang')?.value||'';
    const sourceLang=document.getElementById('pptx-source-lang')?.value||'Polish';
    return pptxSegs.filter(s=>s.status==='done').map(s=>({
      id:s.key, source:s.source, translation:s.target, lang, sourceLang, mode
    }));
  }
  return [];
}

function getWordStem(word, lang){
  const w=word.toLowerCase();
  if(w.length<=4) return w;
  const isEn=lang&&(lang.toLowerCase().includes('eng')||lang.toLowerCase().includes('en'));
  if(isEn){
    const enSuffixes=['nesses','ments','ings','tions','tion','ers','ies','ed','es','er','ly','s'];
    for(const s of enSuffixes){
      if(w.endsWith(s)&&w.length-s.length>=3) return w.slice(0,w.length-s.length);
    }
  } else {
    const plSuffixes=[
      'owych','owego','owym','owej','owe','owi','ową',
      'ami','ach','om','ie','ię',
      'ce','cie','ka','ki','ku','ką',
      'enia','enie','eniu','eń',
      'owania','owaniu',
      'ując','ująca','ujące',
      'iem','ek'
    ];
    for(const s of plSuffixes){
      if(w.endsWith(s)&&w.length-s.length>=3) return w.slice(0,w.length-s.length);
    }
  }
  return w.slice(0,Math.max(4,Math.floor(w.length*0.7)));
}

function getMatchingTerms(source, targetLang, sourceLang){
  const srcLower = source.toLowerCase();
  // Determine which dict field to use as source term
  // If sourceLang is PL (or undefined) → use e.src
  // If sourceLang is another language → use e.translations[sourceLang]
  const isPLSource = !sourceLang ||
    sourceLang.toLowerCase().includes('pol') ||
    sourceLang.toLowerCase()==='pl';

  return dictCache.filter(e=>{
    // Tylko zaakceptowane terminy (spójnie z buildDictPromptForChunk)
    if(!e.translations?.[targetLang] || e.status?.[targetLang]!=='accepted') return false;
    // Get the term in source language
    const termSrc = isPLSource ? e.src : (e.translations[sourceLang]||'');
    if(!termSrc) return false;
    const termLower = termSrc.toLowerCase();
    const slang = isPLSource ? 'pl' : 'en';
    // 1. Exact match
    if(srcLower.includes(termLower)) return true;
    // 2. Stem matching
    const words = termLower.split(' ').filter(w=>w.length>3);
    if(!words.length) return false;
    return words.every(w=>{
      const stem = getWordStem(w, slang);
      return srcLower.includes(stem);
    });
  });
}

async function showVerifySummary(mode){
  const allSegs=getVerifySegments(mode);
  if(!allSegs.length){ alert('Brak przetłumaczonych segmentów.'); return; }

  const lang=allSegs[0]?.lang;
  if(!lang){ alert('Nie można określić języka.'); return; }

  // Find segments that have matching dict terms
  const sourceLang=allSegs[0]?.sourceLang||'Polish';
  const toVerify=allSegs.filter(s=>getMatchingTerms(s.source,lang,sourceLang).length>0);

  if(!toVerify.length){
    alert(`Żaden segment nie zawiera terminów ze słownika dla języka ${lang}.`);
    return;
  }

  const totalVerifyChars=toVerify.reduce((a,s)=>a+s.source.length+s.translation.length,0);
  const estCredits=estimateCredits(totalVerifyChars);

  // Show which terms will be checked
  const allTerms=new Map();
  toVerify.forEach(s=>{
    getMatchingTerms(s.source,lang,sourceLang).forEach(t=>{
      const termSrc=sourceLang&&!sourceLang.toLowerCase().includes('pol')
        ?(t.translations[sourceLang]||t.src):t.src;
      allTerms.set(termSrc, t.translations[lang]);
    });
  });
  const termsList=[...allTerms.entries()].slice(0,8)
    .map(([src,tgt])=>`  • "${src}" → "${tgt}"`).join('\n');
  const moreTerms=allTerms.size>8?`\n  ... i ${allTerms.size-8} więcej`:'';

  const msg='📖 Weryfikacja słownika (Pass 2)\n\n'+
    'Język: '+lang+'\n'+
    'Segmentów do sprawdzenia: '+toVerify.length+' z '+allSegs.length+'\n'+
    '(tylko segmenty zawierające terminy ze słownika)\n\n'+
    'Terminy do zweryfikowania:\n'+termsList+moreTerms+'\n\n'+
    'Szacowany koszt: ~'+estCredits+' kredytów ('+estCredits+' PLN)\n\n'+
    'Jak działa: Claude sprawdza każdy segment osobno i poprawia\n'+
    'tylko jeśli użyto złego terminu.\n\n'+
    'Uruchomić weryfikację?';
    if(!confirm(msg)) return;
  if(!checkTokenBalance(estCredits)) return;

  await runVerification(mode, toVerify, lang);
}

async function runVerification(mode, segments, lang){
  let fixed=0, checked=0;
  let totalCostUsd=0;

  const setStatus=(msg)=>{
    if(mode==='project') setAutosaveIndicator(msg);
    else if(mode==='xliff') setXS(msg);
    else setPPS(msg);
  };

  setStatus(`📖 Weryfikacja: 0/${segments.length}...`);

  for(let si=0;si<segments.length;si++){
    const seg=segments[si];
    const terms=getMatchingTerms(seg.source, lang, seg.sourceLang);
    if(!terms.length){ checked++; continue; }

    // Context: 2 segments before and after
    const ctxBefore=segments.slice(Math.max(0,si-2),si);
    const ctxAfter=segments.slice(si+1,Math.min(segments.length,si+3));
    const ctxBeforeStr=ctxBefore.length
      ? 'KONTEKST POPRZEDZAJĄCY (tylko do wglądu):\n'+ctxBefore.map(s=>'  SRC: '+s.source+'\n  TGT: '+s.translation).join('\n')+'\n\n'
      : '';
    const ctxAfterStr=ctxAfter.length
      ? '\nKONTEKST NASTĘPUJĄCY (tylko do wglądu):\n'+ctxAfter.map(s=>'  SRC: '+s.source+'\n  TGT: '+s.translation).join('\n')
      : '';

    const termsList=terms.map(t=>'"'+t.src+'" → "'+t.translations[lang]+'"').join('\n');
    const charsIn=seg.source.length+seg.translation.length+termsList.length+ctxBeforeStr.length+ctxAfterStr.length+400;

    const srcLangLabel=seg.sourceLang||'język źródłowy';
    const prompt=
      'Sprawdź czy tłumaczenie używa właściwych terminów ze słownika.\n\n'+
      ctxBeforeStr+
      'TEKST ŹRÓDŁOWY ('+srcLangLabel+'):\n'+seg.source+'\n\n'+
      'TŁUMACZENIE DO SPRAWDZENIA:\n'+seg.translation+'\n\n'+
      'WYMAGANE TERMINY (źródło → wymagane tłumaczenie):\n'+termsList+'\n\n'+
      'INSTRUKCJA:\n'+
      '- Uwzględnij kontekst sąsiednich segmentów przy ocenie poprawności\n'+
      '- Jeśli tłumaczenie używa właściwych terminów — odpowiedz dokładnie: null\n'+
      '- Jeśli używa błędnych terminów — odpowiedz WYŁĄCZNIE poprawionym zdaniem, zero komentarzy\n'+
      '- ZAKAZ dodawania jakichkolwiek wyjaśnień, nawiasów, przypisów, nagłówków\n'+
      '- Poprawiaj TYLKO termin, resztę zdania zostaw bez zmian\n'+
      '- Uwzględnij odmianę gramatyczną terminu\n'+
      '- Format odpowiedzi: albo słowo null, albo samo poprawione zdanie — nic więcej'+
      ctxAfterStr;
        try{
      const raw=(await apiCall(prompt,500)).trim();
      const charsOut=raw.length;
      totalCostUsd+=((charsIn/4)/1e6)*PRICE_IN+((charsOut/4)/1e6)*PRICE_OUT;

      // null or "null" = no correction needed
      if(!raw||raw==='null'||raw.toLowerCase()==='null'){
        checked++;
        setStatus(`📖 Weryfikacja: ${checked}/${segments.length} | Poprawiono: ${fixed}`);
        await sleep(100);
        continue;
      }

      // Extract only the corrected sentence - Claude sometimes adds comments
      // Strategy: find the last non-empty line that looks like a sentence (not a comment)
      let corrected=raw.replace(/^["']|["']$/g,'').trim();
      const rawLines=corrected.split('\n').filter(l=>l.trim().length>0);
      if(rawLines.length>1){
        // Filter out lines that are comments/explanations
        const commentPatterns=[/^(poprawka|poprawione|korekta|uwaga|note|correction|fixed|explanation):/i,/^\(.*\)$/,/^-/];
        const sentenceLines=rawLines.filter(l=>!commentPatterns.some(p=>p.test(l)));
        // Take the last sentence line (most likely the corrected translation)
        if(sentenceLines.length>0) corrected=sentenceLines[sentenceLines.length-1].trimStart();
      }
      corrected=corrected.replace(/^["']|["']$/g,'').trim();
      if(corrected && corrected!==seg.translation){
        await applyVerifyCorrection(mode, seg, lang, corrected);
        fixed++;
      }
    }catch(err){ console.error('Verify error:',err); }

    checked++;
    setStatus(`📖 Weryfikacja: ${checked}/${segments.length} | Poprawiono: ${fixed}`);
    await sleep(120);
  }

  const totalChars=segments.reduce((a,s)=>a+s.source.length+s.translation.length,0);
  await deductCredits(totalChars, 'Weryfikacja słownika → '+lang, lang);
  setStatus(`✓ Weryfikacja zakończona. Sprawdzono: ${checked}, poprawiono: ${fixed} segmentów. Użyto ${estimateCredits(totalChars)} kredytów.`);
}

async function applyVerifyCorrection(mode, seg, lang, corrected){
  if(mode==='project'){
    await supa.rpc('save_segment_translation',{seg_id:seg.id,lang,new_text:corrected});
    const projSeg=currentProjectSegs.find(s=>s.id===seg.id);
    if(projSeg&&projSeg.translations) projSeg.translations[lang].text=corrected;
    const ta=document.getElementById('seg-'+seg.id);
    if(ta){ta.value=corrected;ta.className='seg-textarea saved';setTimeout(()=>ta.className='seg-textarea',2000);}
  } else if(mode==='xliff'){
    const idx=Number(seg.id);
    const xseg=xliffSegs[idx];
    if(xseg){ if(xseg.type==='plain') xseg.target=corrected; else xseg.targets[0].text=corrected; }
    const ta=document.getElementById('xta-'+idx);
    if(ta){ta.value=corrected;ta.className='seg-textarea saved';setTimeout(()=>ta.className='seg-textarea',2000);}
  } else if(mode==='pptx'){
    const pseg=pptxSegs.find(s=>s.key===seg.id);
    if(pseg) pseg.target=corrected;
    const idx=pptxSegs.findIndex(s=>s.key===seg.id);
    const ta=document.getElementById('pta-'+idx);
    if(ta){ta.value=corrected;ta.className='seg-textarea saved';setTimeout(()=>ta.className='seg-textarea',2000);}
  }
}