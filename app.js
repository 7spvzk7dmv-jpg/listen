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
    hits:   { A1:1, A2:3, B1:5, B2:7, C1:9, C2:10 },
    errors: { A1:-10, A2:-8, B1:-6, B2:-4, C1:-2, C2:-1 }
  };

  const SCORE_MIN = 0;
  const SCORE_MAX = 100;

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
     TTS ROBUSTO
  ======================= */

  let selectedVoice = null;

  function pickEnglishVoice() {
    const voices = speechSynthesis.getVoices();
    selectedVoice =
      voices.find(v => v.lang === 'en-US' && /Google|Daniel|Samantha|Aaron/i.test(v.name)) ||
      voices.find(v => v.lang === 'en-US') ||
      null;
  }

  speechSynthesis.onvoiceschanged = pickEnglishVoice;
  pickEnglishVoice();

  function speakText(text) {
    if (!selectedVoice) {
      feedback.textContent = '⚠️ Voz inglesa indisponível';
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = selectedVoice;
    u.lang = 'en-US';
    u.rate = 0.9;
    u.pitch = 1;
    speechSynthesis.speak(u);
  }

  window.speakWord = speakText;

  /* =======================
     UTIL
  ======================= */

  function clampScore(v) {
    return Math.min(SCORE_MAX, Math.max(SCORE_MIN, v));
  }

  function levelFromScore(score) {
    if (score <= 20) return 'A1';
    if (score >= 21 && score <= 40) return 'A2';
    if (score >= 41 && score <= 60) return 'B1';
    if (score >= 61 && score <= 80) return 'B2';
    if (score >= 81 && score <= 90) return 'C1';
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
        stats = saved.stats || stats;
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
     STT COM TOLERÂNCIA VOCÁLICA
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

      if (accuracy >= 0.6) {
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
    stats = { level:'A1', score:0, hits:0, errors:0, weights:{} };
    datasetKey = 'frases';
    examMode = false;
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
