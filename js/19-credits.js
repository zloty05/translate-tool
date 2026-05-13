// ══════════════════════════════════════════════════════════
// CREDIT SYSTEM  (1 kredyt = 1000 znaków = 1 PLN)
// ══════════════════════════════════════════════════════════
const STRIPE_PK = 'pk_test_51TRpDpFAZbQYcNSruWmlgB1DCvQtEE1GN1rO2qHQNFHgLxPv80FfgAXqt30ImjdCxfY3ghDNKzEO4XwXi33XIXdi00owtPZrEO';

const PACKAGES = {
  'price_1TRpL9FAZbQYcNSrcZCePhAO': { name:'Starter', tokens:50, price:50 },
  'price_1TRpLWFAZbQYcNSraskM5Xoq': { name:'Standard', tokens:250, price:230 },
  'price_1TRpLnFAZbQYcNSrhHdwtHo5': { name:'Pro', tokens:1000, price:850 },
};

function estimateCredits(chars){ return Math.max(1,Math.ceil(chars/1000)); }
function estimateTokensForTranslation(chars){ return estimateCredits(chars); }

function updateTokenBadge(){
  const balance = currentOrg?.tokens_balance || 0;
  const el = document.getElementById('hdr-token-amount');
  if(!el) return;
  el.textContent = formatTokens(balance);
  el.className = 'token-amount' + (balance < 5 ? ' low' : '') + (balance <= 0 ? ' empty' : '');
  if(balance < 5 && balance > 0 && !sessionStorage.getItem('lowTokenNotifSent') && currentRole==='admin'){
    sessionStorage.setItem('lowTokenNotifSent','1');
    createNotification('tokens_low','Niskie saldo kredytów',
      `Pozostało ${formatTokens(balance)} kredytów — rozważ doładowanie`);
  }
}

function formatTokens(n){ return Number(n).toLocaleString('pl-PL'); }

function updateShopBalance(){
  const balance = currentOrg?.tokens_balance || 0;
  const el = document.getElementById('shop-balance');
  const equiv = document.getElementById('shop-balance-equiv');
  if(el) el.textContent = balance.toLocaleString('pl-PL');
  if(equiv){
    equiv.innerHTML = `<span style="color:#aaa;">= ${balance} PLN · wystarczy na ~${(balance*1000).toLocaleString('pl-PL')} znaków</span>`;
  }
}

async function loadTokenHistory(){
  if(!currentOrg) return;
  document.getElementById('tx-loading').style.display='flex';
  try{
    const txs = await dbGet('token_transactions', `?organization_id=eq.${currentOrg.id}&order=created_at.desc&limit=50`);
    renderTokenHistory(txs);
  }catch(e){ console.error('TX history error:', e); }
  document.getElementById('tx-loading').style.display='none';
}

function renderTokenHistory(txs){
  const list = document.getElementById('tx-list');
  if(!txs.length){ list.innerHTML='<div style="padding:20px;text-align:center;color:#ccc;font-size:13px;">Brak transakcji</div>'; return; }
  const typeLabel = { purchase:'🛒 Zakup', usage:'⚡ Użycie', bonus:'🎁 Bonus', refund:'↩ Zwrot' };
  list.innerHTML = `<div class="tx-row" style="background:#fafaf8;font-size:11px;font-weight:600;color:#999;">
    <div class="tx-col">Data</div><div class="tx-col">Opis</div>
    <div class="tx-col">Kredyty</div><div class="tx-col">Saldo</div>
  </div>` +
  txs.map(tx => `<div class="tx-row">
    <div class="tx-col" style="color:#aaa;font-size:11px;">${fmtDate(tx.created_at)}</div>
    <div class="tx-col">${typeLabel[tx.type]||tx.type} ${esc(tx.description||'')}</div>
    <div class="tx-col ${tx.tokens>0?'tx-plus':'tx-minus'}">${tx.tokens>0?'+':''}${tx.tokens.toLocaleString('pl-PL')}</div>
    <div class="tx-col" style="color:#888;">${tx.balance_after.toLocaleString('pl-PL')}</div>
  </div>`).join('');
}

