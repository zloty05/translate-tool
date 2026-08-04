// ══════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════
function updateSlug(){
  const name=document.getElementById('org-name').value;
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  document.getElementById('org-slug').value=slug;
}

function onboardErr(msg){
  const el=document.getElementById('onboard-error');
  el.textContent=msg;el.style.display='block';
}

async function onboardStep2(){
  const fullName=document.getElementById('onboard-fullname').value.trim();
  const pass1=document.getElementById('onboard-pass1').value;
  const pass2=document.getElementById('onboard-pass2').value;
  const name=document.getElementById('org-name').value.trim();
  const slug=document.getElementById('org-slug').value.trim();
  // Konto zaproszone z panelu Supabase nie ma hasła — ustawiamy je tutaj,
  // inaczej user nie zaloguje się przy kolejnej wizycie (tylko reset hasła).
  if(!fullName){onboardErr('Wpisz imię i nazwisko.');return;}
  if(pass1.length<8){onboardErr('Hasło musi mieć min. 8 znaków.');return;}
  if(pass1!==pass2){onboardErr('Hasła nie są identyczne.');return;}
  if(!name||!slug){onboardErr('Wypełnij nazwę i identyfikator.');return;}
  document.getElementById('onboard-error').style.display='none';
  try{
    // Use security definer function to bypass RLS
    // Step 1: create org (security definer bypasses RLS)
    const{data:orgId,error:e1}=await supa.rpc('create_org_record',{org_name:name,org_slug:slug});
    if(e1)throw new Error(e1.message);
    // Step 2: add current user as admin (security invoker — auth.uid() works)
    const{error:e2}=await supa.rpc('add_org_admin',{org_id:orgId});
    if(e2)throw new Error(e2.message);
    // Step 3: add welcome bonus tokens (10 000)
    await supa.rpc('add_tokens',{org_id:orgId,amount:15,desc_text:'Kredyty startowe — bonus powitalny'});
    // Step 4: zapis hasła i imienia — po utworzeniu org, żeby błąd nie zablokował onboardingu
    try{
      const{error:e3}=await supa.auth.updateUser({password:pass1,data:{full_name:fullName}});
      if(e3)throw e3;
      if(currentUser){
        currentUser.user_metadata=currentUser.user_metadata||{};
        currentUser.user_metadata.full_name=fullName;
      }
    }catch(errAcc){
      console.error('onboard updateUser error:',errAcc);
      alert('Organizacja została utworzona, ale nie udało się zapisać hasła i imienia:\n'+(errAcc.message||'')+'\n\nUstaw je w Ustawieniach → Moje konto.');
    }
    // Step 5: fetch full org record
    const orgs=await dbGet('organizations',`?id=eq.${orgId}`);
    currentOrg=orgs[0];
    currentRole='admin';
    // Go to step 2
    document.getElementById('onboard-step1').classList.remove('active');
    document.getElementById('onboard-step2').classList.add('active');
    document.getElementById('od2').classList.add('done');
    document.getElementById('onboard-subtitle').textContent='Zaproś zespół (opcjonalnie)';
  }catch(e){document.getElementById('onboard-error').textContent='Błąd: '+e.message;document.getElementById('onboard-error').style.display='block';}
}

function addInviteRow(){
  const div=document.createElement('div');
  div.className='input-row';div.style.marginBottom='8px';
  div.innerHTML=`<input type="email" placeholder="email@firma.pl" class="invite-email" /><select class="invite-role" style="width:130px;flex:none;"><option value="translator">Translator</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select>`;
  document.getElementById('invite-rows').appendChild(div);
}

async function finishOnboarding(skip=false){
  if(!skip){
    const emails=document.querySelectorAll('.invite-email');
    const roles=document.querySelectorAll('.invite-role');
    for(let i=0;i<emails.length;i++){
      const email=emails[i].value.trim();
      if(!email)continue;
      try{await dbPost('invitations',{organization_id:currentOrg.id,email,role:roles[i].value,invited_by:currentUser.id});}
      catch(e){console.error('Invite error:',e);}
    }
  }
  await loadApp();
}