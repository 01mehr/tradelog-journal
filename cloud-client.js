/* TradeLog cloud sync and read-only journal sharing.
   Only a Supabase publishable key is used in the browser; table access is protected by RLS. */
(() => {
  const config = window.TRADELOG_CLOUD_CONFIG || {};
  const linkedKey = 'tradelog:cloud-linked-user:v1';
  const stateTable = 'tradelog_user_state';
  let client = null;
  let user = null;
  let app = null;
  let status = 'Sign in to sync this journal across devices.';
  let pendingRemote = null;
  let remoteUpdatedAt = '';
  let dirty = false;
  let syncing = false;
  let syncTimer = 0;
  let readOnly = false;
  let lastCreatedLink = '';
  let linkNotice = '';
  let panelRefreshTimer = 0;
  let googleEnabled = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const configured = () => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url || '') && /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey || '') || /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url || '') && /^[A-Za-z0-9._-]{30,}$/.test(config.publishableKey || '');
  const currentState = () => app?.getState?.() || {};
  const isLinked = () => Boolean(user && localStorage.getItem(linkedKey) === user.id);
  const hasLocalData = () => Boolean(app?.hasLocalData?.());
  const setStatus = (message, tone = 'info') => {
    status = message;
    const node = document.querySelector('[data-cloud-status]');
    if (node) { node.textContent = message; node.dataset.tone = tone; }
    if (document.querySelector('#view') && document.querySelector('#page-title')?.textContent === 'Settings') refreshSettingsSoon();
  };
  const refreshSettingsSoon = () => {
    clearTimeout(panelRefreshTimer);
    panelRefreshTimer = setTimeout(() => {
      if (document.querySelector('#page-title')?.textContent === 'Settings') app?.refresh?.();
    }, 80);
  };
  const publishableKey = () => config.publishableKey || config.anonKey || '';
  const loadAuthProviders = async () => {
    try {
      const response = await fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: publishableKey() } });
      if (!response.ok) throw new Error('Provider settings are unavailable.');
      const settings = await response.json();
      googleEnabled = settings?.external?.google === true;
    } catch {
      googleEnabled = false;
    }
    refreshSettingsSoon();
  };
  const hashToken = async token => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  };
  const getCloudRow = async () => {
    if (!client || !user) throw new Error('Sign in first.');
    const { data, error } = await client.from(stateTable).select('state,updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data || null;
  };
  const writeCloudRow = async state => {
    if (!client || !user) throw new Error('Sign in first.');
    const { error } = await client.from(stateTable).upsert({ user_id: user.id, state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    const { data } = await client.from(stateTable).select('updated_at').eq('user_id', user.id).maybeSingle();
    remoteUpdatedAt = data?.updated_at || new Date().toISOString();
  };
  const applyRow = row => {
    if (!row?.state || typeof row.state !== 'object') return;
    app?.applyState?.(row.state, { readOnly: false });
    remoteUpdatedAt = row.updated_at || '';
    pendingRemote = null;
    localStorage.setItem(linkedKey, user.id);
    dirty = false;
  };
  const signInStatus = () => {
    if (!client) return 'Cloud sync is not configured in this hosted build.';
    if (!user) return 'Sign in to sync this journal across devices.';
    if (pendingRemote) return hasLocalData() ? 'This device and cloud each have journal data. Choose which copy to keep.' : 'A cloud journal is ready to use on this device.';
    if (!isLinked() && hasLocalData()) return 'This journal is still on this device. Upload it to start cloud sync.';
    return status;
  };
  const settingsMarkup = () => {
    const ready = configured() && Boolean(window.supabase?.createClient);
    const shareRows = ready && user && isLinked() ? `<div class="cloud-share-area"><div class="cloud-share-heading"><div><b>Read-only journal link</b><p>Let someone view your journal without giving them edit access.</p></div></div><form data-cloud-share-form class="cloud-share-form"><label>Link name<input name="label" maxlength="60" value="Journal viewer" required></label><label>Expires<select name="expiry"><option value="7">In 7 days</option><option value="30" selected>In 30 days</option><option value="90">In 90 days</option><option value="never">Never</option></select></label><button class="button" type="submit">Create view-only link</button></form><p class="cloud-share-warning">Anyone with the link can view all trades, account details, notes, and profile information in this journal. The link cannot edit your data. Revoke it any time.</p>${lastCreatedLink ? `<div class="cloud-created-link"><label>Copy this link now<input readonly data-created-link value="${esc(lastCreatedLink)}"></label><button class="small-btn" type="button" data-cloud-copy-link>Copy</button></div>` : ''}${linkNotice ? `<p class="cloud-inline-notice" role="status">${esc(linkNotice)}</p>` : ''}<div data-cloud-share-list class="cloud-share-list"><button class="small-btn" type="button" data-cloud-list-shares>Show active links</button></div></div>` : '';
    const googleMarkup = googleEnabled === true
      ? '<button class="button cloud-google-button" type="button" data-cloud-google>Continue with Google</button>'
      : `<p class="cloud-setup-note">${googleEnabled === false ? 'Google sign-in is not enabled for this cloud project yet.' : 'Checking available sign-in methods…'} Email sign-in is available below.</p>`;
    const signedMarkup = user ? `<div class="cloud-signed-in"><span class="cloud-avatar">${esc((user.email || 'T').slice(0,1).toUpperCase())}</span><div><b>${esc(user.email || 'Signed in')}</b><small>Private cloud account</small></div><button class="small-btn" type="button" data-cloud-sign-out>Sign out</button></div><p class="cloud-status" data-cloud-status data-tone="info">${esc(signInStatus())}</p>${pendingRemote ? `<div class="cloud-choice-row"><button class="button" type="button" data-cloud-use-remote>Use cloud copy here</button>${hasLocalData()?'<button class="button" type="button" data-cloud-upload>Replace cloud with this device</button>':''}</div>` : !isLinked() && hasLocalData() ? `<div class="cloud-choice-row"><button class="primary-button" type="button" data-cloud-upload>Upload this device to cloud</button>${pendingRemote?'<button class="button" type="button" data-cloud-use-remote>Use cloud copy here</button>':''}</div>` : `<div class="cloud-action-row"><button class="button" type="button" data-cloud-sync-now>Sync now</button></div>`}${shareRows}` : `<p class="cloud-status" data-cloud-status data-tone="info">${esc(status)}</p><div class="cloud-signin-grid">${googleMarkup}<form data-cloud-email-form class="cloud-email-form"><label>Email for a sign-in link<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label><button class="primary-button" type="submit">Email me a sign-in link</button></form></div><p class="cloud-footnote">Your journal stays private to your account. This browser will not upload its existing trades until you choose Upload.</p>`;
    const configNote = !configured() ? '<p class="cloud-setup-note">Cloud sync will appear here after the hosted build is connected to the TradeLog cloud project.</p>' : !window.supabase?.createClient ? '<p class="cloud-setup-note">The secure sync library did not load. Check your internet connection and reload.</p>' : '';
    return `<section class="card cloud-settings" id="cloud-settings"><div class="card-heading"><div><h3>Cloud sync and sharing</h3><small>Keep one private journal updated across your devices.</small></div><span class="cloud-lock-mark" aria-hidden="true">${client ? 'SYNC' : 'PRIVATE'}</span></div>${configNote}${client ? signedMarkup : ''}</section>`;
  };
  const refreshCloudRow = async ({ quiet = false } = {}) => {
    if (!client || !user || !isLinked() || readOnly || syncing) return;
    try {
      const row = await getCloudRow();
      if (!row) { setStatus('Cloud journal record is missing. Upload this device to restore it.', 'warning'); return; }
      if (row.updated_at && remoteUpdatedAt && new Date(row.updated_at) <= new Date(remoteUpdatedAt)) return;
      if (dirty) { setStatus('Cloud changed on another device. Sync is waiting for this device’s pending save.', 'warning'); return; }
      app?.applyState?.(row.state, { readOnly: false });
      remoteUpdatedAt = row.updated_at || '';
      if (!quiet) setStatus(`Updated from cloud · ${new Date(remoteUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, 'success');
    } catch (error) { if (!quiet) setStatus(`Cloud refresh failed: ${error.message}`, 'error'); }
  };
  const bootstrapUser = async () => {
    if (!client || !user || readOnly) return;
    try {
      const row = await getCloudRow();
      if (row) {
        if (isLinked()) {
          applyRow(row);
          setStatus('Cloud journal loaded · changes sync automatically.', 'success');
        } else if (!hasLocalData()) {
          applyRow(row);
          setStatus('Cloud journal loaded on this device.', 'success');
        } else {
          pendingRemote = row;
          setStatus('Choose which journal copy to use on this device.', 'warning');
        }
      } else if (isLinked()) {
        setStatus('No cloud copy was found for this account. Your local journal is unchanged.', 'warning');
      } else if (hasLocalData()) {
        setStatus('Your trades are still on this device. Upload them when you are ready.', 'info');
      } else {
        await writeCloudRow(currentState());
        localStorage.setItem(linkedKey, user.id);
        setStatus('Private cloud journal is ready. Changes sync automatically.', 'success');
      }
    } catch (error) { setStatus(`Cloud sync could not start: ${error.message}`, 'error'); }
    refreshSettingsSoon();
  };
  const uploadCurrent = async () => {
    if (!user || !client) return;
    if (pendingRemote && !window.confirm('Replace the cloud journal with the copy on this device? This overwrites the cloud copy for this account.')) return;
    try {
      dirty = false;
      await writeCloudRow(currentState());
      localStorage.setItem(linkedKey, user.id);
      pendingRemote = null;
      setStatus('Uploaded safely · future changes sync automatically.', 'success');
      app?.refresh?.();
    } catch (error) { setStatus(`Upload failed: ${error.message}`, 'error'); }
  };
  const useRemote = () => {
    if (!pendingRemote || !user) return;
    if (hasLocalData() && !window.confirm('Replace this browser’s current journal with the cloud copy? The local copy will be replaced. Export a CSV first if you need to keep it.')) return;
    applyRow(pendingRemote);
    setStatus('Cloud copy loaded on this device · future changes sync automatically.', 'success');
    app?.refresh?.();
  };
  const flush = async () => {
    if (!client || !user || !isLinked() || readOnly || !dirty || syncing) return;
    syncing = true;
    try {
      await writeCloudRow(currentState());
      dirty = false;
      setStatus('All changes saved to your cloud journal.', 'success');
    } catch (error) {
      setStatus(`Cloud save failed: ${error.message}. Your changes remain on this device.`, 'error');
    } finally { syncing = false; }
  };
  const scheduleSync = () => {
    if (!client || !user || !isLinked() || readOnly) return;
    dirty = true;
    setStatus('Saving changes to your private cloud journal…', 'info');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flush, 700);
  };
  const startSharedView = async token => {
    readOnly = true;
    document.body.classList.add('read-only-share');
    const banner = document.querySelector('#share-view-banner');
    if (banner) { banner.hidden = false; banner.innerHTML = '<b>Shared journal · view only</b><span>You can browse the journal, but changes are disabled.</span>'; }
    if (!configured() || !window.supabase?.createClient) return showShareError('This shared journal is unavailable right now. Check the connection and try again.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return showShareError('This view-only link is not valid. Ask the owner for a fresh link.');
    client = window.supabase.createClient(config.url, publishableKey(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    try {
      const tokenHash = await hashToken(token);
      const { data, error } = await client.rpc('get_shared_tradelog_state', { p_token_hash: tokenHash });
      if (error || !data || typeof data !== 'object') throw error || new Error('Link has expired or was revoked.');
      app?.applyState?.(data, { readOnly: true });
      document.querySelector('.privacy-note b')?.replaceChildren(document.createTextNode('Read-only shared journal'));
      document.querySelector('.privacy-note small')?.replaceChildren(document.createTextNode('Owner changes are not allowed'));
      if (banner) banner.innerHTML = '<b>Shared journal · view only</b><span>Updates appear when you reload. Editing is disabled.</span>';
    } catch (error) { showShareError(error.message?.includes('expired') || error.message?.includes('revoked') ? 'This view-only link has expired or was revoked. Ask the owner for a new link.' : 'Could not load the shared journal. Check your connection and try again.'); }
  };
  const showShareError = message => {
    document.body.classList.add('read-only-share');
    const view = document.querySelector('#view');
    if (view) view.innerHTML = `<section class="card cloud-share-error"><h2>Shared journal unavailable</h2><p>${esc(message)}</p></section>`;
    document.querySelector('.privacy-note b')?.replaceChildren(document.createTextNode('View-only link'));
  };
  const listShares = async () => {
    const host = document.querySelector('[data-cloud-share-list]');
    if (!host || !client || !user) return;
    host.innerHTML = '<p class="cloud-inline-notice">Loading share links…</p>';
    const { data, error } = await client.from('tradelog_shares').select('token_hash,label,created_at,expires_at,revoked_at').eq('owner_id', user.id).order('created_at', { ascending: false });
    if (error) { host.innerHTML = `<p class="cloud-inline-notice">Could not load links: ${esc(error.message)}</p>`; return; }
    if (!data?.length) { host.innerHTML = '<p class="cloud-inline-notice">No view-only links yet.</p>'; return; }
    host.innerHTML = data.map(item => {
      const expired = item.expires_at && new Date(item.expires_at) <= new Date();
      const inactive = item.revoked_at || expired;
      const statusText = item.revoked_at ? 'Revoked' : expired ? 'Expired' : item.expires_at ? `Expires ${new Date(item.expires_at).toLocaleDateString()}` : 'Never expires';
      return `<div class="cloud-share-row"><div><b>${esc(item.label)}</b><small>${esc(statusText)}</small></div>${inactive ? `<span class="muted">${item.revoked_at ? 'Revoked' : 'Expired'}</span>` : `<button class="small-btn danger" type="button" data-cloud-revoke="${esc(item.token_hash)}">Revoke</button>`}</div>`;
    }).join('');
  };
  const createShare = async form => {
    if (!user || !isLinked()) return;
    if (!window.confirm('Create a view-only link? Anyone who gets the link can see every trade, account detail, journal note, and profile field in this journal. They cannot edit it. You can revoke the link later.')) return;
    try {
      await flush();
      if (dirty) throw new Error('The latest changes have not reached the cloud yet. Try again after sync finishes.');
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const tokenHash = await hashToken(token);
      const expiry = form.elements.expiry.value;
      const expiresAt = expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * 86400000).toISOString();
      const { error } = await client.from('tradelog_shares').insert({ token_hash: tokenHash, owner_id: user.id, label: form.elements.label.value.trim() || 'Journal viewer', expires_at: expiresAt });
      if (error) throw error;
      const link = new URL(location.href);
      link.search = '';
      link.hash = '';
      link.searchParams.set('share', token);
      lastCreatedLink = link.toString();
      linkNotice = 'Link created. Copy it now; the secret part is shown only once.';
      refreshSettingsSoon();
      await listShares();
    } catch (error) { linkNotice = `Could not create a link: ${error.message}`; refreshSettingsSoon(); }
  };
  const revokeShare = async tokenHash => {
    if (!window.confirm('Revoke this view-only link? Anyone using it will lose access immediately.')) return;
    const { error } = await client.from('tradelog_shares').update({ revoked_at: new Date().toISOString() }).eq('owner_id', user.id).eq('token_hash', tokenHash);
    if (error) { linkNotice = `Could not revoke the link: ${error.message}`; refreshSettingsSoon(); return; }
    linkNotice = 'Link revoked.';
    await listShares();
  };
  const begin = async appApi => {
    app = appApi;
    const shareToken = new URLSearchParams(location.search).get('share');
    if (shareToken) return startSharedView(shareToken);
    if (!configured()) return;
    if (!window.supabase?.createClient) { status = 'Secure cloud library is unavailable. Check your internet connection.'; return; }
    client = window.supabase.createClient(config.url, publishableKey(), { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    void loadAuthProviders();
    const { data: sessionData } = await client.auth.getSession();
    user = sessionData?.session?.user || null;
    if (user) await bootstrapUser();
    app?.refresh?.();
    client.auth.onAuthStateChange((event, session) => {
      setTimeout(async () => {
        user = session?.user || null;
        pendingRemote = null;
        dirty = false;
        if (user) await bootstrapUser();
        else { localStorage.removeItem(linkedKey); setStatus('Signed out · this browser keeps its local journal copy.'); app?.refresh?.(); }
        app?.refresh?.();
      }, 0);
    });
    setInterval(() => { if (document.visibilityState === 'visible') refreshCloudRow({ quiet: true }); }, 25000);
    window.addEventListener('online', () => refreshCloudRow());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCloudRow(); });
  };
  const signInEmail = async form => {
    if (!client) return setStatus('Cloud sync is not configured yet.', 'warning');
    const email = form.elements.email.value.trim();
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] + '#settings' } });
    if (error) setStatus(`Could not send the sign-in link: ${error.message}`, 'error');
    else setStatus(`Check ${email} for your secure sign-in link.`, 'success');
  };
  const signInGoogle = async () => {
    if (!client) return setStatus('Cloud sync is not configured yet.', 'warning');
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0] + '#settings' } });
    if (error) setStatus(`Google sign-in is unavailable: ${error.message}`, 'error');
  };
  const signOut = async () => {
    await client?.auth.signOut();
    user = null;
    pendingRemote = null;
    dirty = false;
    localStorage.removeItem(linkedKey);
    setStatus('Signed out · this browser keeps its local journal copy.');
    app?.refresh?.();
  };

  document.addEventListener('submit', event => {
    if (event.target.matches('[data-cloud-email-form]')) { event.preventDefault(); signInEmail(event.target); }
    if (event.target.matches('[data-cloud-share-form]')) { event.preventDefault(); createShare(event.target); }
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-cloud-google],[data-cloud-sign-out],[data-cloud-upload],[data-cloud-use-remote],[data-cloud-sync-now],[data-cloud-list-shares],[data-cloud-revoke],[data-cloud-copy-link]');
    if (!target) return;
    if (target.matches('[data-cloud-google]')) signInGoogle();
    else if (target.matches('[data-cloud-sign-out]')) signOut();
    else if (target.matches('[data-cloud-upload]')) uploadCurrent();
    else if (target.matches('[data-cloud-use-remote]')) useRemote();
    else if (target.matches('[data-cloud-sync-now]')) { dirty = true; flush(); }
    else if (target.matches('[data-cloud-list-shares]')) listShares();
    else if (target.matches('[data-cloud-revoke]')) revokeShare(target.dataset.cloudRevoke);
    else if (target.matches('[data-cloud-copy-link]')) navigator.clipboard?.writeText(lastCreatedLink).then(() => { linkNotice = 'Link copied.'; refreshSettingsSoon(); }).catch(() => { linkNotice = 'Select and copy the link above.'; refreshSettingsSoon(); });
  });

  window.TradeLogCloud = { settingsMarkup, start: begin, scheduleSync, isReadOnly: () => readOnly, hasAccount: () => Boolean(user) };
})();

