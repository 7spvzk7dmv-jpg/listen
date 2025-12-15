document.addEventListener('DOMContentLoaded', () => {

  const DATASETS = {
    frases: 'data/frases.json',
    palavras: 'data/palavras.json'
  };

  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];

  let datasetKey = 'frases';
  let data = [];
  let current = null;
  let examMode = false;

  let stats = {
    level: 'A1',
    hits: 0,
    errors: 0,
    weights: {}
  };

  const englishText = document.getElementById('englishText');
  const translationText = document.getElementById('translationText');
  const feedback = document.getElementById('feedback');
  const hitsEl = document.getElementById('hits');
  const errorsEl = document.getElementById('errors');
  const levelText = document.getElementById('levelText');
  const examModeBtn = document.getElementById('examModeBtn');

  document.getElementById('playBtn').onclick = () => speak(current.ENG);
  document.getElementById('micBtn').onclick = listen;
  document.getElementById('translateBtn').onclick = () => translationText.classList.toggle('hidden');
  document.getElementById('nextBtn').onclick = nextSentence;
  examModeBtn.onclick = toggleExamMode;

  /* ========= FIREBASE LOAD ========= */

  auth.onAuthStateChanged(async user => {
    if (!user) return;

    const { doc, getDoc, setDoc } = await import(
      "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js"
    );

    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      ({ stats, datasetKey, examMode } = snap.data());
    } else {
      await setDoc(ref, { stats, datasetKey, examMode });
    }

    loadDataset();
    updateUI();
  });

  async function saveStats() {
    const { doc, setDoc } = await import(
      "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js"
    );

    await setDoc(
      doc(db, 'users', auth.currentUser.uid),
      { stats, datasetKey, examMode },
      { merge: true }
    );
  }

  /* ========= DATASET ========= */

  async function loadDataset() {
    const res = await fetch(DATASETS[datasetKey]);
    data = await res.json();
    nextSentence();
  }

  function nextSentence() {
    const pool = data.filter(d => d.CEFR === stats.level);
    current = pool[Math.floor(Math.random() * pool.length)] || data[0];

    englishText.textContent = examMode ? '🎧 Ouça e repita' : current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* ========= TTS ========= */

  function speak(text) {
    if (!text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  /* ========= STT + PROGRESSÃO ========= */

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang = 'en-US';

    rec.onresult = e => {
      const spoken = normalize(e.results[0][0].transcript);
      const target = normalize(current.ENG);
      const score = similarity(spoken, target);

      if (score >= 0.75) {
        stats.hits++;
        advanceLevel(true);
        feedback.textContent = '✅ Boa pronúncia';
      } else {
        stats.errors++;
        advanceLevel(false);
        feedback.textContent = '❌ Atenção';
      }

      saveStats();
      updateUI();
    };

    rec.start();
  }

  function advanceLevel(success) {
    let i = levels.indexOf(stats.level);
    if (success && i < levels.length - 1) i++;
    if (!success && i > 0) i--;
    stats.level = levels[i];
  }

  function normalize(t) {
    return t.toLowerCase().replace(/[^a-z']/g, ' ').trim();
  }

  function similarity(a, b) {
    let same = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      if (a[i] === b[i]) same++;
    return same / Math.max(a.length, b.length);
  }

  function toggleExamMode() {
    examMode = !examMode;
    examModeBtn.textContent = examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
    nextSentence();
    saveStats();
  }

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent = `Nível atual: ${stats.level}`;
  }

});
