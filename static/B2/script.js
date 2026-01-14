// État de l'application
let userAnswers = {};
let isSubmitted = false;

// Éléments DOM
const exerciseContainer = document.getElementById('exerciseContainer');
const resultsContainer = document.getElementById('resultsContainer');
const submitBtn = document.getElementById('submitBtn');
const progressText = document.getElementById('progressText');
const reviewBtn = document.getElementById('reviewBtn');
const restartBtn = document.getElementById('restartBtn');

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    loadAllExercises();
    setupEventListeners();
});

function setupEventListeners() {
    submitBtn.addEventListener('click', submitAnswers);
    reviewBtn.addEventListener('click', reviewExercises);
    restartBtn.addEventListener('click', restartExercises);

    // Boutons collapse
    document.querySelectorAll('.btn-collapse').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = btn.dataset.target;
            const section = document.querySelector(`[data-exercise="${target}"]`);
            section.classList.toggle('collapsed');
        });
    });
}

function loadAllExercises() {
    exercicesData.exercices.forEach((exercise, index) => {
        loadExercise(exercise, index);
    });
    updateProgress();
}

function loadExercise(exercise, index) {
    document.getElementById(`exerciseTitle${index}`).textContent = exercise.titre;
    document.getElementById(`instructions${index}`).textContent = exercise.instructions;
    displayText(exercise, index);
    createQuestions(exercise, index);
}

function displayText(exercise, index) {
    let texteHTML = exercise.texte;
    exercise.lacunes.forEach(lacune => {
        const regex = new RegExp(`\\(${lacune.numero}\\)`, 'g');
        texteHTML = texteHTML.replace(regex, `<span class="lacune">${lacune.numero}</span>`);
    });
    const paragraphes = texteHTML.split('\n\n').filter(p => p.trim());
    document.getElementById(`textContainer${index}`).innerHTML = paragraphes.map(p => `<p>${p}</p>`).join('');
}

function createQuestions(exercise, exerciseIndex) {
    const questionsContainer = document.getElementById(`questionsContainer${exerciseIndex}`);
    questionsContainer.innerHTML = '';

    exercise.lacunes.forEach(lacune => {
        const questionCard = document.createElement('div');
        questionCard.className = 'question-card';
        questionCard.dataset.question = lacune.numero;
        questionCard.dataset.exercise = exerciseIndex;

        const header = document.createElement('div');
        header.className = 'question-header';
        header.innerHTML = `
            <span class="question-number">Question ${lacune.numero}</span>
            <span class="question-status"></span>
        `;

        const context = document.createElement('div');
        context.className = 'question-context';
        context.textContent = lacune.contexte;

        const optionsGrid = document.createElement('div');
        optionsGrid.className = 'options-grid';

        Object.entries(exercise.options).forEach(([key, value]) => {
            const optionBtn = document.createElement('button');
            optionBtn.className = 'option-btn';
            optionBtn.dataset.option = key;
            optionBtn.dataset.question = lacune.numero;
            optionBtn.dataset.exercise = exerciseIndex;
            optionBtn.textContent = `${key}) ${value}`;
            
            optionBtn.addEventListener('click', () => {
                if (!isSubmitted) {
                    selectOption(exerciseIndex, lacune.numero, key, optionBtn);
                }
            });

            optionsGrid.appendChild(optionBtn);
        });

        questionCard.appendChild(header);
        questionCard.appendChild(context);
        questionCard.appendChild(optionsGrid);
        questionsContainer.appendChild(questionCard);
    });
}

function selectOption(exerciseIndex, questionNum, option, button) {
    const questionKey = `${exerciseIndex}-${questionNum}`;
    const questionCard = button.closest('.question-card');
    questionCard.querySelectorAll('.option-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    button.classList.add('selected');
    userAnswers[questionKey] = option;
    updateProgress();
}

function updateProgress() {
    const totalQuestions = exercicesData.exercices.reduce((sum, ex) => sum + ex.lacunes.length, 0);
    const answeredCount = Object.keys(userAnswers).length;
    progressText.textContent = `${answeredCount}/${totalQuestions} questions répondues`;
}

// ---------------------------------------------------------
// C'EST ICI QUE J'AI MODIFIÉ LA FONCTION POUR LE SERVEUR
// ---------------------------------------------------------
// --- DANS static/B2/script.js ---

function submitAnswers() {
    if (isSubmitted) return;
    
    // ... validation (répondre à au moins une question) ...

    isSubmitted = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Calcul des points...";

    let correctCount = 0;
    let totalQuestionsAnswered = 0; // ou totalQuestions tout court selon ta logique
    
    // Pour calculer le total possible (si l'étudiant ne répond pas à tout, on veut quand même le total sur 20 par exemple)
    // Calculons le nombre TOTAL de questions dans l'exercice
    let totalQuestionsExamen = exercicesData.exercices.reduce((sum, ex) => sum + ex.lacunes.length, 0);

    // Vérifier chaque réponse
    exercicesData.exercices.forEach((exercise, exerciseIndex) => {
        exercise.lacunes.forEach(lacune => {
            // ... Ta logique de vérification et coloriage (vert/rouge) reste identique ...
            // ...
            if (isCorrect) correctCount++;
        });
    });

    // --- CALCUL DES POINTS (1.5 par question) ---
    const POINTS = 1.5;
    let scoreFinal = correctCount * POINTS;
    let scoreMax = totalQuestionsExamen * POINTS;

    // Envoi au serveur
    const identity = window.studentIdentity || {nom:'?', numero:'?', option:'B2'};
    
    const payload = {
        nom: identity.nom,
        numero: identity.numero,
        option: identity.option,
        reponses: userAnswers,
        // On envoie le score calculé (ex: "15/30")
        score_global: `${scoreFinal}/${scoreMax}`
    };

    fetch('/webhook/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        submitBtn.textContent = "Envoyé !";
        // On passe les infos à l'affichage
        setTimeout(() => {
            showResults(scoreFinal, scoreMax, correctCount, totalQuestionsExamen);
        }, 1000);
    })
    .catch(err => {
        console.error(err);
        setTimeout(() => {
            showResults(scoreFinal, scoreMax, correctCount, totalQuestionsExamen);
        }, 1000);
    });
}

