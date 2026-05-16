// ══════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════
(async()=>{
  // DEBUG: show boot info on screen (remove after fix)
  const _dbg=document.createElement('div');
  _dbg.style='position:fixed;top:0;left:0;right:0;background:#000;color:#0f0;font:12px monospace;padding:8px;z-index:99999;white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:auto;';
  _dbg.textContent='BOOT\nhref: '+window.location.href+'\nhash: '+window.location.hash+'\nsearch: '+window.location.search+'\npendingInvite: '+localStorage.getItem('pendingInvite');
  document.body.appendChild(_dbg);
  const rawHash=window.location.hash;
  const urlParams=new URLSearchParams(window.location.search);
  const inviteToken=urlParams.get('invite');

  // Save invite token to storage immediately (before any replaceState clears the URL)
  if(inviteToken){
    localStorage.setItem('pendingInvite',inviteToken);
    sessionStorage.setItem('pendingInvite',inviteToken);
  }

  // Handle PKCE code (Supabase v2 — email confirmation redirect lands here with ?code=...)
  const codeParam=urlParams.get('code');
  if(codeParam){
    try{
      const{data}=await supa.auth.exchangeCodeForSession(window.location.href);
      if(data?.session){
        currentSession=data.session;currentUser=data.user;
        window.history.replaceState(null,'',window.location.pathname);
        await afterLogin();
        return;
      }
    }catch(e){/* fall through to normal boot */}
  }

  // Handle email confirmation callback (token in URL hash — Supabase implicit flow)
  // Bypass SDK entirely: Edge Tracking Prevention blocks CDN scripts from accessing localStorage
  const hash=rawHash;
  if(hash&&hash.includes('access_token')){
    const hashParams=new URLSearchParams(hash.replace(/^#/,''));
    const accessToken=hashParams.get('access_token');
    const refreshToken=hashParams.get('refresh_token');
    if(accessToken){
      try{
        const payload=JSON.parse(atob(accessToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        currentSession={access_token:accessToken,refresh_token:refreshToken,user:{id:payload.sub,email:payload.email,user_metadata:payload.user_metadata}};
        currentUser=currentSession.user;
        window.history.replaceState(null,'',window.location.pathname);
        await afterLogin();
        return;
      }catch(e){/* malformed token — fall through */}
    }
    // fallback: try SDK getSession
    const{data:d2}=await supa.auth.getSession();
    if(d2?.session){
      currentSession=d2.session;currentUser=d2.session.user;
      window.history.replaceState(null,'',window.location.pathname);
      await afterLogin();
      return;
    }
  }

  // Handle Supabase error in hash (e.g. otp_expired — link wygasł)
  if(hash&&hash.includes('error=')){
    const params=new URLSearchParams(hash.replace(/^#/,''));
    const code=params.get('error_code')||params.get('error');
    if(code==='otp_expired'||code==='access_denied'){
      _showScreen('screen-invite');
      const errEl=document.getElementById('invite-reg-error');
      if(errEl){errEl.textContent='Link potwierdzający wygasł. Skontaktuj się z administratorem po nowe zaproszenie.';errEl.style.display='block';}
      return;
    }
  }

  // Handle password reset callback
  if(hash&&hash.includes('type=recovery')){
    showScreen('screen-reset');
    return;
  }

  // Pre-fill invite screen and clear URL (only when no auth code in URL)
  if(inviteToken){
    window.history.replaceState(null,'',window.location.pathname);
    try{
      const r=await fetch(`${SB_URL}/rest/v1/invitations?token=eq.${encodeURIComponent(inviteToken)}&select=email,organizations(name)`,{
        headers:{apikey:SB_KEY,'Authorization':`Bearer ${SB_KEY}`}
      });
      if(r.ok){
        const data=await r.json();
        if(data.length){
          const emailEl=document.getElementById('invite-email-reg');
          if(emailEl){emailEl.value=data[0].email;emailEl.readOnly=true;emailEl.style.opacity='0.7';}
          const orgName=data[0].organizations?.name;
          if(orgName){
            const orgEl=document.getElementById('invite-org-name');
            if(orgEl)orgEl.textContent=orgName;
          }
        }
      }
    }catch(e){/* anon access denied — form stays empty */}
  }

  // Check existing session
  const{data:{session}}=await supa.auth.getSession();
  if(session){
    currentSession=session;currentUser=session.user;
    await afterLogin();
  } else if(inviteToken){
    _showScreen('screen-invite');
  } else {
    showLanding();
  }

  // Listen for auth changes
  supa.auth.onAuthStateChange(async(event,session)=>{
    currentSession=session;
    if(event==='SIGNED_IN'&&session&&!currentOrg){
      currentUser=session.user;
      await afterLogin();
    }
    if(event==='SIGNED_OUT'){
      currentOrg=null;currentRole=null;currentUser=null;
      if(localStorage.getItem('pendingInvite')){
        _showScreen('screen-invite');
      } else {
        showLanding();
      }
    }
  });
})();
