document.addEventListener('DOMContentLoaded', async () => {

  /* =======================
     FIREBASE
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
     DOM
  ======================= */
  const playBtn = document.getElementById('playBtn');
  const micBtn = document.getElementById('micBtn');
  const translateBtn = document.getElementById('translateBtn');
  const nextBtn = document.getElementById('nextBtn');
  const resetBtn = document.getElementById('resetBtn');
  const toggleDatasetBtn = document.getElementById('toggleDataset');
  const examModeBtn = document.getElementById('examModeBtn');

  const englishText = document.getElementById('englishText');
  const translationText = document.getElementById('translationText');
  const feedback = document.getElementById('feedback');
  const hitsEl = document.getElementById('hits');
  const errorsEl = document.getElementById('errors');
  const levelText = document.getElementById('levelText');

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
     STATE
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
    recent: []
  };

  /* =======================
     LEVELS — EXATOS (SEM ALTERAÇÃO)
  ======================= */
  function levelFromScore(score) {
    if (score <= 10) return 'A1';
    if (score >= 11 && score <= 20) return 'A2';
    if (score >= 21 && score <= 40) return 'B1';
    if (score >= 41 && score <= 70) return 'B2';
    if (score >= 71 && score <= 90) return 'C1';
    if (score >= 91) return 'C2';
  }

  const clampScore = v =>
    Math.min(SCORE_MAX, Math.max(SCORE_MIN, v));

  /* =======================
     NORMALIZAÇÃO
  ======================= */
  function normalizeText(t) {
    return t.toLowerCase()
      .replace(/[^a-z']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* =======================
     FONÉTICA CONTROLADA
  ======================= */
  function phoneticCore(w) {
    return w
      .replace(/ph/g,'f')
      .replace(/ck|c/g,'k')
      .replace(/qu/g,'k')
      .replace(/th/g,'t')
      .replace(/dg|j/g,'j')
      .replace(/ee|ea|ie|ei|y/g,'i')
      .replace(/oo|ou|u/g,'o')
      .replace(/a|e/g,'a')
      .replace(/h/g,'')
      .replace(/(.)\1+/g,'$1')
      .replace(/[^a-z]/g,'');
  }

  function hasInvalidStrongEnding(spokenCore, targetRaw) {
    if (!/(er|or|ar)$/i.test(targetRaw)) return false;
    return /(ter|der|er|r)$/.test(spokenCore);
  }

  function coreMatch(spoken, target) {
    if (!spoken || !target) return false;
    if (hasInvalidStrongEnding(spoken, target)) return false;
    if (spoken === target) return true;

    const len = Math.min(spoken.length, target.length);
    let same = 0;
    for (let i = 0; i < len; i++) {
      if (spoken[i] === target[i]) same++;
    }

    return same >= len - 1 &&
           Math.abs(spoken.length - target.length) <= 1;
  }

  /* =======================
     STREAK / CONSISTÊNCIA
  ======================= */
  function updateRecent(hit) {
    stats.recent.push(hit);
    if (stats.recent.length > WINDOW_SIZE)
      stats.recent.shift();
  }

  function recentAccuracy() {
    if (!stats.recent.length) return 1;
    return stats.recent.filter(Boolean).length / stats.recent.length;
  }

  function applyStreak(hit) {
    if (hit) {
      stats.streak++;
      if (stats.streak === 3) stats.score += 1;
      if (stats.streak === 5) stats.score += 2;
    } else {
      stats.streak = 0;
    }
  }

  function evaluateLevel() {
    const acc = recentAccuracy();
    const upper = {
      A1:10, A2:20, B1:40, B2:70, C1:90, C2:100
    }[stats.level];

    if (stats.score >= upper && acc >= 0.8 && stats.streak >= 3)
      stats.level = levelFromScore(stats.score);

    if (stats.score < upper - 10 && acc < 0.55)
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
    if (!filtered.length) return;
    current = filtered[Math.floor(Math.random() * filtered.length)];
    englishText.textContent = examMode ? '🎧 Ouça e repita' : current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* =======================
     DIFF
  ======================= */
  function diffWords(spoken, target) {
    const s = spoken.split(' ');
    const t = target.split(' ');
    let si = 0;

    return t.map(word => {
      let ok = false;
      const targetCore = phoneticCore(word);

      for (let j = si; j <= si + 1 && j < s.length; j++) {
        const spokenCore = phoneticCore(s[j]);
        if (coreMatch(spokenCore, targetCore)) {
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

  /* =======================
     STT
  ======================= */
  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !current) return;

    const r = new SR();
    r.lang = 'en-US';

    r.onresult = e => {
      const spoken = normalizeText(e.results[0][0].transcript);
      const target = normalizeText(current.ENG);

      const diff = diffWords(spoken, target);
      const accuracy = diff.filter(w => w.ok).length / diff.length;
      const hit = accuracy >= 0.8;

      updateRecent(hit);
      applyStreak(hit);

      stats.score = clampScore(
        stats.score +
        (hit ? SCORE_RULES.hits[stats.level] : SCORE_RULES.errors[stats.level])
      );

      evaluateLevel();

      if (hit) {
        stats.hits++;
        feedback.textContent = '✅ Boa pronúncia';
      } else {
        stats.errors++;
        feedback.textContent = '❌ Clique nas palavras erradas';
        if (!examMode) renderDiff(diff);
      }

      updateUI();
      saveAll();
    };

    r.start();
  }

  /* =======================
     UI / EVENTS
  ======================= */
  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent =
      `Nível: ${stats.level} | Pontos: ${stats.score} | Streak: ${stats.streak}`;

    toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
    examModeBtn.textContent =
      examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
  }

  function saveAll() {
    if (!firebaseReady || !userRef) return;
    setDoc(userRef, { stats, datasetKey, examMode });
  }

  playBtn.onclick = () => current && speakWord(current.ENG);
  micBtn.onclick = listen;
  translateBtn.onclick = () =>
    translationText.classList.toggle('hidden');
  nextBtn.onclick = nextSentence;

  resetBtn.onclick = () => {
    if (!confirm('Deseja apagar todo o progresso?')) return;
    stats = {
      level:'A1', score:0, hits:0, errors:0, streak:0, recent:[]
    };
    saveAll();
    loadDataset();
    updateUI();
  };

  toggleDatasetBtn.onclick = () => {
    datasetKey = datasetKey === 'frases' ? 'palavras' : 'frases';
    saveAll();
    loadDataset();
    updateUI();
  };

  examModeBtn.onclick = () => {
    examMode = !examMode;
    saveAll();
    nextSentence();
    updateUI();
  };

  /* =======================
     AUTH
  ======================= */
  onAuthStateChanged(auth, async user => {
    if (!user) return;
    userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const saved = snap.data();
      stats = { ...stats, ...(saved.stats || {}) };
      datasetKey = saved.datasetKey || datasetKey;
      examMode = saved.examMode || false;
    }
    firebaseReady = true;
    stats.score = clampScore(stats.score);
    stats.level = levelFromScore(stats.score);
    updateUI();
  });

  loadDataset();
  updateUI();
});
