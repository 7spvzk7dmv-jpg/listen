import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

/* =======================
   FIREBASE CONFIG
======================= */

const firebaseConfig = {
  apiKey: "AIzaSyDHEzqBQ00kk3zACQU_tqJzvAVFM6erxks",
  authDomain: "tca-listen-english.firebaseapp.com",
  projectId: "tca-listen-english",
  storageBucket: "tca-listen-english.firebasestorage.app",
  messagingSenderId: "727416842890",
  appId: "1:727416842890:web:89b1d0215b297a7563db73"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

let stats = {
  level: 'A1',
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
const examModeBtn = document.getElementById('examModeBtn');
const toggleDatasetBtn = document.getElementById('toggleDataset');
const logoutBtn = document.getElementById('logoutBtn');

/* =======================
   AUTH GUARD
======================= */

let userRef = null;

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = 'login.html';
    return;
  }

  userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const d = snap.data();
    stats = d.stats || stats;
    datasetKey = d.dataset || datasetKey;
    examMode = d.examMode || false;
  } else {
    await setDoc(userRef, { stats, dataset: datasetKey, examMode });
  }

  await loadDataset();
  updateUI();
});

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
    for (let j = 0; j < w; j++) pool.push(i);
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
   TTS
======================= */

function speak(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* =======================
   STT + PROGRESSÃO CEFR
======================= */

function normalize(t) {
  return t.toLowerCase().replace(/[^a-z']/g, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] === b[i]) s++;
  return s / Math.max(a.length, b.length);
}

function adjustLevel(success) {
  let i = levels.indexOf(stats.level);
  if (success && i < levels.length - 1) i++;
  if (!success && i > 0) i--;
  stats.level = levels[i];
}

function listen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  const rec = new SR();
  rec.lang = 'en-US';

  rec.onresult = e => {
    const spoken = normalize(e.results[0][0].transcript);
    const target = normalize(current.ENG);
    const score = similarity(spoken, target);

    if (score >= 0.75) {
      stats.hits++;
      adjustLevel(true);
      feedback.textContent = '✅ Boa pronúncia';
    } else {
      stats.errors++;
      adjustLevel(false);
      feedback.textContent = '❌ Atenção';
    }

    save();
    updateUI();
  };

  rec.start();
}

/* =======================
   SAVE
======================= */

async function save() {
  await setDoc(userRef, {
    stats,
    dataset: datasetKey,
    examMode
  }, { merge: true });
}

/* =======================
   UI
======================= */

function updateUI() {
  hitsEl.textContent = stats.hits;
  errorsEl.textContent = stats.errors;
  levelText.textContent = `Nível atual: ${stats.level}`;
  examModeBtn.textContent = examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
  toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
}

/* =======================
   EVENTS
======================= */

document.getElementById('playBtn').onclick = () => speak(current.ENG);
document.getElementById('micBtn').onclick = listen;
document.getElementById('translateBtn').onclick = () => translationText.classList.toggle('hidden');
document.getElementById('nextBtn').onclick = nextSentence;
document.getElementById('resetBtn').onclick = async () => {
  if (!confirm('Resetar progresso?')) return;
  stats = { level: 'A1', hits: 0, errors: 0, weights: {} };
  await save();
  updateUI();
};

toggleDatasetBtn.onclick = async () => {
  datasetKey = datasetKey === 'frases' ? 'palavras' : 'frases';
  await save();
  loadDataset();
};

examModeBtn.onclick = async () => {
  examMode = !examMode;
  await save();
  nextSentence();
};

logoutBtn.onclick = async () => {
  await signOut(auth);
  location.href = 'login.html';
};
