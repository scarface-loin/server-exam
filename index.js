const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json()); // Pour lire le JSON envoyé par le React

// --- Configuration ---
const STUDENTS_FILE = path.join(__dirname, 'students.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// --- Helpers ---
const getStudents = () => {
    try {
        return JSON.parse(fs.readFileSync(STUDENTS_FILE));
    } catch (e) { return {}; }
};

const saveStudents = (data) => {
    fs.writeFileSync(STUDENTS_FILE, JSON.stringify(data, null, 2));
};

const getConfig = () => {
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
};

// --- Routes API ---

// 1. Statut de l'examen (Temps)
app.get('/api/status', (req, res) => {
    const config = getConfig();
    const startDateTimeString = `${config.examDate}T${config.startTime}:00`;
    const start = new Date(startDateTimeString);
    const end = new Date(start.getTime() + config.durationMinutes * 60000);
    const now = new Date();

    let status = 'waiting';
    let timeRemaining = 0;

    if (now < start) {
        status = 'waiting';
        timeRemaining = start - now;
    } else if (now >= start && now < end) {
        status = 'running';
        timeRemaining = end - now;
    } else {
        status = 'finished';
    }

    res.json({ status, timeRemaining, config });
});

// 2. Enregistrer l'étudiant (Login)
app.post('/api/login', (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Données manquantes' });

    const students = getStudents();
    
    // On utilise le téléphone comme identifiant unique
    if (!students[phone]) {
        students[phone] = {
            name,
            phone,
            startTime: new Date().toISOString(),
            score: null,
            answers: {}
        };
        saveStudents(students);
    }

    res.json({ success: true, student: students[phone] });
});

// 3. Enregistrer la note
app.post('/api/submit', (req, res) => {
    const { phone, score, total, answers } = req.body;
    const students = getStudents();

    if (students[phone]) {
        students[phone].score = `${score}/${total}`;
        students[phone].answers = answers;
        students[phone].submitTime = new Date().toISOString();
        saveStudents(students);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Étudiant non trouvé' });
    }
});

// 4. Page Admin (HTML simple pour voir les résultats)
app.get('/admin', (req, res) => {
    const students = getStudents();
    let rows = Object.values(students).map(s => `
        <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px;">${s.name}</td>
            <td style="padding: 10px;">${s.phone}</td>
            <td style="padding: 10px; font-weight: bold; color: ${s.score ? 'green' : 'red'}">
                ${s.score || 'En cours...'}
            </td>
            <td style="padding: 10px;">${s.submitTime ? new Date(s.submitTime).toLocaleTimeString() : '-'}</td>
        </tr>
    `).join('');

    res.send(`
        <html>
        <head><title>Admin - Résultats</title></head>
        <body style="font-family: sans-serif; padding: 20px; background: #f4f4f9;">
            <h1>Résultats de l'examen</h1>
            <table style="width: 100%; background: white; border-collapse: collapse; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <thead style="background: #333; color: white;">
                    <tr>
                        <th style="padding: 10px; text-align: left;">Nom</th>
                        <th style="padding: 10px; text-align: left;">Téléphone</th>
                        <th style="padding: 10px; text-align: left;">Note</th>
                        <th style="padding: 10px; text-align: left;">Heure Fin</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </body>
        </html>
    `);
});

app.listen(3001, () => console.log('Serveur prêt sur port 3001'));