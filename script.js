/*** Firebase ***/
const firebaseConfig = {
  apiKey: "AIzaSyAHsaBpOlvvKrhORo3F7bsMW8tflXwcEFE",
  authDomain: "yaplayer-ca754.firebaseapp.com",
  databaseURL: "https://yaplayer-ca754-default-rtdb.firebaseio.com",
  projectId: "yaplayer-ca754",
  storageBucket: "yaplayer-ca754.appspot.com",
  messagingSenderId: "70098606492",
  appId: "1:70098606492:web:bb81c8edadc194e1201059"
};
const app = firebase.initializeApp(firebaseConfig);
const database = firebase.database(app);

/*** UI boot ***/
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('save-btn').addEventListener('click', handleSavePlaylist);
  const refreshBtn = document.getElementById('refresh-exp-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    const mac = document.getElementById('display-mac').textContent;
    if (!isValidMac(mac)) return alert('MAC invalide');
    refreshAllPlaylistsExpiry(mac);
  });
  initSubscriptionUI();
});
function togglePasswordVisibility(){
  const i=document.getElementById('input-password');
  i.type=(i.type==='password')?'text':'password';
}

/*** Helpers généraux ***/
const macToKey = mac => mac.replace(/:/g,'_');
const isValidMac = mac => /^([0-9A-Fa-f]{2}[:]){5}([0-9A-Fa-f]{2})$/.test(mac);
const isPushKey  = k => /^-[-A-Za-z0-9_]{10,}$/.test(k||""); // push key Firebase
const nowMs = () => Date.now();

/*** Helpers dates (ms uniquement) ***/
function toEndOfDayMs(dateStr) {           // "YYYY-MM-DD" -> ms
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T23:59:59');
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
function addDaysMs(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23,59,59,0);
  return d.getTime();
}
function addYearsMs(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  d.setHours(23,59,59,0);
  return d.getTime();
}
function fmtDateHumanFromMs(ms) {
  const n = Number(ms);
  if (!n || Number.isNaN(n)) return '—';
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}
function toInputDateFromMs(ms) {
  const n = Number(ms);
  if (!n || Number.isNaN(n)) return '';
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10);
}

/*** Xtream helpers (exp_date -> ms) ***/
function parseXtreamUrl(url){
  if (!url || typeof url !== 'string') return null;
  try{
    const u = new URL(url);
    const protocol = (u.protocol || 'http:').replace(':','');
    const host = u.hostname;
    const port = u.port || '';
    const username = u.searchParams.get('username') || '';
    const password = u.searchParams.get('password') || '';
    if (!host || !username || !password) return null;
    return { protocol, host, port, username, password };
  }catch(_){ return null; }
}
function buildPlayerApi(creds){
  if (!creds) return '';
  const port = creds.port ? (':' + creds.port) : '';
  return `${creds.protocol||'http'}://${creds.host}${port}/player_api.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`;
}
async function fetchExpMsFromXtream(apiBase){
  try{
    const r = await fetch(apiBase);
    const j = await r.json();
    const expSec = j && j.user_info ? Number(j.user_info.exp_date) : NaN;
    return Number.isNaN(expSec) ? 0 : expSec * 1000;
  }catch(_){ return 0; }
}

/*** Écriture de l’expiration par playlist ***/
async function writePlaylistExpiry(mac, playlistId){
  const key = macToKey(mac);
  const base = database.ref(`devices/${key}`);
  const snap = await base.child(`playlists/${playlistId}`).once('value');
  const pl = snap.val() || {};
  if (!pl.url) return;

  const creds = parseXtreamUrl(pl.url);
  if (!creds) return;

  const api = buildPlayerApi(creds);
  const expMs = await fetchExpMsFromXtream(api);

  await base.child(`playlists/${playlistId}/expires_at`).set(Number(expMs) || 0);
  await base.child('metadata/last_updated').set(nowMs());
  console.log('[PlaylistExpiry] écrit', playlistId, '=>', Number(expMs)||0);
}
async function refreshAllPlaylistsExpiry(mac){
  const key = macToKey(mac);
  const listSnap = await database.ref(`devices/${key}/playlists`).once('value');
  const node = listSnap.val() || {};
  for (const id of Object.keys(node)) {
    await writePlaylistExpiry(mac, id);
  }
  alert('Expiration mise à jour sur toutes les playlists.');
}

