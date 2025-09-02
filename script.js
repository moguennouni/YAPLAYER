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

/*** UI ***/
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('save-btn').addEventListener('click', handleSavePlaylist);

  // Subscription UI init
  initSubscriptionUI();
});
function togglePasswordVisibility(){const i=document.getElementById('input-password');i.type=(i.type==='password')?'text':'password';}

/*** Helpers ***/
const macToKey = mac => mac.replace(/:/g,'_');
const isValidMac = mac => /^([0-9A-Fa-f]{2}[:]){5}([0-9A-Fa-f]{2})$/.test(mac);
const isPushKey  = k => /^-[-A-Za-z0-9_]{10,}$/.test(k||""); // push key Firebase

// === Helpers dates en millisecondes ===
function toEndOfDayMs(dateStr) {
  if (!dateStr) return null; // "YYYY-MM-DD"
  const d = new Date(dateStr + 'T23:59:59');
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime(); // nombre
}
function addDaysMs(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 0);
  return d.getTime(); // nombre
}
function addYearsMs(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  d.setHours(23, 59, 59, 0);
  return d.getTime(); // nombre
}
function fmtDateHumanFromMs(ms) {
  if (!ms || Number.isNaN(Number(ms))) return '—';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}
function toInputDateFromMs(ms) {
  if (!ms || Number.isNaN(Number(ms))) return '';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/* === Sync expiration dans la PLAYLIST ACTIVE (RTDB) === */
async function syncActivePlaylistExpiration(mac){
  const key = mac.replace(/:/g,'_');
  const baseRef = database.ref(`devices/${key}`);

  // 1) Récupérer l'ID de la playlist active + son URL
  const metaSnap = await baseRef.child('metadata').once('value');
  const meta = metaSnap.val() || {};
  const activeId = meta.active_playlist_id;

  const listSnap = await baseRef.child('playlists').once('value');
  const playlists = listSnap.val() || {};

  const active = activeId && playlists[activeId] ? playlists[activeId] : null;
  if (!active || !active.url) return; // rien à faire

  // 2) Appeler Xtream pour récupérer exp_date (en secondes)
  const creds = parseXtreamUrl(active.url);
  if (!creds) return;

  const apiBase = buildPlayerApi(creds); // .../player_api.php?username=...&password=...
  const { expMs } = await fetchXtreamAccountInfo(apiBase); // expMs = exp_date * 1000 (ou NaN)
  const expiresAtMs = (typeof expMs === 'number' && !Number.isNaN(expMs) && expMs > 0) ? expMs : 0;

  // 3) Écrire dans la playlist elle-même
  const updates = {};
  updates[`playlists/${activeId}/expires_at`] = Number(expiresAtMs);
  updates[`metadata/last_updated`] = Date.now();
  await baseRef.update(updates);

  console.log('[PlaylistExpiration] OK:', { activeId, expires_at: Number(expiresAtMs) });
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
    _postLoginAfterCreate(mac);
  } else {
    // Création device + abonnement TRIAL par défaut (10 jours)
    const now = Date.now();
    const trialEnd = addDaysISO(10);
await ref.set({
  mac, password, playlists: {},
  metadata: { created_at: Date.now(), last_updated: Date.now(), active_playlist_id: null },
  subscription: {
    plan: "TRIAL",
    trial_end: addDaysMs(10),   // nombre
    updated_at: Date.now()      // nombre
  }
});

    showPlaylistManager(mac);
    await syncActivePlaylistExpiration(mac);
  }
}

function showPlaylistManager(mac){
  document.getElementById('display-mac').textContent = mac;
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('playlist-container').style.display = 'block';

  // Charger abonnement + playlists
  loadSubscription(mac);
  loadPlaylists(mac, /*attemptMigrate=*/true);
  _postShowPlaylist(mac);
  syncActivePlaylistExpiration(mac);
}
  
