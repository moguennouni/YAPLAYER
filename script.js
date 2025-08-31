/*** Configuration Firebase ***/
const firebaseConfig = {
  apiKey: "AIzaSyAHsaBpOlvvKrhORo3F7bsMW8tflXwcEFE",
  authDomain: "yaplayer-ca754.firebaseapp.com",
  databaseURL: "https://yaplayer-ca754-default-rtdb.firebaseio.com",
  projectId: "yaplayer-ca754",
  storageBucket: "yaplayer-ca754.appspot.com",
  messagingSenderId: "70098606492",
  appId: "1:70098606492:web:bb81c8edadc194e1201059"
};

// Initialisation Firebase
const app = firebase.initializeApp(firebaseConfig);
const database = firebase.database(app);

/*** DOM Ready ***/
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('save-btn').addEventListener('click', handleSavePlaylist);
  document.getElementById('save-subscription-btn').addEventListener('click', handleSaveSubscription);
});

function togglePasswordVisibility() {
  const passwordInput = document.getElementById('input-password');
  passwordInput.type = (passwordInput.type === 'password') ? 'text' : 'password';
}

/*** Helpers ***/
function macToKey(mac) {
  return mac.replace(/:/g, '_');
}
function isValidMac(mac) {
  return /^([0-9A-Fa-f]{2}[:]){5}([0-9A-Fa-f]{2})$/.test(mac);
}

/** Abonnement : calcul statut + affichage **/
function computeStatus(subscription, now = Date.now()) {
  if (!subscription || !subscription.plan) return 'TRIAL';
  const { plan, trial_end = 0, expires_at = 0 } = subscription;

  if (plan === 'LIFETIME') return 'LIFETIME';
  if (plan === 'TRIAL')   return now <= Number(trial_end) ? 'TRIAL'  : 'EXPIRED';
  if (plan === 'YEARLY')  return now <= Number(expires_at) ? 'YEARLY' : 'EXPIRED';
  return 'EXPIRED';
}

function computeCalculatedPayload(plan) {
  const now = Date.now();
  if (plan === 'TRIAL') {
    const fifteenDays = 15 * 24 * 3600 * 1000;
    return { plan, trial_end: now + fifteenDays, expires_at: 0, updated_at: now };
  }
  if (plan === 'YEARLY') {
    const year365 = 365 * 24 * 3600 * 1000;
    return { plan, trial_end: 0, expires_at: now + year365, updated_at: now };
  }
  // LIFETIME
  return { plan, trial_end: 0, expires_at: 0, updated_at: now };
}

function renderSubscriptionUI(subscription) {
  const status = computeStatus(subscription);
  document.getElementById('display-status').textContent = status;

  let expiryText = '—';
  if (subscription?.plan === 'TRIAL' && subscription.trial_end) {
    expiryText = new Date(Number(subscription.trial_end)).toLocaleString();
  } else if (subscription?.plan === 'YEARLY' && subscription.expires_at) {
    expiryText = new Date(Number(subscription.expires_at)).toLocaleString();
  } else if (subscription?.plan === 'LIFETIME') {
    expiryText = 'Jamais (LIFETIME)';
  }
  document.getElementById('display-expiry').textContent = expiryText;

  // Sélecteur plan
  const sel = document.getElementById('sub-plan');
  sel.value = subscription?.plan || 'TRIAL';
}

/*** Auth ***/
async function handleLogin() {
  const mac = document.getElementById('input-mac').value.trim().toUpperCase();
  const password = document.getElementById('input-password').value.trim();

  if (!isValidMac(mac)) {
    alert('Format MAC invalide. Utilisez le format XX:XX:XX:XX:XX:XX');
    return;
  }
  if (!password) {
    alert('Veuillez entrer un mot de passe');
    return;
  }

  try {
    const key = macToKey(mac);
    const deviceRef = database.ref('devices/' + key);
    const snapshot = await deviceRef.once('value');

    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data.password === password) {
        showPlaylistManager(mac);
      } else {
        alert('Mot de passe incorrect');
      }
    } else {
      await deviceRef.set({
        mac: mac,
        password: password,
        playlists: {},
        metadata: {
          created_at: Date.now(),
          last_updated: Date.now()
        },
        // Abonnement par défaut : TRIAL 15 jours
        subscription: computeCalculatedPayload('TRIAL')
      });
      showPlaylistManager(mac);
    }
  } catch (e) {
    console.error("Erreur Firebase:", e);
    alert('Erreur de connexion au serveur');
  }
}

