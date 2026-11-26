import "./style.css";

const IDENTITIES = {
  docker: ["Docker", 20, "Images, conteneurs, volumes et réseau."],
  ansible: ["Ansible", 50, "Automatisation, inventaires et playbooks."],
  devops: ["Fondamentaux DevOps", 10, "Culture, pratiques et travail en équipe."],
  cicd: ["CI/CD", 10, "Intégration continue et livraison automatisée."],
  scm: ["Gestion du code source", 10, "Git et gestion des changements."],
  "usine-logicielle": ["Usine logicielle", 10, "Outillage et chaîne de production logicielle."],
};

const questionModules = import.meta.glob("./questions_*.js");
const app = document.querySelector("#app");
const secondsPerQuestion = 30;
let currentRun;
let tick;

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function answerLabel(value) {
  return value.replace(/^[A-Z]\.\s+/, "");
}

function navigation(playing = false) {
  return `<header class="site-header shell">
    <a class="wordmark" href="/" aria-label="Stacklab, accueil">stacklab.</a>
    ${playing ? '<button class="link-button" id="leave-quiz">Quitter le quiz</button>' : `
      <nav class="main-nav" aria-label="Navigation principale"><a href="/">Accueil</a><a href="/#quiz">Les quiz</a></nav>
      <a class="admin-link" href="/gestion-quiz">Administration</a>`}
  </header>`;
}

function footer() {
  return `<footer class="site-footer shell"><a class="wordmark" href="/">stacklab.</a>
    <a href="/#quiz">Les quiz</a><a href="/gestion-quiz">Administration</a></footer>`;
}

function resetRun() {
  clearInterval(tick);
  currentRun = undefined;
}

function showHome() {
  resetRun();
  app.innerHTML = `${navigation()}<main class="shell" id="contenu">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <h1 id="hero-title">DevOps.<br>À toi de jouer.</h1>
        <p>Six quiz pour réviser Docker, Ansible,<br class="desktop-break"> la CI/CD et les fondamentaux du DevOps.</p>
        <a class="button" href="#quiz">Explorer les quiz</a>
      </div>
      <div class="hero-art">
        <img src="/stacklab/modules.png" width="641" height="484" alt="Modules électroniques translucides violets empilés">
        <aside class="quiz-preview" aria-label="Aperçu d’une question">
          <div class="split-line"><strong>Docker</strong><span>Question 3 / 20</span></div>
          <p>Construire une image Docker ?</p>
          <div class="preview-answer"><strong>docker build</strong><span>Bonne réponse</span></div>
        </aside>
      </div>
    </section>
    <section class="catalog" id="quiz" aria-labelledby="catalog-title">
      <h2 id="catalog-title">Choisis ton quiz</h2>
      <div class="catalog-layout">
        <article class="featured"><h3>Docker</h3><p class="accent">20 questions · 30 s par question</p>
          <p>${IDENTITIES.docker[2]}</p><button class="button" data-topic="docker">Choisir Docker</button></article>
        <ul class="theme-list">${Object.entries(IDENTITIES).filter(([key]) => key !== "docker")
          .map(([key, [title, count]]) => `<li><button data-topic="${key}"><strong>${title}</strong><span>${count} questions</span></button></li>`).join("")}</ul>
      </div>
    </section>
  </main>${footer()}`;
  app.querySelectorAll("[data-topic]").forEach((button) => {
    button.addEventListener("click", () => showRegistration(button.dataset.topic));
  });
}

function focusHeading() {
  window.scrollTo(0, 0);
  app.querySelector("h1")?.focus({ preventScroll: true });
}