/*** Auth ***/
async function handleLogin(){
  const mac = document.getElementById('input-mac').value.trim().toUpperCase();
  const password = document.getElementById('input-password').value.trim();
  if (!isValidMac(mac)) return alert('Format MAC invalide');
  if (!password)        return alert('Veuillez entrer un mot de passe');

  const key = macToKey(mac);
  const ref = database.ref('devices/'+key);
  const snap = await ref.once('value');

  if (snap.exists()){
    const data = snap.val();
    if (data.password !== password) return alert('Mot de passe incorrect');
    showPlaylistManager(mac);
  } else {
    // Création device + abonnement TRIAL par défaut (10 jours)
    await ref.set({
      mac, password, playlists: {},
      metadata: { created_at: nowMs(), last_updated: nowMs(), active_playlist_id: null },
      subscription: { plan: "TRIAL", trial_end: addDaysMs(10), updated_at: nowMs() }
    });
    showPlaylistManager(mac);
  }
}

/*** Manager Playlists ***/
function showPlaylistManager(mac){
  document.getElementById('display-mac').textContent = mac;
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('playlist-container').style.display = 'block';

  loadSubscription(mac);
  loadPlaylists(mac, /*attemptMigrate=*/true);
}

async function setActivePlaylist(mac, playlistId) {
  const key = macToKey(mac);
  const baseRef = database.ref(`devices/${key}`);
  const listRef = baseRef.child('playlists');

  const snap = await listRef.once('value');
  const node = snap.val() || {};
  if (!node[playlistId]) return;

  const updates = {};
  Object.keys(node).forEach(pid => {
    updates[`playlists/${pid}/active`] = (pid === playlistId);
  });
  const t = nowMs();
  updates[`metadata/active_playlist_id`] = playlistId;
  updates[`metadata/activated_at`] = t;
  updates[`metadata/last_updated`] = t;

  await baseRef.update(updates);

  // ⚠️ MAJ de l’expiration pour la playlist qui devient active
  await writePlaylistExpiry(mac, playlistId);

  await loadPlaylists(mac);
}

async function handleSavePlaylist(){
  const mac = document.getElementById('display-mac').textContent;
  const name = document.getElementById('playlist-name').value.trim();
  const url  = document.getElementById('playlist-url').value.trim();
  if (!name) return alert('Nom requis');
  if (!url)  return alert('URL requise');

  const key = macToKey(mac);
  const baseRef = database.ref(`devices/${key}`);
  const listRef = baseRef.child('playlists');

  const allSnap = await listRef.once('value');
  const already = allSnap.val() || {};
  const hasActive = Object.values(already).some(p => p && p.active === true);

  const newRef  = listRef.push(); // clé unique
  const payload = { id: newRef.key, name, url, created_at: new Date().toISOString(), active: false };
  await newRef.set(payload);

  if (!hasActive) {
    // 1ère playlist → active + MAJ expiration
    await setActivePlaylist(mac, newRef.key);
  } else {
    await baseRef.child('metadata/last_updated').set(nowMs());
    // MAJ expiration tout de suite pour la playlist ajoutée
    await writePlaylistExpiry(mac, newRef.key);
  }

  document.getElementById('playlist-name').value = '';
  document.getElementById('playlist-url').value = '';
  alert('Playlist enregistrée');
}

async function migrateOldPlaylistsIfNeeded(mac){
  const key = macToKey(mac);
  const listRef = database.ref(`devices/${key}/playlists`);
  const snap = await listRef.once('value');
  const node = snap.val();
  if (!node) return false;

  let migrated = 0;
  for (const oldKey of Object.keys(node)){
    if (isPushKey(oldKey)) continue; // déjà ID
    const val = node[oldKey];
    const url = (val && (val.url || val.playlist_url)) || null;
    if (!url) continue;

    const name = (val && (val.name || val.playlist_name)) || oldKey;
    const newRef = listRef.push();
    const payload = {
      id: newRef.key, name, url,
      created_at: (val && val.created_at) || new Date().toISOString(),
      active: !!val.active
    };
    await newRef.set(payload);
    await listRef.child(oldKey).remove();

    // MAJ expiration pour la playlist migrée
    await writePlaylistExpiry(mac, newRef.key);

    migrated++;
  }
  if (migrated > 0){
    await database.ref(`devices/${key}/metadata/last_updated`).set(nowMs());
    console.log(`✅ Migration: ${migrated} item(s) converti(s) en clés ID.`);
  }
  return migrated > 0;
}

