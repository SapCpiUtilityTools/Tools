/* =========================================================================
   4. GROOVY IDE / SAP CPI SCRIPT SIMULATOR
========================================================================= */
(function(){

const GIDE = {
  editors:{ input:null, script:null, console:null, output:null, modal:null },
  state:{ fn:'processData' }
};

const SAMPLE_SCRIPT =
`import com.sap.gateway.ip.core.customdev.util.Message;
import java.util.HashMap;

def Message processData(Message message) {
    println "You can print and see the result in the console!"

    // Body
    def body = message.getBody(String);
    message.setBody(body + " Body is modified");

    // Headers
    def map = message.getHeaders();
    def value = map.get("oldHeader");
    println "oldHeader value: " + value
    message.setHeader("oldHeader", value + " World!");
    message.setHeader("newHeader", "newHeader value");

    // Properties
    def mapProperties = message.getProperties();
    def valueProperty = mapProperties.get("oldProperty");
    message.setProperty("oldProperty", valueProperty + " modified");
    message.setProperty("newProperty", "newProperty value");

    return message;
}
`;

const INITIAL_INPUT = {
  body:'<root>Example Input Data</root>',
  headers:[{key:'oldHeader', value:'Hello!'}],
  properties:[{key:'oldProperty', value:'This property is '}]
};

function createMockMessage(input){
  const headersMap = new Map(input.headers.map(h=>[h.key,h.value]));
  const propsMap   = new Map(input.properties.map(p=>[p.key,p.value]));
  let body = input.body;

  const logs = { properties:[], custom_header_properties:{}, attachments:[] };
  const attachmentsStore = [];

  function toJavaMapLike(m){
    return {
      get:(k)=> m.has(k) ? m.get(k) : null,
      put:(k,v)=>{ m.set(k,v); return v; },
      containsKey:(k)=> m.has(k),
      remove:(k)=>{ const v=m.get(k); m.delete(k); return v ?? null; },
      keySet:()=> Array.from(m.keys()),
      entrySet:()=> Array.from(m.entries()).map(([k,v])=>({getKey:()=>k,getValue:()=>v})),
      isEmpty:()=> m.size===0,
      size:()=> m.size,
      toString:()=> JSON.stringify(Object.fromEntries(m))
    };
  }

  const message = {
    getBody:(type)=> body,
    setBody:(v)=>{ body = v; return message; },
    getHeaders:()=> toJavaMapLike(headersMap),
    setHeader:(k,v)=>{ headersMap.set(k,v); return message; },
    getHeader:(k)=> headersMap.has(k)? headersMap.get(k):null,
    getProperties:()=> toJavaMapLike(propsMap),
    setProperty:(k,v)=>{ propsMap.set(k,v); return message; },
    getProperty:(k)=> propsMap.has(k)? propsMap.get(k):null,
    setMessageProcessingLogProperty:(name,val)=>{
      logs.properties.push({name, text:String(val), type:typeof val});
    },
    setCustomHeaderProperty:(name,val)=>{
      logs.custom_header_properties[name]=val;
    },
    createAttachment:(name, content, mimeType)=>{
      const att = {name, text:content, type:mimeType};
      attachmentsStore.push(att);
      logs.attachments.push(att);
      return att;
    },
    getAttachments:()=> attachmentsStore,
    getExchange:()=>({
      getProperty:(k)=> propsMap.get(k) ?? null,
      setProperty:(k,v)=>{ propsMap.set(k,v); }
    })
  };

  return { message, headersMap, propsMap, getBody:()=>body, logs };
}

function convertEachClosures(src){
  let result = '';
  let pos = 0;
  while(true){
    const idx = src.indexOf('.each', pos);
    if(idx === -1){ result += src.slice(pos); break; }
    let j = idx + 5;
    while(src[j] === ' ' || src[j] === '\t') j++;
    if(src[j] !== '{'){ result += src.slice(pos, idx+5); pos = idx+5; continue; }
    const braceStart = j;
    let k = braceStart+1;
    while(src[k]===' '||src[k]==='\t'||src[k]==='\n') k++;
    let paramName = 'it';
    const paramMatch = /^([A-Za-z_]\w*)\s*->/.exec(src.slice(k, k+40));
    let bodyStart = braceStart+1;
    if(paramMatch){
      paramName = paramMatch[1];
      bodyStart = k + paramMatch[0].length;
    }
    let depth = 1, m = braceStart+1;
    while(m < src.length && depth>0){
      if(src[m]==='{') depth++;
      else if(src[m]==='}') depth--;
      m++;
    }
    const braceEnd = m-1;
    const body = src.slice(bodyStart, braceEnd);
    result += src.slice(pos, idx) + `.forEach((${paramName}) => {` + body + `})`;
    pos = braceEnd+1;
  }
  return result;
}

function transpileGroovy(src){
  let s = src;
  s = s.replace(/^\s*import\s+.*$/gm, '');
  s = s.replace(/^\s*package\s+.*$/gm, '');
  s = s.replace(/\bdef\s+Message\s+/g, 'function ');
  s = s.replace(/^(?:public\s+)?Message\s+([A-Za-z_]\w*)\s*\(/gm, 'function $1(');
  s = s.replace(/\bdef\s+([A-Za-z_$][\w$]*)\s*\(/g, 'function $1(');
  s = s.replace(/function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g, (m, name, params)=>{
    if(!params.trim()) return `function ${name}()`;
    const cleaned = params.split(',').map(p=>{
      p = p.trim();
      const parts = p.split(/\s+/);
      return parts[parts.length-1];
    }).join(', ');
    return `function ${name}(${cleaned})`;
  });
  s = s.replace(/\bdef\s+/g, 'let ');
  s = s.replace(/\s+as\s+(String|Integer|int|Boolean|boolean|Double|double|Long|long|Map|List)\b/g, '');
  s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (m, inner)=>{
    if(inner.includes('${')){ return '`'+inner.replace(/`/g,'\\`')+'`'; }
    return m;
  });
  s = s.replace(/"([^"]*\$[A-Za-z_][\w.]*[^"]*)"/g, (m, inner)=>{
    const jsInner = inner.replace(/\$([A-Za-z_][\w.]*)/g,'${$1}');
    return '`'+jsInner+'`';
  });
  s = s.replace(/\bprintln\s*\(([^)]*)\)\s*;?/g, '__console.log($1);');
  s = s.replace(/\bprintln\s+(.+)$/gm, '__console.log($1);');
  s = s.replace(/\bprint\s+(.+)$/gm, '__console.log($1);');
  s = convertEachClosures(s);
  s = s.replace(/([\w\].)]+)\s*\?\:\s*([\w\['"\].() ]+)/g, '($1 || $2)');
  s = s.replace(/for\s*\(\s*([A-Za-z_]\w*)\s+in\s+(\-?\d+)\.\.\<(\-?\d+)\s*\)/g, 'for(let $1=$2; $1<$3; $1++)');
  s = s.replace(/for\s*\(\s*([A-Za-z_]\w*)\s+in\s+(\-?\d+)\.\.(\-?\d+)\s*\)/g, 'for(let $1=$2; $1<=$3; $1++)');
  s = s.replace(/\[\s*:\s*\]/g, '{}');
  s = s.replace(/\.getBody\(\s*(?:java\.lang\.)?String\s*\)/g, '.getBody("String")');
  return s;
}

function setPill(txt, cls){
  const pill = document.getElementById('gide-status');
  pill.textContent = txt;
  pill.className = 'dock-status ' + cls;
}

function runScript(){
  setPill('Running…','run');

  const rawScript = GIDE.editors.script.getValue();
  const fnName = document.getElementById('gide-fn-input').value.trim() || 'processData';

  const inputBody = GIDE.editors.input.getValue();
  const headers = collectKV('gide-kv-headers-in');
  const props   = collectKV('gide-kv-props-in');

  const ctx = createMockMessage({ body:inputBody, headers, properties:props });

  const consoleLines = [];
  const __console = { log:(...args)=> consoleLines.push(args.map(a=> a===undefined?'null':String(a)).join(' ')) };

  let transpiled;
  try{
    transpiled = transpileGroovy(rawScript);
  }catch(e){
    setConsole('Transpile error:\n'+e.message);
    setPill('Error','err');
    return;
  }

  let hadError = false;
  try{
    const runner = new Function('__console','message',
      transpiled + `\n;try{ return ${fnName}(message); }catch(e){ __console.log('Runtime error: '+e.message); throw e; }`
    );
    runner(__console, ctx.message);
  }catch(e){
    consoleLines.push('Error: '+e.message);
    hadError = true;
  }

  setPill(hadError ? 'Error' : 'Success', hadError ? 'err' : 'ok');

  GIDE.editors.output.setValue(ctx.getBody());
  setConsole(consoleLines.join('\n') || '(no console output)');

  renderKV('gide-kv-headers-out', Array.from(ctx.headersMap, ([key,value])=>({key,value})), false);
  renderKV('gide-kv-props-out', Array.from(ctx.propsMap, ([key,value])=>({key,value})), false);

  renderMPL(ctx.logs);
}

function setConsole(txt){ GIDE.editors.console.setValue(txt); }

function renderKV(containerId, list, editable){
  const el = document.getElementById(containerId);
  el.innerHTML = '';

  if((!list || list.length===0) && !editable){
    el.innerHTML = '<div class="gide-kv-empty">empty</div>';
    return;
  }

  const table = document.createElement('table');
  table.className='gide-kv-table';
  table.innerHTML = `<thead><tr><th>Key</th><th>Value</th>${editable?'<th></th>':''}</tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  (list||[]).forEach((kv, idx)=>{
    const tr = document.createElement('tr');
    if(editable){
      tr.innerHTML = `
        <td><input type="text" value="${escapeAttr(kv.key)}" data-idx="${idx}" data-field="key"/></td>
        <td><input type="text" value="${escapeAttr(kv.value)}" data-idx="${idx}" data-field="value"/></td>
        <td><button class="gide-kv-remove" data-idx="${idx}">✕</button></td>`;
    } else {
      tr.innerHTML = `<td>${escapeHtml(kv.key)}</td><td>${escapeHtml(String(kv.value))}</td>`;
    }
    tbody.appendChild(tr);
  });

  el.appendChild(table);

  if(editable){
    const addBtn = document.createElement('button');
    addBtn.className='gide-kv-add';
    addBtn.textContent='+ Add Entry';
    addBtn.onclick = ()=>{
      const arr = collectKV(containerId);
      arr.push({key:'', value:''});
      renderKV(containerId, arr, true);
    };
    el.appendChild(addBtn);

    table.querySelectorAll('input').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const arr = collectKV(containerId);
        const idx = +inp.dataset.idx, field = inp.dataset.field;
        if(arr[idx]) arr[idx][field] = inp.value;
      });
    });
    table.querySelectorAll('.gide-kv-remove').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const arr = collectKV(containerId);
        arr.splice(+btn.dataset.idx,1);
        renderKV(containerId, arr, true);
      });
    });
  }
}

