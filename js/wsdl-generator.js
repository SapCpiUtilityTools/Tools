/* =========================================================================
   10. WSDL GENERATOR (from XSD, sync/async, target namespace aware)
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
  function isForceNsChecked(){
    const el = document.getElementById('wsdl-force-ns');
    return el ? el.checked : true; // default to true if checkbox missing from HTML
  }

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
     Parse an XSD: extract targetNamespace + first top-level element.
     If forceNamespace is provided (non-null), it OVERRIDES whatever
     targetNamespace the pasted XSD declares — this is what actually
     makes the typed Target Namespace show up inside <xs:schema>.
  ----------------------------------------------------------- */
  function parseXsdForWsdl(xsdString, fallbackNamespace, forceNamespace){
    const doc = new DOMParser().parseFromString(stripBOMLocal(xsdString), 'application/xml');
    const errNode = doc.querySelector('parsererror');
    if(errNode) throw new Error('Invalid XSD: ' + errNode.textContent.slice(0,160));

    const schemaEl = doc.documentElement;
    if(localNameOf(schemaEl) !== 'schema'){
      throw new Error(`Root element must be <xs:schema> (found <${schemaEl.nodeName}>).`);
    }

    // Force the WSDL's Target Namespace onto this schema's own attribute
    if(forceNamespace){
      schemaEl.setAttribute('targetNamespace', forceNamespace);
    }

    const targetNamespace = schemaEl.getAttribute('targetNamespace') || fallbackNamespace;

    const rootElementNode = Array.from(schemaEl.children)
      .find(c => localNameOf(c) === 'element' && c.getAttribute('name'));
    if(!rootElementNode){
      throw new Error('No top-level <xs:element> found in this XSD — cannot determine the message root element.');
    }
    const rootElementName = rootElementNode.getAttribute('name');

    // Re-serialize AFTER the attribute change so the output reflects it
    const serialized = new XMLSerializer().serializeToString(schemaEl);

    return { targetNamespace, rootElementName, serialized };
  }

  /* -----------------------------------------------------------
     Namespace prefix registry (tns for main NS, ns1/ns2… for others)
  ----------------------------------------------------------- */
  function buildNsRegistry(mainNs){
    const order = [[mainNs, 'tns']];
    const map = new Map(order);
    let counter = 1;
    return {
      getPrefix(ns){
        if(map.has(ns)) return map.get(ns);
        const p = 'ns' + (counter++);
        map.set(ns, p);
        order.push([ns, p]);
        return p;
      },
      entries(){ return order; }
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
      const forceNs = isForceNsChecked();

      if(!mainNs) throw new Error('Target Namespace is required.');
      if(!requestXsd.trim()) throw new Error('Request XSD is required.');
      if(serviceType === 'sync' && !responseXsd.trim()) throw new Error('Response XSD is required for Synchronous services.');

      const registry = buildNsRegistry(mainNs);

      const reqInfo = parseXsdForWsdl(requestXsd, mainNs, forceNs ? mainNs : null);
      const reqPrefix = registry.getPrefix(reqInfo.targetNamespace);

      let respInfo = null, respPrefix = null;
      if(serviceType === 'sync'){
        respInfo = parseXsdForWsdl(responseXsd, mainNs, forceNs ? mainNs : null);
        respPrefix = registry.getPrefix(respInfo.targetNamespace);
      }

      const nsDeclarations = registry.entries()
        .map(([ns, prefix]) => `xmlns:${prefix}="${escapeXmlAttrLocal(ns)}"`)
        .join('\n            ');

      const typesBlock =
`  <wsdl:types>
${indentBlock(reqInfo.serialized, 4)}${serviceType === 'sync' ? '\n' + indentBlock(respInfo.serialized, 4) : ''}
  </wsdl:types>`;

      const requestMessageName = `${operationName}RequestMessage`;
      const responseMessageName = `${operationName}ResponseMessage`;

      const messagesBlock =
`  <wsdl:message name="${requestMessageName}">
    <wsdl:part name="parameters" element="${reqPrefix}:${reqInfo.rootElementName}"/>
  </wsdl:message>` +
      (serviceType === 'sync'
        ? `\n  <wsdl:message name="${responseMessageName}">
    <wsdl:part name="parameters" element="${respPrefix}:${respInfo.rootElementName}"/>
  </wsdl:message>`
        : '');

      const portTypeBlock =
`  <wsdl:portType name="${serviceName}PortType">
    <wsdl:operation name="${operationName}">
      <wsdl:input message="tns:${requestMessageName}"/>${serviceType === 'sync' ? `
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
      </wsdl:input>${serviceType === 'sync' ? `
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
            ${nsDeclarations}
            targetNamespace="${escapeXmlAttrLocal(mainNs)}">

${typesBlock}

${messagesBlock}

${portTypeBlock}

${bindingBlock}

${serviceBlock}

</wsdl:definitions>`;

      document.getElementById('wsdl-output').value = wsdl;
      badge.textContent = `✅ Generated (${serviceType === 'sync' ? 'Synchronous' : 'Asynchronous'})`;
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
    const forceEl = document.getElementById('wsdl-force-ns');
    if(forceEl) forceEl.checked = true;
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
    const forceEl = document.getElementById('wsdl-force-ns');
    if(forceEl) forceEl.checked = true;
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
    const forceEl = document.getElementById('wsdl-force-ns');
    if(forceEl) forceEl.checked = true;
    document.getElementById('wsdl-request-xsd').value = '';
    document.getElementById('wsdl-response-xsd').value = '';
    document.getElementById('wsdl-output').value = '';
    refreshServiceTypeUI();
    const badge = document.getElementById('wsdl-status-badge');
    badge.textContent = 'Not generated'; badge.className = 'val-report-badge pending';
    setStatus('Cleared', 'ok');
  });

})();
