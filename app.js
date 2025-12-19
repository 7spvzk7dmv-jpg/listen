<script>
document.addEventListener('DOMContentLoaded', async () => {

  const { onAuthStateChanged } =
    await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js');
  const { doc, getDoc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js');

  const auth = window.firebaseAuth;
  const db = window.firebaseDb;

  let userRef = null;
  let firebaseReady = false;

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
     DOM
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
     UTIL
  ======================= */

  function clampScore(v) {
    return Math.min(SCORE_MAX, Math.max(SCORE_MIN, v));
  }

  function levelFromScore(score) {
    if (score <= 10) return 'A1';
    if (score >= 11 && score <= 20) return 'A2';
    if (score >= 21 && score <= 40) return 'B1';
    if (score >= 41 && score <= 70) return 'B2';
    if (score >= 71 && score <= 90) return 'C1';
    if (score >= 91) return 'C2';
  }

  function normalize(t) {
    return t.toLowerCase().replace(/[^a-z']/g,' ').replace(/\s+/g,' ').trim();
  }

  function normalizeVowel(w) {
    return w
      .replace(/ee|ea|ie|ei|i/g,'i')
      .replace(/a|e/g,'a')
      .replace(/o|u/g,'o');
  }

  function updateRecent(isHit) {
    stats.recent.push(isHit);
    if (stats.recent.length > WINDOW_SIZE) {
      stats.recent.shift();
    }
  }

  function recentAccuracy() {
    if (stats.recent.length === 0) return 1;
    return stats.recent.filter(Boolean).length / stats.recent.length;
  }

  function applyStreak(isHit) {
    if (isHit) {
      stats.streak++;
      if (stats.streak === 3) stats.score += 1;
      if (stats.streak === 5) stats.score += 2;
      if (stats.streak >= 8) stats.score += 1;
    } else {
      stats.streak = 0;
    }
  }

  function applyScore(isHit, accuracy) {
    let delta = isHit
      ? SCORE_RULES.hits[stats.level]
      : SCORE_RULES.errors[stats.level];

    // Proteção contra STT injusto
    if (!isHit && accuracy >= 0.9) {
      delta = 0;
    }

    stats.score = clampScore(stats.score + delta);
    applyStreak(isHit);
    stats.score = clampScore(stats.score);
  }

  function evaluateLevel() {
    const acc = recentAccuracy();

    // Subida com histerese
    if (
      stats.score >= SCORE_MAX &&
      acc >= 0.75 &&
      stats.streak >= 3
    ) {
      stats.level = levelFromScore(stats.score);
      return;
    }

    // Regressão controlada
    if (
      stats.score <= SCORE_MIN &&
      acc < 0.55 &&
      stats.recent.slice(-5).filter(v => !v).length >= 3
    ) {
      stats.level = levelFromScore(stats.score);
    }
  }

  /* =======================
     AUTH
  ======================= */

  onAuthStateChanged(auth, async user => {
    if (!user) return;

    userRef = doc(db, 'users', user.uid);

    try {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const saved = snap.data();
        stats = { ...stats, ...(saved.stats || {}) };
        datasetKey = saved.datasetKey || datasetKey;
        examMode = saved.examMode || false;
      }
      firebaseReady = true;
    } catch {}

    stats.score = clampScore(stats.score);
    stats.level = levelFromScore(stats.score);
    init();
  });

  /* =======================
     INIT
  ======================= */

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
    resetBtn.onclick = resetProgress;
    toggleDatasetBtn.onclick = toggleDataset;
    examModeBtn.onclick = toggleExamMode;
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
    englishText.innerHTML = examMode ? '🎧 Ouça e repita' : current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* =======================
     STT
  ======================= */

  function diffWords(spoken, target) {
    const s = spoken.split(' ');
    const t = target.split(' ');
    let si = 0;

    return t.map(word => {
      let ok = false;
      for (let j = si; j <= si + 1 && j < s.length; j++) {
        if (
          s[j] === word ||
          (datasetKey === 'palavras' &&
           word.length <= 4 &&
           normalizeVowel(s[j]) === normalizeVowel(word))
        ) {
          ok = true;
          si = j + 1;
          break;
        }
      }
      return { word, ok };
    });
  }

  function renderDiff(diff) {
    englishText.innerHTML = diff.map(w =>
      w.ok ? w.word :
      `<span class="wrong" onclick="speakWord('${w.word}')">${w.word}</span>`
    ).join(' ');
  }

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !current) return;

    const r = new SR();
    r.lang = 'en-US';

    r.onresult = e => {
      const spoken = normalize(e.results[0][0].transcript);
      const target = normalize(current.ENG);

      const diff = diffWords(spoken, target);
      const accuracy = diff.filter(w => w.ok).length / diff.length;
      const isHit = accuracy >= 0.6;

      updateRecent(isHit);
      applyScore(isHit, accuracy);
      evaluateLevel();

      if (isHit) {
        feedback.textContent = '✅ Boa pronúncia';
        stats.hits++;
      } else {
        feedback.textContent = '❌ Clique nas palavras destacadas';
        stats.errors++;
        if (!examMode) renderDiff(diff);
      }

      updateUI();
      saveAll();
    };

    r.start();
  }

  /* =======================
     UI
  ======================= */

  function toggleDataset() {
    datasetKey = datasetKey === 'frases' ? 'palavras' : 'frases';
    saveAll();
    loadDataset();
    updateUI();
  }

  function toggleExamMode() {
    examMode = !examMode;
    saveAll();
    nextSentence();
    updateUI();
  }

  function resetProgress() {
    if (!confirm('Deseja apagar todo o progresso?')) return;
    stats = {
      level:'A1',
      score:0,
      hits:0,
      errors:0,
      streak:0,
      recent:[],
      weights:{}
    };
    datasetKey = 'frases';
    examMode = false;
    saveAll();
    loadDataset();
    updateUI();
  }

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent =
      `Nível: ${stats.level} | Pontos: ${stats.score} | Streak: ${stats.streak}`;
    examModeBtn.textContent = examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
    toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
  }

  function saveAll() {
    if (!firebaseReady || !userRef) return;
    setDoc(userRef, { stats, datasetKey, examMode });
  }

});
</script>