/*** Règles “active” ***/
// 1ère playlist créée => active
// Supprimer l’active => la plus ancienne devient active
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
  const now = Date.now();
  updates[`metadata/active_playlist_id`] = playlistId;
  updates[`metadata/activated_at`] = now;
  updates[`metadata/last_updated`] = now;

  await baseRef.update(updates);
  await _postSetActivePlaylist(mac);
  await syncActivePlaylistExpiration(mac);
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

  const newRef  = listRef.push(); // => ID unique
  const payload = {
    id: newRef.key,
    name, url,
    created_at: new Date().toISOString(),
    active: false
  };
  await newRef.set(payload);

  if (!hasActive) {
    await setActivePlaylist(mac, newRef.key); // 1ère => active
  } else {
    await baseRef.child('metadata/last_updated').set(Date.now());
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
    migrated++;
  }
  if (migrated > 0){
    await database.ref(`devices/${key}/metadata/last_updated`).set(Date.now());
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
        activated_at: Date.now(),
        last_updated: Date.now()
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
      last_updated: Date.now()
    });
  } else if (wasActive) {
    const nextId = ids
      .map(id => ({ id, t: remaining[id].created_at || '' }))
      .sort((a,b)=> new Date(a.t) - new Date(b.t))[0].id;
    await setActivePlaylist(mac, nextId);
  } else {
    await base.child('metadata/last_updated').set(Date.now());
  }

  await loadPlaylists(mac);
  alert('Playlist supprimée');
}

/*** ===== Abonnement : UI & Firebase ===== ***/
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
    const payload = { plan, updated_at: Date.now() }; // nombres

    if (plan === 'TRIAL') {
      const chosen = toEndOfDayMs(tInput.value) || addDaysMs(10);
      payload.trial_end = chosen;        // nombre
      // nettoie l’autre champ si présent
      payload.expires_at = 0;            // tu as déjà 0 en base → passe validation
    } else if (plan === 'YEARLY') {
      const chosen = toEndOfDayMs(eInput.value) || addYearsMs(1);
      payload.expires_at = chosen;       // nombre
      // nettoie l’autre champ
      delete payload.trial_end;
    } else if (plan === 'LIFETIME') {
      // pas d’échéance → supprime ou mets 0
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
    // LIFETIME
    lblEnd.textContent = '—';
    document.getElementById('trial-fields').style.display = 'none';
    document.getElementById('paid-fields').style.display  = 'none';
  }
}


async function loadSubscription(mac){
  const key = macToKey(mac);
  const ref = database.ref(`devices/${key}/subscription`);
  const snap = await ref.once('value');
  const data = snap.val();

  const sel  = document.getElementById('sub-plan');
  const tInp = document.getElementById('trial-end-date');
  const eInp = document.getElementById('expires-at-date');
  const lblPlan = document.getElementById('sub-plan-label');
  const lblEnd  = document.getElementById('sub-end-label');

  if (!data){
    // Valeurs par défaut si pas encore configuré
    sel.value = 'TRIAL';
    const iso = addDaysISO(10);
    tInp.value = new Date(iso).toISOString().slice(0,10);
    lblPlan.textContent = 'TRIAL';
    lblEnd.textContent  = fmtDateHuman(iso);
    // UI visibilité
    document.getElementById('trial-fields').style.display = 'block';
    document.getElementById('paid-fields').style.display  = 'none';
    return;
  }

  const plan = (data.plan || 'TRIAL').toUpperCase();
  sel.value = plan;
  lblPlan.textContent = plan;

  if (plan === 'TRIAL'){
    const iso = data.trial_end || addDaysISO(10);
    tInp.value = new Date(iso).toISOString().slice(0,10);
    lblEnd.textContent = fmtDateHuman(iso);
    document.getElementById('trial-fields').style.display = 'block';
    document.getElementById('paid-fields').style.display  = 'none';
  } else if (plan === 'YEARLY'){
    const iso = data.expires_at || addYearsISO(1);
    eInp.value = new Date(iso).toISOString().slice(0,10);
    lblEnd.textContent = fmtDateHuman(iso);
    document.getElementById('trial-fields').style.display = 'none';
    document.getElementById('paid-fields').style.display  = 'block';
  } else {
    // LIFETIME
    lblEnd.textContent = '—';
    document.getElementById('trial-fields').style.display = 'none';
    document.getElementById('paid-fields').style.display  = 'none';
  }
}

