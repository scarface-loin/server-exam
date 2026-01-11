// ========================================
// FICHIER index.js AVEC POSTGRESQL
// ========================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Middleware de logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// Middleware
app.use(cors());
app.use(express.json());

// Configuration PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- INITIALISATION DE LA BASE DE DONNÉES ---
async function initDatabase() {
    try {
        // Table pour l'état de l'examen
        await pool.query(`
            CREATE TABLE IF NOT EXISTS exam_state (
                id INTEGER PRIMARY KEY DEFAULT 1,
                status VARCHAR(20) DEFAULT 'waiting',
                start_time TIMESTAMP,
                duration_b1 INTEGER DEFAULT 3600000,
                duration_b2 INTEGER DEFAULT 4500000,
                CHECK (id = 1)
            )
        `);

        // Table pour les étudiants
        await pool.query(`
            CREATE TABLE IF NOT EXISTS students (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(20) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Table pour les résultats
        await pool.query(`
            CREATE TABLE IF NOT EXISTS results (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
                exam_id VARCHAR(50) NOT NULL,
                score INTEGER NOT NULL,
                total INTEGER NOT NULL,
                answers JSONB,
                submitted_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(student_id, exam_id)
            )
        `);

        // Insérer l'état initial si nécessaire
        await pool.query(`
            INSERT INTO exam_state (id, status, start_time, duration_b1, duration_b2)
            VALUES (1, 'waiting', NULL, 3600000, 4500000)
            ON CONFLICT (id) DO NOTHING
        `);

        console.log('✅ Base de données initialisée avec succès');
    } catch (error) {
        console.error('❌ Erreur d\'initialisation de la base de données:', error);
        process.exit(1);
    }
}

initDatabase();

// ==========================================
// SYSTÈME DE TRACKING EN TEMPS RÉEL
// ==========================================
const activeStudents = new Map(); // phone -> {name, lastActivity, currentExam, status}

// Broadcast vers tous les clients WebSocket
function broadcastUpdate() {
    const data = JSON.stringify({
        type: 'update',
        students: Array.from(activeStudents.values())
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// WebSocket connection
wss.on('connection', (ws) => {
    console.log('👀 Admin connecté au monitoring');
    
    // Envoyer l'état actuel immédiatement
    ws.send(JSON.stringify({
        type: 'initial',
        students: Array.from(activeStudents.values())
    }));
    
    ws.on('close', () => {
        console.log('👋 Admin déconnecté du monitoring');
    });
});

// Nettoyage des étudiants inactifs (>5 min)
setInterval(() => {
    const now = Date.now();
    let cleaned = false;
    activeStudents.forEach((student, phone) => {
        if (now - student.lastActivity > 5 * 60 * 1000) {
            activeStudents.delete(phone);
            cleaned = true;
        }
    });
    if (cleaned) broadcastUpdate();
}, 30000); // Vérifier toutes les 30 secondes

// ========================================
// ROUTES API PUBLIQUES
// ========================================

app.get('/api/status', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT status, start_time, duration_b1, duration_b2 FROM exam_state WHERE id = 1'
        );
        
        const state = result.rows[0];
        
        // Vérifier si l'examen est terminé
        if (state.status === 'running' && state.start_time) {
            const elapsed = Date.now() - new Date(state.start_time).getTime();
            const maxDuration = Math.max(state.duration_b1, state.duration_b2);
            
            if (elapsed > maxDuration) {
                await pool.query(
                    "UPDATE exam_state SET status = 'finished' WHERE id = 1"
                );
                state.status = 'finished';
            }
        }

        res.json({
            status: state.status,
            startTime: state.start_time,
            config: {
                durationB1: state.duration_b1,
                durationB2: state.duration_b2
            }
        });
    } catch (error) {
        console.error('Erreur /api/status:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { name, phone } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ error: 'Nom et téléphone requis' });
        }

        // Chercher ou créer l'étudiant
        const result = await pool.query(
            `INSERT INTO students (name, phone) 
             VALUES ($1, $2) 
             ON CONFLICT (phone) 
             DO UPDATE SET name = $1 
             RETURNING *`,
            [name, phone]
        );

        const student = result.rows[0];

        // Ajouter au tracking temps réel
        activeStudents.set(phone, {
            name,
            phone,
            lastActivity: Date.now(),
            currentExam: null,
            status: 'connected'
        });
        broadcastUpdate();

        res.json({ 
            success: true, 
            student: {
                id: student.id,
                name: student.name,
                phone: student.phone
            }
        });
    } catch (error) {
        console.error('Erreur /api/login:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/submit', async (req, res) => {
    try {
        console.log('📥 Réception submit:', req.body);
        const { phone, exam_id, score, total, answers, student_name } = req.body;
        
        if (!phone || !exam_id) {
            console.error('❌ Données manquantes:', { phone, exam_id });
            return res.status(400).json({ error: 'Téléphone et ID examen requis' });
        }

        // Trouver ou créer l'étudiant (au cas où il n'existe pas)
        let studentResult = await pool.query(
            'SELECT id FROM students WHERE phone = $1',
            [phone]
        );

        let studentId;
        if (studentResult.rows.length === 0) {
            console.log('⚠️ Étudiant non trouvé, création automatique');
            const insertResult = await pool.query(
                'INSERT INTO students (name, phone) VALUES ($1, $2) RETURNING id',
                [student_name || 'Anonyme', phone]
            );
            studentId = insertResult.rows[0].id;
        } else {
            studentId = studentResult.rows[0].id;
        }

        // Enregistrer le résultat
        await pool.query(
            `INSERT INTO results (student_id, exam_id, score, total, answers)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (student_id, exam_id)
             DO UPDATE SET score = $3, total = $4, answers = $5, submitted_at = NOW()`,
            [studentId, exam_id, score, total, JSON.stringify(answers)]
        );

        // Mettre à jour le statut temps réel
        if (activeStudents.has(phone)) {
            const student = activeStudents.get(phone);
            student.status = 'submitted';
            student.currentExam = exam_id;
            student.score = `${score}/${total}`;
            student.lastActivity = Date.now();
            broadcastUpdate();
        }

        console.log('✅ Résultat enregistré pour:', exam_id);
        res.json({ 
            success: true, 
            message: `Résultats pour ${exam_id} enregistrés.` 
        });
    } catch (error) {
        console.error('❌ Erreur /api/submit:', error);
        res.status(500).json({ error: 'Erreur serveur', details: error.message });
    }
});

// Heartbeat pour tracker l'activité
app.post('/api/heartbeat', (req, res) => {
    const { phone, exam_id } = req.body;
    if (phone && activeStudents.has(phone)) {
        const student = activeStudents.get(phone);
        student.lastActivity = Date.now();
        student.currentExam = exam_id || student.currentExam;
        student.status = 'active';
        // Pas de broadcast à chaque heartbeat pour économiser la bande passante
    }
    res.json({ success: true });
});

// ========================================
// ROUTES ADMIN
// ========================================

app.get('/admin/start', async (req, res) => {
    try {
        await pool.query(
            "UPDATE exam_state SET status = 'running', start_time = NOW() WHERE id = 1"
        );
        console.log('🚀 EXAMEN DÉMARRÉ !');
        res.redirect('/admin');
    } catch (error) {
        console.error('Erreur start:', error);
        res.status(500).send('Erreur');
    }
});

app.get('/admin/stop', async (req, res) => {
    try {
        await pool.query(
            "UPDATE exam_state SET status = 'finished', start_time = NULL WHERE id = 1"
        );
        console.log('🛑 EXAMEN TERMINÉ !');
        res.redirect('/admin');
    } catch (error) {
        console.error('Erreur stop:', error);
        res.status(500).send('Erreur');
    }
});

app.get('/admin/reset', async (req, res) => {
    try {
        await pool.query(
            "UPDATE exam_state SET status = 'waiting', start_time = NULL WHERE id = 1"
        );
        console.log('🔄 EXAMEN RÉINITIALISÉ !');
        res.redirect('/admin');
    } catch (error) {
        console.error('Erreur reset:', error);
        res.status(500).send('Erreur');
    }
});

app.get('/admin', async (req, res) => {
    try {
        const stateResult = await pool.query('SELECT * FROM exam_state WHERE id = 1');
        const studentsResult = await pool.query(`
            SELECT s.*, 
                   json_agg(
                       json_build_object(
                           'exam_id', r.exam_id,
                           'score', r.score,
                           'total', r.total,
                           'submitted_at', r.submitted_at
                       )
                   ) FILTER (WHERE r.id IS NOT NULL) as results
            FROM students s
            LEFT JOIN results r ON s.id = r.student_id
            GROUP BY s.id
            ORDER BY s.created_at DESC
        `);

        const state = stateResult.rows[0];
        const students = studentsResult.rows;
        const wsUrl = `wss://${req.get('host')}`.replace('https://', 'wss://').replace('http://', 'ws://');

        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Admin - Monitoring Temps Réel</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                        background: #0f172a;
                        color: #e2e8f0;
                        padding: 20px;
                    }
                    .container { max-width: 1400px; margin: 0 auto; }
                    h1 { 
                        font-size: 2rem; 
                        margin-bottom: 10px;
                        background: linear-gradient(to right, #3b82f6, #8b5cf6);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                    }
                    
                    .status-bar { 
                        display: flex; 
                        gap: 20px; 
                        margin: 30px 0;
                        flex-wrap: wrap;
                    }
                    .status-card { 
                        background: #1e293b; 
                        padding: 20px; 
                        border-radius: 12px;
                        flex: 1;
                        min-width: 200px;
                        border: 1px solid #334155;
                    }
                    .status-card h3 { 
                        font-size: 0.875rem; 
                        color: #94a3b8; 
                        margin-bottom: 8px;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                    }
                    .status-card .value { 
                        font-size: 2rem; 
                        font-weight: 700;
                        background: linear-gradient(to right, #10b981, #3b82f6);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                    }
                    
                    .exam-status { 
                        display: inline-block;
                        padding: 8px 16px; 
                        border-radius: 20px; 
                        font-weight: 600;
                        font-size: 0.875rem;
                        margin-bottom: 20px;
                    }
                    .exam-status.waiting { background: #fbbf24; color: #78350f; }
                    .exam-status.running { background: #10b981; color: #064e3b; animation: pulse 2s infinite; }
                    .exam-status.finished { background: #ef4444; color: #7f1d1d; }
                    
                    @keyframes pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.7; }
                    }
                    
                    .controls { 
                        display: flex; 
                        gap: 10px; 
                        margin-bottom: 30px;
                        flex-wrap: wrap;
                    }
                    .btn { 
                        padding: 12px 24px; 
                        border: none;
                        border-radius: 8px;
                        font-weight: 600;
                        cursor: pointer;
                        text-decoration: none;
                        display: inline-block;
                        transition: all 0.2s;
                    }
                    .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(0,0,0,0.3); }
                    .btn-start { background: #10b981; color: white; }
                    .btn-stop { background: #ef4444; color: white; }
                    .btn-reset { background: #f59e0b; color: white; }
                    .btn-refresh { background: #6b7280; color: white; }
                    
                    .section { 
                        background: #1e293b; 
                        border-radius: 12px; 
                        padding: 24px;
                        margin-bottom: 24px;
                        border: 1px solid #334155;
                    }
                    .section h2 { 
                        font-size: 1.25rem; 
                        margin-bottom: 20px;
                        color: #f1f5f9;
                    }
                    
                    .live-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                        gap: 16px;
                    }
                    
                    .student-card {
                        background: #0f172a;
                        border: 2px solid #334155;
                        border-radius: 12px;
                        padding: 16px;
                        transition: all 0.3s;
                    }
                    .student-card:hover { border-color: #3b82f6; }
                    .student-card.active { border-color: #10b981; box-shadow: 0 0 20px rgba(16, 185, 129, 0.3); }
                    .student-card.submitted { border-color: #8b5cf6; }
                    
                    .student-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: start;
                        margin-bottom: 12px;
                    }
                    .student-name {
                        font-weight: 700;
                        font-size: 1.125rem;
                        color: #f1f5f9;
                    }
                    .student-badge {
                        padding: 4px 12px;
                        border-radius: 12px;
                        font-size: 0.75rem;
                        font-weight: 600;
                    }
                    .badge-active { background: #10b981; color: #064e3b; }
                    .badge-submitted { background: #8b5cf6; color: #4c1d95; }
                    .badge-connected { background: #3b82f6; color: #1e3a8a; }
                    
                    .student-info {
                        color: #94a3b8;
                        font-size: 0.875rem;
                        line-height: 1.6;
                    }
                    
                    .pulse-dot {
                        display: inline-block;
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        background: #10b981;
                        margin-right: 6px;
                        animation: pulse-dot 2s infinite;
                    }
                    
                    @keyframes pulse-dot {
                        0%, 100% { opacity: 1; transform: scale(1); }
                        50% { opacity: 0.5; transform: scale(1.2); }
                    }
                    
                    table { 
                        width: 100%; 
                        border-collapse: collapse;
                    }
                    th, td { 
                        padding: 12px; 
                        text-align: left; 
                        border-bottom: 1px solid #334155;
                    }
                    th { 
                        background: #0f172a; 
                        color: #94a3b8;
                        font-weight: 600;
                        font-size: 0.875rem;
                        text-transform: uppercase;
                    }
                    tr:hover { background: #0f172a; }
                    
                    .connection-status {
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        padding: 8px 16px;
                        border-radius: 20px;
                        font-size: 0.75rem;
                        font-weight: 600;
                        background: #1e293b;
                        border: 1px solid #334155;
                    }
                    .connection-status.connected { border-color: #10b981; color: #10b981; }
                    .connection-status.disconnected { border-color: #ef4444; color: #ef4444; }
                </style>
            </head>
            <body>
                <div id="connection-status" class="connection-status disconnected">● Connexion...</div>
                
                <div class="container">
                    <h1>🎓 Panneau d'Administration</h1>
                    
                    <div class="exam-status ${state.status}">
                        ${state.status === 'running' ? '🟢' : state.status === 'finished' ? '🔴' : '🟡'} 
                        ${state.status.toUpperCase()}
                        ${state.start_time ? ` - Démarré: ${new Date(state.start_time).toLocaleString('fr-FR')}` : ''}
                    </div>

                    <div class="controls">
                        <a href="/admin/start" class="btn btn-start">▶️ Démarrer</a>
                        <a href="/admin/stop" class="btn btn-stop">⏹️ Arrêter</a>
                        <a href="/admin/reset" class="btn btn-reset">🔄 Réinitialiser</a>
                        <a href="/admin" class="btn btn-refresh">🔃 Actualiser</a>
                    </div>

                    <div class="status-bar">
                        <div class="status-card">
                            <h3>🟢 En ligne</h3>
                            <div class="value" id="active-count">0</div>
                        </div>
                        <div class="status-card">
                            <h3>📝 En cours</h3>
                            <div class="value" id="composing-count">0</div>
                        </div>
                        <div class="status-card">
                            <h3>✅ Terminé</h3>
                            <div class="value" id="submitted-count">0</div>
                        </div>
                        <div class="status-card">
                            <h3>👥 Total inscrits</h3>
                            <div class="value">${students.length}</div>
                        </div>
                    </div>

                    <div class="section">
                        <h2>🔴 Étudiants en direct</h2>
                        <div id="live-students" class="live-grid">
                            <p style="color: #64748b;">Aucun étudiant connecté pour le moment...</p>
                        </div>
                    </div>

                    <div class="section">
                        <h2>📊 Tous les étudiants</h2>
                        <div style="overflow-x: auto;">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Nom</th>
                                        <th>Téléphone</th>
                                        <th>Inscrit le</th>
                                        <th>Résultats</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${students.map(s => `
                                        <tr>
                                            <td>${s.id}</td>
                                            <td>${s.name}</td>
                                            <td>${s.phone}</td>
                                            <td>${new Date(s.created_at).toLocaleString('fr-FR')}</td>
                                            <td>
                                                ${s.results && s.results[0] ? 
                                                    s.results.map(r => 
                                                        `<span style="background: #334155; padding: 4px 8px; border-radius: 6px; font-size: 0.875rem; margin-right: 4px;">${r.exam_id}: ${r.score}/${r.total}</span>`
                                                    ).join('') 
                                                    : '<span style="color: #64748b;">Aucun</span>'}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <script>
                    const wsUrl = '${wsUrl}';
                    let ws;
                    const connectionStatus = document.getElementById('connection-status');
                    const liveStudents = document.getElementById('live-students');
                    const activeCount = document.getElementById('active-count');
                    const composingCount = document.getElementById('composing-count');
                    const submittedCount = document.getElementById('submitted-count');

                    function connect() {
                        ws = new WebSocket(wsUrl);
                        
                        ws.onopen = () => {
                            console.log('✅ WebSocket connecté');
                            connectionStatus.textContent = '● Connecté';
                            connectionStatus.className = 'connection-status connected';
                        };
                        
                        ws.onmessage = (event) => {
                            const data = JSON.parse(event.data);
                            updateLiveView(data.students);
                        };
                        
                        ws.onerror = (error) => {
                            console.error('❌ Erreur WebSocket:', error);
                        };
                        
                        ws.onclose = () => {
                            console.log('🔌 WebSocket déconnecté, reconnexion...');
                            connectionStatus.textContent = '● Déconnecté';
                            connectionStatus.className = 'connection-status disconnected';
                            setTimeout(connect, 3000);
                        };
                    }

                    function updateLiveView(students) {
                        if (!students || students.length === 0) {
                            liveStudents.innerHTML = '<p style="color: #64748b;">Aucun étudiant connecté pour le moment...</p>';
                            activeCount.textContent = '0';
                            composingCount.textContent = '0';
                            submittedCount.textContent = '0';
                            return;
                        }

                        const active = students.filter(s => s.status === 'active').length;
                        const submitted = students.filter(s => s.status === 'submitted').length;
                        const connected = students.filter(s => s.status === 'connected').length;

                        activeCount.textContent = active;
                        composingCount.textContent = active;
                        submittedCount.textContent = submitted;

                        liveStudents.innerHTML = students.map(s => {
                            const elapsed = Math.floor((Date.now() - s.lastActivity) / 1000);
                            const timeAgo = elapsed < 60 ? \`\${elapsed}s\` : \`\${Math.floor(elapsed/60)}min\`;
                            
                            let badgeClass = 'badge-connected';
                            let badgeText = 'Connecté';
                            let cardClass = '';
                            
                            if (s.status === 'active') {
                                badgeClass = 'badge-active';
                                badgeText = 'En cours';
                                cardClass = 'active';
                            } else if (s.status === 'submitted') {
                                badgeClass = 'badge-submitted';
                                badgeText = 'Terminé';
                                cardClass = 'submitted';
                            }
                            
                            return \`
                                <div class="student-card \${cardClass}">
                                    <div class="student-header">
                                        <div class="student-name">
                                            \${s.status === 'active' ? '<span class="pulse-dot"></span>' : ''}
                                            \${s.name}
                                        </div>
                                        <span class="student-badge \${badgeClass}">\${badgeText}</span>
                                    </div>
                                    <div class="student-info">
                                        📱 \${s.phone}<br>
                                        ⏰ Actif il y a \${timeAgo}
                                        \${s.currentExam ? \`<br>📝 Examen: \${s.currentExam}\` : ''}
                                        \${s.score ? \`<br>🎯 Score: \${s.score}\` : ''}
                                    </div>
                                </div>
                            \`;
                        }).join('');
                    }

                    connect();
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Erreur /admin:', error);
        res.status(500).send('Erreur serveur');
    }
});

// Route de santé
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Route racine
app.get('/', (req, res) => {
    res.json({ 
        message: 'Serveur d\'examen actif',
        endpoints: {
            status: '/api/status',
            login: '/api/login',
            submit: '/api/submit',
            admin: '/admin',
            health: '/health'
        }
    });
});

// Gestion d'erreurs globale
app.use((err, req, res, next) => {
    console.error('Erreur globale:', err.stack);
    res.status(500).json({ error: 'Erreur serveur' });
});

// Démarrage
server.listen(PORT, () => {
    console.log(`🚀 Serveur prêt sur le port ${PORT}`);
    console.log(`👨‍🏫 Admin: http://localhost:${PORT}/admin`);
    console.log(`📡 WebSocket activé pour le monitoring temps réel`);
});

// Gestion propre de l'arrêt
process.on('SIGTERM', async () => {
    console.log('SIGTERM reçu, fermeture...');
    await pool.end();
    process.exit(0);
});