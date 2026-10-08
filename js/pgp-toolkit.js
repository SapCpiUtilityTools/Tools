/* =========================================================================
   5. PGP TOOLKIT — GENERATE / ENCRYPT & SIGN / DECRYPT & VERIFY
      (100% client-side, via OpenPGP.js — lazy-loaded from CDN)
========================================================================= */
(function(){

  const $status = document.getElementById('pgp-status');
  function setStatus(txt, cls){
    $status.textContent = txt;
    $status.className = 'dock-status ' + cls;
  }
  function val(id){ return document.getElementById(id).value.trim(); }

  /* ---------- lazy-load OpenPGP.js only when needed ---------- */
  let openpgpReady = false;
  function requireOpenPGP(){
    return new Promise((resolve, reject)=>{
      if(openpgpReady || window.openpgp){ openpgpReady = true; resolve(); return; }
      if(window.__openpgp_loading){ window.__openpgp_cbs.push(resolve); return; }
      window.__openpgp_loading = true;
      window.__openpgp_cbs = [resolve];
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/openpgp@5.11.1/dist/openpgp.min.js';
      s.onload = ()=>{ openpgpReady = true; window.__openpgp_cbs.forEach(f=>f()); };
      s.onerror = ()=> reject(new Error('Failed to load OpenPGP.js from CDN. Check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  /* ---------- generic copy/download helpers ---------- */
  function copyTextField(id, successMsg){
    const value = document.getElementById(id).value;
    if(!value){ setStatus('Nothing to copy', 'err'); return; }
    navigator.clipboard.writeText(value).then(()=> setStatus(successMsg, 'ok'));
  }
  function downloadTextField(id, filename){
    const value = document.getElementById(id).value;
    if(!value){ setStatus('Nothing to download', 'err'); return; }
    const blob = new Blob([value], { type:'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${filename} ✓`, 'ok');
  }

  /* =======================================================================
     5.1 SUB-TAB SWITCHER
  ======================================================================= */
  document.querySelectorAll('#view-pgp-keygen .pgp-subtab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('#view-pgp-keygen .pgp-subtab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.pgpview;

      document.querySelectorAll('#view-pgp-keygen .pgp-subview').forEach(v=>v.classList.remove('active'));
      document.getElementById('pgp-subview-'+target).classList.add('active');

      document.getElementById('dock-pgp-sub-generate').style.display = target==='generate' ? 'flex' : 'none';
      document.getElementById('dock-pgp-sub-encrypt').style.display = target==='encrypt' ? 'flex' : 'none';
      document.getElementById('dock-pgp-sub-decrypt').style.display = target==='decrypt' ? 'flex' : 'none';

      setStatus('Ready', 'ok');
    });
  });

  /* =======================================================================
     5.2 GENERATE KEYS
  ======================================================================= */
  document.getElementById('pgp-algorithm').addEventListener('change', (e)=>{
    const isRsa = e.target.value === 'rsa';
    document.getElementById('pgp-bitlength-field').style.display = isRsa ? 'flex' : 'none';
    document.getElementById('pgp-curve-field').style.display = isRsa ? 'none' : 'flex';
  });

  function updatePassphraseStrength(){
    const pw = document.getElementById('pgp-passphrase').value;
    const bar = document.getElementById('pgp-strength-bar');
    const label = document.getElementById('pgp-strength-label');

    if(!pw){ bar.style.width='0%'; bar.style.background='var(--sap-border)'; label.textContent=''; return; }

    let score = 0;
    if(pw.length >= 5) score++;
    if(pw.length >= 10) score++;
    if(pw.length >= 16) score++;
    if(/[A-Z]/.test(pw)) score++;
    if(/[0-9]/.test(pw)) score++;
    if(/[^A-Za-z0-9]/.test(pw)) score++;

    const pct = Math.min(100, (score/6)*100);
    bar.style.width = pct + '%';

    let color, text;
    if(score <= 2){ color='var(--sap-error)'; text='Weak'; }
    else if(score <= 4){ color='var(--sap-warning)'; text='Fair'; }
    else { color='var(--sap-success)'; text='Strong'; }

    bar.style.background = color;
    label.textContent = text;
    label.style.color = color;
  }
  document.getElementById('pgp-passphrase').addEventListener('input', updatePassphraseStrength);

  function showKeyStrength(algorithm, bits, curve){
    const box = document.getElementById('pgp-key-strength');
    const badge = document.getElementById('pgp-key-badge');
    const text = document.getElementById('pgp-key-text');
    box.classList.add('show');

    if(algorithm === 'ecc'){
      badge.textContent = 'Excellent';
      badge.className = 'pgp-badge excellent';
      text.textContent = `ECC (${curve}) — modern elliptic-curve cryptography: fast, compact, and highly secure.`;
    } else if(bits >= 4096){
      badge.textContent = 'Excellent';
      badge.className = 'pgp-badge excellent';
      text.textContent = `RSA ${bits}-bit — very strong security, slightly slower key operations.`;
    } else {
      badge.textContent = 'Good';
      badge.className = 'pgp-badge good';
      text.textContent = `RSA ${bits}-bit — solid, widely-compatible security.`;
    }
  }

  async function generateKeys(e){
    if(e) e.preventDefault();

    const name = val('pgp-name');
    const email = val('pgp-email');
    const comment = val('pgp-comment');
    const algorithm = document.getElementById('pgp-algorithm').value;
    const expire = document.getElementById('pgp-expire').value;
    const passphrase = document.getElementById('pgp-passphrase').value;

    if(!name){ setStatus('Please enter your name', 'err'); return; }
    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ setStatus('Please enter a valid email address', 'err'); return; }
    if(!passphrase || passphrase.length < 5){ setStatus('Passphrase must be at least 5 characters', 'err'); return; }

    setStatus('Loading crypto library…', 'run');
    const genBtn = document.getElementById('pgp-btn-generate');
    genBtn.disabled = true;

    try{
      await requireOpenPGP();
      setStatus('Generating keys… this may take a few seconds', 'run');

      const opts = {
        userIDs: [{ name, email, comment: comment || undefined }],
        passphrase,
        format: 'armored'
      };

      let bits = null, curve = null;
      if(algorithm === 'rsa'){
        opts.type = 'rsa';
        bits = parseInt(document.getElementById('pgp-bitlength').value || '2048', 10);
        opts.rsaBits = bits;
      } else {
        opts.type = 'ecc';
        curve = document.getElementById('pgp-curve').value || 'curve25519';
        opts.curve = curve;
      }

      const years = parseInt(expire, 10);
      if(years > 0){ opts.keyExpirationTime = years * 365 * 24 * 3600; }

      const { privateKey, publicKey } = await openpgp.generateKey(opts);

      document.getElementById('pgp-pubkey').value = publicKey;
      document.getElementById('pgp-privkey').value = privateKey;

      showKeyStrength(algorithm, bits, curve);
      setStatus('Keys generated ✓ — store your private key and passphrase safely', 'ok');
    }catch(err){
      setStatus('Error: ' + err.message, 'err');
    }finally{
      genBtn.disabled = false;
    }
  }

  document.getElementById('pgp-btn-generate').addEventListener('click', generateKeys);
  document.getElementById('pgp-form').addEventListener('submit', generateKeys);

  document.getElementById('pgp-btn-copy-pub').addEventListener('click', ()=> copyTextField('pgp-pubkey', 'Public key copied to clipboard ✓'));
  document.getElementById('pgp-btn-copy-priv').addEventListener('click', ()=> copyTextField('pgp-privkey', 'Private key copied to clipboard ✓'));
  document.getElementById('pgp-btn-download-pub').addEventListener('click', ()=>{
    const email = val('pgp-email') || 'key';
    downloadTextField('pgp-pubkey', `publickey_${email.replace(/[^a-zA-Z0-9._-]/g,'_')}.asc`);
  });
  document.getElementById('pgp-btn-download-priv').addEventListener('click', ()=>{
    const email = val('pgp-email') || 'key';
    downloadTextField('pgp-privkey', `privatekey_${email.replace(/[^a-zA-Z0-9._-]/g,'_')}.asc`);
  });

  document.getElementById('pgp-btn-clear').addEventListener('click', ()=>{
    document.getElementById('pgp-form').reset();
    document.getElementById('pgp-algorithm').value = 'ecc';
    document.getElementById('pgp-bitlength-field').style.display = 'none';
    document.getElementById('pgp-curve-field').style.display = 'flex';
    document.getElementById('pgp-pubkey').value = '';
    document.getElementById('pgp-privkey').value = '';
    document.getElementById('pgp-key-strength').classList.remove('show');
    updatePassphraseStrength();
    setStatus('Cleared', 'ok');
  });

  /* =======================================================================
     5.3 ENCRYPT & SIGN
  ======================================================================= */
  document.getElementById('enc-also-sign').addEventListener('change', (e)=>{
    document.getElementById('enc-sign-fields').style.display = e.target.checked ? 'block' : 'none';
  });

  document.getElementById('enc-fill-recipient').addEventListener('click', ()=>{
    const pub = document.getElementById('pgp-pubkey').value;
    if(!pub){ setStatus('Generate a key pair first in the Generate Keys tab', 'err'); return; }
    document.getElementById('enc-recipient-pubkey').value = pub;
    setStatus('Filled with your generated public key', 'ok');
  });
  document.getElementById('enc-fill-privkey').addEventListener('click', ()=>{
    const priv = document.getElementById('pgp-privkey').value;
    if(!priv){ setStatus('Generate a key pair first in the Generate Keys tab', 'err'); return; }
    document.getElementById('enc-own-privkey').value = priv;
    setStatus('Filled with your generated private key', 'ok');
  });

  async function encryptMessage(){
    const plaintext = document.getElementById('enc-plaintext').value;
    const recipientPubArmored = document.getElementById('enc-recipient-pubkey').value.trim();
    const alsoSign = document.getElementById('enc-also-sign').checked;
    const ownPrivArmored = document.getElementById('enc-own-privkey').value.trim();
    const ownPassphrase = document.getElementById('enc-own-passphrase').value;

    if(!plaintext){ setStatus('Enter a message to encrypt', 'err'); return; }
    if(!recipientPubArmored){ setStatus("Paste the recipient's public key first", 'err'); return; }
    if(alsoSign && (!ownPrivArmored || !ownPassphrase)){ setStatus('Provide your private key and passphrase to sign', 'err'); return; }

    setStatus('Encrypting…', 'run');
    const btn = document.getElementById('pgp-btn-encrypt');
    btn.disabled = true;

    try{
      await requireOpenPGP();

      const publicKey = await openpgp.readKey({ armoredKey: recipientPubArmored });
      const message = await openpgp.createMessage({ text: plaintext });

      let signingKeys;
      if(alsoSign){
        let privateKey = await openpgp.readPrivateKey({ armoredKey: ownPrivArmored });
        privateKey = await openpgp.decryptKey({ privateKey, passphrase: ownPassphrase });
        signingKeys = privateKey;
      }

      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        signingKeys: signingKeys || undefined
      });

      document.getElementById('enc-output').value = encrypted;
      setStatus(alsoSign ? 'Message encrypted & signed ✓' : 'Message encrypted ✓', 'ok');
    }catch(err){
      setStatus('Error: ' + err.message, 'err');
    }finally{
      btn.disabled = false;
    }
  }

  document.getElementById('pgp-btn-encrypt').addEventListener('click', encryptMessage);
  document.getElementById('pgp-btn-copy-enc-output').addEventListener('click', ()=> copyTextField('enc-output', 'Encrypted message copied ✓'));
  document.getElementById('pgp-btn-download-enc-output').addEventListener('click', ()=> downloadTextField('enc-output', 'encrypted_message.asc'));

  document.getElementById('pgp-btn-clear-encrypt').addEventListener('click', ()=>{
    document.getElementById('enc-plaintext').value = '';
    document.getElementById('enc-recipient-pubkey').value = '';
    document.getElementById('enc-also-sign').checked = false;
    document.getElementById('enc-sign-fields').style.display = 'none';
    document.getElementById('enc-own-privkey').value = '';
    document.getElementById('enc-own-passphrase').value = '';
    document.getElementById('enc-output').value = '';
    setStatus('Cleared', 'ok');
  });

  /* =======================================================================
     5.4 DECRYPT & VERIFY
  ======================================================================= */
  document.getElementById('dec-fill-privkey').addEventListener('click', ()=>{
    const priv = document.getElementById('pgp-privkey').value;
    if(!priv){ setStatus('Generate a key pair first in the Generate Keys tab', 'err'); return; }
    document.getElementById('dec-own-privkey').value = priv;
    setStatus('Filled with your generated private key', 'ok');
  });
  document.getElementById('dec-fill-senderkey').addEventListener('click', ()=>{
    const pub = document.getElementById('pgp-pubkey').value;
    if(!pub){ setStatus('Generate a key pair first in the Generate Keys tab', 'err'); return; }
    document.getElementById('dec-sender-pubkey').value = pub;
    setStatus('Filled with your generated public key', 'ok');
  });

  async function decryptMessage(){
    const armoredMessage = document.getElementById('dec-ciphertext').value.trim();
    const privArmored = document.getElementById('dec-own-privkey').value.trim();
    const passphrase = document.getElementById('dec-own-passphrase').value;
    const senderPubArmored = document.getElementById('dec-sender-pubkey').value.trim();

    if(!armoredMessage){ setStatus('Paste an encrypted PGP message first', 'err'); return; }
    if(!privArmored){ setStatus('Paste your private key first', 'err'); return; }
    if(!passphrase){ setStatus('Enter your passphrase', 'err'); return; }

    setStatus('Decrypting…', 'run');
    const btn = document.getElementById('pgp-btn-decrypt');
    btn.disabled = true;

    const badge = document.getElementById('dec-verify-badge');

    try{
      await requireOpenPGP();

      const message = await openpgp.readMessage({ armoredMessage });

      let privateKey = await openpgp.readPrivateKey({ armoredKey: privArmored });
      privateKey = await openpgp.decryptKey({ privateKey, passphrase });

      let verificationKeys;
      if(senderPubArmored){
        verificationKeys = await openpgp.readKey({ armoredKey: senderPubArmored });
      }

      const { data: decrypted, signatures } = await openpgp.decrypt({
        message,
        decryptionKeys: privateKey,
        verificationKeys: verificationKeys || undefined
      });

      document.getElementById('dec-output').value = decrypted;

      if(verificationKeys && signatures && signatures.length){
        try{
          await signatures[0].verified;
          badge.textContent = '✅ Signature verified — message is authentic';
          badge.className = 'pgp-verify-badge verified';
        }catch(sigErr){
          badge.textContent = '❌ Signature verification FAILED — do not trust this message';
          badge.className = 'pgp-verify-badge invalid';
        }
      } else if(verificationKeys){
        badge.textContent = 'ℹ️ No signature found in this message';
        badge.className = 'pgp-verify-badge none';
      } else {
        badge.textContent = 'ℹ️ No signature verification performed (sender public key not provided)';
        badge.className = 'pgp-verify-badge none';
      }

      setStatus('Message decrypted ✓', 'ok');
    }catch(err){
      badge.textContent = 'ℹ️ No signature verification performed';
      badge.className = 'pgp-verify-badge none';
      setStatus('Error: ' + err.message, 'err');
    }finally{
      btn.disabled = false;
    }
  }

  document.getElementById('pgp-btn-decrypt').addEventListener('click', decryptMessage);
  document.getElementById('pgp-btn-copy-dec-output').addEventListener('click', ()=> copyTextField('dec-output', 'Decrypted message copied ✓'));
  document.getElementById('pgp-btn-download-dec-output').addEventListener('click', ()=> downloadTextField('dec-output', 'decrypted_message.txt'));

  document.getElementById('pgp-btn-clear-decrypt').addEventListener('click', ()=>{
    document.getElementById('dec-ciphertext').value = '';
    document.getElementById('dec-own-privkey').value = '';
    document.getElementById('dec-own-passphrase').value = '';
    document.getElementById('dec-sender-pubkey').value = '';
    document.getElementById('dec-output').value = '';
    const b = document.getElementById('dec-verify-badge');
    b.textContent = 'ℹ️ No signature verification performed';
    b.className = 'pgp-verify-badge none';
    setStatus('Cleared', 'ok');
  });

})();