/*** Playlists ***/
async function handleSavePlaylist() {
  const mac = document.getElementById('display-mac').textContent;
  const name = document.getElementById('playlist-name').value.trim();
  const url  = document.getElementById('playlist-url').value.trim();

  if (!name) return alert('Veuillez entrer un nom de playlist');
  if (!url)  return alert('Veuillez entrer une URL');

  try {
    const key = macToKey(mac);
    const updates = {
      [`playlists/${name}`]: { url, created_at: new Date().toISOString() },
      "metadata/last_updated": Date.now()
    };
    await database.ref('devices').child(key).update(updates);

    alert('Playlist enregistrée');
    document.getElementById('playlist-name').value = '';
    document.getElementById('playlist-url').value = '';
    loadPlaylists(mac);
  } catch (e) {
    console.error("Erreur:", e);
    alert(`Échec de l'enregistrement: ${e.message}`);
  }
}

async function deletePlaylist(mac, playlistName) {
  if (!confirm(`Supprimer la playlist "${playlistName}" ?`)) return;
  try {
    const key = macToKey(mac);
    await database.ref(`devices/${key}/playlists/${playlistName}`).remove();
    loadPlaylists(mac);
  } catch (e) {
    console.error("Erreur suppression:", e);
    alert('Erreur lors de la suppression');
  }
}

function editPlaylist(name, url) {
  document.getElementById('playlist-name').value = name;
  document.getElementById('playlist-url').value  = url;
}

function showPlaylistManager(mac) {
  document.getElementById('display-mac').textContent = mac;
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('playlist-container').style.display = 'block';
  loadPlaylists(mac);
  loadSubscription(mac);
}

async function loadPlaylists(mac) {
  const key = macToKey(mac);
  const container = document.getElementById('existing-playlists');
  container.innerHTML = '<h3>Vos playlists</h3>';

  try {
    const snap = await database.ref(`devices/${key}/playlists`).once('value');
    const playlists = snap.val();

    if (playlists) {
      Object.entries(playlists).forEach(([name, data]) => {
        const el = document.createElement('div');
        el.className = 'playlist-item';
        el.innerHTML = `
          <h4>${name}</h4>
          <p>URL: ${data.url}</p>
          <div class="playlist-actions">
            <button class="secondary" onclick="editPlaylist('${name}', '${data.url}')">Modifier</button>
            <button class="secondary" onclick="deletePlaylist('${mac}', '${name}')">Supprimer</button>
          </div>`;
        container.appendChild(el);
      });
    } else {
      container.innerHTML += '<p>Aucune playlist enregistrée</p>';
    }
  } catch (e) {
    console.error("Erreur chargement:", e);
    container.innerHTML += '<p>Erreur lors du chargement des playlists</p>';
  }
}

/*** Subscription ***/
async function loadSubscription(mac) {
  const key = macToKey(mac);
  try {
    const snap = await database.ref(`devices/${key}/subscription`).once('value');
    const sub = snap.val() || null;
    renderSubscriptionUI(sub);
  } catch (e) {
    console.error(e);
  }
}

async function handleSaveSubscription() {
  const mac = document.getElementById('display-mac').textContent;
  const plan = document.getElementById('sub-plan').value;
  const key  = macToKey(mac);

  const payload = computeCalculatedPayload(plan);

  try {
    await database.ref(`devices/${key}/subscription`).set(payload);
    alert('Abonnement enregistré');
    renderSubscriptionUI(payload);
  } catch (e) {
    console.error(e);
    alert("Échec d'enregistrement de l'abonnement");
  }
}
