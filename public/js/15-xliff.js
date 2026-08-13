// ══════════════════════════════════════════════════════════
// XLIFF
// ══════════════════════════════════════════════════════════

// Storyline rozbija akapit z pogrubieniem na kilka <g ctype="x-text">.
// Spacja oddzielająca bold od reszty zdania siedzi WEWNĄTRZ <g> (nigdy pomiędzy),
// więc trim przy parsowaniu kasował ją bezpowrotnie: "To jest bold tekst" → "This isboldtext".
// Zapamiętujemy dokładnie to, co trim usunął (nie zakładany znak — bywa "\r        "),
// żeby eksport mógł odtworzyć oryginał znak w znak.
function edgePads(raw,trimmed){
  if(!trimmed) return{padStart:'',padEnd:''};
  const at=raw.indexOf(trimmed);
  return{padStart:raw.slice(0,at),padEnd:raw.slice(at+trimmed.length)};
}

// Zwraca teksty do wstawienia w <g>, z przywróconymi spacjami brzegowymi.
// Spacja wraca tylko gdy: oryginał ją miał, tłumaczenie jest niepuste, nie ma jej już
// (AI bywa niekonsekwentne) i po tej stronie jest jeszcze jakiś niepusty fragment —
// inaczej zostałaby osierocona przed interpunkcją albo na skraju segmentu.
function padXliffTargets(textNodes,targets){
  const txt=targets.map(t=>(t&&t.text)||'');
  const out=txt.slice();
  const filled=txt.map(t=>!!t.trim());
  const nextIdx=i=>{for(let j=i+1;j<txt.length;j++)if(filled[j])return j;return -1;};
  const prevIdx=i=>{for(let j=i-1;j>=0;j--)if(filled[j])return j;return -1;};
  for(let i=0;i<txt.length;i++){
    const n=textNodes[i];
    if(!filled[i]||!n) continue;
    // Spacja na końcu: tylko gdy dalej coś jeszcze jest i żadna ze stron styku jej nie ma.
    const nx=nextIdx(i);
    if(n.padEnd&&nx>=0&&!/[ \t]$/.test(out[i])&&!/^[ \t]/.test(out[nx])) out[i]=out[i]+n.padEnd;
    // Spacja na początku: analogicznie wstecz — sąsiad mógł już dokleić swoją.
    const pv=prevIdx(i);
    if(n.padStart&&pv>=0&&!/^[ \t]/.test(out[i])&&!/[ \t]$/.test(out[pv])) out[i]=n.padStart+out[i];
  }
  return out;
}

// Czy dany <g> jest w indeksie górnym? Storyline trzyma styl w <bpt ctype="x-style">,
// który POPRZEDZA <g> jako rodzeństwo — nie jest jego rodzicem ani atrybutem.
// Stąd cofanie się po previousElementSibling aż do najbliższego <bpt>.
// To jedyne źródło prawdy o ®/²: korelacja Elevation="Superscript" z fragmentem
// symbolu jest w realnych plikach idealna (sprawdzone: 4/4, zero fałszywych trafień).
function isSupNode(g){
  for(let p=g.previousElementSibling;p;p=p.previousElementSibling){
    if(p.nodeName==='bpt'&&(p.getAttribute('ctype')||'')==='x-style')
      return /Elevation\s*=\s*"Superscript"/.test(p.textContent||'');
    if(p.nodeName==='g') break; // trafiliśmy na poprzedni tekst — nasz <bpt> byłby wcześniej
  }
  return false;
}

// Fragment bez litery i cyfry jest nietłumaczalny — w każdym języku zostaje sobą.
// Storyline wydziela takie <g> przy każdym powrocie do poprzedniego stylu, więc po ®
// czy po pogrubieniu zostaje osobny fragment '.', '?' albo ', '. Wysyłanie ich do
// modelu to zmarnowane wywołanie i ryzyko, że wróci coś innego niż wysłaliśmy.
// \p{L} (dowolna litera Unicode) zamiast listy alfabetów — obsługuje też cyrylicę
// dla ukraińskiego i znaki bałtyckie, nie tylko polskie diakrytyki.
function isUntranslatable(text){
  return !!text && !/[0-9\p{L}]/u.test(text);
}

