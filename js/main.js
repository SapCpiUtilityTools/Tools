/* =========================================================================
   -1. SPLASH SPINNER — halftone dot-spiral logo, drawn on canvas
========================================================================= */
(function drawSplashSpinner(){
  const canvas = document.getElementById('splash-spinner');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W/2, cy = H/2;

  const COLOR_CORE = [10, 110, 209];   // --sap-blue
  const COLOR_TIP  = [140, 200, 245];  // lighter blue toward the tips

  function lerpColor(a, b, t){
    return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
  }

  const arms = 3;
  const dotsPerArm = 46;
  const maxRadius = W * 0.42;
  const armSweep = Math.PI * 1.2;

  for(let a=0; a<arms; a++){
    const armOffset = (Math.PI*2/arms) * a;
    for(let i=0; i<dotsPerArm; i++){
      const t = i/(dotsPerArm-1);
      const angle = armOffset + t*armSweep;
      const radius = maxRadius * Math.pow(t, 0.85);

      let size;
      if(t < 0.72){
        size = (t/0.72) * 8.2;
      } else {
        size = 8.2 * (1 - (t-0.72)/0.28);
      }
      size = Math.max(size, 0.6);

      const x = cx + radius*Math.cos(angle);
      const y = cy + radius*Math.sin(angle);

      ctx.fillStyle = lerpColor(COLOR_CORE, COLOR_TIP, t);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI*2);
      ctx.fill();
    }
  }
})();

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
