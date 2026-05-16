// ══════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════
(async()=>{
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
  const hash=rawHash;
  if(hash&&hash.includes('access_token')){
    let session=null;
    try{
      const{data:d}=await supa.auth.exchangeCodeForSession(hash);
      if(d&&d.session)session=d.session;
    }catch(e){/* not a code — try getSession */}
    if(!session){
      const{data:d2}=await supa.auth.getSession();
      if(d2&&d2.session)session=d2.session;
    }
    if(session){
      currentSession=session;currentUser=session.user;
      window.history.replaceState(null,'',window.location.pathname);
      await afterLogin();
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