// Numer akapitu, w którym leży dany <g>. Storyline otwiera akapit przez
// <bpt ctype="x-block">, więc liczymy je od początku <source>. Fragmenty w RÓŻNYCH
// blokach to niezależne teksty (nagłówek + akapit), w TYM SAMYM — jedno rozcięte zdanie.
function blockIndexOf(g,srcEl){
  let n=0;
  for(const el of srcEl.querySelectorAll('bpt,g')){
    if(el===g) break;
    if(el.nodeName==='bpt'&&(el.getAttribute('ctype')||'')==='x-block') n++;
  }
  return n;
}

// ── Podgląd pełnego zdania dla tłumacza ─────────────────────────────
// Po rozcięciu segmentu granice fragmentów nie pokrywają się już z granicami
// w źródle (angielski przestawia szyk), więc pojedynczy wiersz potrafi wyglądać
// jak błąd: źródło ". ", tłumaczenie " system training. ". Podgląd pokazuje całe
// zdanie z wyróżnionym bieżącym fragmentem, żeby tłumacz nie musiał tego składać
// z sąsiednich wierszy — działa też po przesortowaniu tabeli, które je rozdziela.

// Czy jednostka wymaga podglądu? Dwa przypadki urwanego kontekstu:
//  1. indeks górny — rozcinamy segment, więc granice fragmentów nie pokrywają się
//     z granicami w źródle;
//  2. formatowanie (bold/kursywa) W ŚRODKU zdania — nie rozcinamy, ale tłumacz i tak
//     widzi urwany fragment ('przekrój przewodu…' bez początku i końca zdania).
//
// Dla (2) dwa warunki naraz: fragmenty muszą leżeć w TYM SAMYM bloku (inaczej to
// nagłówek + akapit, każdy samodzielny) i tekst musi między nimi PŁYNĄĆ, czyli na
// jakimś styku nie ma łamania linii (inaczej to osobne linie, np. 'Krok 1: \r').
// Świadomie NIE filtrujemy po długości fragmentu — próg zawodzi: '%tradD%'+'dni'
// i '%tradH%'+'godzin' to ta sama sytuacja, a wypadłyby po różnych stronach progu.
// Stare projekty nie mają isSup/blockIdx w metadata → false, zachowanie jak dotąd.
function needsCtxPreview(nodes){
  if(!Array.isArray(nodes)||nodes.length<2) return false;
  if(nodes.some(n=>n&&n.isSup)) return true;
  const solid=nodes.filter(n=>n&&(n.text||'').trim());
  for(let i=0;i<solid.length-1;i++){
    const a=solid[i],b=solid[i+1];
    if(a.blockIdx===undefined||a.blockIdx!==b.blockIdx) continue;
    if(!/[\r\n]\s*$/.test(a.text||'')&&!/^\s*[\r\n]/.test(b.text||'')) return true;
  }
  return false;
}

// Pełne zdanie jako czysty tekst (do Excela). Łamania na ⏎, żeby nie rozbijały komórki.
function ctxSentenceText(nodes){
  if(!needsCtxPreview(nodes)) return '';
  return nodes.map(n=>(n.text||'').replace(/\r\n|[\r\n]/g,'⏎')).join('');
}

// Pełne zdanie jako HTML z <mark> na bieżącym fragmencie (do edytora).
// esc() jest zdefiniowane w 08-utils.js — ładowanym wcześniej.
function ctxSentenceHTML(nodes,curGid){
  if(!needsCtxPreview(nodes)) return '';
  return nodes.map(n=>{
    const t=esc((n.text||'').replace(/\r\n|[\r\n]/g,'⏎'));
    return n.gId===curGid?'<mark>'+t+'</mark>':t;
  }).join('');
}

