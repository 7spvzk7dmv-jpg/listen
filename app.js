document.addEventListener('DOMContentLoaded', () => {

  /* =======================
     FIREBASE (já carregado no HTML)
  ======================= */

  const auth = window.firebaseAuth;
  const db = window.firebaseDb;

  /* =======================
     CONFIGURAÇÃO GERAL
  ======================= */

  const DATASETS = {
    frases: 'data/frases.json',
    palavras: 'data/palavras.json'
  };

  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];

  let datasetKey = 'frases';
  let data = [];
  let current = null;
  let examMode = false;
  let selectedVoice = null;
  let userRef = null;

  let stats = {
    level: 'A1',
    hits: 0,
    errors: 0,
    weights: {}
  };

  /* =======================
     ELEMENTOS DO DOM
  ======================= */

  const englishText = document.getElementById('englishText');
  const translationText = document.getElementById('translationText');
  const feedback = document.getElementById('feedback');
  const hitsEl = document.getElementById('hits');
  const errorsEl = document.getElementById('errors');
  const levelText = document.getElementById('levelText');
  const toggleDatasetBtn = document.getElementById('toggleDataset');
  const examModeBtn = document.getElementById('examModeBtn');
  const playBtn = document.getElementById('playBtn');
  const micBtn = document.getElementById('micBtn');
  const translateBtn = document.getElementById('translateBtn');
  const nextBtn = document.getElementById('nextBtn');
  const resetBtn = document.getElementById('resetBtn');

  /* =======================
     AUTENTICAÇÃO (OBRIGATÓRIA)
  ======================= */

  auth.onAuthStateChanged(async user => {
    if (!user) {
      location.href = 'login.html';
      return;
    }

    userRef = firebase.firestore.doc(db, 'users', user.uid);

    const snap = await firebase.firestore.getDoc(userRef);

    if (snap.exists()) {
      const d = snap.data();
      stats = d.stats || stats;
      datasetKey = d.dataset || datasetKey;
      examMode = d.examMode || false;
    } else {
      await firebase.firestore.setDoc(userRef, {
        email: user.email,
        stats,
        dataset: datasetKey,
        examMode
      });
    }

    initVoices();
    loadDataset();
    updateUI();
  });

  /* =======================
     EVENTOS
  ======================= */

  playBtn.onclick = () => speakText(current?.ENG);
  micBtn.onclick = listen;
  translateBtn.onclick = () => translationText.classList.toggle('hidden');
  nextBtn.onclick = nextSentence;
  resetBtn.onclick = resetProgress;
  toggleDatasetBtn.onclick = toggleDataset;
  examModeBtn.onclick = toggleExamMode;

  /* =======================
     VOZ (TTS – Chrome / Android OK)
  ======================= */

  function initVoices() {
    const preferred = ['Google US English', 'Samantha', 'Daniel'];

    function pick() {
      const voices = speechSynthesis.getVoices();
      selectedVoice =
        voices.find(v => preferred.includes(v.name))
        || voices.find(v => v.lang === 'en-US')
        || voices[0];
    }

    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  function speakText(text) {
    if (!text) return;
    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (selectedVoice) u.voice = selectedVoice;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  /* =======================
     DATASET
  ======================= */

  async function loadDataset() {
    const res = await fetch(DATASETS[datasetKey]);
    data = await res.json();
    nextSentence();
  }

  function weightedRandom(items) {
    const pool = [];
    items.forEach(item => {
      const w = stats.weights[item.ENG] || 1;
      for (let i = 0; i < w; i++) pool.push(item);
    });
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function nextSentence() {
    const filtered = data.filter(d => d.CEFR === stats.level);
    current = weightedRandom(filtered.length ? filtered : data);

    englishText.textContent = examMode ? '🎧 Ouça e repita' : current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* =======================
     PRONÚNCIA (STT)
  ======================= */

  function normalize(t) {
    return t.toLowerCase().replace(/[^a-z']/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function similarity(a, b) {
    let same = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) same++;
    }
    return same / Math.max(a.length, b.length);
  }

  function highlightDifferences(target, spoken) {
    const t = target.split(' ');
    const s = spoken.split(' ');

    return t.map((w, i) => {
      const score = similarity(w, s[i] || '');
      if (score >= 0.85) return `<span>${w}</span>`;
      const cls = score >= 0.5
        ? 'text-yellow-400 underline cursor-pointer'
        : 'text-red-400 underline cursor-pointer';
      return `<span class="${cls}" data-word="${w}">${w}</span>`;
    }).join(' ');
  }

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !current) return;

    const rec = new SR();
    rec.lang = 'en-US';

    rec.onresult = e => {
      const spoken = normalize(e.results[0][0].transcript);
      const target = normalize(current.ENG);
      const score = similarity(spoken, target);

      englishText.innerHTML = highlightDifferences(target, spoken);
      document.querySelectorAll('[data-word]').forEach(el =>
        el.onclick = () => speakText(el.dataset.word)
      );

      if (score >= 0.75) {
        feedback.textContent = '✅ Boa pronúncia';
        stats.hits++;
        adjustLevel(true);
      } else {
        feedback.textContent = '❌ Atenção às palavras';
        stats.errors++;
        adjustLevel(false);
      }

      saveProgress();
      updateUI();
    };

    rec.start();
  }

  /* =======================
     PROGRESSÃO CEFR (CORRIGIDA)
  ======================= */

  function adjustLevel(success) {
    let i = levels.indexOf(stats.level);
    if (success && i < levels.length - 1) i++;
    if (!success && i > 0) i--;
    stats.level = levels[i];
  }

  /* =======================
     UI / ESTADO
  ======================= */

  function toggleDataset() {
    datasetKey = datasetKey === 'frases' ? 'palavras' : 'frases';
    loadDataset();
    saveProgress();
  }

  function toggleExamMode() {
    examMode = !examMode;
    nextSentence();
    saveProgress();
    updateUI();
  }

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent = `Nível atual: ${stats.level}`;
    examModeBtn.textContent = examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
    toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
  }

  function resetProgress() {
    if (!confirm('Deseja apagar todo o progresso?')) return;
    stats = { level: 'A1', hits: 0, errors: 0, weights: {} };
    saveProgress();
    nextSentence();
    updateUI();
  }

  async function saveProgress() {
    if (!userRef) return;
    await firebase.firestore.setDoc(userRef, {
      stats,
      dataset: datasetKey,
      examMode
    }, { merge: true });
  }

});
