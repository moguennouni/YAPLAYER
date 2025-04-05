/*** Configuration Firebase ***/
const firebaseConfig = {
    apiKey: "AIzaSyA...VotreCléAPI",
    authDomain: "votre-projet.firebaseapp.com",
    databaseURL: "https://votre-projet.firebaseio.com",
    projectId: "votre-projet",
    storageBucket: "votre-projet.appspot.com",
    messagingSenderId: "1234567890"
};

// Initialisation
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

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

async function handleLogin() {
    const mac = document.getElementById('input-mac').value.trim();
    const password = document.getElementById('input-password').value.trim();

    if (!mac || !password) {
        alert('Veuillez remplir tous les champs');
        return;
    }

    try {
        const snapshot = await database.ref('devices/' + mac).once('value');
        
        if (snapshot.exists()) {
            if (snapshot.val().password === password) {
                showPlaylistManager(mac);
            } else {
                alert('Mot de passe incorrect');
            }
        } else {
            await database.ref('devices/' + mac).set({
                password: password,
                playlist: "",
                last_updated: firebase.database.ServerValue.TIMESTAMP
            });
            showPlaylistManager(mac);
        }
    } catch (error) {
        console.error("Erreur Firebase:", error);
        alert('Erreur de connexion');
    }
}

function handleSavePlaylist() {
    const mac = document.getElementById('display-mac').textContent;
    const playlistUrl = document.getElementById('playlist-url').value.trim();

    if (!playlistUrl) {
        alert('Veuillez entrer une URL valide');
        return;
    }

    database.ref('devices/' + mac).update({
        playlist: playlistUrl,
        last_updated: firebase.database.ServerValue.TIMESTAMP
    }).then(() => alert('Playlist enregistrée !'));
}

function showPlaylistManager(mac) {
    document.getElementById('display-mac').textContent = mac;
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('playlist-container').style.display = 'block';
    
    // Charger la playlist existante
    database.ref('devices/' + mac).once('value').then((snapshot) => {
        const data = snapshot.val();
        if (data?.playlist) {
            document.getElementById('playlist-url').value = data.playlist;
        }
    });
}