// Kotwica = ogon fragmentu POPRZEDZAJĄCEGO indeks górny; tekst niezmienny językowo,
// po którym symbol ma się znaleźć. Dwa rodzaje spotykane w kursach WAGO:
// nazwa handlowa (CAGE CLAMP, TOPJOB, WINSTA) i jednostka (4 mm, 2,5 mm).
// Nazwy i jednostki nie są tłumaczone ani odmieniane (potwierdzone na realnym
// tłumaczeniu litewskim: 31/31), więc da się je odnaleźć w tekście od modelu.
function findAnchor(prevText){
  if(!prevText) return null;
  const t=prevText.replace(/[ \t]+$/,'');
  // 1) Nazwa WERSALIKAMI, ew. wielowyrazowa: WINSTA, CAGE CLAMP, TOPJOB.
  //    Diakrytyki muszą być w klasie znaków, inaczej "ZESTAW MONTAŻOWY WINSTA"
  //    urywa się na "Ż" i kotwicą zostaje ułamek słowa ("OWY WINSTA").
  const UP='A-ZĄĆĘŁŃÓŚŹŻ';
  let m=t.match(new RegExp('(['+UP+']['+UP+'0-9]*(?:[ \\t]+['+UP+']['+UP+'0-9]*)*)$'));
  if(m&&m[1].length>=2) return m[1];
  // 2) Nazwa handlowa pisana mieszaną wielkością liter: Linect, WinstaLink.
  //    W pełnym szkoleniu "Linect®" to 3 z 82 jednostek — bez tego lecą na fallback.
  m=t.match(/([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]*)*)$/);
  if(m&&m[1].length>=3) return m[1];
  // 3) Jednostka po liczbie: 4 mm, 2,5 mm.
  m=t.match(/(\d+(?:[.,]\d+)?[ \t]*[a-zA-Z]{1,3})$/);
  if(m) return m[1];
  return null;
}

// Rozcina przetłumaczone zdanie z powrotem na fragmenty <g>.
// Zwraca tablicę tekstów (równoległą do nodes) albo null → wołający robi fallback.
//
// Kotwica wyznacza DWIE granice, nie jedną: fragment przed indeksem górnym dostaje
// DOKŁADNIE tekst kotwicy, a wszystko przed nią należy do fragmentów wcześniejszych.
// Cięcie samego "za kotwicą" wrzuciłoby całe zdanie do pogrubionego <g> i pogrubiło
// je w całości — wykryte na symulacji 6GTeyZPPiqb przed implementacją.
function splitByAnchors(translated,nodes){
  const out=new Array(nodes.length).fill(null);
  let cursor=0,lastAssigned=-1;
  for(let i=0;i<nodes.length;i++){
    if(!nodes[i].isSup) continue;
    if(i===0) return null;                       // symbol bez poprzednika — nie ma czego kotwiczyć
    const anchor=findAnchor(nodes[i-1].text);
    if(!anchor) return null;
    const idx=translated.indexOf(anchor,cursor);
    if(idx<0) return null;                       // kotwica nie przeżyła tłumaczenia
    // Dopasowanie idzie PO KOLEI (od cursor), więc powtórzona nazwa nie jest sama w sobie
    // przeszkodą: n-te wystąpienie w źródle odpowiada n-temu w tłumaczeniu — kolejność
    // fragmentów jest ta sama. Blokujemy dopiero sytuację, gdy ta sama kotwica wraca
    // jeszcze raz PO tym, jak zużyliśmy już wszystkie jej wystąpienia w źródle.
    let restSrc=0;
    for(let j=i+1;j<nodes.length;j++) if(nodes[j].isSup&&findAnchor(nodes[j-1].text)===anchor) restSrc++;
    let restTr=0,scan=idx+anchor.length;
    for(;;){const p=translated.indexOf(anchor,scan);if(p<0)break;restTr++;scan=p+anchor.length;}
    if(restTr>restSrc) return null;              // więcej powtórzeń niż w źródle — nie zgadujemy
    // Tekst przed kotwicą trafia do fragmentów między poprzednią kotwicą a tym symbolem.
    // Gdy indeks górny jest zaraz na początku segmentu (i===1), kotwica JEST fragmentem
    // nodes[0] i head musi się w nim zmieścić — doklejamy go przed kotwicę zamiast
    // odrzucać całą ścieżkę (przypadki 'Witaj ... WINSTA®' i 'Prie TOPJOB®S').
    const head=translated.slice(cursor,idx);
    let slot=-1;
    for(let j=lastAssigned+1;j<i-1;j++) if(out[j]===null&&!nodes[j].isSup){slot=j;break;}
    if(slot>=0){ out[slot]=head; for(let j=slot+1;j<i-1;j++) if(out[j]===null) out[j]=''; out[i-1]=anchor; }
    else out[i-1]=head+anchor;                   // brak wolnego slotu → head zostaje przy kotwicy
    const cut=idx+anchor.length;
    // Model bywa uczynny i sam dopisuje ® tuż za nazwą (realny przypadek z pliku
    // litewskiego: 'Prie TOPJOB®S gnybtų blokų'). Wtedy traktujemy jego symbol jako
    // granicę, zamiast dokładać drugi i dostać TOPJOB®®S.
    const sym=nodes[i].text;
    const dup=translated.startsWith(sym,cut);
    out[i]=sym;
    cursor=cut+(dup?sym.length:0);
    lastAssigned=i;
  }
  if(!out.some(v=>v!==null)) return null;        // brak indeksu górnego — nie nasza ścieżka
  // Ogon zdania trafia do pierwszego wolnego fragmentu PO ostatniej kotwicy —
  // nie do pierwszego wolnego w ogóle, bo tamte leżą przed nią i są już rozliczone.
  let tail=-1;
  for(let j=lastAssigned+1;j<nodes.length;j++) if(out[j]===null&&!nodes[j].isSup){tail=j;break;}
  if(tail>=0){ out[tail]=translated.slice(cursor); for(let j=tail+1;j<nodes.length;j++) if(out[j]===null) out[j]=''; }
  else if(cursor<translated.length) return null; // urwany ogon — fallback
  for(let j=0;j<out.length;j++) if(out[j]===null) out[j]='';
  // Kontrola spójności: po usunięciu symboli, które DOKŁADAMY z oryginału, sklejenie
  // musi odtworzyć tekst od modelu znak w znak. Nie można porównywać wprost, bo gdy
  // model nie napisał ® sam, wynik ma go o jeden więcej niż tekst wejściowy — i to
  // jest poprawne. Ta kontrola łapie realne zgubienie lub zdublowanie tekstu.
  let rebuilt='';
  for(let j=0;j<out.length;j++){
    if(nodes[j].isSup&&!translated.startsWith(out[j],rebuilt.length)) continue;
    rebuilt+=out[j];
  }
  if(rebuilt!==translated) return null;
  return out;
}