async function ensureOneActiveIfMissing(mac){
  const key = macToKey(mac);
  const baseRef = database.ref(`devices/${key}`);
  const listSnap = await baseRef.child('playlists').once('value');
  const node = listSnap.val() || {};
  const ids = Object.keys(node);
  if (ids.length === 0) return;

  const alreadyActive = ids.find(id => node[id] && node[id].active === true);
  if (alreadyActive) {
    const metaSnap = await baseRef.child('metadata').once('value');
    const meta = metaSnap.val() || {};
    if (meta.active_playlist_id !== alreadyActive) {
      await baseRef.child('metadata').update({
        active_playlist_id: alreadyActive,
        activated_at: nowMs(),
        last_updated: nowMs()
      });
    }
    return;
  }

  const oldest = ids
    .map(id => ({ id, t: node[id].created_at || '' }))
    .sort((a,b)=> new Date(a.t) - new Date(b.t))[0].id;

  await setActivePlaylist(mac, oldest);
}

async function loadPlaylists(mac, attemptMigrate=false){
  const key = macToKey(mac);
  const container = document.getElementById('existing-playlists');
  container.innerHTML = '<h3>Vos playlists</h3>';

  if (attemptMigrate){
    await migrateOldPlaylistsIfNeeded(mac);
  }
  await ensureOneActiveIfMissing(mac);

  const baseRef = database.ref(`devices/${key}`);
  const snap = await baseRef.child('playlists').once('value');
  const playlists = snap.val() || {};

  const items = Object.values(playlists).map(p => ({
    id: p.id || '',
    name: p.name || '(sans nom)',
    url: p.url || '',
    created_at: p.created_at || '',
    active: !!p.active
  })).sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));

  if (items.length === 0) {
    container.innerHTML += '<p>Aucune playlist</p>';
    return;
  }

  items.forEach(p=>{
    const el = document.createElement('div');
    el.className = 'playlist-item';
    el.innerHTML = `
      <h4>${p.name} ${p.active ? '<span style="color:#0a7">• active</span>' : ''}</h4>
      <p style="word-break:break-all">URL: ${p.url}</p>
      <small>ID: <code>${p.id}</code> — Créée: ${p.created_at ? new Date(p.created_at).toLocaleString() : '-'}</small>
      <div class="playlist-actions">
        ${p.active ? '' : `<button onclick="setActivePlaylist('${mac}','${p.id}')">Définir active</button>`}
        <button class="secondary" onclick="deletePlaylist('${mac}','${p.id}')">Supprimer</button>
      </div>`;
    container.appendChild(el);
  });
}

async function deletePlaylist(mac, playlistId){
  if (!confirm('Supprimer cette playlist ?')) return;
  const key  = macToKey(mac);
  const base = database.ref(`devices/${key}`);
  const listRef = base.child('playlists');

  const snap = await listRef.once('value');
  const node = snap.val() || {};
  const target = node[playlistId];
  if (!target) return;

  const wasActive = !!target.active;
  await listRef.child(playlistId).remove();

  const remainingSnap = await listRef.once('value');
  const remaining = remainingSnap.val() || {};
  const ids = Object.keys(remaining);

  if (ids.length === 0) {
    await base.child('metadata').update({
      active_playlist_id: null,
      last_updated: nowMs()
    });
  } else if (wasActive) {
    const nextId = ids
      .map(id => ({ id, t: remaining[id].created_at || '' }))
      .sort((a,b)=> new Date(a.t) - new Date(b.t))[0].id;
    await setActivePlaylist(mac, nextId);
  } else {
    await base.child('metadata/last_updated').set(nowMs());
  }

  await loadPlaylists(mac);
  alert('Playlist supprimée');
}