/* ============================================================
 * YAPlayer (page web externe) — Sync abonnement Xtream → Firebase
 * À coller dans script.js (en bas du fichier, ou après tes helpers)
 * ============================================================ */

/* ---- Helpers généraux ---- */
function _macToKey(mac){ return mac.replace(/:/g,'_'); }
function _isNonEmpty(s){ return typeof s === 'string' && s.trim() !== ''; }
function _now(){ return Date.now(); }

/* ---- Parse d'une URL Xtream pour extraire {protocol,host,port,username,password} ----
   Gère les formes:
   - http(s)://host[:port]/get.php?username=U&password=P&type=m3u
   - http(s)://host[:port]/player_api.php?username=U&password=P
   - http(s)://host[:port]/?username=U&password=P&...
*/
function parseXtreamUrl(url){
  if (!_isNonEmpty(url)) return null;
  try{
    const u = new URL(url);
    const protocol = u.protocol.replace(':','') || 'http';
    const host = u.hostname;
    // Si pas de port dans l'URL → garder vide (côté TV tu forces un défaut)
    const port = u.port || '';
    const username = u.searchParams.get('username') || '';
    const password = u.searchParams.get('password') || '';
    if (!_isNonEmpty(host) || !_isNonEmpty(username) || !_isNonEmpty(password)) return null;
    return { protocol, host, port, username, password };
  }catch(_){ return null; }
}

/* ---- Construit l'URL player_api.php de base ---- */
function buildPlayerApi(creds){
  if (!creds) return '';
  const port = _isNonEmpty(creds.port) ? (':' + creds.port) : '';
  return `${creds.protocol || 'http'}://${creds.host}${port}/player_api.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`;
}

/* ---- Lit user_info (exp_date en secondes) ---- */
async function fetchXtreamAccountInfo(apiBase){
  try{
    const res = await fetch(apiBase);
    const data = await res.json();
    const ui = (data && data.user_info) || {};
    const expSec = ui.exp_date ? Number(ui.exp_date) : NaN; // souvent secondes UNIX
    const expMs  = isNaN(expSec) ? NaN : expSec * 1000;
    return { expMs };
  }catch(_){
    return { expMs: NaN };
  }
}

/* ---- Récupère l'URL de la playlist active (RTDB) ---- */
async function getActivePlaylistUrlFromDB(mac){
  const key = _macToKey(mac);
  const baseRef = database.ref(`devices/${key}`);
  const snap = await baseRef.child('playlists').once('value');
  const node = snap.val() || {};
  let active = null;

  // priorité au flag active === true
  Object.keys(node).forEach(id => {
    if (node[id] && node[id].active) active = node[id];
  });
  if (!active){
    // fallback: la plus ancienne
    const arr = Object.values(node).sort((a,b)=> new Date(a.created_at||0) - new Date(b.created_at||0));
    if (arr.length) active = arr[0];
  }
  return active && active.url ? String(active.url) : null;
}

/* ---- Déduction du plan selon expMs ----
   - expMs valide → YEARLY (car fourni par Xtream pour les comptes à durée)
   - expMs manquant/0/NaN → LIFETIME (ou on laisse le plan existant si besoin)
*/
function inferPlanFromExpMs(expMs, existingPlan){
  if (typeof expMs === 'number' && !Number.isNaN(expMs) && expMs > 0) return 'YEARLY';
  // si on veut préserver un TRIAL actif côté web, décommente:
  // if ((existingPlan||'').toUpperCase() === 'TRIAL') return 'TRIAL';
  return 'LIFETIME';
}

