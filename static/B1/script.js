let currentExamIndex = 0;
let userAnswers = {};
let examResults = {}; // Pour stocker les résultats de chaque exercice

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    loadExam(0);
    setupEventListeners();
});

// Configuration des écouteurs d'événements
function setupEventListeners() {
    // Boutons de sélection d'examen
    document.querySelectorAll('.exam-btn').forEach((btn, index) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.exam-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadExam(index);
        });
    });

    // Bouton de soumission
    document.getElementById('submit-btn').addEventListener('click', submitAllExams);

    // Bouton de réinitialisation
    document.getElementById('reset-btn').addEventListener('click', resetAllExams);
}

// Charger un examen
function loadExam(index) {
    currentExamIndex = index;
    const exam = examData.exercices[index];
    const container = document.getElementById('exam-container');
    
    let html = `
        <div class="exam-header">
            <h2>${exam.titre}</h2>
            <p class="exam-type">${exam.sous_titre} - ${exam.type}</p>
            <div class="consigne">${exam.consigne}</div>
        </div>
        
        <div class="exam-text">${exam.texte}</div>
    `;

    // Afficher les mots disponibles si c'est le Teil 2
    if (exam.mots_disponibles) {
        html += `
            <div class="mots-disponibles">
                <h3>Mots disponibles :</h3>
                <div class="mots-grid">
                    ${exam.mots_disponibles.map(mot => `
                        <div class="mot-item">
                            <strong>${mot.lettre}.</strong> ${mot.mot}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Générer les questions
    html += '<div class="questions-container">';
    
    exam.questions.forEach(question => {
        // Récupérer la réponse déjà donnée si elle existe
        const existingAnswer = userAnswers[index]?.[question.numero];
        
        html += `<div class="question" data-question="${question.numero}">`;
        html += `<div class="question-number">Question ${question.numero}</div>`;
        
        if (question.options) {
            // Type QCM (Teil 1)
            html += '<div class="options">';
            question.options.forEach(option => {
                const isChecked = existingAnswer === option.lettre;
                html += `
                    <div class="option">
                        <input type="radio" 
                               id="q${index}_${question.numero}_${option.lettre}" 
                               name="q${index}_${question.numero}" 
                               value="${option.lettre}"
                               ${isChecked ? 'checked' : ''}
                               onchange="saveAnswer(${index}, ${question.numero}, '${option.lettre}')">
                        <label for="q${index}_${question.numero}_${option.lettre}">
                            <span class="option-letter">${option.lettre}.</span>
                            <span class="option-text">${option.texte}</span>
                        </label>
                    </div>
                `;
            });
            html += '</div>';
        } else {
            // Type texte libre (Teil 2)
            html += `
                <input type="text" 
                       class="text-input" 
                       id="q${index}_${question.numero}" 
                       name="q${index}_${question.numero}" 
                       placeholder="Entrez la lettre correspondante (a-o)"
                       value="${existingAnswer || ''}"
                       oninput="saveAnswer(${index}, ${question.numero}, this.value)">
            `;
        }
        
        // Afficher le résultat si déjà corrigé
        if (examResults[index] && examResults[index][question.numero]) {
            const result = examResults[index][question.numero];
            const badgeClass = result.isCorrect ? 'correct' : (result.hasAnswered ? 'incorrect' : 'unanswered');
            const badgeText = result.isCorrect ? '✓ Correct' : (result.hasAnswered ? '✗ Incorrect' : '❌ Non répondu');
            
            html += `
                <div class="question-result ${badgeClass}">
                    <span class="badge ${badgeClass}">${badgeText}</span>
                    ${!result.isCorrect && result.hasAnswered ? 
                        `<span>Réponse correcte: <strong>${result.correctAnswer}</strong></span>` : ''}
                </div>
            `;
        }
        
        html += '</div>';
    });
    
    html += '</div>';
    
    container.innerHTML = html;
    
    // Masquer les résultats globaux
    document.getElementById('results-container').classList.add('hidden');
}

// Sauvegarder une réponse (sans soumettre)
function saveAnswer(examIndex, questionNum, answer) {
    if (!userAnswers[examIndex]) {
        userAnswers[examIndex] = {};
    }
    userAnswers[examIndex][questionNum] = answer.trim().toLowerCase();
    
    // Si l'examen a déjà été corrigé, on réinitialise son résultat
    if (examResults[examIndex]) {
        delete examResults[examIndex];
    }
}

// Soumettre TOUS les examens
// --- DANS static/B1/script.js ---

function submitAllExams() {
    // 1. Correction Locale
    examResults = {};
    let totalCorrectQuestions = 0;
    let totalQuestionsCount = 0;
    const POINTS_PAR_QUESTION = 1.5; // <--- CHANGEMENT ICI

    // Corriger chaque examen
    examData.exercices.forEach((exam, examIndex) => {
        correctExam(examIndex);
        if(examResults[examIndex]) {
            Object.values(examResults[examIndex]).forEach(res => {
                totalQuestionsCount++;
                if(res.isCorrect) totalCorrectQuestions++;
            });
        }
    });

    // 2. Calcul du Score pondéré
    // Ex: Si 10 justes : 10 * 1.5 = 15 points
    let scoreFinal = totalCorrectQuestions * POINTS_PAR_QUESTION;
    let noteMax = totalQuestionsCount * POINTS_PAR_QUESTION;

    // 3. Préparation de l'envoi
    const submitButton = document.getElementById('submit-btn');
    submitButton.disabled = true;
    submitButton.textContent = "Envoi en cours...";

    const identity = window.studentIdentity || { nom: "Inconnu", numero: "000", option: "B1" };

    const payload = {
        nom: identity.nom,
        numero: identity.numero,
        option: identity.option,
        reponses: userAnswers,
        details: examResults,
        // On envoie le score formaté (ex: "22.5/30")
        score_global: `${scoreFinal}/${noteMax}` 
    };

    // 4. Envoi Webhook
    fetch('/webhook/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        submitButton.textContent = "Réponses envoyées !";
        // On passe les scores calculés à la fonction d'affichage
        displayGlobalResults(scoreFinal, noteMax, totalCorrectQuestions, totalQuestionsCount);
    })
    .catch((error) => {
        console.error('Erreur:', error);
        alert("Erreur de connexion.");
        submitButton.disabled = false;
    });
}

