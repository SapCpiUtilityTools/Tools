/* =========================================================================
   10. WSDL GENERATOR (from XSD, sync/async) — single merged schema,
       unified Target Namespace, matches real SAP CPI/PI WSDL structure.
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
     Throws a clear error if malformed or missing top-level elements.
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
     MERGE ENGINE: combines Request (+ Response) schemas into ONE
     <xsd:schema targetNamespace="mainNs"> block, auto-renaming any
     colliding top-level complexType/simpleType names, and rewriting
     internal type="..."/base="..."/ref="..." references accordingly.
  ----------------------------------------------------------- */
  function mergeSchemasForWsdl(requestXsdString, responseXsdString, mainNs, isSync){
    const reqSchemaEl = parseSchemaDoc(requestXsdString);
    let respSchemaEl = null;
    if(isSync) respSchemaEl = parseSchemaDoc(responseXsdString);

    const outDoc = document.implementation.createDocument(null, null, null);
    const outSchema = outDoc.createElementNS(XSD_NS, 'xsd:schema');
    outSchema.setAttribute('xmlns:xsd', XSD_NS);
    outSchema.setAttribute('xmlns:tns', mainNs);
    outSchema.setAttribute('targetNamespace', mainNs);
    outDoc.appendChild(outSchema);

    const usedElementNames = new Set();
    const usedTypeNames = new Set();

    let requestRootElementName = null;
    let responseRootElementName = null;

    function collectTopLevelChildren(schemaEl){
      return Array.from(schemaEl.children).filter(c => c.nodeType === 1);
    }

    function processSchema(schemaEl, isRequest){
      const children = collectTopLevelChildren(schemaEl);
      const renameMap = {}; // oldLocalTypeName -> newLocalTypeName (this schema only)

      children.forEach(child => {
        const tag = localNameOf(child);
        const name = child.getAttribute('name');
        if(!name) return;

        if(tag === 'element'){
          let finalName = name;
          if(usedElementNames.has(finalName)){
            let i = 1;
            while(usedElementNames.has(name + i)) i++;
            finalName = name + i;
          }
          usedElementNames.add(finalName);
          if(finalName !== name) child.setAttribute('name', finalName);

          if(isRequest && requestRootElementName === null) requestRootElementName = finalName;
          if(!isRequest && responseRootElementName === null) responseRootElementName = finalName;

        } else if(tag === 'complexType' || tag === 'simpleType'){
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

      // Fix up internal references (type="prefix:OldName", base="...", ref="...")
      // within THIS schema that pointed to a locally-renamed complexType/simpleType.
      if(Object.keys(renameMap).length){
        const allDescendants = schemaEl.querySelectorAll('*');
        allDescendants.forEach(node=>{
          ['type','base','ref'].forEach(attrName=>{
            const val = node.getAttribute(attrName);
            if(!val) return;
            const parts = val.split(':');
            const localPart = parts.length > 1 ? parts[1] : parts[0];
            if(renameMap[localPart]){
              const prefix = parts.length > 1 ? parts[0] : null;
              node.setAttribute(attrName, prefix ? `${prefix}:${renameMap[localPart]}` : renameMap[localPart]);
            }
          });
        });
      }

      return children;
    }

    const reqChildren = processSchema(reqSchemaEl, true);
    let respChildren = [];
    if(isSync) respChildren = processSchema(respSchemaEl, false);

    [...reqChildren, ...respChildren].forEach(node=>{
      const imported = outDoc.importNode(node, true);
      outSchema.appendChild(imported);
    });

    if(requestRootElementName === null){
      throw new Error('No top-level <xs:element> found in the Request XSD — cannot determine the request root element.');
    }
    if(isSync && responseRootElementName === null){
      throw new Error('No top-level <xs:element> found in the Response XSD — cannot determine the response root element.');
    }

    const serialized = new XMLSerializer().serializeToString(outSchema);

    return { serialized, requestRootElementName, responseRootElementName };
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
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

  const SAMPLE_RESPONSE_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="http://sap.com/xi/CPI/Response"
           elementFormDefault="qualified">
  <xs:element name="SubmitStoppageDetailsResponse">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Status" type="xs:string"/>
        <xs:element name="Message" type="xs:string" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

  const SAMPLE_ASYNC_REQUEST_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
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
    setStatus('Sample (Synchronous) loaded and generated ✓', 'ok');
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