function collectKV(containerId){
  const el = document.getElementById(containerId);
  const rows = el.querySelectorAll('tbody tr');
  const out = [];
  rows.forEach(tr=>{
    const inputs = tr.querySelectorAll('input');
    if(inputs.length===2){ out.push({key:inputs[0].value, value:inputs[1].value}); }
  });
  return out;
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

function renderMPL(logs){
  const el = document.getElementById('gide-mpl-out');
  el.innerHTML = '';

  el.appendChild(sectionLabel('Log Properties'));
  if(logs.properties.length){
    const t = document.createElement('table');
    t.className='gide-mpl-table';
    t.innerHTML = '<thead><tr><th>Name</th><th>Value</th><th>Type</th></tr></thead><tbody>'+
      logs.properties.map(p=>`<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.text)}</td><td>${escapeHtml(p.type)}</td></tr>`).join('')+
      '</tbody>';
    el.appendChild(t);
  } else { el.appendChild(emptyLabel()); }

  el.appendChild(sectionLabel('Custom Header Properties'));
  const chp = Object.entries(logs.custom_header_properties||{});
  if(chp.length){
    const t = document.createElement('table');
    t.className='gide-mpl-table';
    t.innerHTML = '<thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>'+
      chp.map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(JSON.stringify(v))}</td></tr>`).join('')+
      '</tbody>';
    el.appendChild(t);
  } else { el.appendChild(emptyLabel()); }

  el.appendChild(sectionLabel('Attachments'));
  if(logs.attachments.length){
    const t = document.createElement('table');
    t.className='gide-mpl-table';
    t.innerHTML = '<thead><tr><th>Name</th><th></th><th>Type</th></tr></thead><tbody></tbody>';
    const tbody = t.querySelector('tbody');
    logs.attachments.forEach(att=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(att.name)}</td><td><button class="gide-mpl-open">Open Text</button></td><td>${escapeHtml(att.type||'')}</td>`;
      tr.querySelector('button').addEventListener('click', ()=> openAttachmentModal(att.text));
      tbody.appendChild(tr);
    });
    el.appendChild(t);
  } else { el.appendChild(emptyLabel()); }
}
function sectionLabel(txt){ const d=document.createElement('div'); d.className='gide-section-title'; d.style.fontSize='11px'; d.textContent=txt; return d; }
function emptyLabel(){ const d=document.createElement('div'); d.className='gide-kv-empty'; d.textContent='empty'; return d; }

