// ========================================
// SERVEUR AVEC DASHBOARD MOBILE ET CONFIG
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

// Middleware
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});
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
        // Vérifier si la table exam_state existe
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'exam_state'
            );
        `);
        
        const tableExists = tableCheck.rows[0].exists;
        
        if (tableExists) {
            // Vérifier si la colonne duration_minutes existe
            const columnCheck = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'exam_state' 
                    AND column_name = 'duration_minutes'
                );
            `);
            
            const columnExists = columnCheck.rows[0].exists;
            
            if (!columnExists) {
                console.log('🔄 Migration: Ajout de la colonne duration_minutes...');
                
                // Supprimer les anciennes colonnes si elles existent
                await pool.query(`
                    ALTER TABLE exam_state 
                    DROP COLUMN IF EXISTS status,
                    DROP COLUMN IF EXISTS duration_b1,
                    DROP COLUMN IF EXISTS duration_b2
                `);
                
                // Ajouter la nouvelle colonne
                await pool.query(`
                    ALTER TABLE exam_state 
                    ADD COLUMN duration_minutes INTEGER DEFAULT 60
                `);
                
                console.log('✅ Migration réussie!');
            }
        } else {
            // Créer la table si elle n'existe pas
            await pool.query(`
                CREATE TABLE exam_state (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    start_time TIMESTAMP,
                    duration_minutes INTEGER DEFAULT 60,
                    CHECK (id = 1)
                )
            `);
        }

        // Tables students et results
        await pool.query(`
            CREATE TABLE IF NOT EXISTS students (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(20) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

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
            INSERT INTO exam_state (id, start_time, duration_minutes)
            VALUES (1, NULL, 60)
            ON CONFLICT (id) DO NOTHING
        `);

        console.log('✅ Base de données initialisée');
    } catch (error) {
        console.error('❌ Erreur initialisation DB:', error);
        console.error('Détails:', error.message);
        process.exit(1);
    }
}

initDatabase();

// ==========================================
// SYSTÈME DE TRACKING EN TEMPS RÉEL
// ==========================================
const activeStudents = new Map();

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

// Broadcast du temps restant toutes les secondes
async function broadcastTimeRemaining() {
    try {
        const result = await pool.query(
            'SELECT start_time, duration_minutes FROM exam_state WHERE id = 1'
        );
        const state = result.rows[0];
        
        if (state.start_time) {
            const startTime = new Date(state.start_time).getTime();
            const durationMs = state.duration_minutes * 60 * 1000;
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, durationMs - elapsed);
            
            const data = JSON.stringify({
                type: 'time_update',
                timeRemaining: remaining,
                duration: durationMs,
                isRunning: remaining > 0
            });
            
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(data);
                }
            });
        }
    } catch (error) {
        console.error('Erreur broadcast time:', error);
    }
}

setInterval(broadcastTimeRemaining, 1000);

wss.on('connection', (ws) => {
    console.log('👀 Client connecté');
    
    ws.send(JSON.stringify({
        type: 'initial',
        students: Array.from(activeStudents.values())
    }));
    
    broadcastTimeRemaining();
    
    ws.on('close', () => {
        console.log('👋 Client déconnecté');
    });
});

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
}, 30000);

// ========================================
// ROUTES API
// ========================================

