/* =========================================================
   EDMX -> XML STRUCTURE GENERATOR
   Injects ONLY the content panel into #view-edmx.
   Wires up to the EXISTING static dock buttons in #dock-edmx.
   Never touches inline display styles — fully respects the
   app's .view / .view.active CSS-driven tab switching.
========================================================= */
(function(){
  "use strict";

  const VIEW_ID = 'view-edmx';
  let injected = false;

  function buildContentMarkup(){
    return `
      <div class="wsdl-grid" style="flex:1;min-height:0;">

        <!-- LEFT: INPUT -->
        <div class="wsdl-panel">
          <div class="ds-panel-header"><span>EDMX Input</span></div>
          <div class="pgp-panel-inner" style="display:flex;flex-direction:column;flex:1;min-height:0;">

            <label class="b64-filedrop" id="edmx-filedrop" for="edmx-file-input" style="margin:0 0 12px;">
              📁 Drop a .edmx / .xml metadata file here, or click to browse
              <input type="file" id="edmx-file-input" accept=".xml,.edmx">
            </label>
            <div class="b64-fileinfo" id="edmx-fileinfo"></div>

            <div class="pgp-field" style="flex:1;min-height:200px;">
              <label>EDMX Metadata XML</label>
              <textarea class="pgp-keyarea" id="edmx-input" style="flex:1;min-height:200px;height:100%;" placeholder="Paste your $metadata EDMX document here, or click a Sample button above…"></textarea>
            </div>

            <div class="val-report-body" id="edmx-summary-wrap" style="flex:none;padding:0;display:none;">
              <div class="val-issue" id="edmx-summary-text" style="margin-top:10px;"></div>
            </div>

            <div class="pgp-field">
              <label>Entity Sets <span class="occ-tag-pill" id="edmx-sets-count">0</span></label>
              <div id="edmx-sets-list" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px;background:var(--sap-bg);border:1px solid var(--sap-border);border-radius:var(--sap-radius);min-height:46px;">
                <span class="gide-kv-empty" style="padding:4px;">Parse an EDMX document to list entity sets here.</span>
              </div>
            </div>

            <div class="pgp-checkbox-row">
              <input type="checkbox" id="edmx-opt-comments">
              <label for="edmx-opt-comments" style="margin:0;">Include type/nullable comments</label>
            </div>
            <div class="pgp-checkbox-row">
              <input type="checkbox" id="edmx-opt-nav">
              <label for="edmx-opt-nav" style="margin:0;">Include navigation properties</label>
            </div>

          </div>
        </div>

        <!-- RIGHT: OUTPUT -->
        <div class="wsdl-panel">
          <div class="ds-panel-header">
            <span id="edmx-output-title">Generated XML Structure</span>
            <span class="val-report-badge pending" id="edmx-output-badge">Not generated</span>
          </div>
          <textarea class="ds-textarea" id="edmx-output" readonly placeholder="Select an entity set on the left to generate its empty XML structure here…"></textarea>
        </div>

      </div>
    `;
  }

  /* ---------------------------------------------------------
     PARSING LOGIC
  --------------------------------------------------------- */
  let entityTypeMap = {};
  let entitySets = [];
  let activeSetIndex = -1;

  function stripBOM(s){ return s.replace(/^\uFEFF/, ''); }

  function parseXMLDoc(str){
    const doc = new DOMParser().parseFromString(stripBOM(str), 'application/xml');
    const err = doc.getElementsByTagName('parsererror');
    if(err.length) throw new Error('XML parse error: ' + err[0].textContent.slice(0,220));
    return doc;
  }

  function byLocalName(root, name){
    const out = [];
    const all = root.getElementsByTagName('*');
    for(let i=0;i<all.length;i++){ if(all[i].localName === name) out.push(all[i]); }
    return out;
  }

  function attr(elm, name, def){
    const v = elm.getAttribute(name);
    return v === null ? (def !== undefined ? def : null) : v;
  }

  function escapeXml(s){
    return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
  }

  function localTypeName(q){
    if(!q) return '';
    let t = q.replace(/^Collection\(/,'').replace(/\)$/,'');
    const parts = t.split('.');
    return parts[parts.length-1];
  }

  function parseEdmx(xmlStr){
    const doc = parseXMLDoc(xmlStr);
    const schemas = byLocalName(doc, 'Schema');
    if(schemas.length === 0){
      throw new Error('No <Schema> element found — this is not a valid EDMX/$metadata document.');
    }

    entityTypeMap = {};
    let rawSets = [];

    schemas.forEach(schema => {
      const ns = attr(schema, 'Namespace', '');

      byLocalName(schema, 'EntityType').forEach(et => {
        const name = attr(et, 'Name', 'Unnamed');
        const keys = [];
        const keyEl = byLocalName(et, 'Key')[0];
        if(keyEl) byLocalName(keyEl, 'PropertyRef').forEach(pr => keys.push(attr(pr, 'Name')));

        const properties = [];
        Array.from(et.children).forEach(child => {
          if(child.localName === 'Property'){
            const pname = attr(child, 'Name');
            properties.push({
              name: pname,
              type: attr(child, 'Type', 'Edm.String'),
              nullable: attr(child, 'Nullable', 'true') !== 'false',
              isKey: keys.includes(pname)
            });
          }
        });

        const navProps = [];
        Array.from(et.children).forEach(child => {
          if(child.localName === 'NavigationProperty'){
            navProps.push({ name: attr(child, 'Name') });
          }
        });

        const full = { name, namespace: ns, keys, properties, navProps };
        entityTypeMap[ns + '.' + name] = full;
        if(!entityTypeMap[name]) entityTypeMap[name] = full;
      });

      byLocalName(schema, 'EntityContainer').forEach(ec => {
        byLocalName(ec, 'EntitySet').forEach(es => {
          rawSets.push({ setName: attr(es, 'Name'), typeRef: attr(es, 'EntityType', '') });
        });
      });
    });

    if(rawSets.length === 0){
      const seen = new Set();
      Object.keys(entityTypeMap).forEach(key => {
        const t = entityTypeMap[key];
        if(!seen.has(t.name)){
          seen.add(t.name);
          rawSets.push({ setName: t.name, typeRef: key });
        }
      });
    }

    const resolvedSets = rawSets.map(rs => {
      let resolved = entityTypeMap[rs.typeRef] || entityTypeMap[localTypeName(rs.typeRef)];
      return { setName: rs.setName, resolved };
    }).filter(s => s.resolved);

    if(resolvedSets.length === 0){
      throw new Error('EntityTypes were found but no EntitySet could be resolved to them.');
    }

    entitySets = resolvedSets;
    return {
      schemaCount: schemas.length,
      typeCount: new Set(Object.values(entityTypeMap).map(t => t.namespace + '.' + t.name)).size,
      setCount: entitySets.length
    };
  }

  function generateEmptyXml(entityType, opts){
    const lines = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<${entityType.name}>`);
    entityType.properties.forEach(p => {
      let comment = '';
      if(opts.comments){
        const bits = [p.type];
        if(p.isKey) bits.push('KEY');
        if(!p.nullable) bits.push('Required');
        comment = ` <!-- ${bits.join(', ')} -->`;
      }
      lines.push(`  <${p.name}></${p.name}>${comment}`);
    });
    if(opts.navProps && entityType.navProps.length){
      lines.push(`  <!-- Navigation Properties -->`);
      entityType.navProps.forEach(np => lines.push(`  <${np.name}></${np.name}>`));
    }
    lines.push(`</${entityType.name}>`);
    return lines.join('\n');
  }

  /* ---------------------------------------------------------
     SAMPLE DOCUMENTS
  --------------------------------------------------------- */
  const SAMPLE_V2 = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" m:DataServiceVersion="2.0">
    <Schema Namespace="SalesOrderService" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="SalesOrder">
        <Key><PropertyRef Name="SalesOrderID"/></Key>
        <Property Name="SalesOrderID" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="CustomerID" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="GrossAmount" Type="Edm.Decimal" Nullable="true"/>
        <Property Name="CurrencyCode" Type="Edm.String" Nullable="true" MaxLength="3"/>
        <Property Name="CreatedAt" Type="Edm.DateTime" Nullable="true"/>
        <NavigationProperty Name="ToItems" Relationship="SalesOrderService.SalesOrder_Items" FromRole="FromRole_SalesOrder_Items" ToRole="ToRole_SalesOrder_Items"/>
      </EntityType>
      <EntityType Name="SalesOrderItem">
        <Key>
          <PropertyRef Name="SalesOrderID"/>
          <PropertyRef Name="ItemPosition"/>
        </Key>
        <Property Name="SalesOrderID" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="ItemPosition" Type="Edm.String" Nullable="false" MaxLength="6"/>
        <Property Name="ProductID" Type="Edm.String" Nullable="true" MaxLength="18"/>
        <Property Name="Quantity" Type="Edm.Decimal" Nullable="true"/>
      </EntityType>
      <EntityContainer Name="SalesOrderServiceContainer" m:IsDefaultEntityContainer="true">
        <EntitySet Name="SalesOrderSet" EntityType="SalesOrderService.SalesOrder"/>
        <EntitySet Name="SalesOrderItemSet" EntityType="SalesOrderService.SalesOrderItem"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

  const SAMPLE_V4 = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="com.sap.odata.Business" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="BusinessPartner">
        <Key><PropertyRef Name="BusinessPartnerID"/></Key>
        <Property Name="BusinessPartnerID" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="BusinessPartnerName" Type="Edm.String" Nullable="true" MaxLength="80"/>
        <Property Name="IsActive" Type="Edm.Boolean" Nullable="false"/>
        <Property Name="CreditLimit" Type="Edm.Decimal" Nullable="true"/>
        <Property Name="ValidFrom" Type="Edm.DateTimeOffset" Nullable="true"/>
        <Property Name="UUID" Type="Edm.Guid" Nullable="false"/>
        <NavigationProperty Name="to_Address" Type="com.sap.odata.Business.Address" Nullable="true"/>
      </EntityType>
      <EntityType Name="Address">
        <Key><PropertyRef Name="AddressID"/></Key>
        <Property Name="AddressID" Type="Edm.String" Nullable="false" MaxLength="10"/>
        <Property Name="City" Type="Edm.String" Nullable="true" MaxLength="40"/>
        <Property Name="PostalCode" Type="Edm.String" Nullable="true" MaxLength="10"/>
        <Property Name="Country" Type="Edm.String" Nullable="true" MaxLength="3"/>
      </EntityType>
      <EntityContainer Name="BusinessContainer">
        <EntitySet Name="BusinessPartners" EntityType="com.sap.odata.Business.BusinessPartner"/>
        <EntitySet Name="Addresses" EntityType="com.sap.odata.Business.Address"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

  /* ---------------------------------------------------------
     UI WIRING — attaches to EXISTING static dock buttons
  --------------------------------------------------------- */
  function setStatus(msg, kind){
    const statusEl = document.getElementById('edmx-status');
    if(!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'dock-status ' + (kind || 'ok');
  }

  function renderSetsList(){
    const listEl = document.getElementById('edmx-sets-list');
    const countEl = document.getElementById('edmx-sets-count');
    if(!listEl || !countEl) return;
    countEl.textContent = entitySets.length;
    if(entitySets.length === 0){
      listEl.innerHTML = '<span class="gide-kv-empty" style="padding:4px;">Parse an EDMX document to list entity sets here.</span>';
      return;
    }
    listEl.innerHTML = entitySets.map((es, i) =>
      `<button type="button" class="pgp-inline-btn edmx-set-btn" data-idx="${i}" style="margin:0;${i===activeSetIndex?'background:var(--sap-blue);color:#fff;':''}">${escapeXml(es.setName)} (${es.resolved.properties.length})</button>`
    ).join('');
    listEl.querySelectorAll('.edmx-set-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSetIndex = parseInt(btn.dataset.idx, 10);
        renderSetsList();
        generateOutput();
      });
    });
  }

  function generateOutput(){
    const outputBox = document.getElementById('edmx-output');
    const titleEl = document.getElementById('edmx-output-title');
    const badgeEl = document.getElementById('edmx-output-badge');
    if(!outputBox) return;

    if(activeSetIndex < 0 || !entitySets[activeSetIndex]){
      setStatus('Select an entity set to generate XML', 'err');
      return;
    }
    const es = entitySets[activeSetIndex];
    const opts = {
      comments: document.getElementById('edmx-opt-comments')?.checked,
      navProps: document.getElementById('edmx-opt-nav')?.checked
    };
    const xml = generateEmptyXml(es.resolved, opts);
    outputBox.value = xml;
    if(titleEl) titleEl.textContent = 'Generated XML — ' + es.setName;
    if(badgeEl){ badgeEl.textContent = 'Generated'; badgeEl.className = 'val-report-badge pass'; }
    setStatus(`Generated empty XML for "${es.setName}" ✓`, 'ok');
  }

  function doParse(){
    const input = document.getElementById('edmx-input');
    const summaryWrap = document.getElementById('edmx-summary-wrap');
    const summaryText = document.getElementById('edmx-summary-text');
    if(!input) return;

    const raw = input.value.trim();
    activeSetIndex = -1;
    const outputBox = document.getElementById('edmx-output');
    if(outputBox) outputBox.value = '';
    const titleEl = document.getElementById('edmx-output-title');
    if(titleEl) titleEl.textContent = 'Generated XML Structure';
    const badgeEl = document.getElementById('edmx-output-badge');
    if(badgeEl){ badgeEl.textContent = 'Not generated'; badgeEl.className = 'val-report-badge pending'; }

    if(!raw){
      setStatus('Nothing to parse — paste or upload an EDMX file first', 'err');
      if(summaryWrap) summaryWrap.style.display = 'none';
      entitySets = [];
      renderSetsList();
      return;
    }
    try{
      const info = parseEdmx(raw);
      if(summaryWrap && summaryText){
        summaryWrap.style.display = 'block';
        summaryText.className = 'val-issue';
        summaryText.style.background = 'rgba(16,126,62,.08)';
        summaryText.style.borderLeft = '3px solid var(--sap-success)';
        summaryText.innerHTML = `✅ Parsed metadata — <b>${info.schemaCount}</b> schema(s), <b>${info.typeCount}</b> EntityType(s), <b>${info.setCount}</b> EntitySet(s) found.`;
      }
      renderSetsList();
      setStatus(`EDMX parsed ✓ — ${info.setCount} entity set(s) listed below`, 'ok');
    }catch(e){
      entitySets = [];
      renderSetsList();
      if(summaryWrap && summaryText){
        summaryWrap.style.display = 'block';
        summaryText.className = 'val-issue error';
        summaryText.style.background = '';
        summaryText.style.borderLeft = '';
        summaryText.innerHTML = `❌ ${escapeXml(e.message)}`;
      }
      setStatus('Parse failed: ' + e.message, 'err');
      console.error('[EDMX Tool] Parse error:', e);
    }
  }

  function doCopy(){
    const out = document.getElementById('edmx-output');
    if(!out || !out.value){ setStatus('Nothing to copy', 'err'); return; }
    navigator.clipboard.writeText(out.value).then(()=>{
      setStatus('Copied to clipboard ✓', 'ok');
    }).catch(()=>{
      out.select(); document.execCommand('copy');
      setStatus('Copied to clipboard ✓', 'ok');
    });
  }

  function doDownload(){
    const out = document.getElementById('edmx-output');
    if(!out || !out.value){ setStatus('Nothing to download', 'err'); return; }
    const name = (entitySets[activeSetIndex]?.setName || 'structure') + '.xml';
    const blob = new Blob([out.value], {type:'application/xml'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setStatus('Downloaded ' + name + ' ✓', 'ok');
  }

  function doClear(){
    const input = document.getElementById('edmx-input');
    const outputBox = document.getElementById('edmx-output');
    const titleEl = document.getElementById('edmx-output-title');
    const badgeEl = document.getElementById('edmx-output-badge');
    const summaryWrap = document.getElementById('edmx-summary-wrap');
    const fileInfo = document.getElementById('edmx-fileinfo');

    if(input) input.value = '';
    if(outputBox) outputBox.value = '';
    if(titleEl) titleEl.textContent = 'Generated XML Structure';
    if(badgeEl){ badgeEl.textContent = 'Not generated'; badgeEl.className = 'val-report-badge pending'; }
    if(summaryWrap) summaryWrap.style.display = 'none';
    if(fileInfo){ fileInfo.classList.remove('show'); fileInfo.textContent = ''; }

    entitySets = [];
    activeSetIndex = -1;
    renderSetsList();
    setStatus('Cleared — ready for new input', 'ok');
  }

  function handleFile(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const input = document.getElementById('edmx-input');
      if(input) input.value = e.target.result;
      const info = document.getElementById('edmx-fileinfo');
      if(info){
        info.classList.add('show');
        info.innerHTML = `Loaded <b>${escapeXml(file.name)}</b> (${(file.size/1024).toFixed(1)} KB) — click "Parse EDMX"`;
      }
      setStatus('File loaded — click "Parse EDMX"', 'ok');
    };
    reader.onerror = () => setStatus('Failed to read file', 'err');
    reader.readAsText(file);
  }

  function wireStaticDockButtons(){
    const parseBtn = document.getElementById('edmx-btn-parse');
    const generateBtn = document.getElementById('edmx-btn-generate');
    const copyBtn = document.getElementById('edmx-btn-copy');
    const downloadBtn = document.getElementById('edmx-btn-download');
    const sampleV2Btn = document.getElementById('edmx-btn-sample-v2');
    const sampleV4Btn = document.getElementById('edmx-btn-sample-v4');
    const clearBtn = document.getElementById('edmx-btn-clear');

    if(parseBtn) parseBtn.addEventListener('click', doParse);
    if(generateBtn) generateBtn.addEventListener('click', generateOutput);
    if(copyBtn) copyBtn.addEventListener('click', doCopy);
    if(downloadBtn) downloadBtn.addEventListener('click', doDownload);
    if(clearBtn) clearBtn.addEventListener('click', doClear);
    if(sampleV2Btn) sampleV2Btn.addEventListener('click', () => {
      const input = document.getElementById('edmx-input');
      if(input) input.value = SAMPLE_V2;
      doParse();
    });
    if(sampleV4Btn) sampleV4Btn.addEventListener('click', () => {
      const input = document.getElementById('edmx-input');
      if(input) input.value = SAMPLE_V4;
      doParse();
    });
  }

  function wireContentHandlers(container){
    const fileInput = container.querySelector('#edmx-file-input');
    if(fileInput) fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    const drop = container.querySelector('#edmx-filedrop');
    if(drop){
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault(); drop.classList.remove('dragover');
        if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      });
    }
    renderSetsList();
  }

  /* ---------------------------------------------------------
     INIT — runs once, no inline styles, no global observers
  --------------------------------------------------------- */
  function init(){
    if(injected) return;
    const container = document.getElementById(VIEW_ID);
    if(!container){
      console.error('[EDMX Tool] #view-edmx not found.');
      return;
    }
    container.innerHTML = buildContentMarkup();
    wireContentHandlers(container);
    wireStaticDockButtons();
    injected = true;
    console.log('[EDMX Tool] Initialized (content only, static dock wired).');
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();