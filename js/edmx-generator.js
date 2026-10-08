/* =========================================================================
   11. EDMX -> SAMPLE XML GENERATOR
       Supports OData V2 and V4 metadata documents. Parses EntityType /
       ComplexType definitions (namespace-agnostic, deeply nested, with
       inheritance via BaseType), lets the user pick any Entity Type, and
       generates a blank-value sample XML instance for it.
========================================================================= */
(function(){

  const $status = document.getElementById('edmx-status');
  function setStatus(txt, cls){ $status.textContent = txt; $status.className = 'dock-status ' + cls; }
  function stripBOMLocal(s){ return s.replace(/^\uFEFF/, ''); }
  function escapeHtmlLocal(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function localNameOf(node){ return node.localName || node.nodeName.replace(/^.*:/,''); }

  const $input = document.getElementById('edmx-input');
  const $output = document.getElementById('edmx-output');
  const $summary = document.getElementById('edmx-parse-summary');
  const $entityField = document.getElementById('edmx-entity-field');
  const $entitySelect = document.getElementById('edmx-entity-select');
  const $navField = document.getElementById('edmx-nav-field');
  const $statusBadge = document.getElementById('edmx-status-badge');
  const $filedrop = document.getElementById('edmx-filedrop');
  const $fileInput = document.getElementById('edmx-file-input');
  const $fileInfo = document.getElementById('edmx-fileinfo');

  let currentModel = null; // { entityTypes, complexTypes, entitySets, odataVersion }

  /* -----------------------------------------------------------
     Generic deep/local-name based DOM traversal helpers
     (namespace-agnostic — works regardless of edmx:/edm: prefix
     conventions used by the exporting tool).
  ----------------------------------------------------------- */
  function deepChildrenByLocalName(root, name){
    const out = [];
    (function walk(node){
      Array.from(node.children || []).forEach(c=>{
        if(localNameOf(c) === name) out.push(c);
        walk(c);
      });
    })(root);
    return out;
  }
  function directChildrenByLocalName(node, name){
    return Array.from(node.children).filter(c=> localNameOf(c) === name);
  }

  /* -----------------------------------------------------------
     Detect OData version from the Schema element's own namespace URI
     (the Schema tag's xmlns IS the EDM namespace it was declared in).
  ----------------------------------------------------------- */
  function detectODataVersion(schemaEl){
    const ns = schemaEl.namespaceURI || '';
    if(ns === 'http://docs.oasis-open.org/odata/ns/edm') return 'V4';
    if(ns.indexOf('http://schemas.microsoft.com/ado/') === 0 && ns.indexOf('/edm') !== -1) return 'V2';
    return 'Unknown';
  }

  /* -----------------------------------------------------------
     Parse the EDMX document into a flat model of entity/complex types.
  ----------------------------------------------------------- */
  function parseEdmxModel(edmxString){
    const doc = new DOMParser().parseFromString(stripBOMLocal(edmxString), 'application/xml');
    const errNode = doc.querySelector('parsererror');
    if(errNode) throw new Error('Invalid EDMX/XML: ' + errNode.textContent.slice(0,200));

    const schemaEls = deepChildrenByLocalName(doc.documentElement, 'Schema');
    if(schemaEls.length === 0) throw new Error('No <Schema> element found. Is this a valid EDMX/CSDL metadata document?');

    const entityTypes = {};   // "Namespace.Name" -> {name, namespace, baseType, properties[], navigationProperties[]}
    const complexTypes = {};  // "Namespace.Name" -> {name, namespace, baseType, properties[]}
    const entitySets = [];    // {name, entityType}
    let odataVersion = 'Unknown';

    function parsePropertyEl(propEl){
      return {
        name: propEl.getAttribute('Name'),
        type: propEl.getAttribute('Type') || 'Edm.String'
      };
    }

    schemaEls.forEach(schemaEl=>{
      const detected = detectODataVersion(schemaEl);
      if(detected !== 'Unknown') odataVersion = detected;

      const ns = schemaEl.getAttribute('Namespace') || '';

      directChildrenByLocalName(schemaEl, 'EntityType').forEach(etEl=>{
        const name = etEl.getAttribute('Name');
        if(!name) return;
        const baseType = etEl.getAttribute('BaseType') || null;
        const properties = directChildrenByLocalName(etEl, 'Property').map(parsePropertyEl);
        const navigationProperties = directChildrenByLocalName(etEl, 'NavigationProperty').map(parsePropertyEl);
        entityTypes[ns + '.' + name] = { name, namespace: ns, baseType, properties, navigationProperties };
      });

      directChildrenByLocalName(schemaEl, 'ComplexType').forEach(ctEl=>{
        const name = ctEl.getAttribute('Name');
        if(!name) return;
        const baseType = ctEl.getAttribute('BaseType') || null;
        const properties = directChildrenByLocalName(ctEl, 'Property').map(parsePropertyEl);
        complexTypes[ns + '.' + name] = { name, namespace: ns, baseType, properties };
      });

      directChildrenByLocalName(schemaEl, 'EntityContainer').forEach(containerEl=>{
        directChildrenByLocalName(containerEl, 'EntitySet').forEach(esEl=>{
          const esName = esEl.getAttribute('Name');
          const esType = esEl.getAttribute('EntityType');
          if(esName && esType) entitySets.push({ name: esName, entityType: esType });
        });
      });
    });

    if(Object.keys(entityTypes).length === 0){
      throw new Error('No <EntityType> definitions found in this EDMX metadata document.');
    }

    return { entityTypes, complexTypes, entitySets, odataVersion };
  }

  /* -----------------------------------------------------------
     Resolve full inherited property list (walks BaseType chain),
     with a visited-set guard against circular inheritance.
  ----------------------------------------------------------- */
  function resolveEntityProperties(fullName, model, visited){
    visited = visited || new Set();
    if(visited.has(fullName)) return [];
    visited.add(fullName);
    const et = model.entityTypes[fullName];
    if(!et) return [];
    let baseProps = [];
    if(et.baseType && model.entityTypes[et.baseType]){
      baseProps = resolveEntityProperties(et.baseType, model, visited);
    }
    return [...baseProps, ...et.properties];
  }

  function resolveComplexProperties(fullName, model, visited){
    visited = visited || new Set();
    if(visited.has(fullName)) return [];
    visited.add(fullName);
    const ct = model.complexTypes[fullName];
    if(!ct) return [];
    let baseProps = [];
    if(ct.baseType && model.complexTypes[ct.baseType]){
      baseProps = resolveComplexProperties(ct.baseType, model, visited);
    }
    return [...baseProps, ...ct.properties];
  }

  function collectNavigationProperties(fullName, model, visited){
    visited = visited || new Set();
    if(visited.has(fullName)) return [];
    visited.add(fullName);
    const et = model.entityTypes[fullName];
    if(!et) return [];
    let baseNav = [];
    if(et.baseType && model.entityTypes[et.baseType]){
      baseNav = collectNavigationProperties(et.baseType, model, visited);
    }
    return [...baseNav, ...et.navigationProperties];
  }

  /* -----------------------------------------------------------
     Type-string helper: unwrap "Collection(X)" -> { inner:'X', isCollection:true }
  ----------------------------------------------------------- */
  function unwrapCollection(typeStr){
    const m = /^Collection\(([^)]+)\)$/.exec(typeStr || '');
    if(m) return { inner: m[1], isCollection: true };
    return { inner: typeStr, isCollection: false };
  }

  /* -----------------------------------------------------------
     Recursively build a DOM element for one property, expanding
     ComplexType references into nested child elements. Primitive
     (Edm.*) types become empty leaf elements (blank value).
     A per-branch "stack" set guards against circular type refs.
  ----------------------------------------------------------- */
  function buildElementForProperty(doc, prop, model, depth, stack){
    const el = doc.createElement(prop.name);
    if(depth > 20) return el; // safety ceiling

    const { inner } = unwrapCollection(prop.type);

    if(!inner || inner.indexOf('Edm.') === 0){
      return el; // primitive leaf — blank
    }

    if(stack.has(inner)){
      el.appendChild(doc.createComment(' circular reference to ' + inner + ' — omitted '));
      return el;
    }

    if(model.complexTypes[inner]){
      const newStack = new Set(stack); newStack.add(inner);
      const props = resolveComplexProperties(inner, model);
      props.forEach(p=> el.appendChild(buildElementForProperty(doc, p, model, depth+1, newStack)));
      return el;
    }

    if(model.entityTypes[inner]){
      const newStack = new Set(stack); newStack.add(inner);
      const props = resolveEntityProperties(inner, model);
      props.forEach(p=> el.appendChild(buildElementForProperty(doc, p, model, depth+1, newStack)));
      return el;
    }

    // Unresolvable/enum/unknown type — leave as blank leaf
    return el;
  }

  /* -----------------------------------------------------------
     Build the full sample XML document for the selected entity.
  ----------------------------------------------------------- */
  function generateSampleXmlForEntity(entityFullName, model, includeNav){
    const et = model.entityTypes[entityFullName];
    if(!et) throw new Error('Entity type not found: ' + entityFullName);

    const doc = document.implementation.createDocument(null, null, null);
    const root = doc.createElement(et.name);
    doc.appendChild(root);

    const props = resolveEntityProperties(entityFullName, model);
    props.forEach(p=> root.appendChild(buildElementForProperty(doc, p, model, 0, new Set([entityFullName]))));

    if(includeNav){
      const navProps = collectNavigationProperties(entityFullName, model);
      navProps.forEach(np=>{
        const { inner } = unwrapCollection(np.type);
        const navEl = doc.createElement(np.name);
        if(model.entityTypes[inner]){
          const targetProps = resolveEntityProperties(inner, model);
          targetProps.forEach(p=> navEl.appendChild(buildElementForProperty(doc, p, model, 1, new Set([inner]))));
        }
        root.appendChild(navEl);
      });
    }

    return root;
  }

  /* -----------------------------------------------------------
     Pretty-print the generated DOM tree (open/close tags, 2-space
     indent) — operates directly on the built tree, no re-parsing.
  ----------------------------------------------------------- */
  function serializeIndented(el, depth){
    const pad = '  '.repeat(depth);
    const children = Array.from(el.childNodes).filter(n=> n.nodeType === 1 || n.nodeType === 8);
    if(children.length === 0){
      return `${pad}<${el.tagName}></${el.tagName}>`;
    }
    const inner = children.map(c=>{
      if(c.nodeType === 8) return '  '.repeat(depth+1) + '<!--' + c.textContent + '-->';
      return serializeIndented(c, depth+1);
    }).join('\n');
    return `${pad}<${el.tagName}>\n${inner}\n${pad}</${el.tagName}>`;
  }

  /* -----------------------------------------------------------
     PARSE action
  ----------------------------------------------------------- */
  function parseEdmx(){
    setStatus('Parsing…', 'run');
    try{
      const raw = $input.value;
      if(!raw.trim()) throw new Error('Paste or upload an EDMX document first.');

      currentModel = parseEdmxModel(raw);

      const entityNames = Object.keys(currentModel.entityTypes).sort();
      const esMap = {};
      currentModel.entitySets.forEach(es=>{ esMap[es.entityType] = esMap[es.entityType] || []; esMap[es.entityType].push(es.name); });

      $entitySelect.innerHTML = '<option value="">— select an entity —</option>' +
        entityNames.map(full=>{
          const sets = esMap[full];
          const label = sets && sets.length ? `${full}  (EntitySet: ${sets.join(', ')})` : full;
          return `<option value="${escapeHtmlLocal(full)}">${escapeHtmlLocal(label)}</option>`;
        }).join('');

      $entityField.style.display = 'flex';
      $navField.style.display = 'flex';

      const schemaCount = new Set(Object.values(currentModel.entityTypes).map(e=>e.namespace)).size;
      $summary.innerHTML =
        `✅ Parsed <b>OData ${escapeHtmlLocal(currentModel.odataVersion)}</b> metadata — ` +
        `${entityNames.length} EntityType(s), ${Object.keys(currentModel.complexTypes).length} ComplexType(s), ` +
        `${currentModel.entitySets.length} EntitySet(s) across ${schemaCount} schema namespace(s). ` +
        `Select an entity below and click "⚙ Generate XML".`;

      setStatus('EDMX parsed ✓ — select an entity', 'ok');
    }catch(e){
      currentModel = null;
      $entityField.style.display = 'none';
      $navField.style.display = 'none';
      $summary.textContent = '❌ ' + e.message;
      setStatus('Error: ' + e.message, 'err');
    }
  }
  document.getElementById('edmx-btn-parse').addEventListener('click', parseEdmx);

  /* -----------------------------------------------------------
     GENERATE action
  ----------------------------------------------------------- */
  function generateXml(){
    const badge = $statusBadge;
    badge.textContent = 'Running…'; badge.className = 'val-report-badge pending';
    setStatus('Generating…', 'run');

    try{
      if(!currentModel) throw new Error('Parse an EDMX document first.');
      const fullName = $entitySelect.value;
      if(!fullName) throw new Error('Select an Entity Type first.');

      const includeNav = document.getElementById('edmx-include-nav').checked;
      const rootEl = generateSampleXmlForEntity(fullName, currentModel, includeNav);
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializeIndented(rootEl, 0);

      $output.value = xml;
      badge.textContent = '✅ Generated'; badge.className = 'val-report-badge pass';
      setStatus('Sample XML generated ✓', 'ok');
    }catch(e){
      badge.textContent = 'Error'; badge.className = 'val-report-badge fail';
      $output.value = '';
      setStatus('Error: ' + e.message, 'err');
    }
  }
  document.getElementById('edmx-btn-generate').addEventListener('click', generateXml);

  /* -----------------------------------------------------------
     Copy / Download
  ----------------------------------------------------------- */
  document.getElementById('edmx-btn-copy').addEventListener('click', ()=>{
    if(!$output.value){ setStatus('Nothing to copy — generate XML first', 'err'); return; }
    navigator.clipboard.writeText($output.value).then(()=> setStatus('XML copied ✓', 'ok'));
  });

  document.getElementById('edmx-btn-download').addEventListener('click', ()=>{
    if(!$output.value){ setStatus('Nothing to download — generate XML first', 'err'); return; }
    const entityLabel = $entitySelect.selectedOptions[0] ? $entitySelect.selectedOptions[0].value.split('.').pop() : 'entity';
    const filename = `${entityLabel.replace(/[^a-zA-Z0-9._-]/g,'_')}_sample.xml`;
    const blob = new Blob([$output.value], { type:'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${filename} ✓`, 'ok');
  });

  /* -----------------------------------------------------------
     File upload (click + drag & drop)
  ----------------------------------------------------------- */
  function handleFile(file){
    if(!file) return;
    setStatus('Reading file…', 'run');
    const reader = new FileReader();
    reader.onload = ()=>{
      $input.value = reader.result;
      $fileInfo.classList.add('show');
      $fileInfo.innerHTML = `<b>${escapeHtmlLocal(file.name)}</b> — ${(file.size/1024).toFixed(1)} KB`;
      setStatus('File loaded — click "🔍 Parse EDMX"', 'ok');
    };
    reader.onerror = ()=> setStatus('Error reading file', 'err');
    reader.readAsText(file);
  }
  $filedrop.addEventListener('click', ()=> $fileInput.click());
  $fileInput.addEventListener('change', (e)=>{ if(e.target.files[0]) handleFile(e.target.files[0]); });
  $filedrop.addEventListener('dragover', (e)=>{ e.preventDefault(); $filedrop.classList.add('dragover'); });
  $filedrop.addEventListener('dragleave', ()=> $filedrop.classList.remove('dragover'));
  $filedrop.addEventListener('drop', (e)=>{
    e.preventDefault(); $filedrop.classList.remove('dragover');
    if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  /* -----------------------------------------------------------
     Samples (OData V2 and V4) — include a nested ComplexType
     property AND a NavigationProperty, so both features are
     exercised immediately.
  ----------------------------------------------------------- */
  const SAMPLE_V2 = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <Schema Namespace="ODataDemo" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="Product">
        <Key><PropertyRef Name="ID"/></Key>
        <Property Name="ID" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String" Nullable="true"/>
        <Property Name="Price" Type="Edm.Decimal" Nullable="true"/>
        <Property Name="Address" Type="ODataDemo.Address" Nullable="true"/>
        <NavigationProperty Name="Category" Relationship="ODataDemo.Product_Category" FromRole="Product_Category" ToRole="Category_Products"/>
      </EntityType>
      <EntityType Name="Category">
        <Key><PropertyRef Name="ID"/></Key>
        <Property Name="ID" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String" Nullable="true"/>
      </EntityType>
      <ComplexType Name="Address">
        <Property Name="Street" Type="Edm.String" Nullable="true"/>
        <Property Name="City" Type="Edm.String" Nullable="true"/>
        <Property Name="ZipCode" Type="Edm.String" Nullable="true"/>
      </ComplexType>
      <EntityContainer Name="DemoService" m:IsDefaultEntityContainer="true">
        <EntitySet Name="Products" EntityType="ODataDemo.Product"/>
        <EntitySet Name="Categories" EntityType="ODataDemo.Category"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

  const SAMPLE_V4 = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="ODataDemo" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Product">
        <Key><PropertyRef Name="ID"/></Key>
        <Property Name="ID" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String"/>
        <Property Name="Price" Type="Edm.Decimal"/>
        <Property Name="ReleaseDate" Type="Edm.Date"/>
        <Property Name="Address" Type="ODataDemo.Address"/>
        <NavigationProperty Name="Category" Type="ODataDemo.Category" Nullable="false" Partner="Products"/>
      </EntityType>
      <EntityType Name="Category">
        <Key><PropertyRef Name="ID"/></Key>
        <Property Name="ID" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String"/>
        <NavigationProperty Name="Products" Type="Collection(ODataDemo.Product)" Partner="Category"/>
      </EntityType>
      <ComplexType Name="Address">
        <Property Name="Street" Type="Edm.String"/>
        <Property Name="City" Type="Edm.String"/>
        <Property Name="ZipCode" Type="Edm.String"/>
      </ComplexType>
      <EntityContainer Name="DemoService">
        <EntitySet Name="Products" EntityType="ODataDemo.Product"/>
        <EntitySet Name="Categories" EntityType="ODataDemo.Category"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

  document.getElementById('edmx-btn-sample-v2').addEventListener('click', ()=>{
    $input.value = SAMPLE_V2;
    $fileInfo.classList.remove('show');
    parseEdmx();
    setStatus('Sample OData V2 loaded and parsed ✓', 'ok');
  });
  document.getElementById('edmx-btn-sample-v4').addEventListener('click', ()=>{
    $input.value = SAMPLE_V4;
    $fileInfo.classList.remove('show');
    parseEdmx();
    setStatus('Sample OData V4 loaded and parsed ✓', 'ok');
  });

  /* -----------------------------------------------------------
     Clear
  ----------------------------------------------------------- */
  document.getElementById('edmx-btn-clear').addEventListener('click', ()=>{
    $input.value = '';
    $output.value = '';
    $entitySelect.innerHTML = '<option value="">— select an entity —</option>';
    $entityField.style.display = 'none';
    $navField.style.display = 'none';
    document.getElementById('edmx-include-nav').checked = false;
    $fileInfo.classList.remove('show');
    $fileInput.value = '';
    currentModel = null;
    $summary.textContent = 'ℹ️ Paste or upload an EDMX file, then click "🔍 Parse EDMX".';
    $statusBadge.textContent = 'Not generated'; $statusBadge.className = 'val-report-badge pending';
    setStatus('Cleared', 'ok');
  });

})();