// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
function _showLanding(){
  document.getElementById('screen-landing').style.display='block';
  document.querySelectorAll('.auth-screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('app-shell').style.display='none';
  document.body.classList.remove('app-mode');
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
}
function _showScreen(id){
  document.getElementById('screen-landing').style.display='none';
  document.querySelectorAll('.auth-screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('app-shell').style.display='none';
  document.body.classList.remove('app-mode');
  const el=document.getElementById(id);
  if(el)el.classList.add('active');
}
function showLanding(){
  try{history.pushState({view:'landing'},'','/');}catch(e){}
  _showLanding();
}
function hideLanding(){
  document.getElementById('screen-landing').style.display='none';
}
function showScreen(id){
  try{history.pushState({view:id},'','/');}catch(e){}
  _showScreen(id);
}
function showApp(){
  document.querySelectorAll('.auth-screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('app-shell').style.display='flex';
  document.body.classList.add('app-mode');
  document.getElementById('tab-projects').classList.add('active');
  switchTab('projects');
}
function toggleSidebar(){
  document.getElementById('app-shell').classList.toggle('sidebar-open');
  document.getElementById('sidebar-overlay').classList.toggle('visible');
}
window.addEventListener('popstate',e=>{
  const view=e.state&&e.state.view;
  if(!view||view==='landing')_showLanding();
  else if(view.startsWith('screen-'))_showScreen(view);
});

function authErr(id,msg){const el=document.getElementById(id);el.textContent=msg;el.style.display='block';}
function authOk(id,msg){const el=document.getElementById(id);el.textContent=msg;el.style.display='block';}
function clearAuthMsgs(){document.querySelectorAll('.auth-error,.auth-success').forEach(e=>{e.style.display='none';e.textContent='';})}
function setFieldState(inputId,msgId,state,msg){
  const inp=document.getElementById(inputId);
  const msgEl=document.getElementById(msgId);
  inp.classList.remove('field-invalid','field-valid');
  if(state==='error')inp.classList.add('field-invalid');
  if(state==='ok')inp.classList.add('field-valid');
  if(msgEl){msgEl.textContent=msg||'';msgEl.className='auth-field-msg'+(msg?' show '+state:'');}
}
function validateEmail(inputId,msgId){
  const val=document.getElementById(inputId).value.trim();
  if(!val)return;
  if(/.+@.+\..+/.test(val))setFieldState(inputId,msgId,'ok','');
  else setFieldState(inputId,msgId,'error','Nieprawidłowy format email');
}
function validatePass(inputId,msgId){
  const val=document.getElementById(inputId).value;
  if(!val)return;
  if(val.length>=8)setFieldState(inputId,msgId,'ok','');
  else setFieldState(inputId,msgId,'error','Hasło musi mieć min. 8 znaków');
}
function validatePass2(inputId,msgId){
  const val=document.getElementById(inputId).value;
  const pass=document.getElementById('reg-pass').value;
  if(!val)return;
  if(val===pass)setFieldState(inputId,msgId,'ok','');
  else setFieldState(inputId,msgId,'error','Hasła nie są identyczne');
}

async function doLogin(){
  clearAuthMsgs();
  const email=document.getElementById('login-email').value.trim();
  const pass=document.getElementById('login-pass').value;
  if(!email||!pass){authErr('login-error','Wypełnij email i hasło.');return;}
  const btn=document.getElementById('login-btn');
  const orig=btn.textContent;
  btn.classList.add('loading');btn.textContent='Logowanie...';
  const{data,error}=await supa.auth.signInWithPassword({email,password:pass});
  btn.classList.remove('loading');btn.textContent=orig;
  if(error){authErr('login-error',error.message);return;}
  currentSession=data.session;currentUser=data.user;
  await afterLogin();
}

async function doRegister(){
  authErr('reg-error','Rejestracja jest tymczasowo wyłączona. Skontaktuj się z administratorem: zloty05@gmail.com');
  return;
  clearAuthMsgs();
  const name=document.getElementById('reg-name').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const pass=document.getElementById('reg-pass').value;
  const pass2=document.getElementById('reg-pass2').value;
  if(!name||!email||!pass){authErr('reg-error','Wypełnij wszystkie pola.');return;}
  if(pass.length<8){authErr('reg-error','Hasło musi mieć min. 8 znaków.');return;}
  if(pass!==pass2){authErr('reg-error','Hasła nie są identyczne.');return;}
  const btn=document.getElementById('reg-btn');
  const orig=btn.textContent;
  btn.classList.add('loading');btn.textContent='Tworzenie konta...';
  const{data,error}=await supa.auth.signUp({email,password:pass,options:{
    data:{full_name:name},
    emailRedirectTo:'https://translatescorm.com'
  }});
  btn.classList.remove('loading');btn.textContent=orig;
  if(error){authErr('reg-error',error.message);return;}
  // If session exists — email confirmation disabled, go straight to app
  if(data.session){
    currentSession=data.session;currentUser=data.user;
    await afterLogin();
  } else {
    // Email confirmation required — show message
    document.getElementById('reg-error').style.display='none';
    const box=document.createElement('div');
    box.className='auth-success';box.style.display='block';
    box.textContent='Sprawdź skrzynkę '+email+' i kliknij link potwierdzający aby dokończyć rejestrację.';
    document.querySelector('#screen-register .auth-box').insertBefore(box,document.getElementById('reg-error').nextSibling);
  }
}

async function doReset(){
  clearAuthMsgs();
  const email=document.getElementById('reset-email').value.trim();
  if(!email){authErr('reset-error','Wpisz email.');return;}
  const{error}=await supa.auth.resetPasswordForEmail(email,{redirectTo:window.location.href});
  if(error){authErr('reset-error',error.message);return;}
  authOk('reset-success','Link resetujący wysłany! Sprawdź skrzynkę.');
}

async function doLogout(){
  await supa.auth.signOut();
  currentSession=null;currentUser=null;currentOrg=null;currentRole=null;
  dictCache=[];tmCache=[];histCache=[];
  showScreen('screen-login');
}
function showAccountMsg(id,msg,type){
  const el=document.getElementById(id);if(!el)return;
  el.textContent=msg;el.style.display='block';
  el.style.color=type==='ok'?'#16a34a':'#b32424';
  if(type==='ok')setTimeout(()=>{el.style.display='none';},3000);
}
function openAccountSettings(){
  switchTab('settings');
  toggleUserMenu();
  const name=currentUser?.user_metadata?.full_name||'';
  const email=currentUser?.email||'';
  document.getElementById('account-name').value=name;
  document.getElementById('account-name-display').textContent=name||email;
  document.getElementById('account-email-display').textContent=email;
  document.getElementById('account-avatar').textContent=(name||email).charAt(0).toUpperCase();
}
async function saveAccountName(e){
  const name=document.getElementById('account-name').value.trim();
  if(!name){showAccountMsg('account-name-msg','Wpisz imię i nazwisko.','error');return;}
  const btn=e.target;btn.disabled=true;btn.textContent='Zapisywanie...';
  try{
    const{error}=await supa.auth.updateUser({data:{full_name:name}});
    if(error)throw error;
    if(currentUser.user_metadata)currentUser.user_metadata.full_name=name;
    document.getElementById('menu-name').textContent=name;
    document.getElementById('hdr-avatar').textContent=name.charAt(0).toUpperCase();
    document.getElementById('account-name-display').textContent=name;
    document.getElementById('account-avatar').textContent=name.charAt(0).toUpperCase();
    showAccountMsg('account-name-msg','Zapisano.','ok');
  }catch(err){showAccountMsg('account-name-msg',err.message||'Błąd zapisu.','error');}
  finally{btn.disabled=false;btn.textContent='Zapisz';}
}
async function changePassword(e){
  const p1=document.getElementById('account-pass1').value;
  const p2=document.getElementById('account-pass2').value;
  if(p1.length<8){showAccountMsg('account-pass-msg','Hasło musi mieć min. 8 znaków.','error');return;}
  if(p1!==p2){showAccountMsg('account-pass-msg','Hasła nie są identyczne.','error');return;}
  const btn=e.target;btn.disabled=true;btn.textContent='Zmienianie...';
  try{
    const{error}=await supa.auth.updateUser({password:p1});
    if(error)throw error;
    document.getElementById('account-pass1').value='';
    document.getElementById('account-pass2').value='';
    showAccountMsg('account-pass-msg','Hasło zmienione pomyślnie.','ok');
  }catch(err){showAccountMsg('account-pass-msg',err.message||'Błąd zmiany hasła.','error');}
  finally{btn.disabled=false;btn.textContent='Zmień hasło';}
}
async function deleteAccount(e){
  const email=document.getElementById('account-delete-confirm').value.trim();
  if(email!==currentUser?.email){showAccountMsg('account-delete-msg','Email nie pasuje do konta.','error');return;}
  if(!confirm('Czy na pewno chcesz usunąć konto? Tej operacji nie można cofnąć.'))return;
  const btn=e.target;btn.disabled=true;btn.textContent='Usuwanie...';
  try{
    const{error}=await supa.rpc('delete_user');
    if(error)throw error;
    await supa.auth.signOut();
    _showLanding();
  }catch(err){
    showAccountMsg('account-delete-msg',err.message||'Błąd usuwania konta.','error');
    btn.disabled=false;btn.textContent='Usuń konto';
  }
}

async function afterLogin(){
  try{
    // Check for pending invitation
    const pendingInvite=sessionStorage.getItem('pendingInvite');
    if(pendingInvite){
      sessionStorage.removeItem('pendingInvite');
      await acceptInvitation(pendingInvite);
      return;
    }
    // Step 1: get membership
    const members=await dbGet('organization_members',`?user_id=eq.${currentUser.id}`);
    if(members.length===0){
      showScreen('screen-onboard');
      return;
    }
    const m=members[0];
    currentRole=m.role;
    // Step 2: get org separately (avoids RLS join issues)
    const orgs=await dbGet('organizations',`?id=eq.${m.organization_id}`);
    if(!orgs.length){
      showScreen('screen-onboard');
      return;
    }
    currentOrg=orgs[0];
    await loadApp();
  }catch(e){
    console.error('afterLogin error:',e);
    showScreen('screen-onboard');
  }
}

async function acceptInvitation(token){
  try{
    // Find invitation by token
    const invites=await dbGet('invitations',`?token=eq.${token}&accepted_at=is.null`);
    if(!invites.length){
      alert('Zaproszenie wygasło lub zostało już użyte.');
      showScreen('screen-onboard');
      return;
    }
    const inv=invites[0];
    if(new Date(inv.expires_at)<new Date()){
      alert('Zaproszenie wygasło.');
      showScreen('screen-onboard');
      return;
    }
    // Add user to organization
    await dbPost('organization_members',{organization_id:inv.organization_id,user_id:currentUser.id,role:inv.role});
    // Mark invitation as accepted
    await dbPatch('invitations',{accepted_at:new Date().toISOString()},`?token=eq.${token}`);
    // Load org
    const orgs=await dbGet('organizations',`?id=eq.${inv.organization_id}`);
    currentOrg=orgs[0];
    currentRole=inv.role;
    await loadApp();
    alert(`Dołączyłeś do organizacji ${currentOrg.name} jako ${inv.role}!`);
  }catch(e){
    console.error('acceptInvitation error:',e);
    alert('Błąd akceptacji zaproszenia: '+e.message);
    showScreen('screen-onboard');
  }
}