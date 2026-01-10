// ========================================
// FICHIER index.js COMPLET
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

// Fonction pour lire les données
function getStudents() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify({}));
            return {};
        }
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erreur lecture fichier:', error);
        return {};
    }
}

// Fonction pour sauvegarder les données
function saveStudents(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Erreur écriture fichier:', error);
        return false;
    }
}

// ========================================
// ROUTE: Soumettre les résultats
// ========================================
app.post('/api/submit', (req, res) => {
    const { phone, score, total, answers } = req.body;

    if (!phone) {
        return res.status(400).json({ error: 'Téléphone requis' });
    }

    const students = getStudents();
    
    // Chercher l'étudiant par téléphone
    let studentKey = null;
    for (const key in students) {
        if (students[key].phone === phone) {
            studentKey = key;
            break;
        }
    }

    if (studentKey) {
        // Mettre à jour les réponses
        students[studentKey].answers = answers;
        students[studentKey].score = score;
        students[studentKey].total = total;
        students[studentKey].submittedAt = new Date().toISOString();
        
        if (saveStudents(students)) {
            res.json({ success: true, message: 'Résultats enregistrés' });
        } else {
            res.status(500).json({ error: 'Erreur sauvegarde' });
        }
    } else {
        res.status(404).json({ error: 'Étudiant non trouvé' });
    }
});

