document.addEventListener('DOMContentLoaded', () => {

  /* =======================
     CONFIGURAÇÃO GERAL
  ======================= */

  const DATASETS = {
    frases: 'data/frases.json',
    palavras: 'data/palavras.json'
  };

  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];

  let datasetKey = localStorage.getItem('dataset') || 'frases';
  let data = [];
  let current = null;

  let examMode = JSON.parse(localStorage.getItem('examMode')) || false;

  let stats = JSON.parse(localStorage.getItem('stats')) || {
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
     EVENTOS
  ======================= */

  document.getElementById('playBtn').addEventListener('click', speakSentence);
  document.getElementById('micBtn').addEventListener('click', listen);
  document.getElementById('translateBtn').addEventListener('click', toggleTranslation);
  document.getElementById('nextBtn').addEventListener('click', nextSentence);
  document.getElementById('resetBtn').addEventListener('click', resetProgress);
  toggleDatasetBtn.addEventListener('click', toggleDataset);
  examModeBtn.addEventListener('click', toggleExamMode);

  initVoices();
  loadDataset();

  /* =======================
     VOZ (TTS) — FIX ANDROID
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
    speechSynthesis.resume(); // 🔥 ESSENCIAL NO ANDROID

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (selectedVoice) u.voice = selectedVoice;
    u.rate = 0.95;
    u.pitch = 1.0;

    speechSynthesis.speak(u);
  }

  function speakSentence() {
    if (!current) return;
    speakText(current.ENG);
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
    updateUI();
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

    englishText.textContent = examMode
      ? '🎧 Ouça e repita'
      : current.ENG;

    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* =======================
     PRONÚNCIA (STT) — FIX ANDROID
  ======================= */

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

      const cls =
        score >= 0.5
          ? 'text-yellow-400 underline cursor-pointer'
          : 'text-red-400 underline cursor-pointer';

      return `<span class="${cls}" data-word="${w}">${w}</span>`;
    }).join(' ');
  }

  function attachWordListeners() {
    document.querySelectorAll('[data-word]').forEach(el => {
      el.addEventListener('click', () => speakWord(el.dataset.word));
    });
  }

  function listen() {
    const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!SR || !current) {
      feedback.textContent = '❌ Reconhecimento não suportado';
      return;
    }

    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

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
        stats.weights[current.ENG] =
          Math.max(1, (stats.weights[current.ENG] || 1) - 1);
        adjustLevel(true);
      } else {
        feedback.textContent = '❌ Atenção às palavras';
        stats.errors++;
        stats.weights[current.ENG] =
          (stats.weights[current.ENG] || 1) + 2;
        adjustLevel(false);
      }

      saveStats();
      updateUI();
    };

    rec.onerror = () => {
      feedback.textContent = '⚠️ Erro no reconhecimento de voz';
    };

    rec.start();
  }

  /* =======================
     PROGRESSÃO CEFR
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
    localStorage.setItem('dataset', datasetKey);
    loadDataset();
  }

  function toggleExamMode() {
    examMode = !examMode;
    localStorage.setItem('examMode', JSON.stringify(examMode));
    nextSentence();
    updateUI();
  }

  function resetProgress() {
    if (!confirm('Deseja apagar todo o progresso?')) return;
    localStorage.clear();
    location.reload();
  }

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent = `Nível atual: ${stats.level}`;
    examModeBtn.textContent = examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
    toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
  }

  function saveStats() {
    localStorage.setItem('stats', JSON.stringify(stats));
  }

});