/* ---- Écrit subscription dans Firebase (RTDB) ----
   Respecte tes rules: nombres uniquement pour trial_end/expires_at/updated_at
*/
async function writeSubscription(mac, patch){
  const key = _macToKey(mac);
  const ref = database.ref(`devices/${key}/subscription`);
  // lecture du plan existant pour ne pas écraser un TRIAL en cours si tu veux
  const existing = (await ref.once('value')).val() || {};
  const plan = patch.plan || existing.plan || 'TRIAL';

  const toWrite = {
    plan: plan,                                  // "TRIAL" | "YEARLY" | "LIFETIME"
    trial_end: Number(existing.trial_end || 0),  // on ne le touche pas ici
    expires_at: Number(patch.expires_at || 0),   // nombre (ms)
    updated_at: _now()
  };
  await ref.set(toWrite);
}

/* ---- Sync principal: à appeler après login / setActivePlaylist ---- */
async function syncSubscriptionFromXtream(mac){
  try{
    const url = await getActivePlaylistUrlFromDB(mac);
    if (!url) return; // pas de playlist active → rien à faire

    const creds = parseXtreamUrl(url);
    if (!creds) return;

    const apiBase = buildPlayerApi(creds);
    const { expMs } = await fetchXtreamAccountInfo(apiBase);

    // expMs valide => YEARLY ; sinon LIFETIME (ou garder TRIAL si tu préfères)
    const snap = await database.ref(`devices/${_macToKey(mac)}/subscription`).once('value');
    const existingPlan = (snap.val() && snap.val().plan) || 'TRIAL';
    const plan = inferPlanFromExpMs(expMs, existingPlan);

    await writeSubscription(mac, { plan, expires_at: (Number(expMs) || 0) });
    console.log('[SubscriptionSync] OK:', { plan, expires_at: Number(expMs)||0 });
  }catch(e){
    console.warn('[SubscriptionSync] échec', e);
  }
}

/* ============================================================
 * INTÉGRATION AUX FLUX EXISTANTS
 * ============================================================ */

/* 1) Après création d’un device (login), tu avais:
      - création TRIAL 10 jours
   On garde tel quel, mais on enlève l’appel inexistant à addDaysISO.
   → Appelle ensuite le sync pour surcharger avec l’info Xtream si dispo.
*/
async function _postLoginAfterCreate(mac){
  try { await syncSubscriptionFromXtream(mac); } catch(_) {}
}

/* 2) Appeler après showPlaylistManager(mac) pour rafraîchir l’abonnement
      (la playlist active peut avoir changé entre-temps) */
async function _postShowPlaylist(mac){
  try { await syncSubscriptionFromXtream(mac); } catch(_) {}
}

/* 3) Appeler après setActivePlaylist(mac, playlistId) */
async function _postSetActivePlaylist(mac){
  try { await syncSubscriptionFromXtream(mac); } catch(_) {}
}

/* ============================================================
 * HOOKS (à placer là où tu as déjà ces appels)
 *  - Après login: une fois showPlaylistManager(mac) appelé, enchaîne _postShowPlaylist(mac)
 *  - Après setActivePlaylist: enchaîne _postSetActivePlaylist(mac)
 * ============================================================ */
// Exemple d’usage (si tes fonctions sont dans le même scope) :
//   -> à la fin de showPlaylistManager(mac):
//       _postShowPlaylist(mac);
//   -> à la fin de setActivePlaylist(mac, playlistId):
//       await setActivePlaylist(mac, playlistId);
//       await _postSetActivePlaylist(mac);


async function saveSubscription(mac, payload) {
  const key = macToKey(mac);
  const ref = database.ref(`devices/${key}/subscription`);
  try {
    await ref.set(payload);
    return true;
  } catch (e) {
    console.error('[SUB] Echec saveSubscription:', e);
    alert('Erreur enregistrement abonnement: ' + (e && e.message ? e.message : e));
    return false;
  }
}

