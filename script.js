// Récupère les paramètres de l'URL
const urlParams = new URLSearchParams(window.location.search);
const macAddress = urlParams.get('mac');
const password = urlParams.get('password');

// Affiche les données TV
document.getElementById('mac-address').textContent = macAddress || 'Non disponible';
document.getElementById('password').textContent = password || 'Non disponible';

// Gestion du formulaire
document.getElementById('submit-btn').addEventListener('click', () => {
    const playlistUrl = document.getElementById('playlist-url').value;
    
    if (!playlistUrl) {
        alert('Veuillez entrer une URL valide');
        return;
    }

    // Envoi des données à votre backend (exemple avec Firebase)
    fetch('https://votre-backend.com/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: macAddress, password, playlistUrl })
    })
    .then(response => response.json())
    .then(data => {
        alert('Playlist envoyée avec succès !');
    })
    .catch(error => {
        console.error('Erreur:', error);
        alert('Échec de l\'envoi');
    });
});

// Génère un QR Code si les paramètres sont présents
if (macAddress && password) {
    const qrData = `${window.location.origin}${window.location.pathname}?mac=${macAddress}&password=${password}`;
    new QRCode(document.getElementById('qrcode'), {
        text: qrData,
        width: 150,
        height: 150
    });
}
