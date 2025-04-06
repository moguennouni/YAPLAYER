        /*** Configuration Firebase ***/
        const firebaseConfig = {
            apiKey: "AIzaSyAHsaBpOlvvKrhORo3F7bsMW8tflXwcEFE",
            authDomain: "yaplayer-ca754.firebaseapp.com",
            databaseURL: "https://yaplayer-ca754-default-rtdb.firebaseio.com",
            projectId: "yaplayer-ca754",
            storageBucket: "yaplayer-ca754.firebasestorage.app",
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
                // Convertir MAC pour Firebase (remplace : par _)
                const firebaseMac = mac.replace(/:/g, '_');
                const deviceRef = database.ref('devices/' + firebaseMac);
                const snapshot = await deviceRef.once('value');
                
                if (snapshot.exists()) {
                    // Vérification mot de passe
                    if (snapshot.val().password === password) {
                        showPlaylistManager(mac);
                    } else {
                        alert('Mot de passe incorrect');
                        passwordInput.focus();
                    }
                } else {
                    // Nouvel appareil
                    await deviceRef.set({
                        macAddress: mac,  // Stocké avec :
                        password: password,
                        playlist: "",
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
    const playlistUrl = document.getElementById('playlist-url').value.trim();

    if (!playlistUrl) {
        alert('Veuillez entrer une URL valide');
        return;
    }

    try {
        const firebaseMac = mac.replace(/:/g, '_');
        const updates = {
            playlist: playlistUrl,
            last_updated: new Date().toISOString()
        };
        
        console.log("Tentative d'envoi:", updates); // Debug
        
        await database.ref('devices').child(firebaseMac).update(updates);
        alert('Playlist enregistrée avec succès!');
        
        // Vérification
        const snapshot = await database.ref('devices/' + firebaseMac).once('value');
        console.log("Données confirmées:", snapshot.val());
    } catch (error) {
        console.error("Erreur complète:", {
            message: error.message,
            code: error.code,
            stack: error.stack
        });
        alert(`Échec de l'enregistrement: ${error.message}`);
    }
}

        function showPlaylistManager(mac) {
            document.getElementById('display-mac').textContent = mac;
            document.getElementById('auth-container').style.display = 'none';
            document.getElementById('playlist-container').style.display = 'block';
            
            // Charger la playlist existante
            const firebaseMac = mac.replace(/:/g, '_');
            database.ref('devices/' + firebaseMac).once('value').then((snapshot) => {
                const data = snapshot.val();
                if (data?.playlist) {
                    document.getElementById('playlist-url').value = data.playlist;
                }
            }).catch(error => {
                console.error("Erreur chargement:", error);
            });
        }
