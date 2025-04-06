// En tout début de script.js
window.togglePasswordVisibility = function() {
    const passwordInput = document.getElementById('input-password');
    const eyeIcon = document.getElementById('eye-icon');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        eyeIcon.classList.replace('fa-eye-slash', 'fa-eye');
    }
};
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

/*** Gestion de l'interface ***/
document.addEventListener('DOMContentLoaded', () => {
    const authContainer = document.getElementById('auth-container');
    const playlistContainer = document.getElementById('playlist-container');
    const loginBtn = document.getElementById('login-btn');
    const saveBtn = document.getElementById('save-btn');

    // Gestion authentification
    loginBtn.addEventListener('click', handleLogin);
    
    // Gestion playlist
    saveBtn.addEventListener('click', handleSavePlaylist);
});
document.addEventListener('DOMContentLoaded', () => {

    const passwordInput = document.getElementById('input-password');
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
    } else {
        passwordInput.type = 'password';
    }
}

async function handleLogin() {
    const macInput = document.getElementById('input-mac');
    const passwordInput = document.getElementById('input-password');
    
    const mac = macInput.value.trim().toUpperCase();
    const password = passwordInput.value.trim();

    // Validation MAC (format XX:XX:XX:XX:XX:XX)
    const macRegex = /^([0-9A-F]{2}[:]){5}([0-9A-F]{2})$/;
    if (!macRegex.test(mac)) {
        alert('Format MAC invalide. Utilisez le format XX:XX:XX:XX:XX:XX');
        return;
    }

    if (!password) {
        alert('Veuillez entrer un mot de passe');
        return;
    }

    try {
        const firebaseMac = mac.replace(/:/g, '_');
        const deviceRef = database.ref('devices/' + firebaseMac);
        const snapshot = await deviceRef.once('value');
        
        if (snapshot.exists()) {
            if (snapshot.val().password === password) {
                showPlaylistManager(mac);
            } else {
                alert('Mot de passe incorrect');
                passwordInput.focus();
            }
        } else {
            await deviceRef.set({
                macAddress: mac,
                password: password,
                playlists: {}, // Nouvelle structure pour stocker plusieurs playlists
                last_updated: firebase.database.ServerValue.TIMESTAMP
            });
            showPlaylistManager(mac);
        }
    } catch (error) {
        console.error("Erreur Firebase:", error);
        alert('Erreur de connexion au serveur');
    }
}

async function handleSavePlaylist() {
    const mac = document.getElementById('display-mac').textContent;
    const playlistName = document.getElementById('playlist-name').value.trim();
    const playlistUrl = document.getElementById('playlist-url').value.trim();

    if (!playlistName) {
        alert('Veuillez entrer un nom pour la playlist');
        return;
    }

    if (!playlistUrl) {
        alert('Veuillez entrer une URL valide');
        return;
    }

    try {
        const firebaseMac = mac.replace(/:/g, '_');
        const updates = {
            [`playlists/${playlistName}`]: {
                url: playlistUrl,
                created_at: new Date().toISOString()
            },
            last_updated: new Date().toISOString()
        };
        
        await database.ref('devices').child(firebaseMac).update(updates);
        alert('Playlist enregistrée avec succès!');
        
        // Réinitialiser les champs
        document.getElementById('playlist-name').value = '';
        document.getElementById('playlist-url').value = '';
        
        // Recharger les playlists
        loadPlaylists(mac);
    } catch (error) {
        console.error("Erreur:", error);
        alert(`Échec de l'enregistrement: ${error.message}`);
    }
}

/*** Fonction pour basculer la visibilité du mot de passe ***/
function togglePasswordVisibility() {
    const passwordInput = document.getElementById('input-password');
    const eyeIcon = document.getElementById('eye-icon');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.classList.remove('fa-eye');
        eyeIcon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        eyeIcon.classList.remove('fa-eye-slash');
        eyeIcon.classList.add('fa-eye');
    }
}

async function deletePlaylist(mac, playlistName) {
    if (!confirm(`Voulez-vous vraiment supprimer la playlist "${playlistName}"?`)) {
        return;
    }

    try {
        const firebaseMac = mac.replace(/:/g, '_');
        await database.ref(`devices/${firebaseMac}/playlists/${playlistName}`).remove();
        loadPlaylists(mac);
    } catch (error) {
        console.error("Erreur suppression:", error);
        alert('Erreur lors de la suppression');
    }
}

function editPlaylist(playlistName, playlistUrl) {
    document.getElementById('playlist-name').value = playlistName;
    document.getElementById('playlist-url').value = playlistUrl;
}

function showPlaylistManager(mac) {
    document.getElementById('display-mac').textContent = mac;
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('playlist-container').style.display = 'block';
    
    // Charger les playlists existantes
    loadPlaylists(mac);
}

// Modifiez la fonction loadPlaylists
async function loadPlaylists(mac) {
    const firebaseMac = mac.replace(/:/g, '_');
    const playlistsList = document.getElementById('playlists-list');
    playlistsList.innerHTML = '';

    try {
        const snapshot = await database.ref(`devices/${firebaseMac}/playlists`).once('value');
        const playlists = snapshot.val();

        if (playlists && Object.keys(playlists).length > 0) {
            Object.entries(playlists).forEach(([name, data]) => {
                const playlistElement = document.createElement('div');
                playlistElement.className = 'playlist-item';
                playlistElement.innerHTML = `
                    <h4><i class="fas fa-music"></i> ${name}</h4>
                    <p><i class="fas fa-link"></i> ${data.url}</p>
                    <small>Créée le ${new Date(data.created_at).toLocaleDateString()}</small>
                    <div class="playlist-actions">
                        <button class="secondary" onclick="editPlaylist('${name}', '${data.url}')">
                            <i class="fas fa-edit"></i> Modifier
                        </button>
                        <button class="danger" onclick="deletePlaylist('${mac}', '${name}')">
                            <i class="fas fa-trash-alt"></i> Supprimer
                        </button>
                    </div>
                `;
                playlistsList.appendChild(playlistElement);
            });
        } else {
            playlistsList.innerHTML = '<p class="no-playlists"><i class="far fa-folder-open"></i> Aucune playlist enregistrée</p>';
        }
    } catch (error) {
        console.error("Erreur chargement:", error);
        playlistsList.innerHTML = '<p class="error"><i class="fas fa-exclamation-triangle"></i> Erreur lors du chargement</p>';
    }
}

// Ajoutez ce style pour les messages
.no-playlists, .error {
    text-align: center;
    padding: 15px;
    color: #666;
}

.error {
    color: var(--danger-color);
}
