document.addEventListener('DOMContentLoaded', () => {

  /* =======================
     FIREBASE (já inicializado no HTML)
  ======================= */

  const auth = window.firebaseAuth;
  const db = window.firebaseDb;

  const { onAuthStateChanged } = auth;
  const { doc, getDoc, setDoc } = window.firebaseFirestore;

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
  let user = null;

  let stats = {
    level: 'A1',
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
     PROTEÇÃO POR LOGIN
  ======================= */

  onAuthStateChanged(auth, async u => {
    if (!u) {
      location.href = 'login.html';
      return;
    }

    user = u;

    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const saved = snap.data();
      stats = saved.stats || stats;
      datasetKey = saved.dataset || datasetKey;
      examMode = saved.examMode || false;
    } else {
      await setDoc(ref, {
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

  document.getElementById('playBtn').onclick = speakSentence;
  document.getElementById('micBtn').onclick = listen;
  document.getElementById('translateBtn').onclick = toggleTranslation;
  document.getElementById('nextBtn').onclick = nextSentence;
  document.getElementById('resetBtn').onclick = resetProgress;
  toggleDatasetBtn.onclick = toggleDataset;
  examModeBtn.onclick = toggleExamMode;

  /* =======================
     VOZ (TTS)
  ======================= */

  function initVoices() {
    const preferred = ['Samantha', 'Daniel', 'Aaron'];

    function pick() {
      const voices = speechSynthesis.getVoices();
      selectedVoice =
        voices.find(v => preferred.includes(v.name) && v.lang.startsWith('en')) ||
        voices.find(v => v.lang === 'en-US') ||
        voices[0];
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

  function speakSentence() {
    if (current) speakText(current.ENG);
  }

  function speakWord(word) {
    speakText(word);
  }

  /* =======================
     DATASET / NÍVEIS
  ======================= */

  async function loadDataset() {
    const res = await fetch(DATASETS[datasetKey]);
    data = await res.json();
    nextSentence();
  }

  function weightedRandom(items) {
    const pool = [];
    items.forEach(i => {
      const w = stats.weights[i.ENG] || 1;
      for (let k = 0; k < w; k++) pool.push(i);
    });
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function nextSentence() {
    const byLevel = data.filter(d => d.CEFR === stats.level);
    current = weightedRandom(byLevel.length ? byLevel : data);

    englishText.textContent = examMode ? '🎧 Ouça e repita' : current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* =======================
     PRONÚNCIA
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
      const sc = similarity(w, s[i] || '');
      if (sc >= 0.85) return `<span>${w}</span>`;
      const cls = sc >= 0.5
        ? 'text-yellow-400 underline cursor-pointer'
        : 'text-red-400 underline cursor-pointer';
      return `<span class="${cls}" data-word="${w}">${w}</span>`;
    }).join(' ');
  }

  function attachWordListeners() {
    document.querySelectorAll('[data-word]').forEach(el => {
      el.onclick = () => speakWord(el.dataset.word);
    });
  }

  function adjustLevel(success) {
    let i = levels.indexOf(stats.level);
    if (success && i < levels.length - 1) i++;
    if (!success && i > 0) i--;
    stats.level = levels[i];
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
      attachWordListeners();

      if (score >= 0.75) {
        stats.hits++;
        feedback.textContent = '✅ Boa pronúncia';
        adjustLevel(true);
      } else {
        stats.errors++;
        feedback.textContent = '❌ Atenção às palavras';
        adjustLevel(false);
      }

      saveStats();
      updateUI();
    };

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
    saveStats();
    loadDataset();
  }

  function toggleExamMode() {
    examMode = !examMode;
    saveStats();
    nextSentence();
    updateUI();
  }

  function resetProgress() {
    if (!confirm('Deseja apagar todo o progresso?')) return;
    stats = { level: 'A1', hits: 0, errors: 0, weights: {} };
    saveStats();
    nextSentence();
    updateUI();
  }

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent = `Nível atual: ${stats.level}`;
    examModeBtn.textContent = examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
    toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
  }

  async function saveStats() {
    localStorage.setItem('stats', JSON.stringify(stats));
    if (!user) return;

    await setDoc(doc(db, 'users', user.uid), {
      stats,
      dataset: datasetKey,
      examMode
    }, { merge: true });
  }

});