// Stripe Checkout — redirect to Stripe hosted page
async function startCheckout(priceId, pkgKey){
  if(!currentOrg){ alert('Brak organizacji.'); return; }
  if(currentRole === 'viewer'){ alert('Brak uprawnień do zakupu.'); return; }
  const pkg = PACKAGES[priceId];
  if(!confirm(`Kupić pakiet ${pkg.name} (${pkg.tokens.toLocaleString('pl-PL')} kredytów) za ${pkg.price} PLN?`)) return;

  // Stripe checkout - requires backend setup
  alert('⚠️ Do obsługi płatności wymagana jest konfiguracja Stripe.\n\nW trybie testowym możesz dodać kredyty ręcznie przez panel admina w zakładce Zespół.');
}

// Admin: manually add credits (for testing)
async function adminAddTokens(amount, description){
  if(!currentOrg || currentRole !== 'admin'){ alert('Tylko admin.'); return; }
  try{
    const{data, error} = await supa.rpc('add_tokens', {
      org_id: currentOrg.id,
      amount,
      desc_text: description || 'Ręczne doładowanie (admin)',
    });
    if(error) throw new Error(error.message);
    currentOrg.tokens_balance = (currentOrg.tokens_balance || 0) + amount;
    updateTokenBadge();
    updateShopBalance();
    loadTokenHistory();
    alert(`Dodano ${amount.toLocaleString('pl-PL')} kredytów! Nowe saldo: ${currentOrg.tokens_balance.toLocaleString('pl-PL')}`);
  }catch(e){ alert('Błąd: '+e.message); }
}

// Check if org has enough credits
function checkTokenBalance(requiredCredits){
  const balance = currentOrg?.tokens_balance || 0;
  if(balance < requiredCredits){
    const deficit = requiredCredits - balance;
    const result = confirm(
      `Niewystarczające saldo kredytów!\n\n` +
      `Potrzebujesz: ${requiredCredits.toLocaleString('pl-PL')} kredytów\n` +
      `Masz: ${balance.toLocaleString('pl-PL')} kredytów\n` +
      `Brakuje: ${deficit.toLocaleString('pl-PL')} kredytów\n\n` +
      `Przejść do zakupu kredytów?`
    );
    if(result) switchTab('shop');
    return false;
  }
  return true;
}

// Deduct credits after translation
async function deductCredits(charsTranslated, filename, lang){
  if(!currentOrg) return;
  const credits = estimateCredits(charsTranslated);
  if(credits <= 0) return;
  try{
    const{data, error} = await supa.rpc('use_tokens', {
      org_id: currentOrg.id,
      amount: credits,
      desc_text: `${filename} → ${lang}`,
      meta: {filename, lang}
    });
    if(error){ console.error('Credit deduction error:', error); return; }
    currentOrg.tokens_balance = data.balance_after;
    updateTokenBadge();
  }catch(e){ console.error('Credit deduction error:', e); }
}
async function deductTokens(chars, filename, lang){ return deductCredits(chars, filename, lang); }

// One-time migration: old token balances → credits (1 credit = 1000 chars = 1 PLN)
async function migrateTokensToCredits(){
  if(!currentOrg) return;
  const flagKey = `creditsConverted_${currentOrg.id}`;
  if(localStorage.getItem(flagKey)) return;
  try{
    // Re-fetch fresh balance to handle concurrent logins (idempotent: > 10000 check)
    const orgs = await dbGet('organizations', `?id=eq.${currentOrg.id}`);
    const fresh = orgs[0]?.tokens_balance || 0;
    if(fresh > 10000){
      const credits = Math.round(fresh / 1000);
      await dbPatch('organizations', {tokens_balance: credits}, `?id=eq.${currentOrg.id}`);
      currentOrg.tokens_balance = credits;
      updateTokenBadge();
    }
  }catch(e){ console.error('Migration error:', e); }
  localStorage.setItem(flagKey, '1');
}