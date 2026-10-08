/* =========================================================================
   3. DATA STUDIO (JSON / XML / XSD / OPENAPI)
========================================================================= */
(function(){
  const $input  = document.getElementById('ds-input');
  const $output = document.getElementById('ds-output');
  const $tree   = document.getElementById('ds-tree');
  const $mode   = document.getElementById('ds-input-mode');
  const $status = document.getElementById('ds-status');

  const SAMPLE_JSON = JSON.stringify({
    company:"Pizug Labs",
    active:true,
    employees:[
      {name:"Alice", role:"Integration Architect", age:34},
      {name:"Bob", role:"Developer", age:29}
    ],
    address:{city:"Berlin", zip:"10115"}
  }, null, 2);

  function stripBOM(s){ return s.replace(/^\uFEFF/, ''); }

  function escapeHtmlLocal(s){
    return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function setStatus(txt, cls){
    $status.textContent = txt;
    $status.className = 'dock-status ' + cls;
  }

  function detectMode(){
    const m = $mode.value;
    if(m !== 'auto') return m;
    const t = $input.value.trim();
    return t.startsWith('<') ? 'xml' : 'json';
  }

  /* ---------- JSON <-> XML converters ---------- */
  function jsonToXml(obj, rootName){
    rootName = rootName || 'root';
    function build(name, val){
      if(val === null || val === undefined) return `<${name}/>`;
      if(Array.isArray(val)){
        return val.map(v=> build(name, v)).join('');
      }
      if(typeof val === 'object'){
        let inner = Object.entries(val).map(([k,v])=> build(k, v)).join('');
        return `<${name}>${inner}</${name}>`;
      }
      return `<${name}>${escapeXml(String(val))}</${name}>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n` + build(rootName, obj);
  }
  function escapeXml(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  function xmlToJson(xmlStr){
    const parser = new DOMParser();
    const doc = parser.parseFromString(stripBOM(xmlStr), 'application/xml');
    const errNode = doc.querySelector('parsererror');
    if(errNode) throw new Error('Invalid XML: ' + errNode.textContent.slice(0,120));

    function nodeToObj(node){
      const children = Array.from(node.children);
      if(children.length === 0){
        return node.textContent;
      }
      const obj = {};
      children.forEach(child=>{
        const val = nodeToObj(child);
        if(obj[child.nodeName] !== undefined){
          if(!Array.isArray(obj[child.nodeName])) obj[child.nodeName] = [obj[child.nodeName]];
          obj[child.nodeName].push(val);
        } else {
          obj[child.nodeName] = val;
        }
      });
      return obj;
    }
    const root = doc.documentElement;
    return { [root.nodeName]: nodeToObj(root) };
  }

  /* ---------- ROBUST XML PRETTY PRINTER (DOM-based) ---------- */
  function escapeXmlText(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function escapeXmlAttr(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  }

  function formatXml(xmlString){
    const clean = stripBOM(xmlString);
    const doc = new DOMParser().parseFromString(clean, 'application/xml');
    const errNode = doc.querySelector('parsererror');
    if(errNode) throw new Error('Invalid XML: ' + errNode.textContent.slice(0,160));

    const INDENT = '  ';
    let out = '';

    const declMatch = clean.match(/^\s*<\?xml[^>]*\?>/i);
    if(declMatch){ out += declMatch[0].trim() + '\n'; }

    function serializeElement(node, depth){
      const pad = INDENT.repeat(depth);
      const attrs = Array.from(node.attributes || [])
        .map(a=> ` ${a.name}="${escapeXmlAttr(a.value)}"`).join('');

      const rawChildren = Array.from(node.childNodes);
      const meaningfulChildren = rawChildren.filter(n=>
        !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim())
      );

      if(meaningfulChildren.length === 0){
        out += `${pad}<${node.tagName}${attrs}/>\n`;
        return;
      }

      const onlyText = meaningfulChildren.length === 1 && meaningfulChildren[0].nodeType === Node.TEXT_NODE;
      const onlyCData = meaningfulChildren.length === 1 && meaningfulChildren[0].nodeType === Node.CDATA_SECTION_NODE;

      if(onlyText){
        out += `${pad}<${node.tagName}${attrs}>${escapeXmlText(meaningfulChildren[0].textContent.trim())}</${node.tagName}>\n`;
      } else if(onlyCData){
        out += `${pad}<${node.tagName}${attrs}><![CDATA[${meaningfulChildren[0].textContent}]]></${node.tagName}>\n`;
      } else {
        out += `${pad}<${node.tagName}${attrs}>\n`;
        meaningfulChildren.forEach(child=> serializeNode(child, depth+1));
        out += `${pad}</${node.tagName}>\n`;
      }
    }

    function serializeNode(node, depth){
      const pad = INDENT.repeat(depth);
      switch(node.nodeType){
        case Node.ELEMENT_NODE:
          serializeElement(node, depth);
          break;
        case Node.COMMENT_NODE:
          out += `${pad}<!--${node.textContent}-->\n`;
          break;
        case Node.CDATA_SECTION_NODE:
          out += `${pad}<![CDATA[${node.textContent}]]>\n`;
          break;
        case Node.TEXT_NODE:
          if(node.textContent.trim()) out += `${pad}${escapeXmlText(node.textContent.trim())}\n`;
          break;
        case Node.PROCESSING_INSTRUCTION_NODE:
          out += `${pad}<?${node.target} ${node.data}?>\n`;
          break;
      }
    }

    Array.from(doc.childNodes).forEach(node=>{
      if(node.nodeType === Node.ELEMENT_NODE) serializeElement(node, 0);
      else if(node.nodeType === Node.COMMENT_NODE) out += `<!--${node.textContent}-->\n`;
      else if(node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) out += `<?${node.target} ${node.data}?>\n`;
    });

    return out.trim();
  }

  /* ---------- Tree view renderer ---------- */
  function renderTree(obj){
    $tree.innerHTML = '';
    $tree.appendChild(buildTreeNode(obj, 'root'));
  }
  function buildTreeNode(val, key){
    if(val !== null && typeof val === 'object'){
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.innerHTML = `<span class="key">${key}</span> ${Array.isArray(val) ? '['+val.length+']' : '{'+Object.keys(val).length+'}'}`;
      details.appendChild(summary);
      const entries = Array.isArray(val) ? val.map((v,i)=>[i,v]) : Object.entries(val);
      entries.forEach(([k,v])=> details.appendChild(buildTreeNode(v, k)));
      return details;
    } else {
      const div = document.createElement('div');
      div.className = 'leaf';
      const type = typeof val;
      const cls = type === 'string' ? 'val-string' : (type === 'number' ? 'val-number' : 'val-bool');
      const display = type === 'string' ? `"${val}"` : String(val);
      div.innerHTML = `<span class="key">${key}</span>: <span class="${cls}">${display}</span>`;
      return div;
    }
  }

  /* ---------- Dock actions ---------- */
  document.getElementById('ds-btn-format').addEventListener('click', ()=>{
    try{
      const mode = detectMode();
      if(mode === 'json'){
        const obj = JSON.parse(stripBOM($input.value));
        $output.value = JSON.stringify(obj, null, 2);
      } else {
        $output.value = formatXml($input.value);
      }
      $tree.style.display = 'none'; $output.style.display='block';
      setStatus('Formatted ✓', 'ok');
    }catch(e){ setStatus('Error: '+e.message, 'err'); }
  });

  document.getElementById('ds-btn-minify').addEventListener('click', ()=>{
    try{
      const mode = detectMode();
      if(mode === 'json'){
        $output.value = JSON.stringify(JSON.parse(stripBOM($input.value)));
      } else {
        $output.value = stripBOM($input.value).replace(/>\s+</g,'><').trim();
      }
      $tree.style.display='none'; $output.style.display='block';
      setStatus('Minified ✓', 'ok');
    }catch(e){ setStatus('Error: '+e.message, 'err'); }
  });

  document.getElementById('ds-btn-validate').addEventListener('click', ()=>{
    try{
      const mode = detectMode();
      if(mode === 'json'){ JSON.parse(stripBOM($input.value)); }
      else {
        const doc = new DOMParser().parseFromString(stripBOM($input.value), 'application/xml');
        if(doc.querySelector('parsererror')) throw new Error('Malformed XML');
      }
      setStatus('Valid ' + mode.toUpperCase() + ' ✓', 'ok');
    }catch(e){ setStatus('Invalid: '+e.message, 'err'); }
  });

  document.getElementById('ds-btn-j2x').addEventListener('click', ()=>{
    try{
      const obj = JSON.parse(stripBOM($input.value));
      const rootKey = Object.keys(obj).length===1 ? Object.keys(obj)[0] : 'root';
      const payload = Object.keys(obj).length===1 ? obj[rootKey] : obj;
      $output.value = formatXml(jsonToXml(payload, rootKey));
      $tree.style.display='none'; $output.style.display='block';
      setStatus('Converted JSON → XML ✓', 'ok');
    }catch(e){ setStatus('Error: '+e.message, 'err'); }
  });

  document.getElementById('ds-btn-x2j').addEventListener('click', ()=>{
    try{
      const obj = xmlToJson($input.value);
      $output.value = JSON.stringify(obj, null, 2);
      $tree.style.display='none'; $output.style.display='block';
      setStatus('Converted XML → JSON ✓', 'ok');
    }catch(e){ setStatus('Error: '+e.message, 'err'); }
  });

  document.getElementById('ds-btn-tree').addEventListener('click', ()=>{
    try{
      const mode = detectMode();
      const obj = mode === 'json' ? JSON.parse(stripBOM($input.value)) : xmlToJson($input.value);
      renderTree(obj);
      $tree.style.display='block'; $output.style.display='none';
      setStatus('Tree rendered ✓', 'ok');
    }catch(e){ setStatus('Error: '+e.message, 'err'); }
  });

  document.getElementById('ds-btn-copy').addEventListener('click', ()=>{
    navigator.clipboard.writeText($output.value).then(()=> setStatus('Copied to clipboard ✓','ok'));
  });

  document.getElementById('ds-btn-sample').addEventListener('click', ()=>{
    $input.value = SAMPLE_JSON;
    setStatus('Sample loaded', 'ok');
  });

  document.getElementById('ds-btn-clear').addEventListener('click', ()=>{
    $input.value = ''; $output.value=''; $tree.innerHTML=''; $tree.style.display='none'; $output.style.display='block';
    setStatus('Cleared', 'ok');
  });

  $input.value = SAMPLE_JSON;

  /* =======================================================================
     3.1  XML -> XSD CONVERTER (with Occurrence Configurator)
  ======================================================================= */

  const SIMPLE_TYPES = ['xs:string','xs:integer','xs:decimal','xs:boolean','xs:date','xs:dateTime','xs:double'];

  function guessType(samples){
    const vals = samples.map(s=> (s||'').trim()).filter(s=> s.length>0);
    if(vals.length===0) return 'xs:string';
    if(vals.every(v=> /^-?\d+$/.test(v))) return 'xs:integer';
    if(vals.every(v=> /^-?\d+\.\d+$/.test(v))) return 'xs:decimal';
    if(vals.every(v=> /^(true|false)$/i.test(v))) return 'xs:boolean';
    if(vals.every(v=> /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v))) return 'xs:dateTime';
    if(vals.every(v=> /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'xs:date';
    return 'xs:string';
  }

  function analyzeXmlForXsd(xmlString){
    const doc = new DOMParser().parseFromString(stripBOM(xmlString), 'application/xml');
    const errNode = doc.querySelector('parsererror');
    if(errNode) throw new Error('Invalid XML: ' + errNode.textContent.slice(0,140));

    const root = doc.documentElement;
    const tagDefs = {};
    const tagInstances = {};

    function ensureDef(tag){
      if(!tagDefs[tag]){
        tagDefs[tag] = { name:tag, attributes:{}, childOrder:[], isLeaf:true, textSamples:[], instanceTotal:0 };
      }
      return tagDefs[tag];
    }

    function collect(node){
      const tag = node.tagName;
      const def = ensureDef(tag);
      tagInstances[tag] = tagInstances[tag] || [];
      tagInstances[tag].push(node);

      Array.from(node.attributes || []).forEach(a=>{
        if(!def.attributes[a.name]) def.attributes[a.name] = { seen:0 };
        def.attributes[a.name].seen++;
      });

      const elChildren = Array.from(node.children);
      if(elChildren.length === 0){
        def.textSamples.push(node.textContent || '');
      } else {
        def.isLeaf = false;
        elChildren.forEach(c=>{
          if(!def.childOrder.includes(c.tagName)) def.childOrder.push(c.tagName);
        });
        elChildren.forEach(collect);
      }
    }
    collect(root);

    const occurrence = {};
    Object.keys(tagDefs).forEach(tag=>{
      const def = tagDefs[tag];
      const instances = tagInstances[tag];
      def.instanceTotal = instances.length;

      def.childOrder.forEach(child=>{
        const counts = instances.map(inst=> Array.from(inst.children).filter(c=> c.tagName===child).length);
        const min = Math.min(...counts);
        const max = Math.max(...counts);
        occurrence[`${tag}>${child}`] = { min, max };
      });

      Object.keys(def.attributes).forEach(attrName=>{
        def.attributes[attrName].required = def.attributes[attrName].seen === def.instanceTotal;
      });

      if(def.isLeaf){
        def.typeGuess = guessType(def.textSamples);
      }
    });

    return { rootTag: root.tagName, tagDefs, occurrence };
  }

  let currentAnalysis = null;
  let xsdConfig = null;

  function buildDefaultConfig(analysis){
    const cfg = { occurrence:{}, attributes:{}, leafTypes:{} };
    Object.entries(analysis.occurrence).forEach(([key,{min,max}])=>{
      cfg.occurrence[key] = {
        min: min,
        max: (max > 1 ? 'unbounded' : (max === 0 ? 1 : max)),
        unbounded: max > 1
      };
    });
    Object.values(analysis.tagDefs).forEach(def=>{
      if(def.isLeaf) cfg.leafTypes[def.name] = def.typeGuess;
      Object.entries(def.attributes).forEach(([attrName, info])=>{
        cfg.attributes[`${def.name}::${attrName}`] = { required: info.required, type:'xs:string' };
      });
    });
    return cfg;
  }

  function typeOptionsHtml(selected){
    return SIMPLE_TYPES.map(t=> `<option value="${t}" ${t===selected?'selected':''}>${t}</option>`).join('');
  }

  function renderXsdModal(){
    const elBody = document.getElementById('xsd-elements-body');
    const attrBody = document.getElementById('xsd-attributes-body');
    elBody.innerHTML = '';
    attrBody.innerHTML = '';

    Object.entries(currentAnalysis.occurrence).forEach(([key, detected])=>{
      const [parent, child] = key.split('>');
      const cfg = xsdConfig.occurrence[key];
      const childDef = currentAnalysis.tagDefs[child];
      const isLeaf = childDef.isLeaf;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="occ-tag-pill">${escapeHtmlLocal(parent)}</span></td>
        <td><b>${escapeHtmlLocal(child)}</b></td>
        <td>${isLeaf ? `<select data-leaf-type="${child}">${typeOptionsHtml(xsdConfig.leafTypes[child]||'xs:string')}</select>` : `<span style="color:var(--sap-text-muted);font-size:11px;">complex</span>`}</td>
        <td><input type="number" min="0" data-occ-min="${key}" value="${cfg.min}"/></td>
        <td><input type="number" min="0" data-occ-max="${key}" value="${cfg.max==='unbounded'?1:cfg.max}" ${cfg.unbounded?'disabled':''}/></td>
        <td style="text-align:center;">
          <input type="checkbox" data-occ-unbounded="${key}" ${cfg.unbounded?'checked':''}/>
          <span class="occ-unbounded-label">∞</span>
        </td>`;
      elBody.appendChild(tr);
    });

    Object.values(currentAnalysis.tagDefs).forEach(def=>{
      Object.entries(def.attributes).forEach(([attrName, info])=>{
        const cfgKey = `${def.name}::${attrName}`;
        const cfg = xsdConfig.attributes[cfgKey];
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="occ-tag-pill">${escapeHtmlLocal(def.name)}</span></td>
          <td><b>@${escapeHtmlLocal(attrName)}</b></td>
          <td><select data-attr-type="${cfgKey}">${typeOptionsHtml(cfg.type)}</select></td>
          <td style="text-align:center;"><input type="checkbox" data-attr-required="${cfgKey}" ${cfg.required?'checked':''}/></td>`;
        attrBody.appendChild(tr);
      });
    });

    elBody.querySelectorAll('[data-leaf-type]').forEach(sel=>{
      sel.addEventListener('change', ()=> xsdConfig.leafTypes[sel.dataset.leafType] = sel.value);
    });
    elBody.querySelectorAll('[data-occ-min]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const key = inp.dataset.occMin;
        xsdConfig.occurrence[key].min = Math.max(0, parseInt(inp.value||'0',10));
      });
    });
    elBody.querySelectorAll('[data-occ-max]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const key = inp.dataset.occMax;
        if(!xsdConfig.occurrence[key].unbounded){
          xsdConfig.occurrence[key].max = Math.max(1, parseInt(inp.value||'1',10));
        }
      });
    });
    elBody.querySelectorAll('[data-occ-unbounded]').forEach(chk=>{
      chk.addEventListener('change', ()=>{
        const key = chk.dataset.occUnbounded;
        xsdConfig.occurrence[key].unbounded = chk.checked;
        xsdConfig.occurrence[key].max = chk.checked ? 'unbounded' : 1;
        const maxInput = elBody.querySelector(`[data-occ-max="${key}"]`);
        maxInput.disabled = chk.checked;
        if(!chk.checked) maxInput.value = 1;
      });
    });
    attrBody.querySelectorAll('[data-attr-type]').forEach(sel=>{
      sel.addEventListener('change', ()=> xsdConfig.attributes[sel.dataset.attrType].type = sel.value);
    });
    attrBody.querySelectorAll('[data-attr-required]').forEach(chk=>{
      chk.addEventListener('change', ()=> xsdConfig.attributes[chk.dataset.attrRequired].required = chk.checked);
    });
  }

  function typeNameFor(tag){
    return tag.replace(/[^A-Za-z0-9_]/g,'_') + 'Type';
  }

  function buildXsdFromConfig(){
    const { rootTag, tagDefs } = currentAnalysis;
    const emitted = new Set();
    const typeBlocks = [];

    function attrsXml(def){
      return Object.keys(def.attributes).map(attrName=>{
        const cfg = xsdConfig.attributes[`${def.name}::${attrName}`];
        return `<xs:attribute name="${attrName}" type="${cfg.type}" use="${cfg.required?'required':'optional'}"/>`;
      }).join('\n');
    }

    function elementRefXml(parentTag, childTag){
      const key = `${parentTag}>${childTag}`;
      const occ = xsdConfig.occurrence[key];
      const min = occ.min;
      const max = occ.unbounded ? 'unbounded' : occ.max;
      const childDef = tagDefs[childTag];

      if(childDef.isLeaf && Object.keys(childDef.attributes).length === 0){
        const type = xsdConfig.leafTypes[childTag] || childDef.typeGuess || 'xs:string';
        return `<xs:element name="${childTag}" type="${type}" minOccurs="${min}" maxOccurs="${max}"/>`;
      } else {
        emitType(childTag);
        return `<xs:element name="${childTag}" type="${typeNameFor(childTag)}" minOccurs="${min}" maxOccurs="${max}"/>`;
      }
    }

    function emitType(tag){
      if(emitted.has(tag)) return;
      emitted.add(tag);
      const def = tagDefs[tag];

      if(def.isLeaf){
        if(Object.keys(def.attributes).length > 0){
          const baseType = xsdConfig.leafTypes[tag] || def.typeGuess || 'xs:string';
          typeBlocks.push(
`  <xs:complexType name="${typeNameFor(tag)}">
    <xs:simpleContent>
      <xs:extension base="${baseType}">
${attrsXml(def).split('\n').map(l=>'        '+l).join('\n')}
      </xs:extension>
    </xs:simpleContent>
  </xs:complexType>`);
        }
        return;
      }

      const seq = def.childOrder.map(child=> '      '+elementRefXml(tag, child)).join('\n');
      const attrs = attrsXml(def).split('\n').filter(Boolean).map(l=>'    '+l).join('\n');
      typeBlocks.push(
`  <xs:complexType name="${typeNameFor(tag)}">
    <xs:sequence>
${seq}
    </xs:sequence>${attrs ? '\n'+attrs : ''}
  </xs:complexType>`);
    }

    emitType(rootTag);

    const rootDef = tagDefs[rootTag];
    let rootElementXml;
    if(rootDef.isLeaf && Object.keys(rootDef.attributes).length === 0){
      const type = xsdConfig.leafTypes[rootTag] || rootDef.typeGuess || 'xs:string';
      rootElementXml = `<xs:element name="${rootTag}" type="${type}"/>`;
    } else {
      rootElementXml = `<xs:element name="${rootTag}" type="${typeNameFor(rootTag)}"/>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="unqualified">

  ${rootElementXml}

${typeBlocks.join('\n\n')}

</xs:schema>`;
  }

  document.getElementById('ds-btn-xml2xsd').addEventListener('click', ()=>{
    try{
      const xml = $input.value;
      if(!xml.trim()) throw new Error('Input is empty. Paste XML first.');
      currentAnalysis = analyzeXmlForXsd(xml);
      xsdConfig = buildDefaultConfig(currentAnalysis);
      renderXsdModal();
      document.getElementById('xsd-modal').classList.add('show');
      setStatus('Analyzed XML — configure occurrences', 'ok');
    }catch(e){
      setStatus('Error: '+e.message, 'err');
    }
  });

  document.getElementById('xsd-reset-btn').addEventListener('click', ()=>{
    xsdConfig = buildDefaultConfig(currentAnalysis);
    renderXsdModal();
  });

  document.getElementById('xsd-cancel-btn').addEventListener('click', ()=>{
    document.getElementById('xsd-modal').classList.remove('show');
  });
  document.getElementById('xsd-modal-close').addEventListener('click', ()=>{
    document.getElementById('xsd-modal').classList.remove('show');
  });

  document.getElementById('xsd-generate-btn').addEventListener('click', ()=>{
    try{
      const xsd = buildXsdFromConfig();
      $output.value = xsd;
      $tree.style.display='none'; $output.style.display='block';
      document.getElementById('xsd-modal').classList.remove('show');
      setStatus('XSD generated ✓', 'ok');
    }catch(e){
      setStatus('Error generating XSD: '+e.message, 'err');
    }
  });

  /* =======================================================================
     3.2  JSON -> OPENAPI 3.0.3 CONVERTER (MULTI PATH / METHOD, SAP CPI compatible)
  ======================================================================= */

  let oaGlobal = { title:'Sample API', version:'1.0.0' };
  let oaOperations = [];
  let oaEditingIndex = -1;

  function oaInferPrimitive(val){
    if(typeof val === 'boolean') return {type:'boolean', format:''};
    if(typeof val === 'number') return Number.isInteger(val) ? {type:'integer', format:''} : {type:'number', format:''};
    if(typeof val === 'string'){
      if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) return {type:'string', format:'date-time'};
      if(/^\d{4}-\d{2}-\d{2}$/.test(val)) return {type:'string', format:'date'};
      if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return {type:'string', format:'email'};
      return {type:'string', format:''};
    }
    return {type:'string', format:''};
  }

  function oaSingularize(key){
    if(key.length>3 && key.endsWith('ies')) return key.slice(0,-3)+'y';
    if(key.length>1 && key.endsWith('s') && !key.endsWith('ss')) return key.slice(0,-1);
    return key;
  }
  function oaCapitalize(s){
    s = String(s||'').replace(/[^A-Za-z0-9]/g,'');
    if(!s) return 'Schema';
    return s.charAt(0).toUpperCase()+s.slice(1);
  }

  function analyzeJsonForOpenApi(jsonValue, preferredRootName){
    const components = {};
    const usedNames = new Set();

    function uniqueName(base){
      let name = oaCapitalize(base);
      let final = name, i=1;
      while(usedNames.has(final)){ final = name+i; i++; }
      usedNames.add(final);
      return final;
    }

    function processObject(obj, nameHint, forceName){
      let compName;
      if(forceName){
        compName = forceName;
        usedNames.add(forceName);
      } else {
        compName = uniqueName(nameHint);
      }
      const comp = { properties: {} };
      components[compName] = comp;
      Object.entries(obj).forEach(([key,val])=>{
        comp.properties[key] = processValue(val, key);
      });
      return compName;
    }

    function processValue(val, keyHint){
      if(Array.isArray(val)){
        const first = val.length ? val[0] : null;
        if(first !== null && typeof first === 'object' && !Array.isArray(first)){
          const itemCompName = processObject(first, oaSingularize(keyHint));
          return { kind:'array-object', ref:itemCompName, required:true };
        } else {
          const prim = first!==null ? oaInferPrimitive(first) : {type:'string', format:''};
          return { kind:'array-primitive', itemsType:prim.type, itemsFormat:prim.format, required:true };
        }
      } else if(val !== null && typeof val === 'object'){
        const compName = processObject(val, keyHint);
        return { kind:'object', ref:compName, required:true };
      } else {
        const prim = oaInferPrimitive(val);
        return { kind:'primitive', type:prim.type, format:prim.format, required:true };
      }
    }

    let rootIsArrayDetected = Array.isArray(jsonValue);
    const sample = rootIsArrayDetected ? (jsonValue.length ? jsonValue[0] : {}) : jsonValue;

    let rootComponentName;
    if(sample !== null && typeof sample === 'object' && !Array.isArray(sample)){
      rootComponentName = processObject(sample, preferredRootName, oaCapitalize(preferredRootName));
    } else {
      rootComponentName = uniqueName(preferredRootName);
      const prim = oaInferPrimitive(sample);
      components[rootComponentName] = { properties: { value: { kind:'primitive', type:prim.type, format:prim.format, required:true } } };
    }

    return { components, rootComponentName, rootIsArrayDetected };
  }

  function oaBuildOperationConfig(analysis, path, method){
    return {
      components: JSON.parse(JSON.stringify(analysis.components)),
      rootComponentName: analysis.rootComponentName,
      meta: {
        path: path,
        method: method,
        summary: `${method.toUpperCase()} ${path}`,
        response: 'OK',
        rootIsArray: analysis.rootIsArrayDetected,
        minItems: 1
      }
    };
  }

  function oaCreateOperationFromInput(path, method){
    const raw = $input.value;
    if(!raw.trim()) throw new Error('Data Studio Input is empty. Paste JSON first.');
    const parsed = JSON.parse(stripBOM(raw));

    let guessedRootName = 'Record';
    if(typeof parsed === 'object' && !Array.isArray(parsed)){
      const keys = Object.keys(parsed);
      if(keys.length === 1 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null){
        guessedRootName = oaCapitalize(oaSingularize(keys[0]));
      }
    } else if(Array.isArray(parsed)){
      guessedRootName = 'Record';
    }

    const analysis = analyzeJsonForOpenApi(parsed, guessedRootName);
    return oaBuildOperationConfig(analysis, path, method);
  }

  function renderOperationsTable(){
    const tbody = document.getElementById('openapi-operations-body');
    tbody.innerHTML = '';
    if(oaOperations.length === 0){
      tbody.innerHTML = '<tr><td colspan="6" class="gide-kv-empty" style="padding:14px;">No operations yet — add one above.</td></tr>';
      return;
    }
    oaOperations.forEach((op, idx)=>{
      const tr = document.createElement('tr');
      if(idx === oaEditingIndex) tr.style.background = 'var(--sap-blue-light)';
      tr.innerHTML = `
        <td><code>${escapeHtmlLocal(op.meta.path)}</code></td>
        <td><span class="oa-comp-badge">${op.meta.method.toUpperCase()}</span></td>
        <td>${escapeHtmlLocal(op.rootComponentName)}</td>
        <td style="text-align:center;">${op.meta.rootIsArray ? '✅' : '—'}</td>
        <td>${escapeHtmlLocal(op.meta.summary||'')}</td>
        <td style="white-space:nowrap;">
          <button class="oa-row-btn" data-edit="${idx}">Edit</button>
          <button class="oa-row-btn danger" data-remove="${idx}">Remove</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('[data-edit]').forEach(btn=>{
      btn.addEventListener('click', ()=> selectOperationForEditing(+btn.dataset.edit));
    });
    tbody.querySelectorAll('[data-remove]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const idx = +btn.dataset.remove;
        oaOperations.splice(idx,1);
        if(oaEditingIndex === idx){
          oaEditingIndex = -1;
          document.getElementById('openapi-editor-section').style.display = 'none';
        } else if(oaEditingIndex > idx){
          oaEditingIndex--;
        }
        renderOperationsTable();
      });
    });
  }

  function selectOperationForEditing(idx){
    oaEditingIndex = idx;
    const op = oaOperations[idx];
    if(!op) return;
    document.getElementById('openapi-editor-section').style.display = 'block';
    document.getElementById('openapi-editor-title').textContent = `Editing: ${op.meta.method.toUpperCase()} ${op.meta.path}`;
    document.getElementById('oa-op-summary').value = op.meta.summary;
    document.getElementById('oa-op-response').value = op.meta.response;
    document.getElementById('oa-op-rootname').value = op.rootComponentName;
    document.getElementById('oa-op-isarray').checked = op.meta.rootIsArray;
    document.getElementById('oa-op-minitems').value = op.meta.minItems;
    document.getElementById('oa-op-minitems').disabled = !op.meta.rootIsArray;
    renderOpenApiFieldsTableForOp(op);
    renderOperationsTable();
  }

  function renderOpenApiFieldsTableForOp(op){
    const tbody = document.getElementById('openapi-fields-body');
    tbody.innerHTML = '';

    Object.entries(op.components).forEach(([compName, comp])=>{
      Object.entries(comp.properties).forEach(([key, p])=>{
        const tr = document.createElement('tr');
        const cellId = `${compName}::${key}`;

        let typeCell, formatCell;
        if(p.kind === 'primitive'){
          typeCell = `<select data-type="${cellId}">
            ${['string','integer','number','boolean'].map(t=>`<option value="${t}" ${t===p.type?'selected':''}>${t}</option>`).join('')}
          </select>`;
          formatCell = `<input type="text" data-format="${cellId}" value="${escapeHtmlLocal(p.format||'')}" placeholder="e.g. date, date-time, email"/>`;
        } else if(p.kind === 'array-primitive'){
          typeCell = `array of
            <select data-itemstype="${cellId}">
              ${['string','integer','number','boolean'].map(t=>`<option value="${t}" ${t===p.itemsType?'selected':''}>${t}</option>`).join('')}
            </select>`;
          formatCell = `<input type="text" data-itemsformat="${cellId}" value="${escapeHtmlLocal(p.itemsFormat||'')}" placeholder="format"/>`;
        } else if(p.kind === 'object'){
          typeCell = `object → <span class="oa-comp-badge">${escapeHtmlLocal(p.ref)}</span>`;
          formatCell = `<span class="oa-ref-note">defined in components/schemas</span>`;
        } else if(p.kind === 'array-object'){
          typeCell = `array of → <span class="oa-comp-badge">${escapeHtmlLocal(p.ref)}</span>`;
          formatCell = `<span class="oa-ref-note">defined in components/schemas</span>`;
        }

        tr.innerHTML = `
          <td><span class="oa-comp-badge">${escapeHtmlLocal(compName)}</span></td>
          <td><b>${escapeHtmlLocal(key)}</b></td>
          <td>${typeCell}</td>
          <td>${formatCell}</td>
          <td style="text-align:center;"><input type="checkbox" data-required="${cellId}" ${p.required?'checked':''}/></td>`;
        tbody.appendChild(tr);
      });
    });

    tbody.querySelectorAll('[data-type]').forEach(sel=>{
      sel.addEventListener('change', ()=>{
        const [comp,key] = sel.dataset.type.split('::');
        op.components[comp].properties[key].type = sel.value;
      });
    });
    tbody.querySelectorAll('[data-format]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const [comp,key] = inp.dataset.format.split('::');
        op.components[comp].properties[key].format = inp.value;
      });
    });
    tbody.querySelectorAll('[data-itemstype]').forEach(sel=>{
      sel.addEventListener('change', ()=>{
        const [comp,key] = sel.dataset.itemstype.split('::');
        op.components[comp].properties[key].itemsType = sel.value;
      });
    });
    tbody.querySelectorAll('[data-itemsformat]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const [comp,key] = inp.dataset.itemsformat.split('::');
        op.components[comp].properties[key].itemsFormat = inp.value;
      });
    });
    tbody.querySelectorAll('[data-required]').forEach(chk=>{
      chk.addEventListener('change', ()=>{
        const [comp,key] = chk.dataset.required.split('::');
        op.components[comp].properties[key].required = chk.checked;
      });
    });
  }

  document.getElementById('oa-global-title').addEventListener('input', (e)=> oaGlobal.title = e.target.value);
  document.getElementById('oa-global-version').addEventListener('input', (e)=> oaGlobal.version = e.target.value);

  document.getElementById('oa-op-summary').addEventListener('input', (e)=>{
    if(oaEditingIndex>=0){ oaOperations[oaEditingIndex].meta.summary = e.target.value; renderOperationsTable(); }
  });
  document.getElementById('oa-op-response').addEventListener('input', (e)=>{
    if(oaEditingIndex>=0) oaOperations[oaEditingIndex].meta.response = e.target.value;
  });
  document.getElementById('oa-op-isarray').addEventListener('change', (e)=>{
    if(oaEditingIndex>=0){
      oaOperations[oaEditingIndex].meta.rootIsArray = e.target.checked;
      document.getElementById('oa-op-minitems').disabled = !e.target.checked;
      renderOperationsTable();
    }
  });
  document.getElementById('oa-op-minitems').addEventListener('input', (e)=>{
    if(oaEditingIndex>=0) oaOperations[oaEditingIndex].meta.minItems = Math.max(0, parseInt(e.target.value||'0',10));
  });
  document.getElementById('oa-op-rootname').addEventListener('change', (e)=>{
    if(oaEditingIndex<0) return;
    const op = oaOperations[oaEditingIndex];
    const newName = oaCapitalize(e.target.value || 'Record');
    if(newName !== op.rootComponentName && op.components[op.rootComponentName] && !op.components[newName]){
      op.components[newName] = op.components[op.rootComponentName];
      delete op.components[op.rootComponentName];
      op.rootComponentName = newName;
      renderOpenApiFieldsTableForOp(op);
      renderOperationsTable();
    }
    e.target.value = op.rootComponentName;
  });

  document.getElementById('oa-reanalyze-btn').addEventListener('click', ()=>{
    if(oaEditingIndex<0) return;
    try{
      const prev = oaOperations[oaEditingIndex];
      const newOp = oaCreateOperationFromInput(prev.meta.path, prev.meta.method);
      newOp.meta.summary = prev.meta.summary;
      newOp.meta.response = prev.meta.response;
      oaOperations[oaEditingIndex] = newOp;
      selectOperationForEditing(oaEditingIndex);
      setStatus('Operation re-analyzed from current Input JSON', 'ok');
    }catch(e){ setStatus('Error: '+e.message, 'err'); }
  });

  document.getElementById('oa-add-operation-btn').addEventListener('click', ()=>{
    try{
      const path = document.getElementById('oa-new-path').value.trim() || '/NewEndpoint';
      const method = document.getElementById('oa-new-method').value;
      const op = oaCreateOperationFromInput(path, method);
      oaOperations.push(op);
      selectOperationForEditing(oaOperations.length - 1);
      setStatus('Operation added — configure its fields below', 'ok');
    }catch(e){
      setStatus('Error: '+e.message, 'err');
    }
  });

  document.getElementById('openapi-reset-all-btn').addEventListener('click', ()=>{
    oaOperations = [];
    oaEditingIndex = -1;
    document.getElementById('openapi-editor-section').style.display = 'none';
    renderOperationsTable();
    setStatus('All operations removed', 'ok');
  });

  document.getElementById('openapi-cancel-btn').addEventListener('click', ()=>{
    document.getElementById('openapi-modal').classList.remove('show');
  });
  document.getElementById('openapi-modal-close').addEventListener('click', ()=>{
    document.getElementById('openapi-modal').classList.remove('show');
  });

  document.getElementById('ds-btn-json2openapi').addEventListener('click', ()=>{
    try{
      document.getElementById('oa-global-title').value = oaGlobal.title;
      document.getElementById('oa-global-version').value = oaGlobal.version;

      if(oaOperations.length === 0){
        const path = document.getElementById('oa-new-path').value.trim() || '/SampleEndpoint';
        const method = document.getElementById('oa-new-method').value;
        const op = oaCreateOperationFromInput(path, method);
        oaOperations.push(op);
        oaEditingIndex = 0;
      }
      renderOperationsTable();
      if(oaEditingIndex < 0 || oaEditingIndex >= oaOperations.length) oaEditingIndex = oaOperations.length - 1;
      selectOperationForEditing(oaEditingIndex);

      document.getElementById('openapi-modal').classList.add('show');
      setStatus('Configure OpenAPI operations', 'ok');
    }catch(e){
      setStatus('Error: '+e.message, 'err');
    }
  });

  function schemasEqualShape(a, b){
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function propToSchema(p, resolveRef){
    if(p.kind === 'primitive'){
      const s = { type: p.type };
      if(p.format) s.format = p.format;
      return s;
    } else if(p.kind === 'array-primitive'){
      return { type:'array', items: Object.assign({type:p.itemsType}, p.itemsFormat?{format:p.itemsFormat}:{}) };
    } else if(p.kind === 'object'){
      return { '$ref': '#/components/schemas/'+resolveRef(p.ref) };
    } else if(p.kind === 'array-object'){
      return { type:'array', items:{ '$ref':'#/components/schemas/'+resolveRef(p.ref) } };
    }
  }

  function buildOpenApiFromOperations(){
    if(oaOperations.length === 0) throw new Error('Add at least one operation first.');

    const globalSchemas = {};
    const perOpNameMap = [];

    oaOperations.forEach((op, opIndex)=>{
      perOpNameMap[opIndex] = {};
      Object.entries(op.components).forEach(([localName, comp])=>{
        let finalName = localName;
        if(globalSchemas[finalName] && !schemasEqualShape(globalSchemas[finalName], comp)){
          let i = 2;
          while(globalSchemas[localName+i] && !schemasEqualShape(globalSchemas[localName+i], comp)) i++;
          finalName = localName + i;
        }
        globalSchemas[finalName] = comp;
        perOpNameMap[opIndex][localName] = finalName;
      });
    });

    const finalSchemas = {};
    oaOperations.forEach((op, opIndex)=>{
      const resolveRef = (localName)=> perOpNameMap[opIndex][localName];
      Object.entries(op.components).forEach(([localName, comp])=>{
        const finalName = perOpNameMap[opIndex][localName];
        if(finalSchemas[finalName]) return;
        const properties = {};
        const required = [];
        Object.entries(comp.properties).forEach(([key,p])=>{
          properties[key] = propToSchema(p, resolveRef);
          if(p.required) required.push(key);
        });
        const schemaObj = { type:'object', properties };
        if(required.length) schemaObj.required = required;
        finalSchemas[finalName] = schemaObj;
      });
    });

    const paths = {};
    oaOperations.forEach((op, opIndex)=>{
      const finalRootName = perOpNameMap[opIndex][op.rootComponentName];
      let bodySchema;
      if(op.meta.rootIsArray){
        bodySchema = { type:'array', items:{ '$ref':'#/components/schemas/'+finalRootName } };
        if(op.meta.minItems > 0) bodySchema.minItems = op.meta.minItems;
      } else {
        bodySchema = { '$ref':'#/components/schemas/'+finalRootName };
      }

      paths[op.meta.path] = paths[op.meta.path] || {};
      paths[op.meta.path][op.meta.method] = {
        summary: op.meta.summary,
        requestBody: {
          required: true,
          content: { "application/json": { schema: bodySchema } }
        },
        responses: { "200": { description: op.meta.response } }
      };
    });

    return JSON.stringify({
      openapi: "3.0.3",
      info: { title: oaGlobal.title, version: oaGlobal.version },
      paths,
      components: { schemas: finalSchemas }
    }, null, 2);
  }

  document.getElementById('openapi-generate-btn').addEventListener('click', ()=>{
    try{
      const json = buildOpenApiFromOperations();
      $output.value = json;
      $tree.style.display = 'none'; $output.style.display = 'block';
      document.getElementById('openapi-modal').classList.remove('show');
      setStatus(`OpenAPI 3.0.3 schema generated ✓ (${oaOperations.length} operation${oaOperations.length>1?'s':''})`, 'ok');
    }catch(e){
      setStatus('Error generating schema: '+e.message, 'err');
    }
  });

})();
