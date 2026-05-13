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
const PRIMARY=LANGS.filter(l=>l.primary);
function langOptionsHTML(){
  return`<optgroup label="Twoje języki">${PRIMARY.map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('')}</optgroup>`+
    `<optgroup label="Pozostałe">${LANGS.filter(l=>!l.primary).map(l=>`<option value="${l.code}">${l.flag} ${l.label}</option>`).join('')}</optgroup>`;
}