// ══════════════════════════════════════════════════════════
// TEAM MANAGEMENT
// ══════════════════════════════════════════════════════════
function getMemberName(m){
  // display_name from member_emails view
  const dn=m.display_name?.trim();
  if(dn && dn.length>0 && !dn.match(/^[0-9a-f-]{36}$/i)) return dn;
  // full_name from profiles
  if(m.profiles?.full_name?.trim()) return m.profiles.full_name.trim();
  if(m.profile?.full_name?.trim()) return m.profile.full_name.trim();
  // email fallback
  if(m.email) return m.email;
  return m.user_id.substring(0,8)+'...';
}

async function loadTeam(){
  document.getElementById('team-org-info').textContent=`Organizacja: ${currentOrg?.name||'—'} · Twoja rola: ${currentRole||'—'}`;
  document.getElementById('team-loading').style.display='flex';
  try{
    const members=await dbGet('organization_members',`?${orgParam()}`);
    // Use member_emails view which bypasses profiles RLS issues
    let nameMap={};
    try{
      const nameData=await dbGet('member_emails',`?organization_id=eq.${currentOrg.id}`);
      nameData.forEach(e=>{ nameMap[e.user_id]=e.display_name; });
    }catch(e){ console.warn('member_emails error:',e); }
    const membersWithProfiles=members.map(m=>({
      ...m,
      profiles:null,
      display_name:nameMap[m.user_id]||null
    }));
    const pending=await dbGet('invitations',`?${orgParam()}&accepted_at=is.null&order=created_at.desc`);
    renderTeamList(membersWithProfiles);
    renderPendingInvites(pending);
  }catch(e){console.error('loadTeam error:',e);}
  document.getElementById('team-loading').style.display='none';
}

// ══════════════════════════════════════════════════════════
// TEAM — language assignments per member
// ══════════════════════════════════════════════════════════
async function saveMemberLanguages(memberId, langs){
  try{
    await dbPatch('organization_members',{languages:langs},`?id=eq.${memberId}`);
    console.log('Languages saved:', langs);
  }catch(e){ console.error('Save languages error:', e); }
}

async function saveMemberTokenLimit(memberId, limit){
  try{
    const val = limit===''||limit===null ? null : parseInt(limit);
    await dbPatch('organization_members',{monthly_token_limit:val},`?id=eq.${memberId}`);
  }catch(e){ alert('Błąd zapisu limitu: '+e.message); }
}

function renderTeamList(members){
  const roleClass={admin:'role-admin',translator:'role-translator',viewer:'role-viewer'};
  const roleLabel={admin:'Admin',translator:'Translator',viewer:'Viewer'};
  const list=document.getElementById('team-list');
  const countEl=document.getElementById('team-member-count');
  if(countEl)countEl.textContent=members.length;
  if(!members.length){list.innerHTML='<div style="padding:20px;text-align:center;color:#ccc;font-size:13px;">Brak członków</div>';return;}
  const isAdmin=currentRole==='admin';
  list.innerHTML=members.map(m=>{
    const isMe=m.user_id===currentUser.id;
    const name=getMemberName(m);
    const email=m.email||m.display_name||'';
    const canRemove=isAdmin&&!isMe;
    const initials=name.charAt(0).toUpperCase();
    return`<div class="member-card">
      <div class="member-avatar">${esc(initials)}</div>
      <div class="member-info">
        <div class="member-name">${esc(name)}${isMe?' <span style="font-size:10px;color:#aaa;font-weight:400;">(Ty)</span>':''}</div>
        ${email&&email!==name?`<div class="member-email">${esc(email)}</div>`:''}
      </div>
      <span class="role-badge ${roleClass[m.role]||''}">${roleLabel[m.role]||m.role}</span>
      ${canRemove?`<button class="btn btn-red btn-sm" style="flex-shrink:0;" onclick="removeMember('${m.id}')">Usuń</button>`:'<div style="width:52px;"></div>'}
    </div>`;
  }).join('');
}

