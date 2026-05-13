// ══════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════
function updateSlug(){
  const name=document.getElementById('org-name').value;
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  document.getElementById('org-slug').value=slug;
}

async function onboardStep2(){
  const name=document.getElementById('org-name').value.trim();
  const slug=document.getElementById('org-slug').value.trim();
  if(!name||!slug){document.getElementById('onboard-error').textContent='Wypełnij nazwę i identyfikator.';document.getElementById('onboard-error').style.display='block';return;}
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
    // Step 4: fetch full org record
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