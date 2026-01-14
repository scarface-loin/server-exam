import eventlet
# Cette ligne doit être la TOUTE PREMIÈRE ligne de code exécutée
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from datetime import datetime

# Configuration de l'application
app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret_examen_cle'
socketio = SocketIO(app, async_mode='threading')

# --- MÉMOIRE TEMPORAIRE ---
# Ce dictionnaire stocke les étudiants en ligne.
# Clé = ID unique du socket (request.sid)
# Valeur = Infos de l'étudiant {nom, numero, option}
connected_students = {}

# ==============================================================================
# 1. ROUTES HTTP (Navigation)
# ==============================================================================

@app.route('/', methods=['GET', 'POST'])
def login():
    """Page d'accueil : Formulaire de connexion"""
    if request.method == 'POST':
        # Récupération des données du formulaire HTML
        nom = request.form.get('nom')
        numero = request.form.get('numero')
        option = request.form.get('option')

        # Redirection vers le bon template avec injection des variables
        if option == 'B1':
            return render_template('exercice_b1.html', nom=nom, numero=numero, option=option)
        elif option == 'B2':
            return render_template('exercice_b2.html', nom=nom, numero=numero, option=option)
    
    return render_template('login.html')

@app.route('/admin')
def dashboard():
    """Page Admin : Tableau de bord"""
    return render_template('dashboard.html')

# ==============================================================================
# 2. WEBHOOK (Réception des résultats JS)
# ==============================================================================

@app.route('/webhook/submit', methods=['POST'])
def webhook_submit():
    """
    Reçoit les résultats finaux envoyés par le fetch() du JS.
    """
    data = request.json
    
    # Ajout de l'heure de soumission
    data['timestamp'] = datetime.now().strftime("%H:%M:%S")
    
    print(f"📝 COPIE REÇUE : {data.get('nom')} - Score : {data.get('score_global')}")
    
    # Envoi immédiat des données au dashboard Admin via SocketIO
    socketio.emit('new_result', data, namespace='/admin')
    
    return jsonify({"status": "success", "message": "Resultats bien reçus"}), 200

# ==============================================================================
# 3. SOCKET.IO (Temps Réel - Connexions)
# ==============================================================================

# --- Côté ÉTUDIANT (Namespace: /etudiant) ---

@socketio.on('connect', namespace='/etudiant')
def handle_student_connect():
    """Déclenché quand la page se charge (connexion technique)"""
    print(f"🔌 Nouveau socket connecté : {request.sid} (En attente d'identification...)")

@socketio.on('student_login', namespace='/etudiant')
def handle_student_identification(data):
    """
    Déclenché par le JS de l'étudiant une fois la page chargée.
    C'est ICI qu'on sait qui est connecté.
    """
    # Enregistrement dans le dictionnaire global
    connected_students[request.sid] = data
    
    print(f"✅ IDENTIFIÉ : {data['nom']} ({data['option']})")
    
    # Mise à jour immédiate de l'admin
    update_admin_list()

@socketio.on('disconnect', namespace='/etudiant')
def handle_student_disconnect():
    """Déclenché quand l'étudiant ferme l'onglet"""
    if request.sid in connected_students:
        user = connected_students[request.sid]
        print(f"❌ DÉCONNEXION : {user['nom']}")
        
        # Suppression de la liste
        del connected_students[request.sid]
        
        # Mise à jour de l'admin
        update_admin_list()

# --- Côté ADMIN (Namespace: /admin) ---

@socketio.on('connect', namespace='/admin')
def handle_admin_connect():
    """Quand l'admin se connecte, on lui envoie tout de suite la liste actuelle"""
    print("👨‍🏫 Admin connecté au Dashboard")
    update_admin_list()

# --- FONCTION UTILITAIRE ---

def update_admin_list():
    """Envoie la liste complète des étudiants connectés à l'admin"""
    users_list = list(connected_students.values())
    count = len(users_list)
    
    socketio.emit('update_users', {
        'count': count, 
        'users': users_list
    }, namespace='/admin')

# ==============================================================================
# LANCEMENT DU SERVEUR
# ==============================================================================

if __name__ == '__main__':
    print("🚀 Serveur lancé sur http://localhost:5000")
    print("👀 Dashboard Admin sur http://localhost:5000/admin")
    socketio.run(app, debug=True, port=5000)