async function toggleMemberLang(memberId, langCode, el){
  const member = await dbGet('organization_members',`?id=eq.${memberId}`);
  if(!member.length) return;
  const langs = member[0].languages || [];
  const idx = langs.indexOf(langCode);
  if(idx>=0) langs.splice(idx,1); else langs.push(langCode);
  el.classList.toggle('selected', langs.includes(langCode));
  await saveMemberLanguages(memberId, langs);
  // Update cache
  teamMembersCache = teamMembersCache||[];
}

function renderPendingInvites(pending){
  const title=document.getElementById('pending-title');
  const list=document.getElementById('pending-list');
  if(!pending||!pending.length){if(title)title.style.display='none';if(list)list.innerHTML='';return;}
  if(title)title.style.display='block';
  const baseUrl='https://translatescorm.com';
  list.innerHTML=`<div style="border:1px solid #eee;border-radius:8px;overflow:hidden;">`+
    pending.map(inv=>{
      const expired=new Date(inv.expires_at)<new Date();
      const inviteUrl=`${baseUrl}?invite=${inv.token}`;
      return`<div style="border-bottom:1px solid #f0ede8;padding:10px 14px;">
        <div style="display:grid;grid-template-columns:1fr 80px 90px 56px;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="font-size:13px;font-weight:500;">${esc(inv.email)}</div>
          <div><span class="badge b-gray" style="font-size:10px;">${esc(inv.role)}</span></div>
          <div style="font-size:11px;">${expired?'<span style="color:#b32424;">Wygasło</span>':'<span style="color:#1a7a3f;">Aktywne</span>'}</div>
          <div><button class="btn btn-red btn-sm" onclick="deleteInvite('${inv.id}')" title="Usuń">✕</button></div>
        </div>
        ${!expired?`<div style="display:flex;gap:8px;align-items:center;">
          <input type="text" value="${inviteUrl}" readonly style="flex:1;font-size:11px;padding:5px 8px;border:1px solid #eee;border-radius:5px;background:#fafaf8;color:#666;" onclick="this.select()" />
          <button class="btn btn-sm" onclick="copyInviteLink('${inviteUrl}',this)">Kopiuj link</button>
        </div>`:''}
      </div>`;
    }).join('')+`</div>`;
}

function copyInviteLink(url, btn){
  navigator.clipboard.writeText(url).then(()=>{
    const orig=btn.textContent;
    btn.textContent='Skopiowano!';
    btn.style.color='#1a7a3f';
    setTimeout(()=>{btn.textContent=orig;btn.style.color='';},2000);
  });
}

async function deleteInvite(id){
  if(!confirm('Usunąć to zaproszenie?'))return;
  try{
    await dbDelete('invitations',`?id=eq.${id}`);
    loadTeam();
  }catch(e){alert('Błąd: '+e.message);}
}

async function sendInvite(){
  const email=document.getElementById('invite-email').value.trim();
  const role=document.getElementById('invite-role').value;
  if(!email){alert('Wpisz email.');return;}
  if(currentRole!=='admin'){alert('Tylko admin może zapraszać.');return;}
  try{
    const result=await dbPost('invitations',{organization_id:currentOrg.id,email,role,invited_by:currentUser.id});
    document.getElementById('invite-email').value='';
    const inv=Array.isArray(result)?result[0]:result;
    if(inv?.token){
      const inviteUrl=`https://translatescorm.com?invite=${inv.token}`;
      try{
        const r=await fetch('/api/invite',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${currentSession.access_token}`},
          body:JSON.stringify({email,inviteUrl,orgName:currentOrg.name})
        });
        if(!r.ok)throw new Error(await r.text());
        alert(`Zaproszenie wysłane do ${email}.`);
      }catch(emailErr){
        alert(`Zaproszenie zostało utworzone dla ${email}, ale wysyłka emaila nie powiodła się.\nSkopiuj link z tabeli poniżej.`);
        console.error('invite email error:',emailErr);
      }
    }else{
      alert(`Zaproszenie wysłane do ${email}.`);
    }
    loadTeam();
  }catch(e){alert('Błąd: '+e.message);}
}

async function removeMember(memberId){
  if(!confirm('Usunąć tego członka z organizacji?'))return;
  try{await dbDelete('organization_members',`?id=eq.${memberId}`);loadTeam();}
  catch(e){alert('Błąd: '+e.message);}
}