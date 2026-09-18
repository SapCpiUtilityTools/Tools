/* =========================================================================
   9. XSLT SIMULATOR (native browser XSLTProcessor — zero dependencies)
========================================================================= */
(function(){

  const $status = document.getElementById('xslt-status');
  function setStatus(txt, cls){ $status.textContent = txt; $status.className = 'dock-status ' + cls; }

  const $xmlInput = document.getElementById('xslt-xml-input');
  const $xsltInput = document.getElementById('xslt-code-input');
  const $outputTextarea = document.getElementById('xslt-output');
  const $outputIframe = document.getElementById('xslt-output-iframe');
  const $viewMode = document.getElementById('xslt-output-viewmode');
  const $consoleBody = document.getElementById('xslt-console-body');

  let lastOutputText = '';
  let lastOutputIsMarkup = false;
  let lastOutputDoc = null; // full result Document, when transformToDocument succeeds

  function stripBOMLocal(s){ return s.replace(/^\uFEFF/, ''); }

  function logConsole(msg, isErr){
    $consoleBody.textContent = msg;
    $consoleBody.className = 'xslt-console-body' + (isErr ? ' err' : '');
  }

  function updateOutputDisplay(){
    const mode = $viewMode.value;
    if(mode === 'rendered' && lastOutputIsMarkup){
      $outputTextarea.style.display = 'none';
      $outputIframe.style.display = 'flex';
      const blob = new Blob([lastOutputText], { type:'text/html' });
      const url = URL.createObjectURL(blob);
      $outputIframe.src = url;
      setTimeout(()=> URL.revokeObjectURL(url), 4000);
    } else {
      $outputIframe.style.display = 'none';
      $outputTextarea.style.display = 'block';
      $outputTextarea.value = lastOutputText;
    }
  }
  $viewMode.addEventListener('change', updateOutputDisplay);

  function detectMarkupOutput(text, resultDoc){
    if(resultDoc && resultDoc.documentElement){
      const rootTag = resultDoc.documentElement.nodeName.toLowerCase();
      if(rootTag === 'html') return true;
    }
    return /^\s*<!DOCTYPE html/i.test(text) || /^\s*<html[\s>]/i.test(text);
  }

  function transform(){
    setStatus('Transforming…', 'run');
    logConsole('Running transformation…', false);

    try{
      const xmlStr = $xmlInput.value;
      const xsltStr = $xsltInput.value;
      if(!xmlStr.trim()) throw new Error('Paste XML input first.');
      if(!xsltStr.trim()) throw new Error('Paste an XSLT stylesheet first.');

      const parser = new DOMParser();

      const xmlDoc = parser.parseFromString(stripBOMLocal(xmlStr), 'application/xml');
      let err = xmlDoc.querySelector('parsererror');
      if(err) throw new Error('Invalid XML input: ' + err.textContent.slice(0,200));

      const xsltDoc = parser.parseFromString(stripBOMLocal(xsltStr), 'application/xml');
      err = xsltDoc.querySelector('parsererror');
      if(err) throw new Error('Invalid XSLT stylesheet: ' + err.textContent.slice(0,200));

      if(!window.XSLTProcessor){
        throw new Error('XSLTProcessor is not supported in this browser.');
      }

      const processor = new XSLTProcessor();
      processor.importStylesheet(xsltDoc);

      let outputText = '';
      let resultDoc = null;

      try{
        resultDoc = processor.transformToDocument(xmlDoc);
        if(resultDoc){
          outputText = new XMLSerializer().serializeToString(resultDoc);
        }
      }catch(docErr){
        resultDoc = null;
      }

      if(!resultDoc || !outputText || outputText.trim() === ''){
        // Fallback: transformToFragment handles text-only / non-well-formed HTML-ish output
        const fragment = processor.transformToFragment(xmlDoc, document);
        if(!fragment || fragment.childNodes.length === 0){
          throw new Error('Transformation produced no output. Check your XSLT match templates and xsl:output settings.');
        }
        const container = document.createElement('div');
        container.appendChild(fragment.cloneNode(true));
        outputText = container.innerHTML;
        resultDoc = null;
      }

      lastOutputText = outputText;
      lastOutputDoc = resultDoc;
      lastOutputIsMarkup = detectMarkupOutput(outputText, resultDoc);

      updateOutputDisplay();

      logConsole(
        `Transformation succeeded.\n` +
        `Output length: ${outputText.length} characters.\n` +
        (lastOutputIsMarkup ? 'Detected HTML output — switch "Rendered" view to preview it.' : 'Output appears to be XML/text.'),
        false
      );
      setStatus('Transformed ✓', 'ok');
    }catch(e){
      lastOutputText = '';
      lastOutputIsMarkup = false;
      $outputIframe.style.display = 'none';
      $outputTextarea.style.display = 'block';
      $outputTextarea.value = '';
      logConsole('Error: ' + e.message, true);
      setStatus('Error: ' + e.message, 'err');
    }
  }

  document.getElementById('xslt-btn-transform').addEventListener('click', transform);

  document.addEventListener('keydown', (e)=>{
    if(e.altKey && e.key === 'Enter'){
      const view = document.getElementById('view-xslt');
      if(view && view.classList.contains('active')){
        e.preventDefault();
        transform();
      }
    }
  });

  document.getElementById('xslt-btn-copy').addEventListener('click', ()=>{
    if(!lastOutputText){ setStatus('Nothing to copy — run a transformation first', 'err'); return; }
    navigator.clipboard.writeText(lastOutputText).then(()=> setStatus('Output copied ✓', 'ok'));
  });

  document.getElementById('xslt-btn-download').addEventListener('click', ()=>{
    if(!lastOutputText){ setStatus('Nothing to download — run a transformation first', 'err'); return; }
    const ext = lastOutputIsMarkup ? 'html' : 'xml';
    const blob = new Blob([lastOutputText], { type:'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'xslt-output.' + ext;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`Downloaded xslt-output.${ext} ✓`, 'ok');
  });

  const SAMPLE_XSLT_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
</Employees>`;

  const SAMPLE_XSLT_CODE = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" indent="yes"/>

  <xsl:template match="/Employees">
    <html>
      <body>
        <h2>Employee Directory</h2>
        <table border="1" cellpadding="6">
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Role</th>
            <th>Age</th>
          </tr>
          <xsl:for-each select="Employee">
            <tr>
              <td><xsl:value-of select="@id"/></td>
              <td><xsl:value-of select="Name"/></td>
              <td><xsl:value-of select="Role"/></td>
              <td><xsl:value-of select="Age"/></td>
            </tr>
          </xsl:for-each>
        </table>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`;

  document.getElementById('xslt-btn-sample').addEventListener('click', ()=>{
    $xmlInput.value = SAMPLE_XSLT_XML;
    $xsltInput.value = SAMPLE_XSLT_CODE;
    $viewMode.value = 'rendered';
    transform();
    setStatus('Sample loaded and transformed ✓', 'ok');
  });

  document.getElementById('xslt-btn-clear').addEventListener('click', ()=>{
    $xmlInput.value = '';
    $xsltInput.value = '';
    lastOutputText = ''; lastOutputIsMarkup = false; lastOutputDoc = null;
    $outputIframe.style.display = 'none';
    $outputTextarea.style.display = 'block';
    $outputTextarea.value = '';
    logConsole('No transformation run yet.', false);
    setStatus('Cleared', 'ok');
  });

})();
