/* =========================================================================
   8. XPATH GENERATOR / VALIDATOR
========================================================================= */
(function(){

  const $status = document.getElementById('xpath-status');
  function setStatus(txt, cls){ $status.textContent = txt; $status.className = 'dock-status ' + cls; }
  function escapeHtmlLocal(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  /* -----------------------------------------------------------
     SUB-TAB SWITCHER (Generate / Validate)
  ----------------------------------------------------------- */
  document.querySelectorAll('#view-xpath .pgp-subtab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('#view-xpath .pgp-subtab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.xpview;

      document.getElementById('xpath-subview-generate').classList.toggle('active', target==='generate');
      document.getElementById('xpath-subview-validate').classList.toggle('active', target==='validate');

      document.getElementById('dock-xpath-sub-generate').style.display = target==='generate' ? 'flex' : 'none';
      document.getElementById('dock-xpath-sub-validate').style.display = target==='validate' ? 'flex' : 'none';

      setStatus('Ready', 'ok');
    });
  });

  /* -----------------------------------------------------------
     SHARED XML PARSING + XPATH PATH BUILDING
  ----------------------------------------------------------- */
  function parseXmlLocal(str){
    const doc = new DOMParser().parseFromString(str.replace(/^\uFEFF/,''), 'application/xml');
    const err = doc.querySelector('parsererror');
    if(err) throw new Error('Invalid XML: ' + err.textContent.slice(0,160));
    return doc;
  }

  // Builds the absolute XPath for an ELEMENT node (walks up to root).
  function buildElementPath(el, opts){
    opts = opts || {};
    const segments = [];
    let cur = el;
    while(cur && cur.nodeType === 1){
      const tag = cur.nodeName;
      const parent = cur.parentNode;
      let segment = tag;

      if(parent && parent.nodeType === 1){
        const sameTagSiblings = Array.from(parent.children).filter(c=> c.nodeName === tag);

        if(opts.useKeyAttr){
          const keyAttr = opts.keyAttrName || 'id';
          if(cur.hasAttribute && cur.hasAttribute(keyAttr)){
            const val = cur.getAttribute(keyAttr);
            const withSameVal = sameTagSiblings.filter(s=> s.getAttribute(keyAttr) === val);
            if(withSameVal.length === 1){
              segment = `${tag}[@${keyAttr}='${val}']`;
            }
          }
        }

        if(segment === tag && (sameTagSiblings.length > 1 || opts.alwaysIndex)){
          const idx = sameTagSiblings.indexOf(cur) + 1;
          segment = `${tag}[${idx}]`;
        }
      }

      segments.unshift(segment);
      cur = (parent && parent.nodeType === 1) ? parent : null;
    }
    return '/' + segments.join('/');
  }

  // Builds an XPath for ANY node type (element / attribute / text), using buildElementPath internally.
  function nodeToXPath(node, opts){
    if(!node) return '';
    if(node.nodeType === 2){ // Attribute
      return buildElementPath(node.ownerElement, opts) + '/@' + node.name;
    }
    if(node.nodeType === 3){ // Text
      return buildElementPath(node.parentNode, opts) + '/text()';
    }
    if(node.nodeType === 1){ // Element
      return buildElementPath(node, opts);
    }
    return '';
  }

  /* =======================================================================
     8.1  GENERATE  — interactive tree + click-to-generate XPath
  ======================================================================= */

  let genCurrentSelection = null;
  let genLastSelectedSpan = null;

  function getGenOpts(){
    return {
      alwaysIndex: document.getElementById('xp-opt-alwaysindex').checked,
      useKeyAttr: document.getElementById('xp-opt-usekey').checked,
      keyAttrName: document.getElementById('xp-opt-keyattr').value.trim() || 'id'
    };
  }

  function recomputeGenOutput(){
    const outField = document.getElementById('xp-gen-output');
    if(!genCurrentSelection){ outField.value=''; return; }
    const opts = getGenOpts();
    let xpath;
    if(genCurrentSelection.kind === 'text'){
      xpath = buildElementPath(genCurrentSelection.el, opts) + '/text()';
    } else {
      xpath = nodeToXPath(genCurrentSelection.node, opts);
    }
    outField.value = xpath;
  }

  function selectGenTarget(sel, spanEl){
    genCurrentSelection = sel;
    if(genLastSelectedSpan) genLastSelectedSpan.classList.remove('xp-selected');
    spanEl.classList.add('xp-selected');
    genLastSelectedSpan = spanEl;
    recomputeGenOutput();
  }

  ['xp-opt-alwaysindex','xp-opt-usekey','xp-opt-keyattr'].forEach(id=>{
    document.getElementById(id).addEventListener('input', recomputeGenOutput);
    document.getElementById(id).addEventListener('change', recomputeGenOutput);
  });

  function renderTreeNode(xmlEl, depth, container){
    const row = document.createElement('div');
    row.className = 'xp-row';
    row.style.paddingLeft = (depth*16) + 'px';

    const hasChildren = xmlEl.children.length > 0;
    const toggle = document.createElement('span');
    toggle.className = 'xp-toggle';
    toggle.textContent = hasChildren ? '▾' : ' ';
    row.appendChild(toggle);

    const tagSpan = document.createElement('span');
    tagSpan.className = 'xp-tag';
    tagSpan.textContent = '<' + xmlEl.nodeName;
    tagSpan.addEventListener('click', (e)=>{ e.stopPropagation(); selectGenTarget({kind:'node', node:xmlEl}, tagSpan); });
    row.appendChild(tagSpan);

    Array.from(xmlEl.attributes || []).forEach(attr=>{
      const attrSpan = document.createElement('span');
      attrSpan.className = 'xp-attr';
      attrSpan.textContent = ` ${attr.name}="${attr.value}"`;
      attrSpan.addEventListener('click', (e)=>{
        e.stopPropagation();
        const attrNode = xmlEl.getAttributeNode(attr.name);
        selectGenTarget({kind:'node', node:attrNode}, attrSpan);
      });
      row.appendChild(attrSpan);
    });

    const closeSpan = document.createElement('span');
    closeSpan.className = 'xp-tag-close';
    closeSpan.textContent = '>';
    row.appendChild(closeSpan);

    const directText = Array.from(xmlEl.childNodes)
      .filter(n=> n.nodeType === 3)
      .map(n=> n.textContent).join('').trim();

    if(directText && !hasChildren){
      const textSpan = document.createElement('span');
      textSpan.className = 'xp-text';
      textSpan.textContent = ' "' + directText + '"';
      textSpan.addEventListener('click', (e)=>{ e.stopPropagation(); selectGenTarget({kind:'text', el:xmlEl}, textSpan); });
      row.appendChild(textSpan);
    }

    container.appendChild(row);

    if(hasChildren){
      const kidsContainer = document.createElement('div');
      kidsContainer.className = 'xp-children';
      Array.from(xmlEl.children).forEach(child=> renderTreeNode(child, depth+1, kidsContainer));
      container.appendChild(kidsContainer);

      toggle.addEventListener('click', (e)=>{
        e.stopPropagation();
        const isHidden = kidsContainer.style.display === 'none';
        kidsContainer.style.display = isHidden ? 'block' : 'none';
        toggle.textContent = isHidden ? '▾' : '▸';
      });
    }
  }

  function renderTree(xmlString){
    const doc = parseXmlLocal(xmlString);
    const body = document.getElementById('xp-tree-body');
    body.innerHTML = '';
    renderTreeNode(doc.documentElement, 0, body);
    genCurrentSelection = null;
    genLastSelectedSpan = null;
    document.getElementById('xp-gen-output').value = '';
  }

  document.getElementById('xp-btn-render').addEventListener('click', ()=>{
    try{
      const xml = document.getElementById('xp-gen-xml-input').value;
      if(!xml.trim()) throw new Error('Paste XML first.');
      renderTree(xml);
      setStatus('Tree rendered ✓ — click any node to generate its XPath', 'ok');
    }catch(e){ setStatus('Error: '+e.message, 'err'); }
  });

  function copyGenOutput(){
    const val = document.getElementById('xp-gen-output').value;
    if(!val){ setStatus('Select a node in the tree first', 'err'); return; }
    navigator.clipboard.writeText(val).then(()=> setStatus('XPath copied ✓', 'ok'));
  }
  document.getElementById('xp-btn-copyxpath').addEventListener('click', copyGenOutput);
  document.getElementById('xp-btn-copyxpath-inline').addEventListener('click', copyGenOutput);

  const SAMPLE_XPATH_XML = `<Company>
  <Employees>
    <Employee id="E1001">
      <Name>Alice Johnson</Name>
      <Role>Integration Architect</Role>
      <Age>34</Age>
    </Employee>
    <Employee id="E1002">
      <Name>Bob Smith</Name>
      <Role>Developer</Role>
      <Age>29</Age>
    </Employee>
  </Employees>
</Company>`;

  document.getElementById('xp-btn-sample-gen').addEventListener('click', ()=>{
    document.getElementById('xp-gen-xml-input').value = SAMPLE_XPATH_XML;
    renderTree(SAMPLE_XPATH_XML);
    setStatus('Sample loaded — click any node to generate its XPath', 'ok');
  });

  document.getElementById('xp-btn-clear-gen').addEventListener('click', ()=>{
    document.getElementById('xp-gen-xml-input').value = '';
    document.getElementById('xp-tree-body').innerHTML = '<div class="gide-kv-empty">Click "🌳 Render Tree" to visualize your XML.</div>';
    document.getElementById('xp-gen-output').value = '';
    genCurrentSelection = null; genLastSelectedSpan = null;
    setStatus('Cleared', 'ok');
  });

  /* =======================================================================
     8.2  VALIDATE  — evaluate an XPath expression against XML
  ======================================================================= */

  function renderMatchItem(node, idx){
    const nodeType = node.nodeType;
    let typeLabel, valueDisplay, path;

    if(nodeType === 1){
      typeLabel = 'Element';
      valueDisplay = new XMLSerializer().serializeToString(node);
      path = buildElementPath(node, {});
    } else if(nodeType === 2){
      typeLabel = 'Attribute';
      valueDisplay = node.value;
      path = buildElementPath(node.ownerElement, {}) + '/@' + node.name;
    } else if(nodeType === 3){
      typeLabel = 'Text';
      valueDisplay = node.textContent;
      path = buildElementPath(node.parentNode, {}) + '/text()';
    } else {
      typeLabel = 'Node(' + nodeType + ')';
      valueDisplay = node.textContent || '';
      path = '';
    }

    const div = document.createElement('div');
    div.className = 'xp-match';
    let truncated = valueDisplay;
    let note = '';
    if(truncated.length > 2000){
      truncated = truncated.slice(0,2000);
      note = '\n… (truncated, ' + valueDisplay.length + ' chars total)';
    }
    div.innerHTML = `
      <div class="xp-match-header">
        <span>#${idx+1} • ${typeLabel}</span>
        <span>${escapeHtmlLocal(path)}</span>
      </div>
      <div class="xp-match-value">${escapeHtmlLocal(truncated)}${escapeHtmlLocal(note)}</div>`;
    return div;
  }

  function renderXPathResult(result){
    const body = document.getElementById('xp-val-result-body');
    const badge = document.getElementById('xp-val-badge');
    body.innerHTML = '';

    const T = XPathResult;
    const type = result.resultType;

    if(type === T.NUMBER_TYPE){
      badge.textContent = 'Number result'; badge.className = 'val-report-badge pass';
      body.innerHTML = `<div class="xp-scalar-box">${escapeHtmlLocal(String(result.numberValue))}</div>`;
      return;
    }
    if(type === T.STRING_TYPE){
      badge.textContent = 'String result'; badge.className = 'val-report-badge pass';
      body.innerHTML = `<div class="xp-scalar-box">"${escapeHtmlLocal(result.stringValue)}"</div>`;
      return;
    }
    if(type === T.BOOLEAN_TYPE){
      badge.textContent = 'Boolean result'; badge.className = 'val-report-badge ' + (result.booleanValue ? 'pass' : 'fail');
      body.innerHTML = `<div class="xp-scalar-box">${result.booleanValue}</div>`;
      return;
    }

    const nodes = [];
    if(type === T.UNORDERED_NODE_ITERATOR_TYPE || type === T.ORDERED_NODE_ITERATOR_TYPE){
      let n;
      while((n = result.iterateNext())) nodes.push(n);
    } else if(type === T.UNORDERED_NODE_SNAPSHOT_TYPE || type === T.ORDERED_NODE_SNAPSHOT_TYPE){
      for(let i=0;i<result.snapshotLength;i++) nodes.push(result.snapshotItem(i));
    } else if(type === T.ANY_UNORDERED_NODE_TYPE || type === T.FIRST_ORDERED_NODE_TYPE){
      if(result.singleNodeValue) nodes.push(result.singleNodeValue);
    }

    if(nodes.length === 0){
      badge.textContent = '0 nodes matched'; badge.className = 'val-report-badge fail';
      body.innerHTML = '<div class="gide-kv-empty">No nodes matched this XPath expression.</div>';
      return;
    }

    badge.textContent = `${nodes.length} node${nodes.length>1?'s':''} matched`;
    badge.className = 'val-report-badge pass';
    nodes.forEach((node, idx)=> body.appendChild(renderMatchItem(node, idx)));
  }

  function evaluateXPath(){
    setStatus('Evaluating…', 'run');
    const badge = document.getElementById('xp-val-badge');
    badge.textContent = 'Running…'; badge.className = 'val-report-badge pending';

    try{
      const xmlStr = document.getElementById('xp-val-xml-input').value;
      const expr = document.getElementById('xp-val-expr-input').value.trim();
      if(!xmlStr.trim()) throw new Error('Paste XML first.');
      if(!expr) throw new Error('Enter an XPath expression.');

      const xmlDoc = parseXmlLocal(xmlStr);
      const resolver = xmlDoc.createNSResolver ? xmlDoc.createNSResolver(xmlDoc.documentElement) : null;
      const result = xmlDoc.evaluate(expr, xmlDoc, resolver, XPathResult.ANY_TYPE, null);

      renderXPathResult(result);
      setStatus('Evaluated ✓', 'ok');
    }catch(e){
      badge.textContent = 'Error'; badge.className = 'val-report-badge fail';
      document.getElementById('xp-val-result-body').innerHTML =
        `<div class="val-issue error"><span class="val-issue-msg">${escapeHtmlLocal(e.message)}</span></div>`;
      setStatus('Error: ' + e.message, 'err');
    }
  }

  document.getElementById('xp-btn-evaluate').addEventListener('click', evaluateXPath);

  document.getElementById('xp-btn-copyresults').addEventListener('click', ()=>{
    const text = document.getElementById('xp-val-result-body').innerText;
    if(!text.trim()){ setStatus('Nothing to copy', 'err'); return; }
    navigator.clipboard.writeText(text).then(()=> setStatus('Results copied ✓', 'ok'));
  });

  document.getElementById('xp-btn-sample-val').addEventListener('click', ()=>{
    document.getElementById('xp-val-xml-input').value = SAMPLE_XPATH_XML;
    document.getElementById('xp-val-expr-input').value = "//Employee/Name";
    evaluateXPath();
    setStatus('Sample loaded and evaluated ✓', 'ok');
  });

  document.getElementById('xp-btn-clear-val').addEventListener('click', ()=>{
    document.getElementById('xp-val-xml-input').value = '';
    document.getElementById('xp-val-expr-input').value = '';
    document.getElementById('xp-val-result-body').innerHTML =
      '<div class="gide-kv-empty">Enter an XPath expression and click "▶ Evaluate".</div>';
    const badge = document.getElementById('xp-val-badge');
    badge.textContent = 'Not run'; badge.className = 'val-report-badge pending';
    setStatus('Cleared', 'ok');
  });

})();
