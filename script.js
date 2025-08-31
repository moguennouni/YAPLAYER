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

/*** Playlists CRUD ***/
async function handleSavePlaylist(){
  const mac = document.getElementById('display-mac').textContent;
  const name = document.getElementById('playlist-name').value.trim();
  const url  = document.getElementById('playlist-url').value.trim();
  if (!name) return alert('Nom requis');
  if (!url)  return alert('URL requise');

  const key = macToKey(mac);
  const listRef = database.ref(`devices/${key}/playlists`);
  const newRef  = listRef.push();                  // => ID unique
  const playlist = {
    id: newRef.key,                                // <-- on écrit l'ID dans l'objet
    name, url,
    created_at: new Date().toISOString()
  };
  await newRef.set(playlist);                      // <-- clé = ID
  await database.ref(`devices/${key}/metadata/last_updated`).set(Date.now());

  document.getElementById('playlist-name').value = '';
  document.getElementById('playlist-url').value = '';
  await loadPlaylists(mac);
  alert('Playlist enregistrée');
}

/** Migration: convertit les anciennes clés (noms) -> nouvelles clés (IDs) */
async function migrateOldPlaylistsIfNeeded(mac){
  const key = macToKey(mac);
  const listRef = database.ref(`devices/${key}/playlists`);
  const snap = await listRef.once('value');
  const node = snap.val();
  if (!node) return false;

  let migrated = 0;
  // Détecter entrées avec clé non pushKey (ex: "Amiraaaaa")
  for (const oldKey of Object.keys(node)){
    if (isPushKey(oldKey)) continue; // déjà OK
    const val = node[oldKey];
    // on cherche une URL pour qualifier une vraie playlist
    const url = (val && (val.url || val.playlist_url)) || null;
    if (!url) continue;

    const name = (val && (val.name || val.playlist_name)) || oldKey;
    const newRef = listRef.push(); // nouvelle clé = ID
    const payload = {
      id: newRef.key,
      name,
      url,
      created_at: (val && val.created_at) || new Date().toISOString()
    };
    await newRef.set(payload);
    await listRef.child(oldKey).remove(); // supprimer l'ancienne entrée
    migrated++;
  }

  if (migrated > 0){
    await database.ref(`devices/${key}/metadata/last_updated`).set(Date.now());
    console.log(`✅ Migration playlists → ${migrated} élément(s) converti(s) en clés ID.`);
  }
  return migrated > 0;
}

async function loadPlaylists(mac, attemptMigrate=false){
  const key = macToKey(mac);
  const container = document.getElementById('existing-playlists');
  container.innerHTML = '<h3>Vos playlists</h3>';

  // Tentative de migration si on vient d’ouvrir le manager (1er passage)
  if (attemptMigrate){
    await migrateOldPlaylistsIfNeeded(mac);
  }

  const snap = await database.ref(`devices/${key}/playlists`).once('value');
  const playlists = snap.val();
  if (!playlists){ container.innerHTML += '<p>Aucune playlist</p>'; return; }

  Object.entries(playlists).forEach(([nodeKey, p])=>{
    // NodeKey = la clé Firebase (doit être un ID push après migration)
    const pid   = p && (p.id || p._id || p.key || p.uid) || nodeKey;
    const name  = (p && (p.name || p.playlist_name)) || '(sans nom)';
    const url   = (p && (p.url  || p.playlist_url))  || '';

    const el = document.createElement('div');
    el.className = 'playlist-item';
    el.innerHTML = `
      <h4>${name}</h4>
      <p style="word-break:break-all">URL: ${url}</p>
      <small>ID: <code>${pid}</code></small>
      <div class="playlist-actions">
        <button class="secondary" onclick="editPlaylist('${pid}','${escapeQuotes(name)}','${escapeQuotes(url)}')">Modifier</button>
        <button class="secondary" onclick="deletePlaylist('${mac}','${pid}')">Supprimer</button>
      </div>`;
    container.appendChild(el);
  });
}

function escapeQuotes(s){return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');}

function editPlaylist(id, name, url){
  document.getElementById('playlist-name').value = name;
  document.getElementById('playlist-url').value  = url;
  alert(`Le formulaire est prérempli. Après modification, cliquez "Enregistrer" pour créer une nouvelle entrée.\n(ID playlist: ${id})`);
}

async function deletePlaylist(mac, playlistId){
  if (!confirm('Supprimer cette playlist ?')) return;
  const key = macToKey(mac);
  const ref = database.ref(`devices/${key}/playlists/${playlistId}`);
  await ref.remove();
  await database.ref(`devices/${key}/metadata/last_updated`).set(Date.now());
  loadPlaylists(mac);
  alert('Playlist supprimée');
}
