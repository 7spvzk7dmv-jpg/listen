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
    recent: []
  };

  /* =======================
     LEVELS (EXATOS)
  ======================= */
  function levelFromScore(score) {
    if (score <= 10) return 'A1';
    if (score >= 11 && score <= 20) return 'A2';
    if (score >= 21 && score <= 40) return 'B1';
    if (score >= 41 && score <= 70) return 'B2';
    if (score >= 71 && score <= 90) return 'C1';
    if (score >= 91) return 'C2';
  }

  function clampScore(v) {
    return Math.min(SCORE_MAX, Math.max(SCORE_MIN, v));
  }

  /* =======================
     NORMALIZAÇÃO FONÉTICA
  ======================= */
  function normalize(t) {
    return t.toLowerCase()
      .replace(/[^a-z']/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function phonetic(w) {
    return w
      .replace(/ph/g,'f')
      .replace(/ck|c/g,'k')
      .replace(/qu/g,'k')
      .replace(/ee|ea|ie|ei|y/g,'i')
      .replace(/oo|ou|u/g,'o')
      .replace(/a|e/g,'a')
      .replace(/(.)\1+/g,'$1');
  }

  /* =======================
     STREAK / CONSISTÊNCIA
  ======================= */
  function updateRecent(isHit) {
    stats.recent.push(isHit);
    if (stats.recent.length > WINDOW_SIZE) stats.recent.shift();
  }

  function recentAccuracy() {
    if (!stats.recent.length) return 1;
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

  function evaluateLevel() {
    const acc = recentAccuracy();
    const upper = { A1:10, A2:20, B1:40, B2:70, C1:90, C2:100 }[stats.level];

    if (stats.score >= upper && acc >= 0.75 && stats.streak >= 3) {
      stats.level = levelFromScore(stats.score);
    }

    if (stats.score < upper - 10 && acc < 0.55) {
      stats.level = levelFromScore(stats.score);
    }
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
    speechSynthesis.speak(u);
  }

  window.speakWord = speakText;

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

    englishText.className =
      'text-2xl font-medium leading-relaxed select-text text-zinc-100';

    englishText.textContent = examMode ? '🎧 Ouça e repita' : current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* =======================
     DIFF + HIGHLIGHT (SAFARI SAFE)
  ======================= */
  function diffWords(spoken, target) {
    const s = spoken.split(' ');
    const t = target.split(' ');
    let si = 0;

    return t.map(word => {
      let ok = false;
      for (let j = si; j <= si + 1 && j < s.length; j++) {
        if (s[j] === word || phonetic(s[j]) === phonetic(word)) {
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
      w.ok
        ? `<span>${w.word}</span>`
        : `<span class="wrong bg-red-500/20 rounded px-1" onclick="speakWord('${w.word}')">${w.word}</span>`
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
      const spoken = normalize(e.results[0][0].transcript);
      const target = normalize(current.ENG);

      const diff = diffWords(spoken, target);
      const accuracy = diff.filter(w => w.ok).length / diff.length;
      const isHit = accuracy >= 0.6;

      updateRecent(isHit);
      applyStreak(isHit);

      let delta = isHit
        ? SCORE_RULES.hits[stats.level]
        : SCORE_RULES.errors[stats.level];

      stats.score = clampScore(stats.score + delta);
      evaluateLevel();

      if (isHit) {
        stats.hits++;
        feedback.textContent = '✅ Boa pronúncia';
        englishText.classList.add('bg-green-500/20');
        setTimeout(() => englishText.classList.remove('bg-green-500/20'), 300);
      } else {
        stats.errors++;
        feedback.textContent = '❌ Clique nas palavras erradas';
        englishText.classList.add('bg-red-500/20');
        setTimeout(() => englishText.classList.remove('bg-red-500/20'), 300);
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
  }

  function resetProgress() {
    if (!confirm('Deseja apagar todo o progresso?')) return;
    stats = { level:'A1', score:0, hits:0, errors:0, streak:0, recent:[] };
    saveAll();
    loadDataset();
    updateUI();
  }

  playBtn.onclick = () => current && speakText(current.ENG);
  micBtn.onclick = listen;
  translateBtn.onclick = () => translationText.classList.toggle('hidden');
  nextBtn.onclick = nextSentence;
  resetBtn.onclick = resetProgress;

  toggleDatasetBtn.onclick = () => {
    datasetKey = datasetKey === 'frases' ? 'palavras' : 'frases';
    loadDataset();
  };

  examModeBtn.onclick = () => {
    examMode = !examMode;
    nextSentence();
  };

  /* =======================
     FIREBASE
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

  function saveAll() {
    if (!firebaseReady || !userRef) return;
    setDoc(userRef, { stats, datasetKey, examMode });
  }

  /* =======================
     START
  ======================= */
  loadDataset();
  updateUI();

});
