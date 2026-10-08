/* =========================================================================
   6. BASE64 ENCODER / DECODER (text + file, standard & URL-safe)
========================================================================= */
(function(){

  const $status = document.getElementById('b64-status');
  function setStatus(txt, cls){
    $status.textContent = txt;
    $status.className = 'dock-status ' + cls;
  }

  const $mode = document.getElementById('b64-mode');
  const $variant = document.getElementById('b64-variant');
  const $wrap = document.getElementById('b64-wrap');
  const $nopad = document.getElementById('b64-nopad');
  const $input = document.getElementById('b64-input');
  const $output = document.getElementById('b64-output');
  const $inputCount = document.getElementById('b64-input-count');
  const $outputCount = document.getElementById('b64-output-count');
  const $filedrop = document.getElementById('b64-filedrop');
  const $fileInput = document.getElementById('b64-file-input');
  const $fileInfo = document.getElementById('b64-fileinfo');

  let currentFileBase64 = null;
  let currentFileName = null;

  const SAMPLE_TEXT = 'Hello, SAP CPI! This text will be Base64 encoded. 🚀';

  /* ---------- mode toggle: text vs file ---------- */
  $mode.addEventListener('change', ()=>{
    const isFile = $mode.value === 'file';
    $filedrop.style.display = isFile ? 'block' : 'none';
    $input.style.display = isFile ? 'none' : 'block';
    $inputCount.style.display = isFile ? 'none' : 'block';
    if(!isFile){
      $fileInfo.classList.remove('show');
      currentFileBase64 = null;
      currentFileName = null;
    }
    setStatus('Ready', 'ok');
  });

  /* ---------- char counters ---------- */
  function updateCounts(){
    $inputCount.textContent = `${$input.value.length.toLocaleString()} characters`;
    $outputCount.textContent = `${$output.value.length.toLocaleString()} characters`;
  }
  $input.addEventListener('input', updateCounts);

  /* ---------- helpers: UTF-8 safe base64 for text ---------- */
  function toBase64Standard(str){
    const utf8Bytes = new TextEncoder().encode(str);
    let binary = '';
    utf8Bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }
  function fromBase64Standard(b64){
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal:false }).decode(bytes);
  }

  function toUrlSafe(b64){
    return b64.replace(/\+/g,'-').replace(/\//g,'_');
  }
  function fromUrlSafe(b64){
    return b64.replace(/-/g,'+').replace(/_/g,'/');
  }

  function stripPadding(b64){
    return b64.replace(/=+$/,'');
  }
  function restorePadding(b64){
    const mod = b64.length % 4;
    if(mod === 0) return b64;
    return b64 + '='.repeat(4 - mod);
  }

  function wrapLines(str, width){
    const re = new RegExp(`.{1,${width}}`, 'g');
    return (str.match(re) || []).join('\n');
  }

  function normalizeBase64Input(str){
    return str.replace(/\s+/g, '');
  }

  /* ---------- ENCODE ---------- */
  function encodeAction(){
    setStatus('Encoding…', 'run');
    try{
      let b64;

      if($mode.value === 'file'){
        if(!currentFileBase64){ setStatus('Choose a file first', 'err'); return; }
        b64 = currentFileBase64;
      } else {
        const text = $input.value;
        if(!text){ setStatus('Enter some text to encode', 'err'); return; }
        b64 = toBase64Standard(text);
      }

      if($variant.value === 'urlsafe'){
        b64 = toUrlSafe(b64);
      }
      if($nopad.checked){
        b64 = stripPadding(b64);
      }
      if($wrap.checked){
        b64 = wrapLines(b64, 76);
      }

      $output.value = b64;
      updateCounts();
      setStatus('Encoded ✓', 'ok');
    }catch(e){
      setStatus('Error: ' + e.message, 'err');
    }
  }

  /* ---------- DECODE ---------- */
  function decodeAction(){
    setStatus('Decoding…', 'run');
    try{
      const source = $mode.value === 'file'
        ? $output.value
        : $input.value;

      if(!source || !source.trim()){ setStatus('Enter a Base64 string to decode', 'err'); return; }

      let b64 = normalizeBase64Input(source);

      if($variant.value === 'urlsafe'){
        b64 = fromUrlSafe(b64);
      }
      b64 = restorePadding(b64);

      const decodedText = fromBase64Standard(b64);
      $output.value = decodedText;
      updateCounts();
      setStatus('Decoded ✓', 'ok');
    }catch(e){
      setStatus('Error: Invalid Base64 input — ' + e.message, 'err');
    }
  }

  document.getElementById('b64-btn-encode').addEventListener('click', encodeAction);
  document.getElementById('b64-btn-decode').addEventListener('click', decodeAction);

  /* ---------- swap input/output ---------- */
  document.getElementById('b64-btn-swap').addEventListener('click', ()=>{
    const tmp = $input.value;
    $input.value = $output.value;
    $output.value = tmp;
    updateCounts();
    setStatus('Swapped ✓', 'ok');
  });

  /* ---------- copy / download output ---------- */
  document.getElementById('b64-btn-copy').addEventListener('click', ()=>{
    if(!$output.value){ setStatus('Nothing to copy', 'err'); return; }
    navigator.clipboard.writeText($output.value).then(()=> setStatus('Output copied ✓', 'ok'));
  });

  document.getElementById('b64-btn-download').addEventListener('click', ()=>{
    if(!$output.value){ setStatus('Nothing to download', 'err'); return; }
    const isLikelyBase64Output = /^[A-Za-z0-9+/_-]+=*$/.test($output.value.replace(/\n/g,''));
    const filename = currentFileName
      ? (isLikelyBase64Output ? `${currentFileName}.base64.txt` : currentFileName)
      : (isLikelyBase64Output ? 'encoded.base64.txt' : 'decoded.txt');
    const blob = new Blob([$output.value], { type:'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${filename} ✓`, 'ok');
  });

  /* ---------- sample / clear ---------- */
  document.getElementById('b64-btn-sample').addEventListener('click', ()=>{
    $mode.value = 'text';
    $mode.dispatchEvent(new Event('change'));
    $input.value = SAMPLE_TEXT;
    $output.value = '';
    updateCounts();
    setStatus('Sample loaded', 'ok');
  });

  document.getElementById('b64-btn-clear').addEventListener('click', ()=>{
    $input.value = '';
    $output.value = '';
    currentFileBase64 = null;
    currentFileName = null;
    $fileInfo.classList.remove('show');
    $fileInput.value = '';
    updateCounts();
    setStatus('Cleared', 'ok');
  });

  /* ---------- file handling (drag & drop + click) ---------- */
  function readFileAsBase64(file){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ()=>{
        const result = reader.result;
        const commaIdx = result.indexOf(',');
        resolve(commaIdx >= 0 ? result.slice(commaIdx+1) : result);
      };
      reader.onerror = ()=> reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(file){
    if(!file) return;
    setStatus('Reading file…', 'run');
    try{
      const b64 = await readFileAsBase64(file);
      currentFileBase64 = b64;
      currentFileName = file.name;

      $fileInfo.classList.add('show');
      $fileInfo.innerHTML = `<b>${file.name}</b> — ${(file.size/1024).toFixed(1)} KB — ${file.type || 'unknown type'}`;

      setStatus('File loaded — click Encode to convert to Base64', 'ok');
    }catch(e){
      setStatus('Error reading file: ' + e.message, 'err');
    }
  }

  $filedrop.addEventListener('click', ()=> $fileInput.click());
  $fileInput.addEventListener('change', (e)=>{
    if(e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });
  $filedrop.addEventListener('dragover', (e)=>{
    e.preventDefault();
    $filedrop.classList.add('dragover');
  });
  $filedrop.addEventListener('dragleave', ()=> $filedrop.classList.remove('dragover'));
  $filedrop.addEventListener('drop', (e)=>{
    e.preventDefault();
    $filedrop.classList.remove('dragover');
    if(e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  updateCounts();

})();
