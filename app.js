document.addEventListener('DOMContentLoaded', () => {

  /* =======================
     FIREBASE (GLOBAL)
  ======================= */

  const auth = window.firebaseAuth;
  const db = window.firebaseDb;

  if (!auth || !db) {
    alert('Firebase não carregou corretamente.');
    return;
  }

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
  let user = null;

  let examMode = false;

  let stats = {
    level: 'A1',
    hits: 0,
    errors: 0,
    weights: {}
  };

  let selectedVoice = null;

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
  const logoutBtn = document.getElementById('logoutBtn');

  /* =======================
     AUTENTICAÇÃO
  ======================= */

  auth.onAuthStateChanged(async u => {
    if (!u) {
      location.href = 'login.html';
      return;
    }

    user = u;

    const ref = db.collection('users').doc(user.uid);
    const snap = await ref.get();

    if (snap.exists) {
      const d = snap.data();
      stats = d.stats || stats;
      datasetKey = d.dataset || datasetKey;
      examMode = d.examMode || false;
    } else {
      await ref.set({
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

  logoutBtn?.addEventListener('click', async () => {
    await auth.signOut();
    location.href = 'login.html';
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
     VOZ
  ======================= */

  function initVoices() {
    const preferred = ['Samantha', 'Google US English', 'Daniel'];

    const pick = () => {
      const voices = speechSynthesis.getVoices();
      selectedVoice =
        voices.find(v => preferred.includes(v.name)) ||
        voices.find(v => v.lang === 'en-US') ||
        voices[0];
    };

    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  function speak(text) {
    if (!text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (selectedVoice) u.voice = selectedVoice;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  function speakSentence() {
    if (current) speak(current.ENG);
  }

  function speakWord(w) {
    speak(w);
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
    items.forEach(i => {
      const w = stats.weights[i.ENG] || 1;
      for (let x = 0; x < w; x++) pool.push(i);
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
     PRONÚNCIA
  ======================= */

  function normalize(t) {
    return t.toLowerCase().replace(/[^a-z']/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function similarity(a, b) {
    let same = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      if (a[i] === b[i]) same++;
    return same / Math.max(a.length, b.length);
  }

  function highlight(target, spoken) {
    const t = target.split(' ');
    const s = spoken.split(' ');

    return t.map((w, i) => {
      const sc = similarity(w, s[i] || '');
      if (sc >= 0.85) return `<span>${w}</span>`;
      return `<span class="text-red-400 underline cursor-pointer" data-word="${w}">${w}</span>`;
    }).join(' ');
  }

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !current) return;

    const rec = new SR();
    rec.lang = 'en-US';

    rec.onresult = async e => {
      const spoken = normalize(e.results[0][0].transcript);
      const target = normalize(current.ENG);
      const score = similarity(spoken, target);

      englishText.innerHTML = highlight(target, spoken);
      document.querySelectorAll('[data-word]').forEach(el =>
        el.onclick = () => speakWord(el.dataset.word)
      );

      if (score >= 0.75) {
        stats.hits++;
        stats.weights[current.ENG] = Math.max(1, (stats.weights[current.ENG] || 1) - 1);
        adjustLevel(true);
        feedback.textContent = '✅ Boa pronúncia';
      } else {
        stats.errors++;
        stats.weights[current.ENG] = (stats.weights[current.ENG] || 1) + 2;
        adjustLevel(false);
        feedback.textContent = '❌ Atenção às palavras';
      }

      await saveStats();
      updateUI();
    };

    rec.start();
  }

  /* =======================
     CEFR
  ======================= */

  function adjustLevel(success) {
    let i = levels.indexOf(stats.level);
    if (success && i < levels.length - 1) i++;
    if (!success && i > 0) i--;
    stats.level = levels[i];
  }

  /* =======================
     UI
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
    if (!confirm('Resetar progresso?')) return;
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
    await db.collection('users').doc(user.uid).set({
      stats,
      dataset: datasetKey,
      examMode
    }, { merge: true });
  }

});