function openAttachmentModal(text){
  document.getElementById('attachment-modal').classList.add('show');
  requireMonaco(()=>{
    if(!GIDE.editors.modal){
      GIDE.editors.modal = monaco.editor.create(document.getElementById('attachment-modal-editor'), {
        value:text, language:'xml', theme: currentMonacoTheme(), minimap:{enabled:false}, automaticLayout:true
      });
    } else {
      GIDE.editors.modal.setValue(text);
    }
  });
}
document.getElementById('attachment-modal-close').addEventListener('click', ()=>{
  document.getElementById('attachment-modal').classList.remove('show');
});

function buildShareUrl(){
  const payload = {
    input:{
      body: GIDE.editors.input.getValue(),
      headers: Object.fromEntries(collectKV('gide-kv-headers-in').map(o=>[o.key,o.value])),
      properties: Object.fromEntries(collectKV('gide-kv-props-in').map(o=>[o.key,o.value]))
    },
    script:{ code: GIDE.editors.script.getValue(), function: document.getElementById('gide-fn-input').value }
  };
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return location.origin + location.pathname + '#/cpi/share/' + b64;
}
function loadShareUrlIfPresent(){
  const m = location.hash.match(/#\/cpi\/share\/(.+)$/);
  if(!m) return null;
  try{
    let b64 = m[1].replace(/-/g,'+').replace(/_/g,'/');
    b64 = b64 + '==='.slice(0,(4 - b64.length % 4) % 4);
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  }catch(e){ console.warn('Bad share payload', e); return null; }
}

let monacoReady = false;
const monacoReadyCbs = [];
function requireMonaco(cb){
  if(monacoReady){ cb(); return; }
  monacoReadyCbs.push(cb);
  if(window.__monaco_loading) return;
  window.__monaco_loading = true;
  const loaderScript = document.createElement('script');
  loaderScript.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js';
  loaderScript.onload = ()=>{
    require.config({ paths:{ vs:'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }});
    require(['vs/editor/editor.main'], ()=>{
      monacoReady = true;
      monacoReadyCbs.forEach(f=>f());
    });
  };
  document.head.appendChild(loaderScript);
}
function currentMonacoTheme(){
  return document.documentElement.getAttribute('data-theme')==='dark' ? 'vs-dark' : 'vs';
}
function requireSplit(cb){
  if(window.Split){ cb(); return; }
  if(window.__split_loading){ window.__split_cbs.push(cb); return; }
  window.__split_loading = true; window.__split_cbs=[cb];
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/split.js@1.6.5/dist/split.min.js';
  s.onload = ()=> window.__split_cbs.forEach(f=>f());
  document.head.appendChild(s);
}

const REFERENCE_ROWS = [
  ['message.getBody(String)', 'Returns the message body as a String.', 'def body = message.getBody(String);', 'full'],
  ['message.setBody(value)', 'Replaces the message body.', 'message.setBody(body + " modified");', 'full'],
  ['message.getHeaders()', 'Returns a Map-like object of all headers.', 'def map = message.getHeaders();', 'full'],
  ['message.setHeader(k, v)', 'Sets/overwrites a header value.', 'message.setHeader("newHeader", "value");', 'full'],
  ['message.getHeader(k)', 'Convenience getter for a single header.', 'message.getHeader("oldHeader");', 'full'],
  ['message.getProperties()', 'Returns a Map-like object of all exchange properties.', 'def props = message.getProperties();', 'full'],
  ['message.setProperty(k, v)', 'Sets/overwrites a property value.', 'message.setProperty("newProperty", "value");', 'full'],
  ['message.getProperty(k)', 'Convenience getter for a single property.', 'message.getProperty("oldProperty");', 'full'],
  ['map.get(k) / map.put(k,v)', 'Standard Java Map operations on headers/properties.', 'map.get("oldHeader")', 'full'],
  ['message.createAttachment(name, content, type)', 'Creates a message attachment visible in MPL.', 'message.createAttachment("log.txt", text, "text/plain");', 'full'],
  ['message.setMessageProcessingLogProperty(n,v)', 'Adds a custom entry to the Message Processing Log.', 'message.setMessageProcessingLogProperty("step","done");', 'full'],
  ['message.setCustomHeaderProperty(n,v)', 'Adds a custom header property entry to MPL.', 'message.setCustomHeaderProperty("x-trace","abc");', 'full'],
  ['message.getExchange()', 'Returns a minimal Exchange mock (property get/set only).', 'message.getExchange().getProperty("p1")', 'partial'],
  ['println / print', 'Writes to the simulated Console panel.', 'println "Hello ${name}"', 'full'],
  ['list.each { it -> ... }', 'Iterates a collection (converted to forEach).', 'items.each { println it }', 'full'],
  ['for (i in 0..5)', 'Groovy range loop (inclusive/exclusive).', 'for (i in 0..<5) { println i }', 'full'],
  ['a ?: b (Elvis operator)', 'Returns a if truthy, else b.', 'def x = value ?: "default"', 'full'],
  ['GString interpolation', '"text ${expr}" template strings.', 'println "Value: ${value}"', 'full'],
  ['XmlSlurper / JsonSlurper / MarkupBuilder', 'Not yet shimmed — avoid in simulator scripts.', 'new XmlSlurper().parseText(xml)', 'partial'],
  ['Base64 / MessageDigest', 'Not yet shimmed — planned for a future release.', 'Base64.getEncoder().encodeToString(...)', 'partial']
];

function populateReferenceTable(){
  const tbody = document.getElementById('ref-table-body');
  tbody.innerHTML = REFERENCE_ROWS.map(([fn, desc, ex, support])=>`
    <tr>
      <td><code>${escapeHtml(fn)}</code></td>
      <td>${escapeHtml(desc)}</td>
      <td><code>${escapeHtml(ex)}</code></td>
      <td><span class="badge-support ${support}">${support === 'full' ? 'Supported' : 'Partial'}</span></td>
    </tr>
  `).join('');
}

document.getElementById('gide-btn-ref').addEventListener('click', ()=>{
  populateReferenceTable();
  document.getElementById('ref-modal').classList.add('show');
});
document.getElementById('ref-modal-close').addEventListener('click', ()=>{
  document.getElementById('ref-modal').classList.remove('show');
});

let initialized = false;
function initGroovyIDE(){
  if(initialized){ layoutAll(); return; }
  initialized = true;

  const shared = loadShareUrlIfPresent();
  let initialInput = INITIAL_INPUT;
  let initialScript = SAMPLE_SCRIPT;
  let initialFn = 'processData';

  if(shared){
    initialInput = {
      body: shared.input.body || '',
      headers: Object.entries(shared.input.headers||{}).map(([key,value])=>({key,value})),
      properties: Object.entries(shared.input.properties||{}).map(([key,value])=>({key,value}))
    };
    initialScript = shared.script.code || SAMPLE_SCRIPT;
    initialFn = shared.script.function || 'processData';
  }

  requireSplit(()=>{
    Split(['#gide-col-1','#gide-col-2','#gide-col-3'], { minSize:0, snapOffset:0, sizes:[25,45,30] });
    Split(['#gide-col-1-row-1','#gide-col-1-row-2'], { direction:'vertical', minSize:0, snapOffset:0, sizes:[65,35] });
    Split(['#gide-col-2-row-1','#gide-col-2-row-2'], { direction:'vertical', minSize:0, snapOffset:0, sizes:[70,30] });
    Split(['#gide-col-3-row-1','#gide-col-3-row-2'], { direction:'vertical', minSize:0, snapOffset:0, sizes:[55,45] });
  });

  requireMonaco(()=>{
    const theme = currentMonacoTheme();
    GIDE.editors.input = monaco.editor.create(document.getElementById('gide-editor-input'), {
      value: initialInput.body, language:'xml', theme, minimap:{enabled:false}, automaticLayout:true, fontSize:13
    });
    GIDE.editors.script = monaco.editor.create(document.getElementById('gide-editor-script'), {
      value: initialScript, language:'groovy', theme, minimap:{enabled:false}, automaticLayout:true, fontSize:13
    });
    GIDE.editors.console = monaco.editor.create(document.getElementById('gide-editor-console'), {
      value:'Console Output\n', language:'plaintext', theme:'vs-dark', minimap:{enabled:false}, automaticLayout:true,
      readOnly:true, fontSize:13
    });
    GIDE.editors.output = monaco.editor.create(document.getElementById('gide-editor-output'), {
      value:'', language:'xml', theme, minimap:{enabled:false}, automaticLayout:true, readOnly:true, fontSize:13
    });

    document.getElementById('gide-fn-input').value = initialFn;

    renderKV('gide-kv-headers-in', initialInput.headers, true);
    renderKV('gide-kv-props-in', initialInput.properties, true);
    renderKV('gide-kv-headers-out', [], false);
    renderKV('gide-kv-props-out', [], false);
    renderMPL({properties:[],custom_header_properties:{},attachments:[]});

    setTimeout(layoutAll, 60);
  });

  document.getElementById('gide-btn-run').addEventListener('click', runScript);
  document.getElementById('gide-btn-clear').addEventListener('click', ()=> setConsole('Console Output\n'));
  document.getElementById('gide-btn-sample').addEventListener('click', ()=>{
    GIDE.editors.script.setValue(SAMPLE_SCRIPT);
  });
  document.getElementById('gide-btn-share').addEventListener('click', ()=>{
    const url = buildShareUrl();
    navigator.clipboard.writeText(url).then(()=>{
      const btn = document.getElementById('gide-btn-share');
      const old = btn.textContent; btn.textContent='✅ Copied!';
      setTimeout(()=> btn.textContent = old, 1800);
    });
  });

  document.addEventListener('keydown', (e)=>{
    if(e.altKey && e.key==='Enter'){
      const root = document.getElementById('view-groovy-ide');
      if(root && root.classList.contains('active')){ e.preventDefault(); runScript(); }
    }
  });

  window.addEventListener('resize', ()=> layoutAll());
}

function layoutAll(){
  Object.values(GIDE.editors).forEach(ed=> ed && ed.layout && ed.layout());
}

window.GroovyIDE = {
  show(){ initGroovyIDE(); setTimeout(layoutAll, 50); },
  refreshTheme(){
    if(!monacoReady) return;
    monaco.editor.setTheme(currentMonacoTheme());
  }
};

if(location.hash.startsWith('#/cpi/share/')){
  document.querySelector('.view-tab[data-view="groovy-ide"]').click();
}

})();