async function loadXliff(file){
  const xml=await readFile(file);xliffRawXml=xml;xliffXmlDoc=domParser.parseFromString(xml,'application/xml');
  const units=Array.from(xliffXmlDoc.querySelectorAll('trans-unit'));xliffSegs=[];
  units.forEach(unit=>{
    const unitId=unit.getAttribute('id')||'',datatype=unit.getAttribute('datatype')||'';
    const srcEl=unit.querySelector('source');if(!srcEl)return;
    if(datatype==='plaintext'){const text=(srcEl.textContent||'').trim();if(!text)return;const tgt=unit.querySelector('target');xliffSegs.push({id:unitId,unitId,type:'plain',source:text,target:tgt?(tgt.textContent||''):'',status:(tgt&&tgt.textContent.trim())?'done':'pending',fromTM:false});}
    else{const gNodes=Array.from(srcEl.querySelectorAll('g[ctype="x-text"]'));const textNodes=gNodes.map(g=>{const raw=g.textContent||'';const text=raw.replace(/^[ \t]+|[ \t]+$/g,'');return{gId:g.getAttribute('id'),text,isSup:isSupNode(g),blockIdx:blockIndexOf(g,srcEl),...edgePads(raw,text)};}).filter(n=>n.text.length>0);if(!textNodes.length)return;const tgt=unit.querySelector('target');const exT=tgt?Array.from(tgt.querySelectorAll('g[ctype="x-text"]')).map(g=>({gId:g.getAttribute('id'),text:g.textContent||''})):[];const targets=textNodes.map(n=>{const ex=exT.find(t=>t.gId===n.gId);return{gId:n.gId,text:ex?ex.text:''};});xliffSegs.push({id:unitId,unitId,type:'rich',textNodes,targets,status:targets.every(t=>t.text.trim())?'done':'pending',fromTM:false});}
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
  // Segment z indeksem górnym (®, ²) idzie do modelu JAKO CAŁE ZDANIE, jednym itemem.
  // Rozbicie na osobne <g> gubi kontekst: fragment tłumaczony w izolacji zmienia szyk,
  // a symbol zostaje przyklejony do pozycji, nie do słowa — stąd "training®" zamiast
  // "WINSTA®". Odpowiedź rozcinamy sami przez splitByAnchors(). Segmenty bez indeksu
  // górnego zostają na dotychczasowej ścieżce (fragment = item).
  let xliffMergedFallback=0,xliffSkipped=0;
  const items=[];toT.forEach(seg=>{const idx=xliffSegs.indexOf(seg);
    if(seg.type==='plain'){items.push({key:idx+'__p',segIndex:idx,gId:null,text:seg.source});return;}
    // Sklejamy z przywróconymi spacjami brzegowymi (padStart/padEnd z edgePads),
    // bo n.text jest przycięty — inaczej "czym jest"+"WINSTA" da "czym jestWINSTA"
    // i model dostanie zlepiony bełkot zamiast zdania.
    if(seg.textNodes.some(n=>n.isSup)){items.push({key:idx+'__merged',segIndex:idx,gId:null,merged:true,text:seg.textNodes.map(n=>(n.padStart||'')+n.text+(n.padEnd||'')).join('')});return;}
    seg.textNodes.forEach((n,j)=>{
      // Fragment bez litery i cyfry ('.', '?', ', ') przepisujemy wprost z oryginału
      // zamiast wysyłać do modelu — nie ma czego tłumaczyć, a tłumacz nie dostaje
      // wiersza "przetłumacz kropkę". Segmenty z ® idą wyżej ścieżką scalania.
      if(isUntranslatable(n.text)){const t=seg.targets[j];if(t&&!t.text)t.text=n.text;xliffSkipped++;return;}
      items.push({key:idx+'__'+n.gId,segIndex:idx,gId:n.gId,text:n.text});});
    if(seg.targets.every(t=>t.text.trim())) seg.status='done';});
  setXS('Tłumaczenie '+items.length+' fragmentów na '+lang+'...');
  let done=0,totalCostUsd=0;
  for(let i=0;i<items.length;i+=CHUNK){
    const chunk=items.slice(i,i+CHUNK);
    const dict=buildDictPromptForChunk(lang,chunk.map(it=>it.text),document.getElementById('source-lang')?.value);
    const charsIn=chunk.reduce((a,it)=>a+it.text.length,0);
    // Reguła o nazwach i jednostkach wzmacnia zachowanie, które model i tak przejawia —
    // dzięki temu kotwica w splitByAnchors() trafia pewniej. To NIE jest znacznik do
    // rozstawiania przez model: pozycję ®/² wyliczamy w kodzie.
    const prompt=`Tłumacz materiały e-learningowe na: ${lang}.\nZachowaj zmienne %...% bez zmian.\nNie tłumacz nazw produktów (WINSTA, TOPJOB, CAGE CLAMP, PUSH WIRE, MINI, MIDI, CLASSIC) ani symboli jednostek (mm) — przepisz je dokładnie.${dict}\nJSON: [{"key":"...","translation":"..."}] — bez markdown.\n\nFragmenty:\n${JSON.stringify(chunk.map(it=>({key:it.key,text:it.text})))}`;
    try{
      const res=JSON.parse((await apiCall(prompt)).replace(/```json|```/g,'').trim());
      const charsOut=res.reduce((a,r)=>a+(r.translation?.length||0),0);
      totalCostUsd+=((charsIn/CPT)/1e6)*PRICE_IN+((charsOut/CPT)/1e6)*PRICE_OUT;
      res.forEach(r=>{const item=chunk.find(it=>it.key===r.key);if(!item)return;const seg=xliffSegs[item.segIndex];if(!seg)return;if(seg.type==='plain'){seg.target=r.translation;seg.status='done';}else if(item.merged){
          // Rozcięcie po kotwicach. Gdy się nie uda (kotwica nie przeżyła tłumaczenia
          // albo jest niejednoznaczna) — segment zostaje do ponowienia starą ścieżką,
          // czyli wynik będzie co najwyżej taki jak dziś, nigdy gorszy.
          const parts=splitByAnchors(r.translation||'',seg.textNodes);
          if(parts){seg.targets.forEach((t,j)=>{t.text=parts[j];});seg.status='done';}
          else{xliffMergedFallback++;seg._needsSplitFallback=true;}
        }else{const tn=seg.targets.find(t=>t.gId===item.gId);if(tn)tn.text=r.translation;if(seg.targets.every(t=>t.text.trim()))seg.status='done';}const ta=document.getElementById('xta-'+item.segIndex);if(ta)ta.value=xliffTgt(xliffSegs[item.segIndex]);const b=document.getElementById('xbadge-'+item.segIndex);if(b&&xliffSegs[item.segIndex].status==='done'){b.className='badge b-green';b.textContent='OK';}});
    }catch(err){chunk.forEach(it=>{xliffSegs[it.segIndex].status='error';const b=document.getElementById('xbadge-'+it.segIndex);if(b){b.className='badge b-red';b.textContent='Błąd';}});setXS('Błąd: '+err.message);}
    done+=chunk.length;document.getElementById('xliff-pf').style.width=Math.round(done/items.length*100)+'%';updateXliffProgress();if(typeof quickMode!=='undefined'&&quickMode==='xliff')renderQuickTable();await sleep(150);
  }
  // Fallback: segmenty, których nie dało się rozciąć po kotwicy, tłumaczymy jeszcze raz
  // fragment po fragmencie — dokładnie tak, jak działo się to przed tą zmianą.
  const fbSegs=xliffSegs.filter(s=>s._needsSplitFallback);
  if(fbSegs.length){
    setXS('Ponawiam '+fbSegs.length+' segmentów bez kotwicy...');
    const fbItems=[];fbSegs.forEach(seg=>{const idx=xliffSegs.indexOf(seg);seg.textNodes.forEach(n=>fbItems.push({key:idx+'__'+n.gId,segIndex:idx,gId:n.gId,text:n.text}));});
    for(let i=0;i<fbItems.length;i+=CHUNK){
      const chunk=fbItems.slice(i,i+CHUNK);
      const dict=buildDictPromptForChunk(lang,chunk.map(it=>it.text),document.getElementById('source-lang')?.value);
      const prompt=`Tłumacz materiały e-learningowe na: ${lang}.\nZachowaj zmienne %...% bez zmian.${dict}\nJSON: [{"key":"...","translation":"..."}] — bez markdown.\n\nFragmenty:\n${JSON.stringify(chunk.map(it=>({key:it.key,text:it.text})))}`;
      try{
        const res=JSON.parse((await apiCall(prompt)).replace(/```json|```/g,'').trim());
        res.forEach(r=>{const item=chunk.find(it=>it.key===r.key);if(!item)return;const seg=xliffSegs[item.segIndex];if(!seg)return;const tn=seg.targets.find(t=>t.gId===item.gId);if(tn)tn.text=r.translation;});
      }catch(err){console.warn('Fallback XLIFF nieudany:',err.message);}
      await sleep(150);
    }
    fbSegs.forEach(seg=>{delete seg._needsSplitFallback;const idx=xliffSegs.indexOf(seg);seg.status=seg.targets.every(t=>t.text.trim())?'done':'error';const ta=document.getElementById('xta-'+idx);if(ta)ta.value=xliffTgt(seg);const b=document.getElementById('xbadge-'+idx);if(b){const ok=seg.status==='done';b.className='badge '+(ok?'b-green':'b-red');b.textContent=ok?'OK':'Błąd';}});
    updateXliffProgress();
  }
  if(xliffMergedFallback) console.info('[XLIFF] segmenty bez jednoznacznej kotwicy (fallback):',xliffMergedFallback);
  if(xliffSkipped) console.info('[XLIFF] fragmenty przepisane bez tłumaczenia (interpunkcja, ®):',xliffSkipped);
  const finalDone=xliffSegs.filter(s=>s.status==='done').length;
  const charsThisBatch=items.reduce((a,it)=>a+it.text.length,0);
  const creditsUsed=estimateCredits(charsThisBatch);
  await updateHistoryEntry(histId,finalDone,xliffSegs.filter(s=>s.fromTM).length,creditsUsed,creditsUsed);
  updateXliffCost();
  await deductCredits(charsThisBatch, document.getElementById('xliff-fname').textContent, lang);
  setXS(`Gotowe! Użyto ${creditsUsed} kredytów. Saldo: ${formatTokens(currentOrg?.tokens_balance||0)} kredytów.`);
}
function setXS(m){document.getElementById('xliff-status').textContent=m;}

// Kolumna kontekstu MUSI zostać na końcu — xliffImportExcel() czyta kolumny po
// indeksach (row[0..4]), więc wstawienie jej wcześniej po cichu zepsułoby import.
function xliffExportExcel(){if(!xliffSegs.length){alert('Brak segmentów.');return;}const lang=document.getElementById('target-lang').value;const rows=[['ID','Typ','gID','Źródło (PL)','Tłumaczenie ('+lang+')','Status','Pełne zdanie (kontekst)']];xliffSegs.forEach(s=>{if(s.type==='plain')rows.push([s.id,'plain','',s.source,s.target,s.status,'']);else{const ctx=ctxSentenceText(s.textNodes);s.textNodes.forEach((n,i)=>rows.push([s.id,'rich',n.gId,n.text,s.targets[i]?.text||'',s.status,ctx]));}});const ws=XLSX.utils.aoa_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Tłumaczenia');XLSX.writeFile(wb,'xliff_'+lang.toLowerCase()+'.xlsx');}
async function xliffImportExcel(e){const f=e.target.files[0];if(!f)return;const buf=await readFile(f,'array');const rows=XLSX.utils.sheet_to_json(XLSX.read(buf,{type:'array'}).Sheets[XLSX.read(buf,{type:'array'}).SheetNames[0]],{header:1});let n=0;rows.slice(1).forEach(row=>{const sid=String(row[0]||'').trim(),type=String(row[1]||'').trim(),gId=String(row[2]||'').trim(),tr=String(row[4]||'').trim();if(!sid||!tr)return;const seg=xliffSegs.find(s=>s.id===sid);if(!seg)return;if(type==='plain'){seg.target=tr;seg.status='done';seg.fromTM=false;n++;}else if(type==='rich'&&gId){const tn=seg.targets.find(t=>t.gId===gId);if(tn){tn.text=tr;n++;}if(seg.targets.every(t=>t.text.trim()))seg.status='done';}});renderXliffTable();updateXliffProgress();e.target.value='';alert('Zaimportowano '+n+' tłumaczeń.');}

function exportXliff(){
  if(!xliffXmlDoc){alert('Brak pliku.');return;}
  const lang=document.getElementById('target-lang').value;
  const workDoc=domParser.parseFromString(xliffRawXml,'application/xml');
  xliffSegs.forEach(seg=>{let unit=null;for(const u of workDoc.querySelectorAll('trans-unit')){if(u.getAttribute('id')===seg.unitId){unit=u;break;}}if(!unit)return;const srcEl=unit.querySelector('source');if(!srcEl)return;const ex=unit.querySelector('target');if(ex)ex.remove();const tgt=workDoc.createElementNS(XLIFF_NS,'target');tgt.setAttribute('state','translated');if(seg.type==='plain'){tgt.textContent=seg.target||seg.source;}else{const cl=srcEl.cloneNode(true);const padded=padXliffTargets(seg.textNodes,seg.targets);cl.querySelectorAll('g[ctype="x-text"]').forEach(g=>{const i=seg.targets.findIndex(t=>t.gId===g.getAttribute('id'));if(i>=0&&seg.targets[i].text)g.textContent=padded[i];});while(cl.firstChild)tgt.appendChild(cl.firstChild);}srcEl.after(tgt);});
  let s=xmlSer.serializeToString(workDoc);if(!s.startsWith('<?xml'))s='<?xml version="1.0" encoding="utf-8"?>'+s;
  download(s,'translated_'+lang.toLowerCase().replace(/\s+/g,'_')+'.xliff','application/xliff+xml');
}