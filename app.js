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

  let stats = JSON.parse(localStorage.getItem('stats')) || {
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

  /* =======================
     EVENTOS
  ======================= */

  document.getElementById('playBtn').onclick = speak;
  document.getElementById('micBtn').onclick = listen;
  document.getElementById('translateBtn').onclick = toggleTranslation;
  document.getElementById('nextBtn').onclick = nextSentence;
  document.getElementById('resetBtn').onclick = resetProgress;
  toggleDatasetBtn.onclick = toggleDataset;

  loadDataset();

  /* =======================
     DATASET
  ======================= */

  async function loadDataset() {
    try {
      const res = await fetch(DATASETS[datasetKey]);
      data = await res.json();
      nextSentence();
      updateUI();
    } catch (e) {
      englishText.textContent = 'Erro ao carregar dataset.';
      console.error(e);
    }
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
    if (!data.length) return;

    const filtered = data.filter(d => d.CEFR === stats.level);
    current = weightedRandom(filtered.length ? filtered : data);

    englishText.textContent = current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* =======================
     ÁUDIO (TTS)
  ======================= */

  function speak() {
    if (!current) return;
    const u = new SpeechSynthesisUtterance(current.ENG);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  /* =======================
     PRONÚNCIA (STT)
  ======================= */

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;

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
      if (score >= 0.5)
        return `<span class="text-yellow-400 underline">${w}</span>`;
      return `<span class="text-red-400 underline">${w}</span>`;
    }).join(' ');
  }

  function listen() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      feedback.textContent = 'Reconhecimento de voz não suportado.';
      return;
    }

    const rec = new SpeechRecognition();

    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      feedback.textContent = '🎙️ Ouvindo... fale agora';
    };

    rec.onerror = e => {
      feedback.textContent = '⚠️ Erro no microfone: ' + e.error;
    };

    rec.onend = () => {
      if (feedback.textContent === '🎙️ Ouvindo... fale agora') {
        feedback.textContent = '⚠️ Não ouvi nada. Tente falar mais alto.';
      }
    };

    rec.onresult = e => {
      const spokenRaw = e.results[0][0].transcript;
      const spoken = normalize(spokenRaw);
      const target = normalize(current.ENG);

      const score = similarity(spoken, target);

      englishText.innerHTML = highlightDifferences(target, spoken);

      if (score >= 0.75) {
        feedback.textContent = '✅ Boa pronúncia geral';
        stats.hits++;
        stats.weights[current.ENG] =
          Math.max(1, (stats.weights[current.ENG] || 1) - 1);
        adjustLevel(true);
      } else {
        feedback.textContent = '❌ Atenção às palavras destacadas';
        stats.errors++;
        stats.weights[current.ENG] =
          (stats.weights[current.ENG] || 1) + 2;
        adjustLevel(false);
      }

      saveStats();
      updateUI();
    };

    // Safari iOS precisa desse pequeno atraso
    setTimeout(() => rec.start(), 100);
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
     UI / ESTADO
  ======================= */

  function toggleTranslation() {
    translationText.classList.toggle('hidden');
  }

  function toggleDataset() {
    datasetKey = datasetKey === 'frases' ? 'palavras' : 'frases';
    localStorage.setItem('dataset', datasetKey);
    loadDataset();
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
    toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
  }

  function saveStats() {
    localStorage.setItem('stats', JSON.stringify(stats));
  }

});
