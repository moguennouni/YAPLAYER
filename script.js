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
});
function togglePasswordVisibility(){const i=document.getElementById('input-password');i.type=(i.type==='password')?'text':'password';}

/*** Helpers ***/
const macToKey = mac => mac.replace(/:/g,'_');
const isValidMac = mac => /^([0-9A-Fa-f]{2}[:]){5}([0-9A-Fa-f]{2})$/.test(mac);
const isPushKey  = k => /^-[-A-Za-z0-9_]{10,}$/.test(k||""); // style Firebase push key

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
    await ref.set({
      mac, password, playlists: {},
      metadata:{ created_at: Date.now(), last_updated: Date.now() }
    });
    showPlaylistManager(mac);
  }
}

function showPlaylistManager(mac){
  document.getElementById('display-mac').textContent = mac;
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('playlist-container').style.display = 'block';
  loadPlaylists(mac, /*attemptMigrate=*/true);
}

/*** Règles "active" ***/
// - La première playlist créée devient active
// - Ajouter d'autres playlists ne change rien au statut actif courant
// - Supprimer la playlist active => la suivante la plus ancienne devient active
async function setActivePlaylist(mac, playlistId) {
  const key = macToKey(mac);
  const baseRef = database.ref(`devices/${key}`);
  const listRef = baseRef.child('playlists');

  const snap = await listRef.once('value');
  const node = snap.val() || {};

  if (!node[playlistId]) return;

  const updates = {};
  // tout passer à false
  Object.keys(node).forEach(pid => {
    updates[`playlists/${pid}/active`] = (pid === playlistId);
  });
  // méta
  const now = Date.now();
  updates[`metadata/active_playlist_id`] = playlistId;
  updates[`metadata/activated_at`] = now;
  updates[`metadata/last_updated`] = now;

  await baseRef.update(updates);
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
  const exists = allSnap.exists();
  const hasActive = exists && Object.values(allSnap.val()||{}).some(p => p && p.active === true);

  // création playlist
  const newRef  = listRef.push(); // => ID unique
  const nowIso = new Date().toISOString();
  const payload = {
    id: newRef.key,
    name, url,
    created_at: nowIso,
    active: false // sera activée uniquement si c'est la toute première
  };
  await newRef.set(payload);

  // si c'est la première playlist => elle devient active
  if (!hasActive) {
    await setActivePlaylist(mac, newRef.key);
  } else {
    // Sinon on met juste à jour last_updated
    await baseRef.child('metadata/last_updated').set(Date.now());
  }

  // UI
  document.getElementById('playlist-name').value = '';
  document.getElementById('playlist-url').value = '';
  await loadPlaylists(mac);
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
    if (isPushKey(oldKey)) continue;
    const val = node[oldKey];
    const url = (val && (val.url || val.playlist_url)) || null;
    if (!url) continue;

    const name = (val && (val.name || val.playlist_name)) || oldKey;
    const newRef = listRef.push();
    const payload = {
      id: newRef.key,
      name,
      url,
      created_at: (val && val.created_at) || new Date().toISOString(),
      active: !!val.active // si ancien avait un flag actif, on le propage
    };
    await newRef.set(payload);
    await listRef.child(oldKey).remove();
    migrated++;
  }

  if (migrated > 0){
    await database.ref(`devices/${key}/metadata/last_updated`).set(Date.now());
    console.log(`✅ Migration → ${migrated} élément(s) converti(s) en clés ID.`);
  }
  return migrated > 0;
}

async function loadPlaylists(mac, attemptMigrate=false){
  const key = macToKey(mac);
  const container = document.getElementById('existing-playlists');
  container.innerHTML = '<h3>Vos playlists</h3>';

  if (attemptMigrate){
    await migrateOldPlaylistsIfNeeded(mac);
  }

  const baseRef = database.ref(`devices/${key}`);
  const snap = await baseRef.child('playlists').once('value');
  const playlists = snap.val();

  if (!playlists){ container.innerHTML += '<p>Aucune playlist</p>'; return; }

  // afficher par ordre chronologique (created_at asc)
  const items = Object.values(playlists).map(p => ({
    id: p.id || '',
    name: p.name || '(sans nom)',
    url: p.url || '',
    created_at: p.created_at || '',
    active: !!p.active
  })).sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));

  items.forEach(p=>{
    const el = document.createElement('div');
    el.className = 'playlist-item';
    el.innerHTML = `
      <h4>${p.name} ${p.active ? '<span style="color:#0a7">• active</span>' : ''}</h4>
      <p style="word-break:break-all">URL: ${p.url}</p>
      <small>ID: <code>${p.id}</code> — Créée le: ${p.created_at ? new Date(p.created_at).toLocaleString() : '-'}</small>
      <div class="playlist-actions">
        ${p.active ? '' : `<button onclick="setActivePlaylist('${mac}','${p.id}')">Définir active</button>`}
        <button class="secondary" onclick="deletePlaylist('${mac}','${p.id}')">Supprimer</button>
      </div>`;
    container.appendChild(el);
  });

  // synchroniser metadata.active_playlist_id si manquant
  const metaSnap = await baseRef.child('metadata').once('value');
  const meta = metaSnap.val() || {};
  const currentActive = items.find(p=>p.active);
  if (currentActive && meta.active_playlist_id !== currentActive.id) {
    await baseRef.child('metadata').update({
      active_playlist_id: currentActive.id,
      activated_at: Date.now(),
      last_updated: Date.now()
    });
  }
}

async function deletePlaylist(mac, playlistId){
  if (!confirm('Supprimer cette playlist ?')) return;
  const key  = macToKey(mac);
  const base = database.ref(`devices/${key}`);
  const listRef = base.child('playlists');

  // 1) récupérer toutes les playlists pour savoir si celle-ci est active
  const snap = await listRef.once('value');
  const node = snap.val() || {};
  const target = node[playlistId];
  if (!target) return;

  const wasActive = !!target.active;
  await listRef.child(playlistId).remove();

  // 2) si on a supprimé l’active → promouvoir la plus ancienne restante
  const remainingSnap = await listRef.once('value');
  const remaining = remainingSnap.val() || {};
  const ids = Object.keys(remaining);

  if (ids.length === 0) {
    await base.child('metadata').update({
      active_playlist_id: null,
      last_updated: Date.now()
    });
  } else if (wasActive) {
    // trouve la plus ancienne (created_at asc)
    const ordered = ids
      .map(id => ({ id, created_at: remaining[id].created_at || '' }))
      .sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));
    const nextId = ordered[0].id;
    await setActivePlaylist(mac, nextId);
  } else {
    await base.child('metadata/last_updated').set(Date.now());
  }

  await loadPlaylists(mac);
  alert('Playlist supprimée');
}