// METTRE À JOUR L'AFFICHAGE DU CERCLE
function showResults(scoreFinal, scoreMax, correctCount, totalQuestions) {
    const percentage = scoreMax > 0 ? (scoreFinal / scoreMax) * 100 : 0;

    exerciseContainer.classList.add('hidden');
    resultsContainer.classList.remove('hidden');

    // ... Ta logique de niveau (Excellent, Bien...) reste la même ...

    // Afficher le score PONDÉRÉ
    const scoreCircle = document.getElementById('scoreCircle');
    const scoreNumber = document.getElementById('scoreNumber');
    const scoreTotal = scoreCircle.querySelector('.score-total');
    
    // Affiche le score (ex: 13.5)
    scoreNumber.textContent = scoreFinal; 
    // Affiche le total (ex: /30)
    scoreTotal.textContent = `/${scoreMax}`;

    // ... le reste de la fonction ...
}

function showResults(correctCount, totalAnswered) {
    const percentage = totalAnswered > 0 ? (correctCount / totalAnswered) * 100 : 0;
    exerciseContainer.classList.add('hidden');
    resultsContainer.classList.remove('hidden');

    let level, message, circleClass;
    if (percentage >= 90) { level = 'Excellent !'; message = 'Vous maîtrisez parfaitement ce sujet !'; circleClass = 'excellent'; } 
    else if (percentage >= 70) { level = 'Très bien !'; message = 'Vous avez une bonne compréhension du sujet.'; circleClass = 'good'; } 
    else if (percentage >= 50) { level = 'Bien'; message = 'Vous êtes sur la bonne voie.'; circleClass = 'average'; } 
    else { level = 'À améliorer'; message = 'Révisez le cours et réessayez.'; circleClass = 'poor'; }

    const scoreCircle = document.getElementById('scoreCircle');
    document.getElementById('scoreNumber').textContent = correctCount;
    scoreCircle.querySelector('.score-total').textContent = `/${totalAnswered}`;
    scoreCircle.className = `score-circle ${circleClass}`;
    document.getElementById('resultsTitle').textContent = level;
    document.getElementById('resultsMessage').textContent = message;

    displayResultsDetails(correctCount, totalAnswered);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function displayResultsDetails(correctCount, totalAnswered) {
    const detailsContainer = document.getElementById('resultsDetails');
    detailsContainer.innerHTML = `<h3 style="margin-bottom: 16px; font-size: 18px;">Détails des réponses (${totalAnswered} questions répondues)</h3>`;

    exercicesData.exercices.forEach((exercise, exerciseIndex) => {
        const exerciseTitle = document.createElement('h4');
        exerciseTitle.style.cssText = 'margin: 20px 0 12px 0; font-size: 16px; color: var(--primary);';
        exerciseTitle.textContent = `Exercice ${exerciseIndex + 1}`;
        detailsContainer.appendChild(exerciseTitle);

        exercise.lacunes.forEach(lacune => {
            const questionKey = `${exerciseIndex}-${lacune.numero}`;
            const userAnswer = userAnswers[questionKey];
            const correctAnswer = exercise.solutions[lacune.numero];

            if (!userAnswer) return;

            const isCorrect = userAnswer === correctAnswer;
            const resultItem = document.createElement('div');
            resultItem.className = `result-item ${isCorrect ? 'correct' : 'incorrect'}`;
            
            resultItem.innerHTML = `
                <span class="result-label">Question ${lacune.numero}</span>
                <div class="result-answer">
                    ${isCorrect ? 
                        `<span class="correct-answer">✓ ${userAnswer}) ${exercise.options[userAnswer]}</span>` :
                        `
                            <span class="your-answer" style="color: var(--error)">✗ ${userAnswer}) ${exercise.options[userAnswer]}</span>
                            <span class="correct-answer">→ ${correctAnswer}) ${exercise.options[correctAnswer]}</span>
                        `
                    }
                </div>
            `;
            detailsContainer.appendChild(resultItem);
        });
    });
}

function reviewExercises() {
    resultsContainer.classList.add('hidden');
    exerciseContainer.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function restartExercises() {
    userAnswers = {};
    isSubmitted = false;
    resultsContainer.classList.add('hidden');
    exerciseContainer.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = "Soumettre mes réponses";
    
    exercicesData.exercices.forEach((exercise, index) => {
        document.getElementById(`questionsContainer${index}`).innerHTML = '';
        loadExercise(exercise, index);
    });
    
    document.querySelectorAll('.exercise-section').forEach(section => {
        section.classList.remove('collapsed');
    });
    updateProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}