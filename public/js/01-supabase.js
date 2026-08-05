// ══════════════════════════════════════════════════════════
// SUPABASE
// ══════════════════════════════════════════════════════════
// Trzy środowiska. Klucz anon jest publiczny z założenia (barierą jest RLS),
// więc wszystkie mogą leżeć w kodzie — to ta sama klasa sekretu co dotychczas.
const ENVS={
  prod:{
    name:'prod',
    url:'https://lzklxvdzyslpwugjvvtj.supabase.co',
    key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6a2x4dmR6eXNscHd1Z2p2dnRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjI5NjcsImV4cCI6MjA5MzAzODk2N30.5ddnoP1rO-FsQ73lcMfOxz02G8MDPXHHHsBrZJKxTFE'
  },
  test:{
    name:'test',
    // Projekt "translatescorm-test" — osobna baza, żadnych danych produkcyjnych
    url:'https://ejtorsngzodkxrbvmybc.supabase.co',
    key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdG9yc25nem9ka3hyYnZteWJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTg5OTgsImV4cCI6MjEwMTQ5NDk5OH0.abp7sfO4sOFAAvejZWrFOZDcHqXaiL1eA5iACet2FMI'
  },
  local:{
    name:'local',
    url:'http://127.0.0.1:54321',
    // Domyślny klucz Supabase CLI — identyczny na każdej instalacji, nie jest sekretem
    key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
  }
};
// Dopasowanie DOKŁADNE, nie po sufiksie: test.translatescorm.com nie może
// wpaść w gałąź produkcyjną. Nieznany host → local (pomyłka nie trafia w prod).
function pickEnv(host){
  const h=(host||'').toLowerCase();
  if(h==='translatescorm.com'||h==='www.translatescorm.com') return ENVS.prod;
  if(h==='test.translatescorm.com'||h.endsWith('.pages.dev')) return ENVS.test;
  return ENVS.local;
}
let SB_ENV=pickEnv(location.hostname);
// Zabezpieczenie: gdyby środowisko testowe nie było jeszcze skonfigurowane,
// NIE schodzimy po cichu na produkcję — lepiej głośny błąd niż zapis do prod.
if(!SB_ENV.url){
  console.error(`[env] Środowisko "${SB_ENV.name}" nie ma skonfigurowanego Supabase (js/01-supabase.js).`);
  SB_ENV={...SB_ENV,name:SB_ENV.name+' (NIESKONFIGUROWANE)',url:ENVS.local.url,key:ENVS.local.key};
}
const IS_PROD=SB_ENV.name==='prod';
const SB_URL=SB_ENV.url;
const SB_KEY=SB_ENV.key;
// Capture URL before Supabase SDK processes and clears the hash
window._bootHash=window.location.hash;
window._bootSearch=window.location.search;
const supa=supabase.createClient(SB_URL,SB_KEY);

// Znacznik środowiska — żeby nie pomylić okna lokalnego z produkcyjnym.
if(!IS_PROD){
  console.info(`[env] ${SB_ENV.name} — Supabase: ${SB_URL}`);
  document.addEventListener('DOMContentLoaded',()=>{
    const el=document.getElementById('env-badge');
    if(!el)return;
    el.textContent=`⚠ ŚRODOWISKO ${SB_ENV.name.toUpperCase()} — ${SB_URL}`;
    el.style.display='';
    document.body.classList.add('env-nonprod');
  });
}

// REST helper (bypasses RLS issues with JS client in some cases)
async function sbRest(method,table,body=null,params=''){
  const url=`${SB_URL}/rest/v1/${table}${params}`;
  const h={'apikey':SB_KEY,'Authorization':`Bearer ${currentSession?.access_token||SB_KEY}`,'Content-Type':'application/json','Prefer':'return=representation'};
  const r=await fetch(url,{method,headers:h,body:body?JSON.stringify(body):null});
  if(!r.ok){const e=await r.text();throw new Error(`${method} ${table}: ${e}`);}
  const t=await r.text();return t?JSON.parse(t):[];
}
// GET z paginacją przez nagłówek Range — obchodzi domyślny limit PostgREST (db-max-rows=1000).
// Gdy caller sam podał limit= w params, respektujemy go i NIE paginujemy.
const PAGE=1000;
async function dbGet(table,params=''){
  if(/[?&]limit=/.test(params)) return sbRest('GET',table,null,params);
  const url=`${SB_URL}/rest/v1/${table}${params}`;
  let out=[],from=0;
  while(true){
    const to=from+PAGE-1;
    const h={'apikey':SB_KEY,'Authorization':`Bearer ${currentSession?.access_token||SB_KEY}`,'Content-Type':'application/json','Range-Unit':'items','Range':`${from}-${to}`};
    const r=await fetch(url,{headers:h});
    if(!r.ok){const e=await r.text();throw new Error(`GET ${table}: ${e}`);}
    const t=await r.text();
    const page=t?JSON.parse(t):[];
    out=out.concat(page);
    if(page.length<PAGE) break;
    from+=PAGE;
  }
  return out;
}
const dbPost=(t,b)=>sbRest('POST',t,b);
const dbPatch=(t,b,p)=>sbRest('PATCH',t,b,p);
const dbDelete=(t,p)=>sbRest('DELETE',t,null,p);
async function dbUpsert(table,body,onConflict){
  const params=onConflict?`?on_conflict=${onConflict}`:'';
  const url=`${SB_URL}/rest/v1/${table}${params}`;
  const h={'apikey':SB_KEY,'Authorization':`Bearer ${currentSession?.access_token||SB_KEY}`,'Content-Type':'application/json','Prefer':'return=representation,resolution=merge-duplicates'};
  const r=await fetch(url,{method:'POST',headers:h,body:JSON.stringify(body)});
  if(!r.ok){const e=await r.text();throw new Error(`UPSERT ${table}: ${e}`);}
  const t=await r.text();return t?JSON.parse(t):[];
}