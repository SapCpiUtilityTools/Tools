/* =========================================================================
   7. SCHEMA VALIDATOR (XML→XSD, JSON→JSON Schema / OpenAPI)
========================================================================= */
(function(){

  const $status = document.getElementById('val-status');
  function setStatus(txt, cls){ $status.textContent = txt; $status.className = 'dock-status ' + cls; }

  const $instanceMode = document.getElementById('val-instance-mode');
  const $schemaMode = document.getElementById('val-schema-mode');
  const $instanceInput = document.getElementById('val-instance-input');
  const $schemaInput = document.getElementById('val-schema-input');
  const $targetRow = document.getElementById('val-openapi-target-row');
  const $targetSelect = document.getElementById('val-openapi-target');
  const $reportBadge = document.getElementById('val-report-badge');
  const $reportBody = document.getElementById('val-report-body');

  function stripBOMLocal(s){ return s.replace(/^\uFEFF/, ''); }
  function escapeHtmlLocal(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  $schemaMode.addEventListener('change', ()=>{
    $targetRow.style.display = $schemaMode.value === 'openapi' ? 'flex' : 'none';
    $targetSelect.innerHTML = '<option value="">— scan schema first —</option>';
  });

  function detectInstanceMode(){
    const m = $instanceMode.value;
    if(m !== 'auto') return m;
    return $instanceInput.value.trim().startsWith('<') ? 'xml' : 'json';
  }

  /* -----------------------------------------------------------
     XSD PARSER + VALIDATOR  (heuristic, subset of XSD 1.0)
  ----------------------------------------------------------- */
  const SIMPLE_XSD_TYPES = ['xs:string','xs:integer','xs:decimal','xs:boolean','xs:date','xs:dateTime',
    'xs:double','xs:float','xs:long','xs:short','xs:byte','xs:anyURI','xs:time','xs:normalizedString','xs:token'];

  function localNameOf(node){ return node.localName || node.nodeName.replace(/^.*:/,''); }

  function parseXsdSchema(xsdString){
    const doc = new DOMParser().parseFromString(stripBOMLocal(xsdString), 'application/xml');
    const errNode = doc.querySelector('parsererror');
    if(errNode) throw new Error('Invalid XSD: ' + errNode.textContent.slice(0,160));
    const schemaEl = doc.documentElement;

    function childrenByLocalName(node, name){
      return Array.from(node.children).filter(c=> localNameOf(c) === name);
    }
    function firstChildByLocalName(node, name){ return childrenByLocalName(node, name)[0] || null; }

    const namedComplexTypes = {};
    const namedSimpleTypes = {};
    const topLevelElements = {};

    function parseSimpleTypeNode(stNode){
      const restriction = firstChildByLocalName(stNode, 'restriction');
      if(!restriction) return { base:'xs:string', enum:null };
      const base = restriction.getAttribute('base') || 'xs:string';
      const enums = childrenByLocalName(restriction, 'enumeration').map(e=> e.getAttribute('value'));
      return { base, enum: enums.length ? enums : null };
    }

    function parseAttributeNode(aNode){
      return { name:aNode.getAttribute('name'), type:aNode.getAttribute('type')||'xs:string', use:aNode.getAttribute('use')||'optional' };
    }

    function parseElementNode(elNode){
      const name = elNode.getAttribute('name');
      const ref = elNode.getAttribute('ref');
      const typeRef = elNode.getAttribute('type');
      const minOccurs = elNode.hasAttribute('minOccurs') ? parseInt(elNode.getAttribute('minOccurs'),10) : 1;
      const maxAttr = elNode.getAttribute('maxOccurs');
      const maxOccurs = maxAttr === 'unbounded' ? Infinity : (maxAttr ? parseInt(maxAttr,10) : 1);

      let inlineComplexType = null, inlineSimpleType = null;
      if(!typeRef && !ref){
        const ctChild = firstChildByLocalName(elNode, 'complexType');
        if(ctChild) inlineComplexType = parseComplexTypeNode(ctChild);
        const stChild = firstChildByLocalName(elNode, 'simpleType');
        if(stChild) inlineSimpleType = parseSimpleTypeNode(stChild);
      }
      return { name, ref, typeRef, minOccurs, maxOccurs, inlineComplexType, inlineSimpleType };
    }

    function parseComplexTypeNode(ctNode){
      const def = { sequenceChildren:[], attributes:[], simpleContentBase:null, simpleContentEnum:null };
      const simpleContent = firstChildByLocalName(ctNode, 'simpleContent');
      if(simpleContent){
        const ext = firstChildByLocalName(simpleContent, 'extension');
        if(ext){
          def.simpleContentBase = ext.getAttribute('base') || 'xs:string';
          childrenByLocalName(ext, 'attribute').forEach(a=> def.attributes.push(parseAttributeNode(a)));
        }
        return def;
      }
      const group = firstChildByLocalName(ctNode,'sequence') || firstChildByLocalName(ctNode,'choice') || firstChildByLocalName(ctNode,'all');
      if(group){
        childrenByLocalName(group, 'element').forEach(elNode=> def.sequenceChildren.push(parseElementNode(elNode)));
      }
      childrenByLocalName(ctNode, 'attribute').forEach(a=> def.attributes.push(parseAttributeNode(a)));
      return def;
    }

    childrenByLocalName(schemaEl,'complexType').forEach(ct=>{ const n=ct.getAttribute('name'); if(n) namedComplexTypes[n]=parseComplexTypeNode(ct); });
    childrenByLocalName(schemaEl,'simpleType').forEach(st=>{ const n=st.getAttribute('name'); if(n) namedSimpleTypes[n]=parseSimpleTypeNode(st); });
    childrenByLocalName(schemaEl,'element').forEach(el=>{ const n=el.getAttribute('name'); if(n) topLevelElements[n]=parseElementNode(el); });

    return { namedComplexTypes, namedSimpleTypes, topLevelElements };
  }

  function resolveElementTypeDef(elementDef, model){
    if(elementDef.ref){
      const target = model.topLevelElements[elementDef.ref];
      if(!target) return { kind:'unknown' };
      return resolveElementTypeDef(target, model);
    }
    if(elementDef.inlineComplexType) return { kind:'complex', def: elementDef.inlineComplexType };
    if(elementDef.inlineSimpleType) return { kind:'simple', type: elementDef.inlineSimpleType.base, enum: elementDef.inlineSimpleType.enum };
    const typeRef = elementDef.typeRef;
    if(!typeRef) return { kind:'simple', type:'xs:string', enum:null };
    if(SIMPLE_XSD_TYPES.includes(typeRef)) return { kind:'simple', type:typeRef, enum:null };
    if(model.namedComplexTypes[typeRef]) return { kind:'complex', def: model.namedComplexTypes[typeRef] };
    if(model.namedSimpleTypes[typeRef]) return { kind:'simple', type: model.namedSimpleTypes[typeRef].base, enum: model.namedSimpleTypes[typeRef].enum };
    return { kind:'unknown' };
  }

  function validateSimpleValueXsd(text, type, enumVals, path, label, errors){
    if(enumVals && enumVals.length && text !== '' && !enumVals.includes(text)){
      errors.push({path, message:`Value '${text}' for ${label} is not one of allowed values: ${enumVals.join(', ')}.`});
    }
    if(text === '') return;
    switch(type){
      case 'xs:integer': case 'xs:long': case 'xs:short': case 'xs:byte':
        if(!/^-?\d+$/.test(text)) errors.push({path, message:`Value '${text}' for ${label} is not a valid integer.`});
        break;
      case 'xs:decimal': case 'xs:double': case 'xs:float':
        if(!/^-?\d+(\.\d+)?$/.test(text)) errors.push({path, message:`Value '${text}' for ${label} is not a valid number.`});
        break;
      case 'xs:boolean':
        if(!/^(true|false|0|1)$/i.test(text)) errors.push({path, message:`Value '${text}' for ${label} is not a valid boolean.`});
        break;
      case 'xs:date':
        if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) errors.push({path, message:`Value '${text}' for ${label} is not a valid xs:date (YYYY-MM-DD).`});
        break;
      case 'xs:dateTime':
        if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(text)) errors.push({path, message:`Value '${text}' for ${label} is not a valid xs:dateTime.`});
        break;
      default: break;
    }
  }

  function validateAttributesXsd(xmlEl, attrDefs, path, errors){
    attrDefs.forEach(a=>{
      const has = xmlEl.hasAttribute(a.name);
      if(a.use === 'required' && !has){
        errors.push({path, message:`Missing required attribute @${a.name} on <${localNameOf(xmlEl)}>.`});
      }
      if(has){
        validateSimpleValueXsd(xmlEl.getAttribute(a.name), a.type, null, path, `attribute @${a.name} on <${localNameOf(xmlEl)}>`, errors);
      }
    });
  }

  function validateXmlElement(xmlEl, elementDef, path, model, errors, warnings){
    const typeDef = resolveElementTypeDef(elementDef, model);
    const label = elementDef.name || elementDef.ref || localNameOf(xmlEl);

    if(typeDef.kind === 'unknown'){
      warnings.push({path, message:`Unknown/unresolvable type for element <${label}> — skipped detailed validation.`});
      return;
    }
    if(typeDef.kind === 'simple'){
      validateSimpleValueXsd((xmlEl.textContent||'').trim(), typeDef.type, typeDef.enum, path, `element <${label}>`, errors);
      return;
    }

    const def = typeDef.def;
    if(def.simpleContentBase){
      validateSimpleValueXsd((xmlEl.textContent||'').trim(), def.simpleContentBase, def.simpleContentEnum, path, `element <${label}>`, errors);
      validateAttributesXsd(xmlEl, def.attributes, path, errors);
      return;
    }

    const actualChildren = Array.from(xmlEl.children);
    const declaredNames = new Set(def.sequenceChildren.map(c=> c.name || c.ref));

    def.sequenceChildren.forEach(childDef=>{
      const childName = childDef.name || childDef.ref;
      const matches = actualChildren.filter(c=> localNameOf(c) === childName);
      const min = childDef.minOccurs, max = childDef.maxOccurs;

      if(matches.length < min){
        errors.push({path, message:`Element <${childName}> occurs ${matches.length} time(s) under <${label}>, expected at least ${min}.`});
      }
      if(matches.length > max){
        errors.push({path, message:`Element <${childName}> occurs ${matches.length} time(s) under <${label}>, expected at most ${max===Infinity?'unbounded':max}.`});
      }
      matches.forEach((childEl, idx)=>{
        const childPath = `${path}/${childName}${matches.length>1 ? '['+(idx+1)+']' : ''}`;
        validateXmlElement(childEl, childDef, childPath, model, errors, warnings);
      });
    });

    actualChildren.forEach(c=>{
      const tag = localNameOf(c);
      if(!declaredNames.has(tag)){
        warnings.push({path:`${path}/${tag}`, message:`Unexpected element <${tag}> not declared in schema under <${label}>.`});
      }
    });

    validateAttributesXsd(xmlEl, def.attributes, path, errors);
  }

  function validateXmlAgainstXsd(xmlString, xsdString){
    const errors = [], warnings = [];
    const xmlDoc = new DOMParser().parseFromString(stripBOMLocal(xmlString), 'application/xml');
    const xmlErr = xmlDoc.querySelector('parsererror');
    if(xmlErr) throw new Error('Invalid XML: ' + xmlErr.textContent.slice(0,160));

    const model = parseXsdSchema(xsdString);
    const root = xmlDoc.documentElement;
    const rootName = localNameOf(root);
    const rootDef = model.topLevelElements[rootName];

    if(!rootDef){
      errors.push({path:'/'+rootName, message:`Root element <${rootName}> is not declared in the schema.`});
      return { valid:false, errors, warnings };
    }
    validateXmlElement(root, rootDef, '/'+rootName, model, errors, warnings);
    return { valid: errors.length===0, errors, warnings };
  }

  /* -----------------------------------------------------------
     JSON SCHEMA / OPENAPI VALIDATOR (heuristic subset of draft-07)
  ----------------------------------------------------------- */
  function resolveJsonRef(ref, rootDoc){
    if(!ref.startsWith('#/')) throw new Error('Only local $ref (#/...) is supported: '+ref);
    const parts = ref.slice(2).split('/').map(p=> decodeURIComponent(p).replace(/~1/g,'/').replace(/~0/g,'~'));
    let node = rootDoc;
    for(const p of parts){
      if(node == null || !(p in node)) throw new Error('Cannot resolve $ref: '+ref);
      node = node[p];
    }
    return node;
  }

  function jsonTypeOf(value){
    if(value === null) return 'null';
    if(Array.isArray(value)) return 'array';
    return typeof value;
  }

  function deepEqualLocal(a,b){ return JSON.stringify(a) === JSON.stringify(b); }

  function validateStringFormat(value, format){
    switch(format){
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : `Value '${value}' is not a valid date (YYYY-MM-DD).`;
      case 'date-time': return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) ? null : `Value '${value}' is not a valid date-time.`;
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : `Value '${value}' is not a valid email address.`;
      default: return null;
    }
  }

  function validateJsonNode(value, schema, rootDoc, path, errors){
    if(!schema || typeof schema !== 'object') return;

    if(schema.$ref){
      let resolved;
      try{ resolved = resolveJsonRef(schema.$ref, rootDoc); }
      catch(e){ errors.push({path, message:e.message}); return; }
      validateJsonNode(value, resolved, rootDoc, path, errors);
      return;
    }

    if(Array.isArray(schema.allOf)) schema.allOf.forEach(s=> validateJsonNode(value, s, rootDoc, path, errors));

    if(Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)){
      const list = schema.oneOf || schema.anyOf;
      let matchedAny = false;
      for(const s of list){
        const subErrors = [];
        validateJsonNode(value, s, rootDoc, path, subErrors);
        if(subErrors.length === 0){ matchedAny = true; break; }
      }
      if(!matchedAny) errors.push({path, message:`Value does not match any of the ${schema.oneOf?'oneOf':'anyOf'} schemas.`});
    }

    if(schema.enum && !schema.enum.some(e=> deepEqualLocal(e, value))){
      errors.push({path, message:`Value ${JSON.stringify(value)} is not one of allowed enum values: ${JSON.stringify(schema.enum)}.`});
    }

    if(schema.type){
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actualType = jsonTypeOf(value);
      const okType = types.some(t=>{
        if(t === 'integer') return actualType === 'number' && Number.isInteger(value);
        if(t === 'number') return actualType === 'number';
        return t === actualType;
      });
      if(!okType){
        errors.push({path, message:`Expected type '${types.join(' or ')}' but got '${actualType}' (value: ${JSON.stringify(value)}).`});
        return;
      }
    }

    const actualType = jsonTypeOf(value);

    if(actualType === 'object' && (schema.properties || schema.required || schema.additionalProperties !== undefined)){
      const props = schema.properties || {};
      (schema.required||[]).forEach(reqKey=>{
        if(!(reqKey in value)) errors.push({path, message:`Missing required property '${reqKey}'.`});
      });
      Object.keys(value).forEach(key=>{
        const childPath = `${path}.${key}`;
        if(props[key]) validateJsonNode(value[key], props[key], rootDoc, childPath, errors);
        else if(schema.additionalProperties === false) errors.push({path:childPath, message:`Unexpected property '${key}' (additionalProperties: false).`});
        else if(schema.additionalProperties && typeof schema.additionalProperties === 'object') validateJsonNode(value[key], schema.additionalProperties, rootDoc, childPath, errors);
      });
    }

    if(actualType === 'array'){
      if(schema.minItems !== undefined && value.length < schema.minItems) errors.push({path, message:`Array has ${value.length} item(s), expected at least ${schema.minItems}.`});
      if(schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({path, message:`Array has ${value.length} item(s), expected at most ${schema.maxItems}.`});
      if(schema.items) value.forEach((item, idx)=> validateJsonNode(item, schema.items, rootDoc, `${path}[${idx}]`, errors));
    }

    if(actualType === 'string'){
      if(schema.minLength !== undefined && value.length < schema.minLength) errors.push({path, message:`String length ${value.length} is less than minLength ${schema.minLength}.`});
      if(schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({path, message:`String length ${value.length} exceeds maxLength ${schema.maxLength}.`});
      if(schema.pattern){
        try{ const re = new RegExp(schema.pattern); if(!re.test(value)) errors.push({path, message:`String '${value}' does not match pattern ${schema.pattern}.`}); }catch(e){}
      }
      if(schema.format){
        const fmtErr = validateStringFormat(value, schema.format);
        if(fmtErr) errors.push({path, message: fmtErr});
      }
    }

    if(actualType === 'number'){
      if(schema.minimum !== undefined && value < schema.minimum) errors.push({path, message:`Value ${value} is less than minimum ${schema.minimum}.`});
      if(schema.maximum !== undefined && value > schema.maximum) errors.push({path, message:`Value ${value} is greater than maximum ${schema.maximum}.`});
    }
  }

  function validateJsonAgainstSchema(jsonValue, schema, rootDoc){
    const errors = [];
    validateJsonNode(jsonValue, schema, rootDoc || schema, '$', errors);
    return { valid: errors.length===0, errors, warnings: [] };
  }

  /* -----------------------------------------------------------
     OPENAPI TARGET SCANNING
  ----------------------------------------------------------- */
  let scannedOpenApiDoc = null;

  document.getElementById('val-btn-scan').addEventListener('click', ()=>{
    try{
      if($schemaMode.value !== 'openapi'){
        setStatus('Switch Schema Type to "OpenAPI 3.0 Document" first', 'err');
        return;
      }
      const raw = $schemaInput.value;
      if(!raw.trim()) throw new Error('Paste an OpenAPI document first.');
      const doc = JSON.parse(stripBOMLocal(raw));
      scannedOpenApiDoc = doc;

      const options = ['<option value="">— select a target —</option>'];

      if(doc.components && doc.components.schemas){
        Object.keys(doc.components.schemas).forEach(name=>{
          options.push(`<option value='${escapeHtmlLocal(JSON.stringify({kind:'component', name}))}'>Component: ${escapeHtmlLocal(name)}</option>`);
        });
      }
      if(doc.paths){
        Object.entries(doc.paths).forEach(([p, methods])=>{
          Object.entries(methods).forEach(([m, op])=>{
            const schema = op && op.requestBody && op.requestBody.content && op.requestBody.content['application/json'] && op.requestBody.content['application/json'].schema;
            if(schema){
              options.push(`<option value='${escapeHtmlLocal(JSON.stringify({kind:'requestBody', path:p, method:m}))}'>${m.toUpperCase()} ${escapeHtmlLocal(p)} (request body)</option>`);
            }
          });
        });
      }

      $targetSelect.innerHTML = options.join('');
      setStatus(`Found ${options.length-1} schema target(s) — pick one from the dropdown`, 'ok');
    }catch(e){
      setStatus('Error scanning OpenAPI document: ' + e.message, 'err');
    }
  });

  function getSelectedOpenApiSchema(){
    const raw = $targetSelect.value;
    if(!raw) throw new Error('Select a "Validate Against" target first (click "Scan OpenAPI Targets").');
    const target = JSON.parse(raw);
    if(!scannedOpenApiDoc) throw new Error('Scan the OpenAPI document first.');
    if(target.kind === 'component'){
      const schema = scannedOpenApiDoc.components.schemas[target.name];
      if(!schema) throw new Error(`Component schema '${target.name}' not found.`);
      return schema;
    } else {
      const op = scannedOpenApiDoc.paths[target.path][target.method];
      const schema = op.requestBody.content['application/json'].schema;
      return schema;
    }
  }

  /* -----------------------------------------------------------
     REPORT RENDERING
  ----------------------------------------------------------- */
  function renderReport(result){
    $reportBody.innerHTML = '';

    if(result.valid){
      $reportBadge.textContent = '✅ Valid';
      $reportBadge.className = 'val-report-badge pass';
    } else {
      $reportBadge.textContent = `❌ Invalid (${result.errors.length} error${result.errors.length>1?'s':''})`;
      $reportBadge.className = 'val-report-badge fail';
    }

    if(result.errors.length === 0 && (!result.warnings || result.warnings.length===0)){
      $reportBody.innerHTML = '<div class="gide-kv-empty">✅ No issues found. The instance is valid against the schema.</div>';
      return;
    }

    if(result.errors.length){
      const title = document.createElement('div');
      title.className = 'val-report-section-title';
      title.textContent = `Errors (${result.errors.length})`;
      $reportBody.appendChild(title);
      result.errors.forEach(issue=>{
        const div = document.createElement('div');
        div.className = 'val-issue error';
        div.innerHTML = `<span class="val-issue-path">${escapeHtmlLocal(issue.path)}</span><span class="val-issue-msg">${escapeHtmlLocal(issue.message)}</span>`;
        $reportBody.appendChild(div);
      });
    }

    if(result.warnings && result.warnings.length){
      const title = document.createElement('div');
      title.className = 'val-report-section-title';
      title.textContent = `Warnings (${result.warnings.length})`;
      $reportBody.appendChild(title);
      result.warnings.forEach(issue=>{
        const div = document.createElement('div');
        div.className = 'val-issue warning';
        div.innerHTML = `<span class="val-issue-path">${escapeHtmlLocal(issue.path)}</span><span class="val-issue-msg">${escapeHtmlLocal(issue.message)}</span>`;
        $reportBody.appendChild(div);
      });
    }
  }

  /* -----------------------------------------------------------
     MAIN VALIDATE ACTION
  ----------------------------------------------------------- */
  document.getElementById('val-btn-validate').addEventListener('click', ()=>{
    setStatus('Validating…', 'run');
    $reportBadge.textContent = 'Running…';
    $reportBadge.className = 'val-report-badge pending';

    try{
      const instanceMode = detectInstanceMode();
      const schemaMode = $schemaMode.value;

      if(schemaMode === 'xsd'){
        if(instanceMode !== 'xml') throw new Error('XSD validation requires an XML instance. Switch Instance Type to XML.');
        const result = validateXmlAgainstXsd($instanceInput.value, $schemaInput.value);
        renderReport(result);
      } else {
        if(instanceMode !== 'json') throw new Error('JSON Schema/OpenAPI validation requires a JSON instance. Switch Instance Type to JSON.');
        const jsonValue = JSON.parse(stripBOMLocal($instanceInput.value));

        let schema, rootDoc;
        if(schemaMode === 'jsonschema'){
          schema = JSON.parse(stripBOMLocal($schemaInput.value));
          rootDoc = schema;
        } else { // openapi
          schema = getSelectedOpenApiSchema();
          rootDoc = scannedOpenApiDoc;
        }

        const result = validateJsonAgainstSchema(jsonValue, schema, rootDoc);
        renderReport(result);
      }

      setStatus('Validation complete', 'ok');
    }catch(e){
      $reportBadge.textContent = 'Error';
      $reportBadge.className = 'val-report-badge fail';
      $reportBody.innerHTML = `<div class="val-issue error"><span class="val-issue-msg">${escapeHtmlLocal(e.message)}</span></div>`;
      setStatus('Error: ' + e.message, 'err');
    }
  });

  /* -----------------------------------------------------------
     SAMPLES
  ----------------------------------------------------------- */
  const SAMPLE_XML = `<Employee id="E1001">
  <Name>Alice Johnson</Name>
  <Role>Integration Architect</Role>
  <Age>34</Age>
  <JoinDate>2019-03-15</JoinDate>
</Employee>`;

  const SAMPLE_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified">
  <xs:element name="Employee">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Name" type="xs:string" minOccurs="1" maxOccurs="1"/>
        <xs:element name="Role" type="xs:string" minOccurs="1" maxOccurs="1"/>
        <xs:element name="Age" type="xs:integer" minOccurs="1" maxOccurs="1"/>
        <xs:element name="JoinDate" type="xs:date" minOccurs="0" maxOccurs="1"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

  const SAMPLE_JSON_INSTANCE = JSON.stringify({
    Plant:"Plant A", Hall:"Hall 1", EntryDate:"2024-01-15", Shift:"Morning", Machine:"M-12"
  }, null, 2);

  const SAMPLE_OPENAPI = JSON.stringify({
    openapi:"3.0.3",
    info:{title:"Ring Frame API", version:"1.0.0"},
    paths:{
      "/RingframeDetails":{
        post:{
          summary:"Submit Stoppage details",
          requestBody:{
            required:true,
            content:{ "application/json": { schema:{ "$ref":"#/components/schemas/StoppageRecord" } } }
          },
          responses:{ "200": { description:"OK" } }
        }
      }
    },
    components:{
      schemas:{
        StoppageRecord:{
          type:"object",
          properties:{
            Plant:{type:"string"}, Hall:{type:"string"}, EntryDate:{type:"string", format:"date"},
            Shift:{type:"string"}, Machine:{type:"string"}
          },
          required:["Plant","Shift"]
        }
      }
    }
  }, null, 2);

  document.getElementById('val-btn-sample-xml').addEventListener('click', ()=>{
    $instanceMode.value = 'xml';
    $schemaMode.value = 'xsd';
    $schemaMode.dispatchEvent(new Event('change'));
    $instanceInput.value = SAMPLE_XML;
    $schemaInput.value = SAMPLE_XSD;
    $reportBody.innerHTML = '<div class="gide-kv-empty">Click "Validate" to check your instance against the schema.</div>';
    $reportBadge.textContent = 'Not run'; $reportBadge.className='val-report-badge pending';
    setStatus('Sample XML + XSD loaded', 'ok');
  });

  document.getElementById('val-btn-sample-json').addEventListener('click', ()=>{
    $instanceMode.value = 'json';
    $schemaMode.value = 'openapi';
    $schemaMode.dispatchEvent(new Event('change'));
    $instanceInput.value = SAMPLE_JSON_INSTANCE;
    $schemaInput.value = SAMPLE_OPENAPI;
    $targetSelect.innerHTML = '<option value="">— scan schema first —</option>';
    scannedOpenApiDoc = null;
    $reportBody.innerHTML = '<div class="gide-kv-empty">Click "🔍 Scan OpenAPI Targets" then select a target, then click "Validate".</div>';
    $reportBadge.textContent = 'Not run'; $reportBadge.className='val-report-badge pending';
    setStatus('Sample JSON + OpenAPI loaded — click Scan Targets next', 'ok');
  });

  document.getElementById('val-btn-copy-report').addEventListener('click', ()=>{
    const text = $reportBody.innerText;
    if(!text.trim()){ setStatus('Nothing to copy', 'err'); return; }
    navigator.clipboard.writeText(text).then(()=> setStatus('Report copied ✓', 'ok'));
  });

  document.getElementById('val-btn-clear').addEventListener('click', ()=>{
    $instanceInput.value = '';
    $schemaInput.value = '';
    $targetSelect.innerHTML = '<option value="">— scan schema first —</option>';
    scannedOpenApiDoc = null;
    $reportBody.innerHTML = '<div class="gide-kv-empty">Click "Validate" to check your instance against the schema.</div>';
    $reportBadge.textContent = 'Not run'; $reportBadge.className='val-report-badge pending';
    setStatus('Cleared', 'ok');
  });

  // init defaults
  $instanceInput.value = SAMPLE_XML;
  $schemaInput.value = SAMPLE_XSD;

})();
