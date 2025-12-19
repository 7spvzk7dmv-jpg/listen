document.addEventListener('DOMContentLoaded', async () => {

  const { onAuthStateChanged } =
    await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js');
  const { doc, getDoc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js');

  const auth = window.firebaseAuth;
  const db = window.firebaseDb;

  let userRef = null;
  let firebaseReady = false;

  /* =======================
     DOM
  ======================= */

  const playBtn = document.getElementById('playBtn');
  const micBtn = document.getElementById('micBtn');
  const translateBtn = document.getElementById('translateBtn');
  const nextBtn = document.getElementById('nextBtn');
  const resetBtn = document.getElementById('resetBtn');

  const englishText = document.getElementById('englishText');
  const translationText = document.getElementById('translationText');
  const feedback = document.getElementById('feedback');
  const hitsEl = document.getElementById('hits');
  const errorsEl = document.getElementById('errors');
  const levelText = document.getElementById('levelText');
  const toggleDatasetBtn = document.getElementById('toggleDataset');
  const examModeBtn = document.getElementById('examModeBtn');

  /* =======================
     CONFIG
  ======================= */

  const DATASETS = {
    frases: 'data/frases.json',
    palavras: 'data/palavras.json'
  };

  const SCORE_RULES = {
    hits:   { A1:1, A2:2, B1:2, B2:5, C1:5, C2:5 },
    errors: { A1:-5, A2:-5, B1:-5, B2:-3, C1:-3, C2:-1 }
  };

  const SCORE_MIN = 0;
  const SCORE_MAX = 100;
  const WINDOW_SIZE = 10;

  /* =======================
     ESTADO
  ======================= */

  let datasetKey = 'frases';
  let data = [];
  let current = null;
  let examMode = false;

  let stats = {
    level: 'A1',
    score: 0,
    hits: 0,
    errors: 0,
    streak: 0,
    recent: [],
    weights: {}
  };

  /* =======================
     UTIL
  ======================= */

  function clampScore(v) {
    return Math.min(SCORE_MAX, Math.max(SCORE_MIN, v));
  }

  function levelFromScore(score) {
    if (score <= 10) return 'A1';
    if (score <= 20) return 'A2';
    if (score <= 40) return 'B1';
    if (score <= 70) return 'B2';
    if (score <= 90) return 'C1';
    return 'C2';
  }

  function levelUpperBound(level) {
    return { A1:10, A2:20, B1:40, B2:70, C1:90, C2:100 }[level];
  }

  function normalize(t) {
    return t.toLowerCase().replace(/[^a-z']/g,' ').replace(/\s+/g,' ').trim();
  }

  function normalizeVowel(w) {
    return w.replace(/ee|ea|ie|ei|i/g,'i')
            .replace(/a|e/g,'a')
            .replace(/o|u/g,'o');
  }

  /* =======================
     TTS
  ======================= */

  let selectedVoice = null;

  function pickEnglishVoice() {
    const voices = speechSynthesis.getVoices();
    selectedVoice = voices.find(v => v.lang === 'en-US') || null;
  }

  speechSynthesis.onvoiceschanged = pickEnglishVoice;
  pickEnglishVoice();

  function speakText(text) {
    if (!selectedVoice) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = selectedVoice;
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  window.speakWord = speakText;

  /* =======================
     MODELO
  ======================= */

  function updateRecent(isHit) {
    stats.recent.push(isHit);
    if (stats.recent.length > WINDOW_SIZE) stats.recent.shift();
  }

  function recentAccuracy() {
    if (!stats.recent.length) return 1;
    return stats.recent.filter(Boolean).length / stats.recent.length;
  }

  function applyScore(isHit, accuracy) {
    let delta = isHit
      ? SCORE_RULES.hits[stats.level]
      : SCORE_RULES.errors[stats.level];

    if (!isHit && accuracy >= 0.9) delta = 0;

    stats.score = clampScore(stats.score + delta);
    stats.level = levelFromScore(stats.score);
  }

  /* =======================
     DATASET
  ======================= */

  async function loadDataset() {
    const r = await fetch(DATASETS[datasetKey]);
    data = await r.json();
    nextSentence();
  }

  function nextSentence() {
    const filtered = data.filter(d => d.CEFR === stats.level);
    current = filtered[Math.floor(Math.random() * filtered.length)];
    englishText.textContent = examMode ? '🎧 Ouça e repita' : current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* =======================
     STT
  ======================= */

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !current) return;

    const r = new SR();
    r.lang = 'en-US';

    r.onresult = e => {
      const spoken = normalize(e.results[0][0].transcript);
      const target = normalize(current.ENG);

      const accuracy = spoken === target ? 1 : 0;
      const isHit = accuracy >= 0.6;

      updateRecent(isHit);
      applyScore(isHit, accuracy);

      feedback.textContent = isHit ? '✅ Boa pronúncia' : '❌ Tente novamente';
      updateUI();
      saveAll();
    };

    r.start();
  }

  /* =======================
     UI
  ======================= */

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent = `Nível: ${stats.level} | Pontos: ${stats.score}`;
  }

  function saveAll() {
    if (!firebaseReady || !userRef) return;
    setDoc(userRef, { stats, datasetKey, examMode });
  }

  function init() {
    bindEvents();
    loadDataset();
    updateUI();
  }

  function bindEvents() {
    playBtn.onclick = () => current && speakText(current.ENG);
    micBtn.onclick = listen;
    translateBtn.onclick = () => translationText.classList.toggle('hidden');
    nextBtn.onclick = nextSentence;
    resetBtn.onclick = () => location.reload();
    toggleDatasetBtn.onclick = () => {
      datasetKey = datasetKey === 'frases' ? 'palavras' : 'frases';
      loadDataset();
    };
  }

  /* =======================
     AUTH (AGORA NÃO BLOQUEIA A UI)
  ======================= */

  onAuthStateChanged(auth, async user => {
    if (!user) return;

    userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const saved = snap.data();
      stats = { ...stats, ...(saved.stats || {}) };
    }
    firebaseReady = true;
    updateUI();
  });

  /* =======================
     START
  ======================= */

  init();

});