// IL FAUT AUSSI ADAPTER L'AFFICHAGE LOCAL
// Remplace le début de displayGlobalResults par ceci :
function displayGlobalResults(scoreFinal, noteMax, correctCount, totalCount) {
    // Si la fonction est appelée sans arguments (rechargement), on recalcule vite fait (optionnel)
    if(scoreFinal === undefined) {
        scoreFinal = 0; noteMax = 0; 
        // ... logique de repli si besoin, mais normalement submitAllExams envoie tout
    }

    const percentage = noteMax > 0 ? Math.round((scoreFinal / noteMax) * 100) : 0;
    const container = document.getElementById('results-container');
    
    // ... le reste de ta logique de feedback (Excellent, Bien, etc.) ...
    
    let html = `
        <div class="results-header">
            <h2>📊 Résultats Finaux</h2>
            <!-- Affichage Note sur 1.5 -->
            <div class="score">${scoreFinal} / ${noteMax}</div>
            <div class="percentage">${percentage}%</div>
            <div class="stats">
                Questions correctes : <strong>${correctCount}/${totalCount}</strong>
            </div>
            <!-- ... -->
        </div>
    `;
    // ... suite de la fonction ...
    container.innerHTML = html;
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Corriger un examen spécifique
function correctExam(examIndex) {
    const exam = examData.exercices[examIndex];
    examResults[examIndex] = {};
    
    exam.questions.forEach(question => {
        const userAnswer = userAnswers[examIndex]?.[question.numero];
        const correctAnswer = question.reponse_correcte.toLowerCase();
        let isCorrect = false;
        let hasAnswered = false;
        
        // Vérifier si l'utilisateur a répondu à cette question
        if (userAnswer !== undefined && userAnswer !== '') {
            hasAnswered = true;
            isCorrect = userAnswer.toLowerCase() === correctAnswer;
        }
        
        examResults[examIndex][question.numero] = {
            numero: question.numero,
            userAnswer: hasAnswered ? userAnswer : 'Non répondu',
            correctAnswer: question.reponse_correcte.toUpperCase(),
            isCorrect: isCorrect,
            hasAnswered: hasAnswered
        };
    });
}

// Afficher les résultats globaux
function displayGlobalResults() {
    let totalCorrect = 0;
    let totalQuestions = 0;
    let totalAnswered = 0;
    
    // Calculer les totaux
    examData.exercices.forEach((exam, examIndex) => {
        const results = examResults[examIndex];
        if (results) {
            Object.values(results).forEach(result => {
                totalQuestions++;
                if (result.isCorrect) totalCorrect++;
                if (result.hasAnswered) totalAnswered++;
            });
        }
    });
    
    const percentage = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    const container = document.getElementById('results-container');
    
    let scoreClass = 'low';
    let feedback = '';
    let feedbackClass = 'needs-improvement';
    
    // Baser le feedback sur le pourcentage total
    if (percentage >= 80) {
        scoreClass = '';
        feedback = '🎉 Excellent travail ! Vous maîtrisez très bien les deux exercices.';
        feedbackClass = 'excellent';
    } else if (percentage >= 60) {
        scoreClass = 'medium';
        feedback = '👍 Bon travail ! Continuez à pratiquer pour améliorer vos résultats.';
        feedbackClass = 'good';
    } else if (percentage > 0) {
        feedback = '📚 Continuez à étudier. La pratique régulière vous aidera à progresser.';
        feedbackClass = 'needs-improvement';
    } else if (totalAnswered === 0) {
        feedback = '❌ Vous n\'avez répondu à aucune question. Essayez de répondre à au moins quelques questions.';
        feedbackClass = 'no-answers';
    } else {
        feedback = '⚠️ Aucune réponse correcte. Revoyez le cours et réessayez.';
        feedbackClass = 'needs-improvement';
    }
    
    let html = `
        <div class="results-header">
            <h2>📊 Résultats Finaux - Évaluation Complète</h2>
            <div class="score ${scoreClass}">${totalCorrect} / ${totalQuestions}</div>
            <div class="percentage">${percentage}%</div>
            <div class="stats">
                Questions répondues: <strong>${totalAnswered}/${totalQuestions}</strong> | 
                Questions non répondues: <strong>${totalQuestions - totalAnswered}</strong>
            </div>
            <div class="feedback-message ${feedbackClass}">${feedback}</div>
        </div>
    `;
    
    // Afficher les résultats par examen
    examData.exercices.forEach((exam, examIndex) => {
        const results = examResults[examIndex];
        if (results) {
            let examCorrect = 0;
            let examQuestions = Object.keys(results).length;
            let examAnswered = 0;
            
            Object.values(results).forEach(result => {
                if (result.isCorrect) examCorrect++;
                if (result.hasAnswered) examAnswered++;
            });
            
            const examPercentage = Math.round((examCorrect / examQuestions) * 100);
            
            html += `
                <div class="exam-results">
                    <h3>${exam.titre} (${exam.sous_titre})</h3>
                    <div class="exam-score">${examCorrect} / ${examQuestions} (${examPercentage}%)</div>
                    <div class="exam-details">
                        ${Object.values(results).map(result => {
                            const badgeClass = result.isCorrect ? 'correct' : (result.hasAnswered ? 'incorrect' : 'unanswered');
                            const badgeText = result.isCorrect ? '✓' : (result.hasAnswered ? '✗' : '○');
                            return `
                                <span class="question-result-mini ${badgeClass}" 
                                      title="Question ${result.numero}: ${result.userAnswer}">
                                    ${badgeText}
                                </span>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
    });
    
    html += `
        <div class="final-actions">
            <button onclick="loadExam(0)" class="btn btn-secondary">Revoir Teil 1</button>
            <button onclick="loadExam(1)" class="btn btn-secondary">Revoir Teil 2</button>
        </div>
    `;
    
    container.innerHTML = html;
    container.classList.remove('hidden');
    
    // Scroll vers les résultats
    container.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
    });
}

// Réinitialiser tous les examens
function resetAllExams() {
    if (confirm('Êtes-vous sûr de vouloir tout recommencer ? Toutes vos réponses seront effacées.')) {
        userAnswers = {};
        examResults = {};
        loadExam(currentExamIndex);
        document.getElementById('results-container').innerHTML = '';
        document.getElementById('results-container').classList.add('hidden');
    }
}