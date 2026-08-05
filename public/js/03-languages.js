// ══════════════════════════════════════════════════════════
// LANGUAGES
// ══════════════════════════════════════════════════════════
const LANGS=[
  {code:'English',label:'EN — Angielski',flag:'🇬🇧',primary:true},
  {code:'Lithuanian',label:'LT — Litewski',flag:'🇱🇹',primary:true},
  {code:'Latvian',label:'LV — Łotewski',flag:'🇱🇻',primary:true},
  {code:'Estonian',label:'ET — Estoński',flag:'🇪🇪',primary:true},
  {code:'Ukrainian',label:'UA — Ukraiński',flag:'🇺🇦',primary:true},
  {code:'Hungarian',label:'HU — Węgierski',flag:'🇭🇺',primary:true},
  {code:'Czech',label:'CZ — Czeski',flag:'🇨🇿',primary:true},
  {code:'Slovak',label:'SK — Słowacki',flag:'🇸🇰',primary:true},
  {code:'German',label:'DE — Niemiecki',flag:'🇩🇪'},
  {code:'French',label:'FR — Francuski',flag:'🇫🇷'},
  {code:'Spanish',label:'ES — Hiszpański',flag:'🇪🇸'},
  {code:'Italian',label:'IT — Włoski',flag:'🇮🇹'},
  {code:'Russian',label:'RU — Rosyjski',flag:'🇷🇺'},
  {code:'Portuguese',label:'PT — Portugalski',flag:'🇵🇹'},
  {code:'Dutch',label:'NL — Niderlandzki',flag:'🇳🇱'},
  {code:'Swedish',label:'SV — Szwedzki',flag:'🇸🇪'},
  {code:'Norwegian',label:'NO — Norweski',flag:'🇳🇴'},
  {code:'Danish',label:'DA — Duński',flag:'🇩🇰'},
  {code:'Finnish',label:'FI — Fiński',flag:'🇫🇮'},
  {code:'Romanian',label:'RO — Rumuński',flag:'🇷🇴'},
  {code:'Bulgarian',label:'BG — Bułgarski',flag:'🇧🇬'},
  {code:'Serbian',label:'SR — Serbski',flag:'🇷🇸'},
  {code:'Croatian',label:'HR — Chorwacki',flag:'🇭🇷'},
  {code:'Slovenian',label:'SL — Słoweński',flag:'🇸🇮'},
  {code:'Polish',label:'PL — Polski',flag:'🇵🇱'},
  {code:'Turkish',label:'TR — Turecki',flag:'🇹🇷'},
  {code:'Japanese',label:'JA — Japoński',flag:'🇯🇵'},
  {code:'Korean',label:'KO — Koreański',flag:'🇰🇷'},
  {code:'Chinese (Simplified)',label:'ZH — Chiński',flag:'🇨🇳'},
  {code:'Arabic',label:'AR — Arabski',flag:'🇸🇦'},
];
// Domyślny zestaw języków słownika — używany, dopóki organizacja
// nie ma własnej konfiguracji (organizations.dict_langs).
const PRIMARY_FALLBACK=LANGS.filter(l=>l.primary);
// Alias zachowany dla kodu spoza słownika (np. getFavLangs).
const PRIMARY=PRIMARY_FALLBACK;

// ── Konfiguracja słownika per organizacja ──────────────────────────
// Język bazowy — ten, w którym zapisany jest termin w dictionary.src.
function dictBaseLang(){ return currentOrg?.dict_base_lang||'Polish'; }
// Języki docelowe słownika tego tenanta (obiekty z LANGS).
// Nieznany kod (np. z backfillu starych danych) dostaje obiekt zastępczy,
// żeby renderowanie nie wywróciło się na undefined.
function dictLangs(){
  const codes=currentOrg?.dict_langs;
  if(!codes||!codes.length)return PRIMARY_FALLBACK;
  const base=dictBaseLang();
  return codes.filter(c=>c!==base).map(c=>LANGS.find(l=>l.code===c)||{code:c,label:c,flag:'🌐'});
}
// Kolejność przetwarzania języków wg grafu źródeł: język idzie dopiero
// po swoim źródle (żeby np. EN było gotowe, zanim ruszy CZ tłumaczone z EN).
function dictLangOrder(){
  const langs=dictLangs();
  const base=dictBaseLang();
  const byCode=new Map(langs.map(l=>[l.code,l]));
  const out=[],done=new Set();
  const visit=(code,depth)=>{
    if(done.has(code)||!byCode.has(code))return true;
    if(depth>langs.length){console.warn('dictLangOrder: cykl w mapie źródeł przy',code);return false;}
    const src=currentOrg?.dict_source_map?.[code];
    if(src&&src!==base&&src!==code&&!visit(src,depth+1))return false;
    if(done.has(code))return true;
    done.add(code);out.push(byCode.get(code));
    return true;
  };
  for(const l of langs){ if(!visit(l.code,0)) return langs; } // cykl → kolejność domyślna
  return out;
}
function getFavLangs(){
  try{const s=localStorage.getItem('favLangs_'+(currentOrg?.id||'default'));if(s)return JSON.parse(s);}catch(e){}
  return dictLangs().map(l=>l.code); // domyślnie języki słownika tej organizacji
}
function setFavLangs(codes){localStorage.setItem('favLangs_'+(currentOrg?.id||'default'),JSON.stringify(codes));}
function langOptionsHTML(selectedLang){
  const favCodes=getFavLangs();
  const favs=LANGS.filter(l=>favCodes.includes(l.code));
  const rest=LANGS.filter(l=>!favCodes.includes(l.code));
  const opt=l=>`<option value="${l.code}"${selectedLang&&l.code===selectedLang?' selected':''}>${l.flag} ${l.label}</option>`;
  return`<optgroup label="Twoje języki">${favs.map(opt).join('')}</optgroup>`+
    `<optgroup label="Pozostałe">${rest.map(opt).join('')}</optgroup>`;
}
function buildFavLangsUI(){
  const favCodes=getFavLangs();
  const picker=document.getElementById('fav-lang-picker');if(!picker)return;
  picker.innerHTML=LANGS.map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('');
  renderFavPills(favCodes);
}
function renderFavPills(codes){
  const container=document.getElementById('fav-langs-pills');if(!container)return;
  container.innerHTML=codes.map(code=>{
    const l=LANGS.find(x=>x.code===code);if(!l)return'';
    return`<span style="display:inline-flex;align-items:center;gap:4px;background:#f0fdf4;border:1px solid #4CDE80;border-radius:20px;padding:4px 10px;font-size:13px;">${l.flag} ${l.label}<button onclick="removeFavLang('${code}')" style="background:none;border:none;cursor:pointer;color:#888;font-size:15px;line-height:1;padding:0 0 0 2px;">×</button></span>`;
  }).join('');
}
function addFavLang(){
  const code=document.getElementById('fav-lang-picker').value;
  const favCodes=getFavLangs();
  if(!favCodes.includes(code)){favCodes.push(code);setFavLangs(favCodes);renderFavPills(favCodes);}
}
function removeFavLang(code){
  const favCodes=getFavLangs().filter(c=>c!==code);
  setFavLangs(favCodes);renderFavPills(favCodes);
}
function saveFavLangs(){
  ['target-lang','pptx-target-lang','sub-target-lang','q-target-lang'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.innerHTML=langOptionsHTML();
  });
  const npSrc=document.getElementById('np-src-lang');if(npSrc)npSrc.innerHTML=langOptionsHTML();
  alert('Języki zapisane.');
}