/*** Abonnement : UI & Firebase (bloc minimal, en ms) ***/
function initSubscriptionUI() {
  const sel     = document.getElementById('sub-plan');
  const tBox    = document.getElementById('trial-fields');
  const pBox    = document.getElementById('paid-fields');
  const tInput  = document.getElementById('trial-end-date');
  const eInput  = document.getElementById('expires-at-date');
  const lblPlan = document.getElementById('sub-plan-label');
  const lblEnd  = document.getElementById('sub-end-label');

  const trial10 = document.getElementById('btn-trial-10d');
  const year1   = document.getElementById('btn-yearly-1y');
  const saveBtn = document.getElementById('sub-save-btn');

  function updateVisibility() {
    const val = (sel.value || 'TRIAL').toUpperCase();
    tBox.style.display = (val === 'TRIAL')  ? 'block' : 'none';
    pBox.style.display = (val === 'YEARLY') ? 'block' : 'none';
    if (val === 'LIFETIME') { tBox.style.display = 'none'; pBox.style.display = 'none'; }
  }

  sel.addEventListener('change', () => {
    lblPlan.textContent = sel.value;
    updateVisibility();
  });

  trial10.addEventListener('click', (e) => {
    e.preventDefault();
    const ms = addDaysMs(10);
    tInput.value = toInputDateFromMs(ms);
    lblEnd.textContent = fmtDateHumanFromMs(ms);
  });

  year1.addEventListener('click', (e) => {
    e.preventDefault();
    const ms = addYearsMs(1);
    eInput.value = toInputDateFromMs(ms);
    lblEnd.textContent = fmtDateHumanFromMs(ms);
  });

  saveBtn.addEventListener('click', async () => {
    const mac = document.getElementById('display-mac').textContent;
    if (!isValidMac(mac)) return alert('MAC invalide (session).');

    const plan = (sel.value || 'TRIAL').toUpperCase();
    const payload = { plan, updated_at: nowMs() };

    if (plan === 'TRIAL') {
      const chosen = toEndOfDayMs(tInput.value) || addDaysMs(10);
      payload.trial_end = chosen;
      payload.expires_at = 0;
    } else if (plan === 'YEARLY') {
      const chosen = toEndOfDayMs(eInput.value) || addYearsMs(1);
      payload.expires_at = chosen;
      delete payload.trial_end;
    } else if (plan === 'LIFETIME') {
      delete payload.trial_end;
      payload.expires_at = 0;
    }

    const ok = await saveSubscription(mac, payload);
    if (ok) {
      document.getElementById('sub-plan-label').textContent = payload.plan;
      document.getElementById('sub-end-label').textContent =
        fmtDateHumanFromMs(payload.trial_end || payload.expires_at || 0);
      alert('Abonnement enregistré');
    }
  });

  updateVisibility();
}

async function saveSubscription(mac, payload){
  try{
    const key = macToKey(mac);
    await database.ref(`devices/${key}/subscription`).set(payload);
    await database.ref(`devices/${key}/metadata/last_updated`).set(nowMs());
    return true;
  }catch(e){
    console.warn('[saveSubscription] fail', e);
    alert('Erreur sauvegarde abonnement');
    return false;
  }
}

async function loadSubscription(mac) {
  const key = macToKey(mac);
  const ref = database.ref(`devices/${key}/subscription`);
  const snap = await ref.once('value');
  const data = snap.val() || {};

  const sel     = document.getElementById('sub-plan');
  const tInput  = document.getElementById('trial-end-date');
  const eInput  = document.getElementById('expires-at-date');
  const lblPlan = document.getElementById('sub-plan-label');
  const lblEnd  = document.getElementById('sub-end-label');

  const plan = (data.plan || 'TRIAL').toUpperCase();
  sel.value = plan;
  lblPlan.textContent = plan;

  if (plan === 'TRIAL') {
    const ms = (typeof data.trial_end === 'number' ? data.trial_end : addDaysMs(10));
    tInput.value = toInputDateFromMs(ms);
    lblEnd.textContent = fmtDateHumanFromMs(ms);
    document.getElementById('trial-fields').style.display = 'block';
    document.getElementById('paid-fields').style.display  = 'none';
  } else if (plan === 'YEARLY') {
    const ms = (typeof data.expires_at === 'number' && data.expires_at > 0) ? data.expires_at : addYearsMs(1);
    eInput.value = toInputDateFromMs(ms);
    lblEnd.textContent = fmtDateHumanFromMs(ms);
    document.getElementById('trial-fields').style.display = 'none';
    document.getElementById('paid-fields').style.display  = 'block';
  } else {
    lblEnd.textContent = '—';
    document.getElementById('trial-fields').style.display = 'none';
    document.getElementById('paid-fields').style.display  = 'none';
  }
}
