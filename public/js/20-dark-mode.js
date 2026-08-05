// ══════════════════════════════════════════════════════════
// DARK MODE
// ══════════════════════════════════════════════════════════
function initDarkMode(){
  const dark = localStorage.getItem('darkMode') !== 'false';
  applyDarkMode(dark);
}

function applyDarkMode(on){
  document.body.classList.toggle('dark', on);
  document.documentElement.classList.toggle('dark', on);
  document.documentElement.style.background = on ? '#0f0f0f' : '';
  const track = document.getElementById('dark-toggle-track');
  if(track) track.classList.toggle('on', on);
  const iconLight = document.querySelector('.dark-icon-light');
  const iconDark  = document.querySelector('.dark-icon-dark');
  if(iconLight) iconLight.style.display = on ? 'none' : '';
  if(iconDark)  iconDark.style.display  = on ? ''     : 'none';
}

function toggleDarkMode(){
  const isDark = document.body.classList.contains('dark');
  applyDarkMode(!isDark);
  localStorage.setItem('darkMode', !isDark);
}