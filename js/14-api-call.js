// ══════════════════════════════════════════════════════════
// API CALL
// ══════════════════════════════════════════════════════════
async function apiCall(prompt,maxTokens=2000){
  const resp=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(currentSession?.access_token||'')},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})});
  if(!resp.ok){const e=await resp.json();throw new Error(e.error?.message||resp.statusText);}
  const data=await resp.json();return data.content.map(b=>b.text||'').join('');
}