// ========================================
// ROUTE ADMIN - PAGE DES RÉSULTATS
// ========================================
app.get('/admin', (req, res) => {
    // 1. On récupère les données à jour
    const studentsObj = getStudents();
    const studentsArray = Object.values(studentsObj);

    // 2. On prépare le HTML avec les vraies données
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Résultats Examen</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 16px;
            color: #1f2937;
        }

        .container {
            max-width: 100%;
            margin: 0 auto;
        }

        .header {
            background: white;
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }

        .header h1 {
            font-size: 1.5rem;
            color: #111827;
            margin-bottom: 8px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-top: 16px;
        }

        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 12px;
            border-radius: 12px;
            color: white;
        }

        .stat-label {
            font-size: 0.75rem;
            opacity: 0.9;
            margin-bottom: 4px;
        }

        .stat-value {
            font-size: 1.5rem;
            font-weight: bold;
        }

        .legend {
            background: white;
            border-radius: 12px;
            padding: 12px;
            margin-bottom: 16px;
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            font-size: 0.85rem;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .legend-box {
            width: 16px;
            height: 16px;
            border-radius: 4px;
        }

        .student-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .student-card {
            background: white;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transition: transform 0.2s;
        }

        .student-card:active {
            transform: scale(0.98);
        }

        .student-header {
            padding: 16px;
            background: linear-gradient(135deg, #f9fafb 0%, #e5e7eb 100%);
            border-bottom: 2px solid #e5e7eb;
        }

        .student-name {
            font-size: 1.1rem;
            font-weight: bold;
            color: #111827;
            margin-bottom: 4px;
        }

        .student-phone {
            font-size: 0.85rem;
            color: #6b7280;
        }

        .score-section {
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #fafafa;
        }

        .score-badge {
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 1.1rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .score-high { 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
        }
        .score-med { 
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: white;
        }
        .score-low { 
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
        }

        .answers-section {
            padding: 16px;
        }

        .section-title {
            font-size: 0.75rem;
            font-weight: bold;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
        }

        .answer-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 6px;
            margin-bottom: 16px;
        }

        .ans-box {
            aspect-ratio: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: bold;
            position: relative;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .ans-correct {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
        }

        .ans-wrong {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
            position: relative;
        }

        .ans-wrong::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 10%;
            right: 10%;
            height: 2px;
            background: white;
            transform: translateY(-50%) rotate(-20deg);
        }

        .ans-empty {
            background: #e5e7eb;
            color: #9ca3af;
        }

        .question-label {
            position: absolute;
            top: -8px;
            left: -8px;
            background: #1f2937;
            color: white;
            font-size: 0.6rem;
            padding: 2px 4px;
            border-radius: 4px;
            font-weight: bold;
        }

        .no-answers {
            padding: 20px;
            text-align: center;
            color: #9ca3af;
            font-style: italic;
            background: #f9fafb;
            border-radius: 12px;
            margin: 12px 16px;
        }

        .filters {
            background: white;
            border-radius: 12px;
            padding: 12px;
            margin-bottom: 16px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }

        .filter-buttons {
            display: flex;
            gap: 8px;
            overflow-x: auto;
            padding-bottom: 4px;
        }

        .filter-btn {
            padding: 8px 16px;
            border: 2px solid #e5e7eb;
            background: white;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
            white-space: nowrap;
            transition: all 0.2s;
            cursor: pointer;
        }

        .filter-btn.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-color: transparent;
        }

        @media (min-width: 768px) {
            .container {
                max-width: 1200px;
            }

            .header h1 {
                font-size: 2rem;
            }

            .stats-grid {
                grid-template-columns: repeat(4, 1fr);
            }

            .answer-grid {
                grid-template-columns: repeat(10, 1fr);
            }

            .student-list {
                grid-template-columns: repeat(2, 1fr);
                display: grid;
            }
        }

        @media (min-width: 1024px) {
            .student-list {
                grid-template-columns: repeat(3, 1fr);
            }
        }
    </style>
</head>
<body>

<div class="container">
    <div class="header">
        <h1>📊 Résultats Telc B1</h1>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total élèves</div>
                <div class="stat-value" id="totalStudents">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Ont répondu</div>
                <div class="stat-value" id="answeredStudents">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Moyenne</div>
                <div class="stat-value" id="avgScore">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Meilleur</div>
                <div class="stat-value" id="bestScore">0</div>
            </div>
        </div>
    </div>

    <div class="legend">
        <div class="legend-item">
            <div class="legend-box" style="background: linear-gradient(135deg, #10b981, #059669)"></div>
            <span>Correct</span>
        </div>
        <div class="legend-item">
            <div class="legend-box" style="background: linear-gradient(135deg, #ef4444, #dc2626)"></div>
            <span>Faux</span>
        </div>
        <div class="legend-item">
            <div class="legend-box" style="background: #e5e7eb"></div>
            <span>Non répondu</span>
        </div>
    </div>

    <div class="filters">
        <div class="filter-buttons">
            <button class="filter-btn active" onclick="filterResults('all')">Tous</button>
            <button class="filter-btn" onclick="filterResults('answered')">Ont répondu</button>
            <button class="filter-btn" onclick="filterResults('high')">≥35 pts</button>
            <button class="filter-btn" onclick="filterResults('medium')">20-34 pts</button>
            <button class="filter-btn" onclick="filterResults('low')">< 20 pts</button>
        </div>
    </div>

    <div class="student-list" id="studentList"></div>
</div>

<script>
    const studentsData = ${JSON.stringify(studentsArray)};

    const solutionKey = {
        "1": "h", "2": "f", "3": "c", "4": "a", "5": "d",
        "11": "d", "12": "h", "13": "x", "14": "j", "15": "f", 
        "16": "b", "17": "e", "18": "x", "19": "a", "20": "c"
    };

    let allStudentsWithScores = [];

    function calculateScore(student) {
        let scoreTotal = 0;
        let details = { part1: [], part3: [] };

        for(let i=1; i<=5; i++) {
            const qId = i.toString();
            const correct = solutionKey[qId];
            const studentAns = (student.answers[qId] || "").toLowerCase();
            const isCorrect = studentAns === correct;
            
            if(isCorrect) scoreTotal += 5;
            
            details.part1.push({
                q: i,
                answer: studentAns || "-",
                correct: isCorrect,
                expected: correct
            });
        }

        for(let i=11; i<=20; i++) {
            const qId = i.toString();
            const correct = solutionKey[qId];
            const studentAns = (student.answers[qId] || "").toLowerCase();
            const isCorrect = studentAns === correct;
            
            if(isCorrect) scoreTotal += 2.5;
            
            details.part3.push({
                q: i,
                answer: studentAns || "-",
                correct: isCorrect,
                expected: correct
            });
        }

        return { score: scoreTotal, details };
    }

    function renderStudentCard(student, scoreData) {
        const { score, details } = scoreData;
        const hasAnswers = Object.keys(student.answers || {}).length > 0;
        
        let badgeClass = "score-low";
        if(score >= 35) badgeClass = "score-high";
        else if(score >= 20) badgeClass = "score-med";

        let html = \`
            <div class="student-card" data-score="\${score}" data-answered="\${hasAnswers}">
                <div class="student-header">
                    <div class="student-name">\${student.name}</div>
                    <div class="student-phone">📱 \${student.phone}</div>
                </div>
                <div class="score-section">
                    <span style="font-weight: 600; color: #6b7280;">Note finale</span>
                    <span class="score-badge \${badgeClass}">\${score}/50</span>
                </div>
        \`;

        if(hasAnswers) {
            html += \`
                <div class="answers-section">
                    <div class="section-title">Partie 1 (5 pts/q)</div>
                    <div class="answer-grid">
            \`;
            
            details.part1.forEach(item => {
                const className = item.answer === "-" ? "ans-empty" : (item.correct ? "ans-correct" : "ans-wrong");
                html += \`
                    <div class="ans-box \${className}">
                        <span class="question-label">\${item.q}</span>
                        \${item.answer.toUpperCase()}
                    </div>
                \`;
            });

            html += \`
                    </div>
                    <div class="section-title">Partie 3 (2.5 pts/q)</div>
                    <div class="answer-grid">
            \`;

            details.part3.forEach(item => {
                const className = item.answer === "-" ? "ans-empty" : (item.correct ? "ans-correct" : "ans-wrong");
                html += \`
                    <div class="ans-box \${className}">
                        <span class="question-label">\${item.q}</span>
                        \${item.answer.toUpperCase()}
                    </div>
                \`;
            });

            html += \`</div></div>\`;
        } else {
            html += \`<div class="no-answers">❌ Aucune réponse enregistrée</div>\`;
        }

        html += \`</div>\`;
        return html;
    }

    function renderAllStudents() {
        const listEl = document.getElementById('studentList');
        listEl.innerHTML = '';

        allStudentsWithScores = studentsData.map(student => {
            const scoreData = calculateScore(student);
            return { ...student, ...scoreData };
        });

        const totalStudents = allStudentsWithScores.length;
        const answeredStudents = allStudentsWithScores.filter(s => Object.keys(s.answers || {}).length > 0).length;
        const scores = allStudentsWithScores.filter(s => Object.keys(s.answers || {}).length > 0).map(s => s.score);
        const avgScore = scores.length > 0 ? (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1) : 0;
        const bestScore = scores.length > 0 ? Math.max(...scores) : 0;

        document.getElementById('totalStudents').textContent = totalStudents;
        document.getElementById('answeredStudents').textContent = answeredStudents;
        document.getElementById('avgScore').textContent = avgScore;
        document.getElementById('bestScore').textContent = bestScore;

        allStudentsWithScores.sort((a, b) => b.score - a.score);

        allStudentsWithScores.forEach(student => {
            listEl.innerHTML += renderStudentCard(student, { score: student.score, details: student.details });
        });
    }

    function filterResults(type) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');

        const cards = document.querySelectorAll('.student-card');
        
        cards.forEach(card => {
            const score = parseFloat(card.dataset.score);
            const hasAnswered = card.dataset.answered === 'true';
            let show = true;

            switch(type) {
                case 'answered':
                    show = hasAnswered;
                    break;
                case 'high':
                    show = score >= 35;
                    break;
                case 'medium':
                    show = score >= 20 && score < 35;
                    break;
                case 'low':
                    show = score < 20;
                    break;
            }

            card.style.display = show ? 'block' : 'none';
        });
    }

    renderAllStudents();
</script>

</body>
</html>`;

    res.send(html);
});

// ========================================
// DÉMARRAGE DU SERVEUR
// ========================================
app.listen(PORT, () => {
    console.log('🚀 Serveur démarré sur http://localhost:' + PORT);
    console.log('📊 Page admin: http://localhost:' + PORT + '/admin');
});