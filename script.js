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
  loadPlaylists(mac);
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
  const newRef  = listRef.push(); // => id unique
  const playlist = {
    id: newRef.key,
    name, url,
    created_at: new Date().toISOString()
  };
  await newRef.set(playlist);
  await database.ref(`devices/${key}/metadata/last_updated`).set(Date.now());

  document.getElementById('playlist-name').value = '';
  document.getElementById('playlist-url').value = '';
  loadPlaylists(mac);
  alert('Playlist enregistrée');
}

async function loadPlaylists(mac){
  const key = macToKey(mac);
  const container = document.getElementById('existing-playlists');
  container.innerHTML = '<h3>Vos playlists</h3>';

  const snap = await database.ref(`devices/${key}/playlists`).once('value');
  const playlists = snap.val();
  if (!playlists){ container.innerHTML += '<p>Aucune playlist</p>'; return; }

  Object.values(playlists).forEach(p=>{
    // Compat backward: si ancienne structure (clé = nom), fabrique un id temporaire
    const pid   = p.id || p._id || p.key || p.uid || ''; // normal : p.id
    const name  = p.name || '(sans nom)';
    const url   = p.url  || '';
    const id    = pid || Object.keys(playlists).find(k=>playlists[k]===p) || name;

    const el = document.createElement('div');
    el.className = 'playlist-item';
    el.innerHTML = `
      <h4>${name}</h4>
      <p style="word-break:break-all">URL: ${url}</p>
      <small>ID: <code>${id}</code></small>
      <div class="playlist-actions">
        <button class="secondary" onclick="editPlaylist('${id}','${escapeQuotes(name)}','${escapeQuotes(url)}')">Modifier</button>
        <button class="secondary" onclick="deletePlaylist('${mac}','${id}')">Supprimer</button>
      </div>`;
    container.appendChild(el);
  });
}

function escapeQuotes(s){return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');}

function editPlaylist(id, name, url){
  // pour simplicité on préremplit le formulaire (on pourrait aussi proposer une vraie modif par ID)
  document.getElementById('playlist-name').value = name;
  document.getElementById('playlist-url').value  = url;
  alert(`Le formulaire est prérempli. Pour changer l'URL ou le nom puis ré-enregistrer.\n(ID playlist: ${id})`);
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
