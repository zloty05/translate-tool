// ══════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════
(async()=>{
  // Handle invitation link (?invite=TOKEN)
  const urlParams=new URLSearchParams(window.location.search);
  const inviteToken=urlParams.get('invite');
  if(inviteToken){
    // Store token and show login/register
    sessionStorage.setItem('pendingInvite',inviteToken);
    window.history.replaceState(null,'',window.location.pathname);
  }

  // Handle email confirmation callback (token in URL hash)
  const hash=window.location.hash;
  if(hash&&hash.includes('access_token')){
    const{data,error}=await supa.auth.getSession();
    if(!error&&data.session){
      currentSession=data.session;currentUser=data.session.user;
      // Clean URL
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
      showLanding();
    }
  });
})();