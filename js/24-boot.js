// ══════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════
(async()=>{
  // Capture hash before any replaceState calls (which clear window.location.hash)
  const rawHash=window.location.hash;

  // Handle invitation link (?invite=TOKEN)
  const urlParams=new URLSearchParams(window.location.search);
  const inviteToken=urlParams.get('invite');
  if(inviteToken){
    localStorage.setItem('pendingInvite',inviteToken);
    sessionStorage.setItem('pendingInvite',inviteToken);
    window.history.replaceState(null,'',window.location.pathname);
    // Try to pre-fill invite screen with email (anon read — graceful degradation if RLS blocks)
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

  // Handle email confirmation callback (token in URL hash)
  const hash=rawHash;
  if(hash&&hash.includes('access_token')){
    // Try exchangeCodeForSession first (Supabase v2 PKCE), fall back to getSession
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
