// ========================================
// FICHIER index.js AVEC POSTGRESQL
// ========================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
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

        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Admin - Gestion Examen</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 1200px; margin: 20px auto; padding: 20px; }
                    h1 { color: #333; }
                    .status { padding: 10px; border-radius: 5px; display: inline-block; margin: 10px 0; }
                    .status.waiting { background: #ffc107; }
                    .status.running { background: #4caf50; color: white; }
                    .status.finished { background: #f44336; color: white; }
                    .controls { margin: 20px 0; }
                    .controls a { 
                        display: inline-block; 
                        padding: 10px 20px; 
                        margin-right: 10px; 
                        background: #2196F3; 
                        color: white; 
                        text-decoration: none; 
                        border-radius: 5px; 
                    }
                    .controls a:hover { background: #0b7dda; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                    th { background-color: #2196F3; color: white; }
                    tr:nth-child(even) { background-color: #f2f2f2; }
                    pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
                </style>
            </head>
            <body>
                <h1>🎓 Panneau d'Administration</h1>
                
                <div class="status ${state.status}">
                    Statut: <strong>${state.status.toUpperCase()}</strong>
                    ${state.start_time ? `<br>Démarré: ${new Date(state.start_time).toLocaleString('fr-FR')}` : ''}
                </div>

                <div class="controls">
                    <a href="/admin/start">▶️ Démarrer l'examen</a>
                    <a href="/admin/stop">⏹️ Arrêter l'examen</a>
                    <a href="/admin/reset">🔄 Réinitialiser</a>
                    <a href="/admin" style="background: #9E9E9E;">🔃 Actualiser</a>
                </div>

                <h2>📊 Étudiants inscrits (${students.length})</h2>
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
                                            `${r.exam_id}: ${r.score}/${r.total}`
                                        ).join('<br>') 
                                        : 'Aucun résultat'}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <h2>🔍 Données brutes</h2>
                <pre>${JSON.stringify(students, null, 2)}</pre>
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
app.listen(PORT, () => {
    console.log(`🚀 Serveur prêt sur le port ${PORT}`);
    console.log(`👨‍🏫 Admin: http://localhost:${PORT}/admin`);
});

// Gestion propre de l'arrêt
process.on('SIGTERM', async () => {
    console.log('SIGTERM reçu, fermeture...');
    await pool.end();
    process.exit(0);
});