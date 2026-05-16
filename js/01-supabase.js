// ══════════════════════════════════════════════════════════
// SUPABASE
// ══════════════════════════════════════════════════════════
const SB_URL='https://lzklxvdzyslpwugjvvtj.supabase.co';
const SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6a2x4dmR6eXNscHd1Z2p2dnRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjI5NjcsImV4cCI6MjA5MzAzODk2N30.5ddnoP1rO-FsQ73lcMfOxz02G8MDPXHHHsBrZJKxTFE';
// Capture URL before Supabase SDK processes and clears the hash
window._bootHash=window.location.hash;
window._bootSearch=window.location.search;
const supa=supabase.createClient(SB_URL,SB_KEY);

// REST helper (bypasses RLS issues with JS client in some cases)
async function sbRest(method,table,body=null,params=''){
  const url=`${SB_URL}/rest/v1/${table}${params}`;
  const h={'apikey':SB_KEY,'Authorization':`Bearer ${currentSession?.access_token||SB_KEY}`,'Content-Type':'application/json','Prefer':'return=representation'};
  const r=await fetch(url,{method,headers:h,body:body?JSON.stringify(body):null});
  if(!r.ok){const e=await r.text();throw new Error(`${method} ${table}: ${e}`);}
  const t=await r.text();return t?JSON.parse(t):[];
}
const dbGet=(t,p='')=>sbRest('GET',t,null,p);
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