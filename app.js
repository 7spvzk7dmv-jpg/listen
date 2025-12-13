const DATASETS = {
  frases: '/data/frases.json',
  palavras: '/data/palavras.json'
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

// DOM
const englishText = document.getElementById('englishText');
const translationText = document.getElementById('translationText');
const feedback = document.getElementById('feedback');
const hitsEl = document.getElementById('hits');
const errorsEl = document.getElementById('errors');
const levelText = document.getElementById('levelText');

// Eventos
document.getElementById('toggleDataset').onclick = toggleDataset;
document.getElementById('playBtn').onclick = speak;
document.getElementById('micBtn').onclick = listen;
document.getElementById('translateBtn').onclick = toggleTranslation;
document.getElementById('nextBtn').onclick = nextSentence;
document.getElementById('resetBtn').onclick = resetProgress;

// Inicialização
loadDataset();

/* =======================
   DATASET E SORTEIO
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

  englishText.textContent = current.ENG;
  translationText.textContent = current.PTBR;
  translationText.classList.add('hidden');
  feedback.textContent = '';
}

/* =======================
   ÁUDIO
======================= */

function speak() {
  const u = new SpeechSynthesisUtterance(current.ENG);
  u.lang = 'en-US';
  speechSynthesis.speak(u);
}

/* =======================
   PRONÚNCIA
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

  const len = Math.max(a.length, b.length);
  let same = 0;

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) same++;
  }
  return same / len;
}

function highlightDifferences(target, spoken) {
  const tWords = target.split(' ');
  const sWords = spoken.split(' ');

  return tWords.map((word, i) => {
    const sw = sWords[i] || '';
    const score = similarity(word, sw);

    if (score >= 0.85) {
      return `<span>${word}</span>`;
    }
    if (score >= 0.5) {
      return `<span class="text-yellow-400 underline decoration-yellow-400">${word}</span>`;
    }
    return `<span class="text-red-400 underline decoration-red-400">${word}</span>`;
  }).join(' ');
}

function listen() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert('Speech Recognition não suportado neste navegador.');
    return;
  }

  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.start();

  rec.onresult = e => {
    const spokenRaw = e.results[0][0].transcript;
    const spoken = normalize(spokenRaw);
    const target = normalize(current.ENG);

    const score = similarity(spoken, target);

    englishText.innerHTML = highlightDifferences(target, spoken);

    if (score >= 0.75) {
      feedback.textContent = '✅ Boa pronúncia geral';
      stats.hits++;
      adjustLevel(true);
      stats.weights[current.ENG] = Math.max(1, (stats.weights[current.ENG] || 1) - 1);
    } else {
      feedback.textContent = '❌ Atenção às palavras destacadas';
      stats.errors++;
      adjustLevel(false);
      stats.weights[current.ENG] = (stats.weights[current.ENG] || 1) + 2;
    }

    saveStats();
    updateUI();
  };
}

/* =======================
   PROGRESSÃO CEFR
======================= */

function adjustLevel(success) {
  let idx = levels.indexOf(stats.level);
  if (success && idx < levels.length - 1) idx++;
  if (!success && idx > 0) idx--;
  stats.level = levels[idx];
}

/* =======================
   UI E ESTADO
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
  if (!confirm('Deseja realmente apagar todo o progresso?')) return;
  localStorage.clear();
  location.reload();
}

function updateUI() {
  hitsEl.textContent = stats.hits;
  errorsEl.textContent = stats.errors;
  levelText.textContent = `Nível atual: ${stats.level}`;
  document.getElementById('toggleDataset').textContent =
    `Dataset: ${datasetKey}`;
}

function saveStats() {
  localStorage.setItem('stats', JSON.stringify(stats));
}
