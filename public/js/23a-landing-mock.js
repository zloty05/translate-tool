// ══════════════════════════════════════════════════════════════════════
// LANDING — MAKIETA EDYTORA (przełącznik języka)
// Jedyny interaktywny element makiet na landing page. Reszta makiet to
// statyczna ilustracja bez hoverów i bez kursora (patrz .lp-mock w app.css).
// Dane są zaszyte tutaj — makieta nie dotyka Supabase ani API.
// ══════════════════════════════════════════════════════════════════════

// Wspólne źródło (PL) + tłumaczenia per język. Status: 't' = przetłumaczony,
// 'e' = pusty. Pola chg/sav odwzorowują stany .seg-textarea.changed/.saved
// z realnego edytora (pole w trakcie edycji / świeżo zapisane).
const LPM_SRC = [
  'Przed przystąpieniem do pracy sprawdź stan środków ochrony indywidualnej.',
  'Zgłoś przełożonemu każdą sytuację potencjalnie wypadkową.',
  'Karta charakterystyki substancji musi być dostępna na stanowisku.',
  'Wejście do strefy zagrożenia wybuchem wymaga zezwolenia.',
];

const LPM_LANGS = {
  en: {
    label: '🇬🇧 EN',
    rows: [
      { t: 'Before starting work, check the condition of your personal protective equipment.', s: 't' },
      { t: 'Report every near-miss situation to your supervisor.', s: 't' },
      { t: 'The safety data sheet must be available at the workstation.', s: 't' },
      { t: 'Entering an explosion hazard zone requires a work permit.', s: 't' },
    ],
  },
  de: {
    label: '🇩🇪 DE',
    rows: [
      { t: 'Prüfen Sie vor Arbeitsbeginn den Zustand der persönlichen Schutzausrüstung.', s: 't' },
      { t: 'Melden Sie jede Beinaheunfall-Situation Ihrem Vorgesetzten.', s: 't', chg: true },
      { t: 'Das Sicherheitsdatenblatt muss am Arbeitsplatz verfügbar sein.', s: 't', sav: true },
      { t: '—', s: 'e' },
    ],
  },
  cs: {
    label: '🇨🇿 CS',
    rows: [
      { t: 'Před zahájením práce zkontrolujte stav osobních ochranných prostředků.', s: 't' },
      { t: 'Nahlaste nadřízenému každou skoro-nehodu.', s: 't' },
      { t: 'Bezpečnostní list musí být dostupný na pracovišti.', s: 't' },
      { t: 'Vstup do zóny s nebezpečím výbuchu vyžaduje povolení.', s: 't' },
    ],
  },
  uk: {
    label: '🇺🇦 UK',
    rows: [
      { t: 'Перед початком роботи перевірте стан засобів індивідуального захисту.', s: 't' },
      { t: '—', s: 'e' },
      { t: '—', s: 'e' },
      { t: '—', s: 'e' },
    ],
  },
};

function switchLpmLang(lang) {
  const cfg = LPM_LANGS[lang];
  if (!cfg) return;

  const body = document.getElementById('lpm-seg-body');
  const head = document.getElementById('lpm-tgt-head');
  if (!body || !head) return;

  head.textContent = 'Tłumaczenie · ' + cfg.label;

  body.innerHTML = LPM_SRC.map(function (src, i) {
    const r = cfg.rows[i] || { t: '—', s: 'e' };
    const cls = 'lpm-in' + (r.chg ? ' chg' : '') + (r.sav ? ' sav' : '') + (r.s === 'e' ? ' empty' : '');
    const pill = r.s === 'e'
      ? '<span class="lpm-sp lpm-sp-e">Puste</span>'
      : '<span class="lpm-sp lpm-sp-t">Tłum.</span>';
    return '<tr>'
      + '<td class="lpm-num">' + (i + 1) + '</td>'
      + '<td>' + esc(src) + '</td>'
      + '<td><div class="' + cls + '">' + esc(r.t) + '</div></td>'
      + '<td>' + pill + '</td>'
      + '</tr>';
  }).join('');

  document.querySelectorAll('#lpm-ltabs .lpm-ltab').forEach(function (b) {
    b.classList.toggle('on', b.dataset.lang === lang);
    b.setAttribute('aria-selected', b.dataset.lang === lang ? 'true' : 'false');
  });
}

function initLandingMock() {
  const tabs = document.getElementById('lpm-ltabs');
  if (!tabs) return;
  tabs.addEventListener('click', function (e) {
    const btn = e.target.closest('.lpm-ltab');
    if (btn && btn.dataset.lang) switchLpmLang(btn.dataset.lang);
  });
  switchLpmLang('de'); // język startowy — zgodny z zakładką .on w HTML
}

document.addEventListener('DOMContentLoaded', initLandingMock);
