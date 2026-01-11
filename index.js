// ========================================
// FICHIER index.js COMPLET (Serveur Node.js)
// ========================================

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Chemin vers le fichier de données
const DATA_FILE = path.join(__dirname, 'students.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// --- GESTION DE L'ÉTAT DE L'EXAMEN ---
let examState = {
    status: 'waiting',
    startTime: null,
    config: {
        durationB1: 60 * 60 * 1000,
        durationB2: 75 * 60 * 1000,
    }
};

function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            examState = JSON.parse(data);
            console.log('✅ Configuration de l\'examen chargée.');
        } catch (e) {
            console.error("❌ Erreur de parsing de config.json, utilisation des valeurs par défaut.", e);
            saveConfig();
        }
    } else {
        console.log('ℹ️ Aucune configuration trouvée, création du fichier par défaut.');
        saveConfig();
    }
}

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(examState, null, 2));
}

loadConfig();

// --- FONCTIONS UTILITAIRES ---
function getStudents() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({}));
        return {};
    }
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
}

function saveStudents(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ========================================
// ROUTES API PUBLIQUES
// ========================================

// --- ROUTE /api/status (celle qui posait problème) ---
app.get('/api/status', (req, res) => {
    let timeRemaining = 0;
    if (examState.status === 'running' && examState.startTime) {
        // La durée est maintenant calculée côté client, on envoie juste le temps de départ
        // C'est plus robuste si B1 et B2 ont des durées différentes.
        const elapsed = Date.now() - new Date(examState.startTime).getTime();
        // On vérifie avec la plus longue durée possible pour savoir si c'est fini
        const maxDuration = Math.max(examState.config.durationB1, examState.config.durationB2);
        if (elapsed > maxDuration) {
            examState.status = 'finished';
            saveConfig();
        }
    }

    res.json({
        status: examState.status,
        startTime: examState.startTime,
        config: examState.config
    });
});

app.post('/api/login', (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nom et téléphone requis' });
    
    const students = getStudents();
    let student = Object.values(students).find(s => s.phone === phone);

    if (!student) {
        const newId = `student_${Date.now()}`;
        student = { id: newId, name, phone, results: {} };
        students[newId] = student;
    } else {
        student.name = name; // Mettre à jour le nom
    }
    
    saveStudents(students);
    res.json({ success: true, student });
});

app.post('/api/submit', (req, res) => {
    const { phone, exam_id, score, total, answers } = req.body;
    if (!phone || !exam_id) return res.status(400).json({ error: 'Téléphone et ID examen requis' });

    const students = getStudents();
    const studentKey = Object.keys(students).find(k => students[k].phone === phone);

    if (studentKey) {
        if (!students[studentKey].results) students[studentKey].results = {};
        students[studentKey].results[exam_id] = { score, total, answers, submittedAt: new Date().toISOString() };
        saveStudents(students);
        res.json({ success: true, message: `Résultats pour ${exam_id} enregistrés.` });
    } else {
        res.status(404).json({ error: 'Étudiant non trouvé.' });
    }
});


// ========================================
// ROUTES ADMIN
// ========================================
app.get('/admin/start', (req, res) => {
    if (examState.status !== 'running') {
        examState.status = 'running';
        examState.startTime = new Date().toISOString();
        saveConfig();
        console.log('🚀 EXAMEN DÉMARRÉ !');
    }
    res.redirect('/admin');
});

app.get('/admin/stop', (req, res) => {
    examState.status = 'finished';
    examState.startTime = null;
    saveConfig();
    console.log('🛑 EXAMEN TERMINÉ !');
    res.redirect('/admin');
});

app.get('/admin/reset', (req, res) => {
    examState.status = 'waiting';
    examState.startTime = null;
    saveConfig();
    console.log('🔄 EXAMEN RÉINITIALISÉ !');
    res.redirect('/admin');
});

app.get('/admin', (req, res) => {
    // ... (votre code HTML pour la page admin reste le même)
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Admin</title></head>
        <body>
            <h1>Panneau Admin</h1>
            <p>Statut: <strong>${examState.status}</strong></p>
            <a href="/admin/start">Démarrer</a> | 
            <a href="/admin/stop">Arrêter</a> | 
            <a href="/admin/reset">Réinitialiser</a>
            <h2>Élèves</h2>
            <pre>${JSON.stringify(getStudents(), null, 2)}</pre>
        </body>
        </html>
    `);
});

// ========================================
// DÉMARRAGE
// ========================================
app.listen(PORT, () => {
    console.log(`🚀 Serveur prêt sur http://localhost:${PORT}`);
    console.log(`👨‍🏫 Admin: http://localhost:${PORT}/admin`);
});