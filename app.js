document.addEventListener('DOMContentLoaded', async () => {

  /* =======================
     FIREBASE (DINÂMICO)
  ======================= */

  const { onAuthStateChanged } =
    await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js');
  const { doc, getDoc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js');

  const auth = window.firebaseAuth;
  const db = window.firebaseDb;

  let userRef = null;
  let firebaseReady = false;

  /* =======================
     CONFIGURAÇÃO GERAL
  ======================= */

  const DATASETS = {
    frases: 'data/frases.json',
    palavras: 'data/palavras.json'
  };

  const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  const SCORE_RULES = {
    hits: {
      A1: 1,
      A2: 3,
      B1: 5,
      B2: 7,
      C1: 9,
      C2: 10
    },
    errors: {
      A1: -10,
      A2: -8,
      B1: -6,
      B2: -4,
      C1: -2,
      C2: -1
    }
  };

  let datasetKey = 'frases';
  let data = [];
  let current = null;
  let examMode = false;

  let stats = {
    level: 'A1',
    score: 0,
    hits: 0,
    errors: 0,
    weights: {}
  };

  let selectedVoice = null;

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

  /* =======================
     AUTENTICAÇÃO + LOAD
  ======================= */

  onAuthStateChanged(auth, async user => {
    if (!user) return;

    userRef = doc(db, 'users', user.uid);

    try {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const saved = snap.data();
        stats = saved.stats || stats;
        datasetKey = saved.datasetKey || datasetKey;
        examMode = saved.examMode || false;
      }
      firebaseReady = true;
    } catch {
      console.warn('⚠️ Firestore indisponível, usando memória local');
    }

    init();
  });

  /* =======================
     INIT
  ======================= */

  function init() {
    initVoices();
    bindEvents();
    loadDataset();
    updateUI();
  }

  function bindEvents() {
    document.getElementById('playBtn').addEventListener('click', speakSentence);
    document.getElementById('micBtn').addEventListener('click', listen);
    document.getElementById('translateBtn').addEventListener('click', toggleTranslation);
    document.getElementById('nextBtn').addEventListener('click', nextSentence);
    document.getElementById('resetBtn').addEventListener('click', resetProgress);
    toggleDatasetBtn.addEventListener('click', toggleDataset);
    examModeBtn.addEventListener('click', toggleExamMode);
  }

  /* =======================
     VOZ (TTS)
  ======================= */

  function initVoices() {
    const preferred = ['Samantha', 'Daniel', 'Aaron'];

    function pickVoice() {
      const voices = speechSynthesis.getVoices();
      if (!voices.length) return;

      selectedVoice =
        voices.find(v => preferred.includes(v.name) && v.lang.startsWith('en')) ||
        voices.find(v => v.lang === 'en-US') ||
        voices[0];
    }

    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function speakText(text) {
    if (!text) return;
    speechSynthesis.cancel();
    speechSynthesis.resume();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (selectedVoice) u.voice = selectedVoice;
    u.rate = 0.95;

    speechSynthesis.speak(u);
  }

  function speakSentence() {
    if (current) speakText(current.ENG);
  }

  function speakWord(word) {
    speakText(word);
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

  function normalize(text) {
    return text.toLowerCase().replace(/[^a-z']/g, ' ').replace(/\s+/g, ' ').trim();
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

  function attachWordListeners() {
    document.querySelectorAll('[data-word]').forEach(el =>
      el.addEventListener('click', () => speakWord(el.dataset.word))
    );
  }

  function adjustLevelByScore(success) {
    const lvl = current.CEFR;
    const delta = success
      ? SCORE_RULES.hits[lvl]
      : SCORE_RULES.errors[lvl];

    stats.score += delta;
    stats.level = levelFromScore(stats.score);
  }

  function levelFromScore(score) {
    if (score <= 30) return 'A1';
    if (score <= 60) return 'A2';
    if (score <= 70) return 'B1';
    if (score <= 80) return 'B2';
    if (score <= 90) return 'C1';
    return 'C2';
  }

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !current) {
      feedback.textContent = '❌ Reconhecimento não suportado';
      return;
    }

    const rec = new SR();
    rec.lang = 'en-US';

    rec.onstart = () => feedback.textContent = '🎙️ Ouvindo...';

    rec.onresult = e => {
      const spoken = normalize(e.results[0][0].transcript);
      const target = normalize(current.ENG);
      const score = similarity(spoken, target);

      englishText.innerHTML = highlightDifferences(target, spoken);
      attachWordListeners();

      if (score >= 0.75) {
        feedback.textContent = '✅ Boa pronúncia';
        stats.hits++;
        stats.weights[current.ENG] = Math.max(1, (stats.weights[current.ENG] || 1) - 1);
        adjustLevelByScore(true);
      } else {
        feedback.textContent = '❌ Atenção às palavras';
        stats.errors++;
        stats.weights[current.ENG] = (stats.weights[current.ENG] || 1) + 2;
        adjustLevelByScore(false);
      }

      saveAll();
      updateUI();
    };

    rec.onerror = () => feedback.textContent = '⚠️ Erro no reconhecimento';
    rec.start();
  }

  /* =======================
     UI / ESTADO
  ======================= */

  function toggleTranslation() {
    translationText.classList.toggle('hidden');
  }

  function toggleDataset() {
    datasetKey = datasetKey === 'frases' ? 'palavras' : 'frases';
    saveAll();
    loadDataset();
  }

  function toggleExamMode() {
    examMode = !examMode;
    saveAll();
    nextSentence();
    updateUI();
  }

  function resetProgress() {
    if (!confirm('Deseja apagar todo o progresso?')) return;

    stats = { level: 'A1', score: 0, hits: 0, errors: 0, weights: {} };
    examMode = false;
    datasetKey = 'frases';

    saveAll();
    loadDataset();
    updateUI();
  }

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent = `Nível: ${stats.level} | Pontos: ${stats.score}`;
    examModeBtn.textContent = examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
    toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
  }

  function saveAll() {
    if (!firebaseReady || !userRef) return;
    setDoc(userRef, { stats, datasetKey, examMode });
  }

});
