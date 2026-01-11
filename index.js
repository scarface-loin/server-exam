// ========================================
// FICHIER index.js COMPLET (Modifié)
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

// Fonctions utilitaires
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
    return true;
}

// ========================================
// ROUTE: Soumettre les résultats
// ========================================
app.post('/api/submit', (req, res) => {
    // ---- MODIFICATION ICI : On récupère exam_level ----
    const { phone, exam_id, score, total, answers } = req.body;

    if (!phone || !exam_id) {
        return res.status(400).json({ error: 'Téléphone et ID de l\'examen requis' });
    }

    const students = getStudents();
    
    let studentKey = Object.keys(students).find(key => students[key].phone === phone);

    if (studentKey) {
        // ---- MODIFICATION ICI : Structure des résultats par niveau ----
        if (!students[studentKey].results) {
            students[studentKey].results = {};
        }

        students[studentKey].results[exam_id] = {
            score,
            total,
            answers,
            submittedAt: new Date().toISOString()
        };
        
        saveStudents(students);
        res.json({ success: true, message: `Résultats pour ${exam_id} enregistrés` });

    } else {
        res.status(404).json({ error: 'Étudiant non trouvé' });
    }
});


// ========================================
// ROUTE ADMIN - PAGE DES RÉSULTATS
// ========================================
app.get('/admin', (req, res) => {
    const studentsObj = getStudents();
    const studentsArray = Object.values(studentsObj);

    // ---- MODIFICATION ICI : HTML amélioré pour gérer B1 et B2 ----
    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Résultats</title>
<style>
    body { font-family: system-ui, sans-serif; background-color: #f4f7f6; margin: 0; padding: 16px; }
    .container { max-width: 1200px; margin: auto; }
    h1, h2 { color: #333; }
    .student-card { background: white; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .student-header { padding: 16px; border-bottom: 1px solid #eee; }
    .student-name { font-weight: bold; font-size: 1.2rem; }
    .exam-results { padding: 16px; }
    .exam-title { font-weight: bold; color: #0056b3; margin-bottom: 8px; font-size: 1.1rem; }
    .score { font-size: 1.5rem; font-weight: bold; }
    .no-result { color: #999; font-style: italic; }
    .tabs { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
    .tab-btn { padding: 10px 15px; border: none; background: #eee; cursor: pointer; border-radius: 5px 5px 0 0; font-weight: bold; }
    .tab-btn.active { background: #007bff; color: white; }
    .student-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px; }
</style>
</head><body>
<div class="container">
    <h1>📊 Tableau de Bord des Résultats</h1>
    <div class="tabs">
        <button class="tab-btn active" onclick="showTab('b1')">Examen B1</button>
        <button class="tab-btn" onclick="showTab('b2')">Examen B2</button>
    </div>

    ${['b1', 'b2'].map(level => `
    <div id="tab-${level}" class="student-grid" ${level !== 'b1' ? 'style="display:none;"' : ''}>
        ${studentsArray.map(student => {
            const result = student.results ? student.results[`telc_${level}_263`] : null;
            if (result) {
                return `
                <div class="student-card">
                    <div class="student-header">
                        <div class="student-name">${student.name}</div>
                        <div>${student.phone}</div>
                    </div>
                    <div class="exam-results">
                        <div class="exam-title">Résultat ${level.toUpperCase()}</div>
                        <div class="score">${result.score} / ${result.total}</div>
                        <small>Soumis le: ${new Date(result.submittedAt).toLocaleString('fr-FR')}</small>
                    </div>
                </div>`;
            }
            return ''; // Ne pas afficher l'étudiant s'il n'a pas de résultat pour ce niveau
        }).join('')}
    </div>
    `).join('')}
</div>
<script>
    function showTab(level) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(\`button[onclick="showTab('\${level}')"]\`).classList.add('active');
        document.getElementById('tab-b1').style.display = 'none';
        document.getElementById('tab-b2').style.display = 'none';
        document.getElementById('tab-' + level).style.display = 'grid';
    }
</script>
</body></html>`;
    res.send(html);
});

// Le reste du serveur (login, status, etc.) reste identique pour le moment
// ... (Copiez ici vos routes /api/login et /api/status)

app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📊 Admin: http://localhost:${PORT}/admin`);
});