function showRegistration(subject) {
  resetRun();
  const [title, count, description] = IDENTITIES[subject];
  app.innerHTML = `${navigation()}<main class="shell start-layout" id="contenu">
    <div><a class="back-link" href="/#quiz">← Tous les quiz</a>
      <h1 tabindex="-1">Quiz ${title}</h1>
      <p class="accent">${count} questions · 30 s par question</p><p class="description">${description}</p>
    </div>
    <form class="registration" id="registration-form">
      <h2>Avant de commencer</h2>
      <label for="firstname">Prénom</label><input id="firstname" name="firstname" autocomplete="given-name" maxlength="100" placeholder="Ton prénom" required>
      <label for="email">Adresse e-mail</label><input id="email" name="email" type="email" autocomplete="email" maxlength="255" placeholder="nom@exemple.fr" required>
      <div class="hp-field" aria-hidden="true"><label for="website">Site web</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
      <button class="button" type="submit">Commencer le quiz</button>
      <p class="form-hint">Ton e-mail sert à recevoir ton résultat.</p>
      <p class="form-message" id="registration-message" role="alert"></p>
    </form>
  </main>`;
  app.querySelectorAll('a[href="/#quiz"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showHome();
      if (location.hash !== "#quiz") location.hash = "quiz";
      document.querySelector("#quiz").scrollIntoView();
    });
  });
  focusHeading();
  const form = app.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button");
    const status = form.querySelector("#registration-message");
    button.disabled = true;
    button.textContent = "Chargement…";
    status.textContent = "";

    try {
      const { Questions } = await questionModules[`./questions_${subject}.js`]();
      const response = await fetch("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstname: data.firstname.trim(), email: data.email.trim(), website: data.website }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? "Trop de tentatives. Réessaie dans quelques minutes." : "Impossible de s’inscrire. Réessaie.");
      const user = await response.json();
      if (!form.isConnected) return;
      const questions = [...Questions];
      for (let index = questions.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1));
        [questions[index], questions[swap]] = [questions[swap], questions[index]];
      }
      currentRun = { user, title, questions, index: 0, score: 0, answers: [] };
      showQuestion();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Commencer le quiz";
      status.textContent = error.message || "Impossible de démarrer le quiz.";
    }
  });
}

function showQuestion() {
  clearInterval(tick);
  const run = currentRun;
  const question = run.questions[run.index];
  const questionNumber = run.index + 1;
  const total = run.questions.length;
  const started = Date.now();

  app.innerHTML = `${navigation(true)}<main class="quiz-main shell" id="contenu">
    <form class="quiz-panel" id="question-form">
      <div class="split-line"><strong>Quiz ${run.title}</strong><span id="timer">30 s</span></div>
      <progress aria-label="Progression du quiz" value="${questionNumber}" max="${total}"></progress>
      <p class="question-caption">Question ${questionNumber} sur ${total}</p>
      <h1 id="question-title" tabindex="-1">${escape(question.question)}</h1>
      <fieldset class="options" aria-labelledby="question-title">
        ${question.answers.map((answer, index) => `<label class="option" data-answer="${index}">
          <input type="radio" name="choice" value="${index}">
          <span class="option-key">${String.fromCharCode(65 + index)}</span><span>${escape(answerLabel(answer))}</span><strong class="option-status"></strong>
        </label>`).join("")}
      </fieldset>
      <p class="feedback" role="status" hidden></p>
      <div class="quiz-actions"><button class="button button-lime" id="validate" type="submit" disabled>Valider ma réponse</button></div>
    </form>
  </main>`;
  focusHeading();

  document.querySelector("#leave-quiz").addEventListener("click", () => {
    if (window.confirm("Quitter ce quiz ? Les réponses de cette partie ne seront pas enregistrées.")) {
      showHome();
      focusHeading();
    }
  });

  const form = app.querySelector("form");
  const submit = form.querySelector("#validate");
  const feedback = form.querySelector(".feedback");
  const timer = form.querySelector("#timer");
  let graded = false;
  form.addEventListener("change", () => { if (!graded) submit.disabled = false; });

  function grade(option) {
    if (graded || currentRun !== run) return;
    graded = true;
    clearInterval(tick);
    const answer = option === null ? null : question.answers[option];
    const correct = answer === question.correct;
    if (correct) run.score++;
    run.answers.push({
      questionIndex: run.index, questionText: question.question, userAnswer: answer,
      correctAnswer: question.correct, isCorrect: correct, timeSpentMs: Date.now() - started,
    });

    form.querySelectorAll("[data-answer]").forEach((row) => {
      const index = Number(row.dataset.answer);
      row.querySelector("input").disabled = true;
      if (question.answers[index] === question.correct) {
        row.classList.add("correct");
        row.querySelector(".option-status").textContent = "Correct";
      } else if (index === option) {
        row.classList.add("incorrect");
        row.querySelector(".option-status").textContent = "À revoir";
      }
    });
    feedback.hidden = false;
    feedback.classList.toggle("feedback-missed", !correct);
    feedback.textContent = correct ? `Bonne réponse. ${answerLabel(question.correct)}` :
      `${answer === null ? "Temps écoulé." : "À revoir."} Bonne réponse : ${answerLabel(question.correct)}`;
    submit.disabled = false;
    submit.textContent = questionNumber === total ? "Voir mon résultat" : "Question suivante";
    submit.focus();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (currentRun !== run) return;
    if (graded) {
      run.index++;
      if (run.index < total) showQuestion();
      else showResult(run);
      return;
    }
    const selected = new FormData(form).get("choice");
    if (selected !== null) grade(Number(selected));
  });

  tick = setInterval(() => {
    const seconds = Math.max(0, Math.ceil((secondsPerQuestion * 1000 - (Date.now() - started)) / 1000));
    timer.textContent = `${seconds} s`;
    if (seconds === 0) grade(null);
  }, 200);
}

