/* =========================================================================
   0. SPLASH SCREEN CONTROLLER
========================================================================= */
window.addEventListener('DOMContentLoaded', ()=>{
  const start = Date.now();
  const MIN_DISPLAY = 1300;
  function finish(){
    const elapsed = Date.now() - start;
    const wait = Math.max(0, MIN_DISPLAY - elapsed);
    setTimeout(()=>{
      document.getElementById('splash-screen').classList.add('hide');
      document.getElementById('app').classList.add('show');
    }, wait);
  }
  if(document.readyState === 'complete'){ finish(); }
  else { window.addEventListener('load', finish); }
});

/* =========================================================================
   1. THEME TOGGLE
========================================================================= */
(function(){
  const saved = localStorage.getItem('sap-theme');
  if(saved) document.documentElement.setAttribute('data-theme', saved);
  updateIcon();
  document.getElementById('theme-toggle').addEventListener('click', ()=>{
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    localStorage.setItem('sap-theme', cur);
    updateIcon();
    if(window.GroovyIDE) window.GroovyIDE.refreshTheme();
  });
  function updateIcon(){
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.getElementById('theme-toggle').textContent = isDark ? '☀' : '🌙';
  }
})();

/* =========================================================================
   2. VIEW SWITCHER
========================================================================= */
(function(){
  const tabs = document.querySelectorAll('.view-tab');
  const docks = {
    'data-studio':'dock-data-studio',
    'groovy-ide':'dock-groovy-ide',
    'pgp-keygen':'dock-pgp-keygen',
    'base64':'dock-base64',
    'validator':'dock-validator',
    'xpath':'dock-xpath',
    'xslt':'dock-xslt',
    'wsdl':'dock-wsdl'
  };
  tabs.forEach(tab=>{
    tab.addEventListener('click', ()=>{
      tabs.forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.view;

      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.getElementById('view-'+target).classList.add('active');

      Object.entries(docks).forEach(([key, id])=>{
        document.getElementById(id).style.display = (key === target) ? 'flex' : 'none';
      });

      if(target === 'groovy-ide' && window.GroovyIDE){
        window.GroovyIDE.show();
      }
    });
  });
})();
