/* =========================================================================
   10. WSDL GENERATOR (from XSD, sync/async) — single merged schema,
       unified Target Namespace, robust across arbitrary namespace prefix
       conventions and deeply nested/referenced complexTypes.
========================================================================= */
(function(){

  const $status = document.getElementById('wsdl-status');
  function setStatus(txt, cls){ $status.textContent = txt; $status.className = 'dock-status ' + cls; }
  function stripBOMLocal(s){ return s.replace(/^\uFEFF/, ''); }
  function localNameOf(node){ return node.localName || node.nodeName.replace(/^.*:/,''); }
  function escapeXmlAttrLocal(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  }
  function indentBlock(xml, spaces){
    const pad = ' '.repeat(spaces);
    return xml.split('\n').map(l=> pad+l).join('\n');
  }

  const XSD_NS = 'http://www.w3.org/2001/XMLSchema';
  const QNAME_ATTRS = ['type','base','ref','substitutionGroup','itemType'];
  const QNAME_LIST_ATTRS = ['memberTypes'];
  const DROP_TAGS = ['import','include','redefine'];
  const RENAMEABLE_ELEMENT_TAGS = ['element'];
  const RENAMEABLE_TYPE_TAGS = ['complexType','simpleType','group','attributeGroup','attribute'];

  /* -----------------------------------------------------------
     Toggle Response XSD field based on Sync/Async selection
  ----------------------------------------------------------- */
  function refreshServiceTypeUI(){
    const isSync = document.getElementById('wsdl-service-type').value === 'sync';
    document.getElementById('wsdl-response-xsd-field').style.display = isSync ? 'flex' : 'none';
  }
  document.getElementById('wsdl-service-type').addEventListener('change', refreshServiceTypeUI);
  refreshServiceTypeUI();

  /* -----------------------------------------------------------
     Parse a pasted XSD string into its <xs:schema> root element.
  ----------------------------------------------------------- */
  function parseSchemaDoc(xsdString){
    const doc = new DOMParser().parseFromString(stripBOMLocal(xsdString), 'application/xml');
    const errNode = doc.querySelector('parsererror');
    if(errNode) throw new Error('Invalid XSD: ' + errNode.textContent.slice(0,160));
    const schemaEl = doc.documentElement;
    if(localNameOf(schemaEl) !== 'schema'){
      throw new Error(`Root element must be <xs:schema> (found <${schemaEl.nodeName}>).`);
    }
    return schemaEl;
  }

  /* -----------------------------------------------------------
     Collect this schema's own xmlns declarations (including the
     default/no-prefix binding, keyed as '').
  ----------------------------------------------------------- */
  function collectNsDecls(schemaEl){
    const decls = {};
    Array.from(schemaEl.attributes).forEach(attr=>{
      if(attr.name === 'xmlns'){
        decls[''] = attr.value;
      } else if(attr.name.indexOf('xmlns:') === 0){
        decls[attr.name.slice(6)] = attr.value;
      }
    });
    return decls;
  }

  /* -----------------------------------------------------------
     Build a per-schema prefix rewrite map:
       - any prefix bound to the XSD builtin namespace  -> 'xsd'
       - any prefix bound to THIS schema's OWN targetNamespace -> 'tns'
       - any other (external/imported) namespace -> stable global nsN prefix
  ----------------------------------------------------------- */
  function buildPrefixRewriteMap(schemaEl, globalExtraNs, counterRef){
    const ownTargetNs = schemaEl.getAttribute('targetNamespace') || '';
    const nsDecls = collectNsDecls(schemaEl);
    const map = {};

    Object.entries(nsDecls).forEach(([prefix, uri])=>{
      if(uri === XSD_NS){
        map[prefix] = 'xsd';
      } else if(ownTargetNs !== '' && uri === ownTargetNs){
        map[prefix] = 'tns';
      } else {
        if(globalExtraNs.has(uri)){
          map[prefix] = globalExtraNs.get(uri);
        } else {
          const newPrefix = 'ns' + (counterRef.count++);
          globalExtraNs.set(uri, newPrefix);
          map[prefix] = newPrefix;
        }
      }
    });

    return map;
  }

  function rewriteSingleQName(val, prefixMap){
    if(!val) return val;
    const idx = val.indexOf(':');
    let origPrefix, localName;
    if(idx === -1){ origPrefix=''; localName=val; }
    else { origPrefix = val.slice(0,idx); localName = val.slice(idx+1); }

    if(Object.prototype.hasOwnProperty.call(prefixMap, origPrefix)){
      const finalPrefix = prefixMap[origPrefix];
      return finalPrefix ? finalPrefix + ':' + localName : localName;
    }
    return val; // unknown prefix — leave untouched (best effort)
  }

  /* -----------------------------------------------------------
     Rewrite every QName-valued attribute (type/base/ref/...) across
     the ENTIRE subtree (any nesting depth) using the prefix map.
  ----------------------------------------------------------- */
  function normalizeNamespacePrefixes(schemaEl, prefixMap){
    const allNodes = [schemaEl, ...Array.from(schemaEl.querySelectorAll('*'))];
    allNodes.forEach(node=>{
      QNAME_ATTRS.forEach(attrName=>{
        if(node.hasAttribute(attrName)){
          const val = node.getAttribute(attrName);
          const rewritten = rewriteSingleQName(val, prefixMap);
          if(rewritten !== val) node.setAttribute(attrName, rewritten);
        }
      });
      QNAME_LIST_ATTRS.forEach(attrName=>{
        if(node.hasAttribute(attrName)){
          const val = node.getAttribute(attrName);
          const rewritten = val.split(/\s+/).filter(Boolean)
            .map(tok=> rewriteSingleQName(tok, prefixMap)).join(' ');
          if(rewritten !== val) node.setAttribute(attrName, rewritten);
        }
      });
    });
  }

  /* -----------------------------------------------------------
     After namespace normalization, every self-reference now uses
     'tns:'. Detect + resolve top-level name collisions (element,
     complexType, simpleType, group, attributeGroup, attribute)
     across BOTH schemas, and rewrite all 'tns:OldName' references
     within the SAME schema to the renamed local name.
  ----------------------------------------------------------- */
  function dedupeAndRenameTopLevel(schemaEl, usedElementNames, usedTypeNames, isRequest, rootHolder){
    const rawChildren = Array.from(schemaEl.children).filter(c=> c.nodeType === 1);
    const children = rawChildren.filter(c=> DROP_TAGS.indexOf(localNameOf(c)) === -1);

    const renameMap = {}; // oldLocalName -> newLocalName (this schema only)
    let rootElementName = null;

    children.forEach(child=>{
      const tag = localNameOf(child);
      const name = child.getAttribute('name');
      if(!name) return;

      if(RENAMEABLE_ELEMENT_TAGS.indexOf(tag) !== -1){
        let finalName = name;
        if(usedElementNames.has(finalName)){
          let i = 1;
          while(usedElementNames.has(name + i)) i++;
          finalName = name + i;
        }
        usedElementNames.add(finalName);
        if(finalName !== name){
          renameMap[name] = finalName;
          child.setAttribute('name', finalName);
        }
        if(rootElementName === null) rootElementName = finalName;

      } else if(RENAMEABLE_TYPE_TAGS.indexOf(tag) !== -1){
        let finalName = name;
        if(usedTypeNames.has(finalName)){
          let i = 1;
          while(usedTypeNames.has(name + i)) i++;
          finalName = name + i;
        }
        usedTypeNames.add(finalName);
        if(finalName !== name){
          renameMap[name] = finalName;
          child.setAttribute('name', finalName);
        }
      }
    });

    if(Object.keys(renameMap).length){
      const allNodes = [schemaEl, ...Array.from(schemaEl.querySelectorAll('*'))];
      allNodes.forEach(node=>{
        QNAME_ATTRS.forEach(attrName=>{
          if(node.hasAttribute(attrName)){
            const val = node.getAttribute(attrName);
            if(val && val.indexOf('tns:') === 0){
              const local = val.slice(4);
              if(renameMap[local]) node.setAttribute(attrName, 'tns:' + renameMap[local]);
            }
          }
        });
        QNAME_LIST_ATTRS.forEach(attrName=>{
          if(node.hasAttribute(attrName)){
            const val = node.getAttribute(attrName);
            const rewritten = val.split(/\s+/).filter(Boolean).map(tok=>{
              if(tok.indexOf('tns:') === 0){
                const local = tok.slice(4);
                if(renameMap[local]) return 'tns:' + renameMap[local];
              }
              return tok;
            }).join(' ');
            if(rewritten !== val) node.setAttribute(attrName, rewritten);
          }
        });
      });
    }

    if(rootHolder) rootHolder.name = rootElementName;
    return children;
  }

  /* -----------------------------------------------------------
     MERGE ENGINE: combines Request (+ Response) schemas into ONE
     <xsd:schema targetNamespace="mainNs"> block. Handles arbitrary
     original namespace-prefix conventions and any nesting depth.
  ----------------------------------------------------------- */
  function mergeSchemasForWsdl(requestXsdString, responseXsdString, mainNs, isSync){
    const reqSchemaEl = parseSchemaDoc(requestXsdString);
    let respSchemaEl = null;
    if(isSync) respSchemaEl = parseSchemaDoc(responseXsdString);

    const globalExtraNs = new Map(); // externalNamespaceURI -> assigned prefix (ns1, ns2, ...)
    const counterRef = { count:1 };

    // Step 1: normalize each schema's own namespace prefixes to tns/xsd/nsN
    const reqPrefixMap = buildPrefixRewriteMap(reqSchemaEl, globalExtraNs, counterRef);
    normalizeNamespacePrefixes(reqSchemaEl, reqPrefixMap);

    let respPrefixMap = null;
    if(isSync){
      respPrefixMap = buildPrefixRewriteMap(respSchemaEl, globalExtraNs, counterRef);
      normalizeNamespacePrefixes(respSchemaEl, respPrefixMap);
    }

    // Step 2: dedupe/rename top-level names, now that all self-refs use 'tns:' uniformly
    const usedElementNames = new Set();
    const usedTypeNames = new Set();

    const reqRoot = {};
    const reqChildren = dedupeAndRenameTopLevel(reqSchemaEl, usedElementNames, usedTypeNames, true, reqRoot);

    let respChildren = [];
    const respRoot = {};
    if(isSync){
      respChildren = dedupeAndRenameTopLevel(respSchemaEl, usedElementNames, usedTypeNames, false, respRoot);
    }

    if(!reqRoot.name){
      throw new Error('No top-level <xs:element> found in the Request XSD — cannot determine the request root element.');
    }
    if(isSync && !respRoot.name){
      throw new Error('No top-level <xs:element> found in the Response XSD — cannot determine the response root element.');
    }

    // Step 3: build the merged output schema
    const outDoc = document.implementation.createDocument(null, null, null);
    const outSchema = outDoc.createElementNS(XSD_NS, 'xsd:schema');
    outSchema.setAttribute('xmlns:xsd', XSD_NS);
    outSchema.setAttribute('xmlns:tns', mainNs);
    outSchema.setAttribute('targetNamespace', mainNs);

    // Preserve any external/imported namespaces referenced by either schema
    globalExtraNs.forEach((prefix, uri)=>{
      outSchema.setAttribute('xmlns:' + prefix, uri);
    });

    outDoc.appendChild(outSchema);

    [...reqChildren, ...respChildren].forEach(node=>{
      outSchema.appendChild(outDoc.importNode(node, true));
    });

    const serialized = new XMLSerializer().serializeToString(outSchema);

    return {
      serialized,
      requestRootElementName: reqRoot.name,
      responseRootElementName: isSync ? respRoot.name : null
    };
  }

  /* -----------------------------------------------------------
     Main WSDL builder
  ----------------------------------------------------------- */
  function generateWsdl(){
    setStatus('Generating…', 'run');
    const badge = document.getElementById('wsdl-status-badge');
    badge.textContent = 'Running…'; badge.className = 'val-report-badge pending';

    try{
      const mainNs = document.getElementById('wsdl-target-ns').value.trim();
      const serviceName = document.getElementById('wsdl-service-name').value.trim() || 'MyService';
      const operationName = document.getElementById('wsdl-operation-name').value.trim() || 'MyOperation';
      const serviceType = document.getElementById('wsdl-service-type').value; // 'sync' | 'async'
      const endpointUrl = document.getElementById('wsdl-endpoint-url').value.trim() || 'http://localhost/service';
      const requestXsd = document.getElementById('wsdl-request-xsd').value;
      const responseXsd = document.getElementById('wsdl-response-xsd').value;
      const isSync = serviceType === 'sync';

      if(!mainNs) throw new Error('Target Namespace is required.');
      if(!requestXsd.trim()) throw new Error('Request XSD is required.');
      if(isSync && !responseXsd.trim()) throw new Error('Response XSD is required for Synchronous services.');

      const merged = mergeSchemasForWsdl(requestXsd, responseXsd, mainNs, isSync);

      const typesBlock =
`  <wsdl:types>
${indentBlock(merged.serialized, 4)}
  </wsdl:types>`;

      const requestMessageName = `${operationName}RequestMessage`;
      const responseMessageName = `${operationName}ResponseMessage`;

      const messagesBlock =
`  <wsdl:message name="${requestMessageName}">
    <wsdl:part name="${requestMessageName}" element="tns:${merged.requestRootElementName}"/>
  </wsdl:message>` +
      (isSync
        ? `\n  <wsdl:message name="${responseMessageName}">
    <wsdl:part name="${responseMessageName}" element="tns:${merged.responseRootElementName}"/>
  </wsdl:message>`
        : '');

      const portTypeBlock =
`  <wsdl:portType name="${serviceName}PortType">
    <wsdl:operation name="${operationName}">
      <wsdl:input message="tns:${requestMessageName}"/>${isSync ? `
      <wsdl:output message="tns:${responseMessageName}"/>` : ''}
    </wsdl:operation>
  </wsdl:portType>`;

      const bindingBlock =
`  <wsdl:binding name="${serviceName}Binding" type="tns:${serviceName}PortType">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
    <wsdl:operation name="${operationName}">
      <soap:operation soapAction="${mainNs}/${operationName}"/>
      <wsdl:input>
        <soap:body use="literal"/>
      </wsdl:input>${isSync ? `
      <wsdl:output>
        <soap:body use="literal"/>
      </wsdl:output>` : ''}
    </wsdl:operation>
  </wsdl:binding>`;

      const serviceBlock =
`  <wsdl:service name="${serviceName}">
    <wsdl:port name="${serviceName}Port" binding="tns:${serviceName}Binding">
      <soap:address location="${escapeXmlAttrLocal(endpointUrl)}"/>
    </wsdl:port>
  </wsdl:service>`;

      const wsdl =
`<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
            xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
            xmlns:tns="${escapeXmlAttrLocal(mainNs)}"
            targetNamespace="${escapeXmlAttrLocal(mainNs)}">

${typesBlock}

${messagesBlock}

${portTypeBlock}

${bindingBlock}

${serviceBlock}

</wsdl:definitions>`;

      document.getElementById('wsdl-output').value = wsdl;
      badge.textContent = `✅ Generated (${isSync ? 'Synchronous' : 'Asynchronous'})`;
      badge.className = 'val-report-badge pass';
      setStatus('WSDL generated ✓', 'ok');
    }catch(e){
      badge.textContent = 'Error'; badge.className = 'val-report-badge fail';
      document.getElementById('wsdl-output').value = '';
      setStatus('Error: ' + e.message, 'err');
    }
  }

  document.getElementById('wsdl-btn-generate').addEventListener('click', generateWsdl);

  /* -----------------------------------------------------------
     Copy / Download
  ----------------------------------------------------------- */
  document.getElementById('wsdl-btn-copy').addEventListener('click', ()=>{
    const val = document.getElementById('wsdl-output').value;
    if(!val){ setStatus('Nothing to copy — generate a WSDL first', 'err'); return; }
    navigator.clipboard.writeText(val).then(()=> setStatus('WSDL copied ✓', 'ok'));
  });

  document.getElementById('wsdl-btn-download').addEventListener('click', ()=>{
    const val = document.getElementById('wsdl-output').value;
    if(!val){ setStatus('Nothing to download — generate a WSDL first', 'err'); return; }
    const serviceName = document.getElementById('wsdl-service-name').value.trim() || 'service';
    const filename = `${serviceName.replace(/[^a-zA-Z0-9._-]/g,'_')}.wsdl`;
    const blob = new Blob([val], { type:'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${filename} ✓`, 'ok');
  });

  /* -----------------------------------------------------------
     Samples
  ----------------------------------------------------------- */
  const SAMPLE_REQUEST_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://sap.com/xi/CPI/Request"
           targetNamespace="http://sap.com/xi/CPI/Request"
           elementFormDefault="qualified">
  <xs:element name="SubmitStoppageDetailsRequest">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Plant" type="xs:string"/>
        <xs:element name="Hall" type="xs:string"/>
        <xs:element name="EntryDate" type="xs:date"/>
        <xs:element name="Shift" type="xs:string"/>
        <xs:element name="Machine" type="xs:string"/>
        <xs:element name="LineItems" type="tns:LineItemsType" maxOccurs="unbounded" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  <xs:complexType name="LineItemsType">
    <xs:sequence>
      <xs:element name="SAPReferenceCode" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

  const SAMPLE_RESPONSE_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://sap.com/xi/CPI/Response"
           targetNamespace="http://sap.com/xi/CPI/Response"
           elementFormDefault="qualified">
  <xs:element name="SubmitStoppageDetailsResponse">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="LineItems" type="tns:LineItemsType" maxOccurs="unbounded" minOccurs="0"/>
        <xs:element name="Status" type="xs:string"/>
        <xs:element name="Message" type="xs:string" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  <xs:complexType name="LineItemsType">
    <xs:sequence>
      <xs:element name="Message" type="xs:string" minOccurs="0"/>
      <xs:element name="Success" type="xs:string" minOccurs="0"/>
      <xs:element name="SapReferenceCode" type="xs:string" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

  const SAMPLE_ASYNC_REQUEST_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://sap.com/xi/CPI/Event"
           targetNamespace="http://sap.com/xi/CPI/Event"
           elementFormDefault="qualified">
  <xs:element name="NotifyStoppageEvent">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Plant" type="xs:string"/>
        <xs:element name="Machine" type="xs:string"/>
        <xs:element name="EventTimestamp" type="xs:dateTime"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

  document.getElementById('wsdl-btn-sample-sync').addEventListener('click', ()=>{
    document.getElementById('wsdl-target-ns').value = 'http://sap.com/xi/CPI';
    document.getElementById('wsdl-service-name').value = 'RingFrameService';
    document.getElementById('wsdl-operation-name').value = 'SubmitStoppageDetails';
    document.getElementById('wsdl-service-type').value = 'sync';
    document.getElementById('wsdl-endpoint-url').value = 'http://localhost/service';
    document.getElementById('wsdl-request-xsd').value = SAMPLE_REQUEST_XSD;
    document.getElementById('wsdl-response-xsd').value = SAMPLE_RESPONSE_XSD;
    refreshServiceTypeUI();
    generateWsdl();
    setStatus('Sample (Synchronous, with nested/referenced types) loaded and generated ✓', 'ok');
  });

  document.getElementById('wsdl-btn-sample-async').addEventListener('click', ()=>{
    document.getElementById('wsdl-target-ns').value = 'http://sap.com/xi/CPI';
    document.getElementById('wsdl-service-name').value = 'RingFrameEventService';
    document.getElementById('wsdl-operation-name').value = 'NotifyStoppageEvent';
    document.getElementById('wsdl-service-type').value = 'async';
    document.getElementById('wsdl-endpoint-url').value = 'http://localhost/service';
    document.getElementById('wsdl-request-xsd').value = SAMPLE_ASYNC_REQUEST_XSD;
    document.getElementById('wsdl-response-xsd').value = '';
    refreshServiceTypeUI();
    generateWsdl();
    setStatus('Sample (Asynchronous) loaded and generated ✓', 'ok');
  });

  /* -----------------------------------------------------------
     Clear
  ----------------------------------------------------------- */
  document.getElementById('wsdl-btn-clear').addEventListener('click', ()=>{
    document.getElementById('wsdl-target-ns').value = '';
    document.getElementById('wsdl-service-name').value = '';
    document.getElementById('wsdl-operation-name').value = '';
    document.getElementById('wsdl-service-type').value = 'sync';
    document.getElementById('wsdl-endpoint-url').value = '';
    document.getElementById('wsdl-request-xsd').value = '';
    document.getElementById('wsdl-response-xsd').value = '';
    document.getElementById('wsdl-output').value = '';
    refreshServiceTypeUI();
    const badge = document.getElementById('wsdl-status-badge');
    badge.textContent = 'Not generated'; badge.className = 'val-report-badge pending';
    setStatus('Cleared', 'ok');
  });

})();