async function showResult(run) {
  clearInterval(tick);
  const total = run.questions.length;
  app.innerHTML = `${navigation()}<main class="shell results" id="contenu">
    <h1 tabindex="-1">Quiz terminé.</h1><p class="result-subtitle">${run.title} · ${total} questions</p>
    <div class="result-layout">
      <section class="score-panel">
        <h2>Ton score</h2><p class="score">${run.score}/${total}</p><p>${total - run.score} réponse(s) à revoir</p>
        <button id="new-quiz" class="button button-lime">Choisir un autre quiz</button>
        <p id="save-status" role="status">Enregistrement du résultat…</p>
      </section>
      <section class="corrections"><h2>Tes corrections</h2><ul>${run.answers.map((answer) => `
        <li><strong>${escape(answer.questionText)}</strong><span>${answer.isCorrect ? "Bonne réponse" : "À revoir"} · ${escape(answerLabel(answer.correctAnswer))}</span></li>`).join("")}</ul></section>
    </div>
  </main>`;
  focusHeading();
  document.querySelector("#new-quiz").addEventListener("click", () => {
    showHome();
    focusHeading();
  });
  const status = document.querySelector("#save-status");

  try {
    const response = await fetch("/api/results", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: run.user.id, submissionToken: run.user.submissionToken, score: run.score, totalQuestions: total, answers: run.answers }),
    });
    if (!response.ok) throw new Error("Create result failed");
    const { emailAccepted } = await response.json();
    status.textContent = emailAccepted ? "Résultat enregistré. L’envoi de l’e-mail a été accepté." :
      "Résultat enregistré. L’envoi de l’e-mail n’a pas été confirmé.";
  } catch {
    status.textContent = "Impossible de confirmer l’enregistrement de ton résultat.";
  }
}

function showNotFound() {
  app.innerHTML = `${navigation()}<main class="shell" id="contenu"><section class="not-found">
    <p class="accent">Erreur 404</p><h1>Page introuvable.</h1>
    <p>Cette page a peut-être été déplacée. Retrouve les thèmes disponibles dans le catalogue.</p>
    <a class="button" href="/#quiz">Retour aux quiz</a></section></main>`;
}

if (window.location.pathname === "/") showHome();
else showNotFound();