app.get('/api/status', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT start_time, duration_minutes FROM exam_state WHERE id = 1'
        );
        
        const state = result.rows[0];
        let timeRemaining = null;
        let isRunning = false;
        let status = 'waiting';
        
        if (state.start_time) {
            const startTime = new Date(state.start_time).getTime();
            const durationMs = state.duration_minutes * 60 * 1000;
            const elapsed = Date.now() - startTime;
            timeRemaining = Math.max(0, durationMs - elapsed);
            isRunning = timeRemaining > 0;
            
            if (isRunning) {
                status = 'running';
            } else {
                status = 'finished';
            }
        }

        res.json({
            status,
            startTime: state.start_time,
            durationMinutes: state.duration_minutes,
            timeRemaining,
            isRunning
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

        const result = await pool.query(
            `INSERT INTO students (name, phone) 
             VALUES ($1, $2) 
             ON CONFLICT (phone) 
             DO UPDATE SET name = $1 
             RETURNING *`,
            [name, phone]
        );

        const student = result.rows[0];

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
        const { phone, exam_id, score, total, answers, student_name } = req.body;
        
        if (!phone || !exam_id) {
            return res.status(400).json({ error: 'Données manquantes' });
        }

        let studentResult = await pool.query(
            'SELECT id FROM students WHERE phone = $1',
            [phone]
        );

        let studentId;
        if (studentResult.rows.length === 0) {
            const insertResult = await pool.query(
                'INSERT INTO students (name, phone) VALUES ($1, $2) RETURNING id',
                [student_name || 'Anonyme', phone]
            );
            studentId = insertResult.rows[0].id;
        } else {
            studentId = studentResult.rows[0].id;
        }

        await pool.query(
            `INSERT INTO results (student_id, exam_id, score, total, answers)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (student_id, exam_id)
             DO UPDATE SET score = $3, total = $4, answers = $5, submitted_at = NOW()`,
            [studentId, exam_id, score, total, JSON.stringify(answers)]
        );

        if (activeStudents.has(phone)) {
            const student = activeStudents.get(phone);
            student.status = 'submitted';
            student.currentExam = exam_id;
            student.score = `${score}/${total}`;
            student.lastActivity = Date.now();
            broadcastUpdate();
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Erreur /api/submit:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/heartbeat', (req, res) => {
    const { phone, exam_id } = req.body;
    if (phone && activeStudents.has(phone)) {
        const student = activeStudents.get(phone);
        student.lastActivity = Date.now();
        student.currentExam = exam_id || student.currentExam;
        student.status = 'active';
    }
    res.json({ success: true });
});

// ========================================
// ROUTES ADMIN
// ========================================

app.post('/admin/configure', async (req, res) => {
    try {
        const { durationMinutes } = req.body;
        
        if (!durationMinutes || durationMinutes < 1) {
            return res.status(400).json({ error: 'Durée invalide' });
        }

        await pool.query(
            'UPDATE exam_state SET duration_minutes = $1, start_time = NOW() WHERE id = 1',
            [durationMinutes]
        );
        
        console.log(`⚙️ Examen configuré: ${durationMinutes} minutes`);
        res.json({ success: true });
    } catch (error) {
        console.error('Erreur configure:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/admin/reset', async (req, res) => {
    try {
        await pool.query(
            'UPDATE exam_state SET start_time = NULL WHERE id = 1'
        );
        console.log('🔄 Examen réinitialisé');
        res.json({ success: true });
    } catch (error) {
        console.error('Erreur reset:', error);
        res.status(500).json({ error: 'Erreur serveur' });
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Admin Mobile</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            background: #0f172a;
            color: #e2e8f0;
            padding: 16px;
            padding-bottom: 80px;
        }
        
        .header {
            position: sticky;
            top: 0;
            background: #0f172a;
            padding-bottom: 16px;
            z-index: 100;
        }
        
        h1 { 
            font-size: 1.5rem; 
            margin-bottom: 16px;
            background: linear-gradient(to right, #3b82f6, #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .timer-card {
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            border: 2px solid #334155;
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 16px;
            text-align: center;
        }
        
        .timer-display {
            font-size: 3rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            background: linear-gradient(to right, #10b981, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin: 16px 0;
        }
        
        .timer-label {
            font-size: 0.875rem;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }
        
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #1e293b;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 16px;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(to right, #10b981, #3b82f6);
            transition: width 1s linear;
            border-radius: 4px;
        }
        
        .config-section {
            background: #1e293b;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 16px;
        }
        
        .input-group {
            margin-bottom: 16px;
        }
        
        .input-group label {
            display: block;
            font-size: 0.875rem;
            color: #94a3b8;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .input-group input {
            width: 100%;
            padding: 12px;
            background: #0f172a;
            border: 2px solid #334155;
            border-radius: 8px;
            color: #e2e8f0;
            font-size: 1rem;
        }
        
        .input-group input:focus {
            outline: none;
            border-color: #3b82f6;
        }
        
        .btn-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 16px;
        }
        
        .btn {
            padding: 16px;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .btn:active {
            transform: scale(0.95);
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            grid-column: 1 / -1;
        }
        
        .btn-secondary {
            background: #334155;
            color: #e2e8f0;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-bottom: 16px;
        }
        
        .stat-card {
            background: #1e293b;
            border-radius: 12px;
            padding: 16px;
            border: 1px solid #334155;
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(to right, #10b981, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .stat-label {
            font-size: 0.75rem;
            color: #94a3b8;
            text-transform: uppercase;
            margin-top: 4px;
        }
        
        .student-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .student-card {
            background: #1e293b;
            border: 2px solid #334155;
            border-radius: 12px;
            padding: 16px;
        }
        
        .student-card.active {
            border-color: #10b981;
            background: linear-gradient(135deg, #1e293b 0%, #064e3b 100%);
        }
        
        .student-card.submitted {
            border-color: #8b5cf6;
        }
        
        .student-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .student-name {
            font-weight: 700;
            font-size: 1.125rem;
        }
        
        .badge {
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
        
        .section-title {
            font-size: 1.125rem;
            font-weight: 600;
            margin-bottom: 12px;
            color: #f1f5f9;
        }
        
        .connection-dot {
            position: fixed;
            top: 16px;
            right: 16px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #ef4444;
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.2);
        }
        
        .connection-dot.connected {
            background: #10b981;
            box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2);
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .empty-state {
            text-align: center;
            padding: 32px;
            color: #64748b;
        }
    </style>
</head>
<body>
    <div class="connection-dot" id="connection-dot"></div>
    
    <div class="header">
        <h1>🎓 Dashboard Admin</h1>
    </div>
    
    <div class="timer-card">
        <div class="timer-label">Temps Restant</div>
        <div class="timer-display" id="timer-display">--:--</div>
        <div class="progress-bar">
            <div class="progress-fill" id="progress-fill" style="width: 0%"></div>
        </div>
    </div>
    
    <div class="config-section">
        <div class="input-group">
            <label>⏱️ Durée de l'examen (minutes)</label>
            <input type="number" id="duration-input" value="${state.duration_minutes}" min="1" max="300">
        </div>
        <div class="btn-group">
            <button class="btn btn-primary" onclick="startExam()">
                ▶️ Démarrer l'examen
            </button>
            <button class="btn btn-secondary" onclick="resetExam()">
                🔄 Réinitialiser
            </button>
        </div>
    </div>
    
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value" id="active-count">0</div>
            <div class="stat-label">🟢 En ligne</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="submitted-count">0</div>
            <div class="stat-label">✅ Terminé</div>
        </div>
    </div>
    
    <div class="section-title">👥 Étudiants en direct</div>
    <div class="student-list" id="student-list">
        <div class="empty-state">Aucun étudiant connecté</div>
    </div>

    <script>
        const wsUrl = '${wsUrl}';
        let ws;
        let timeRemaining = 0;
        let duration = 0;

        function connect() {
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('✅ Connecté');
                document.getElementById('connection-dot').classList.add('connected');
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'time_update') {
                    timeRemaining = data.timeRemaining;
                    duration = data.duration;
                    updateTimer();
                } else if (data.students) {
                    updateStudents(data.students);
                }
            };
            
            ws.onclose = () => {
                console.log('🔌 Déconnecté');
                document.getElementById('connection-dot').classList.remove('connected');
                setTimeout(connect, 3000);
            };
        }

        function updateTimer() {
            const minutes = Math.floor(timeRemaining / 60000);
            const seconds = Math.floor((timeRemaining % 60000) / 1000);
            const display = \`\${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
            
            document.getElementById('timer-display').textContent = display;
            
            const progress = duration > 0 ? ((duration - timeRemaining) / duration) * 100 : 0;
            document.getElementById('progress-fill').style.width = progress + '%';
        }

        function updateStudents(students) {
            const active = students.filter(s => s.status === 'active').length;
            const submitted = students.filter(s => s.status === 'submitted').length;
            
            document.getElementById('active-count').textContent = active;
            document.getElementById('submitted-count').textContent = submitted;
            
            const list = document.getElementById('student-list');
            
            if (!students || students.length === 0) {
                list.innerHTML = '<div class="empty-state">Aucun étudiant connecté</div>';
                return;
            }
            
            list.innerHTML = students.map(s => {
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
                            <div class="student-name">\${s.name}</div>
                            <span class="badge \${badgeClass}">\${badgeText}</span>
                        </div>
                        <div class="student-info">
                            📱 \${s.phone}<br>
                            ⏰ Actif il y a \${timeAgo}
                            \${s.currentExam ? \`<br>📝 \${s.currentExam}\` : ''}
                            \${s.score ? \`<br>🎯 \${s.score}\` : ''}
                        </div>
                    </div>
                \`;
            }).join('');
        }

        async function startExam() {
            const durationMinutes = parseInt(document.getElementById('duration-input').value);
            
            if (!durationMinutes || durationMinutes < 1) {
                alert('Veuillez entrer une durée valide');
                return;
            }
            
            try {
                const res = await fetch('/admin/configure', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ durationMinutes })
                });
                
                if (res.ok) {
                    alert('✅ Examen démarré pour ' + durationMinutes + ' minutes');
                }
            } catch (error) {
                alert('❌ Erreur: ' + error.message);
            }
        }

        async function resetExam() {
            if (!confirm('Réinitialiser l\'examen ?')) return;
            
            try {
                const res = await fetch('/admin/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (res.ok) {
                    alert('✅ Examen réinitialisé');
                    location.reload();
                }
            } catch (error) {
                alert('❌ Erreur: ' + error.message);
            }
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

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
    res.json({ 
        message: 'Serveur actif',
        endpoints: {
            admin: '/admin',
            status: '/api/status'
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Serveur sur le port ${PORT}`);
    console.log(`👨‍🏫 Admin: http://localhost:${PORT}/admin`);
});

process.on('SIGTERM', async () => {
    await pool.end();
    process.exit(0);
});