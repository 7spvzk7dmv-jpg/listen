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

document.addEventListener('DOMContentLoaded', () => {

  /* =======================
     FIREBASE
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

  let user = null;
  let data = [];
  let current = null;
  let selectedVoice = null;

  let datasetKey = 'frases';
  let examMode = false;

  let stats = {
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
  const examModeBtn = document.getElementById('examModeBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  /* =======================
     AUTENTICAÇÃO
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
      const d = snap.data();
      stats = d.stats || stats;
      datasetKey = d.dataset || datasetKey;
      examMode = d.examMode || examMode;
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

  logoutBtn.onclick = async () => {
    await signOut(auth);
    location.href = 'login.html';
  };

  /* =======================
     EVENTOS
  ======================= */

  document.getElementById('playBtn').onclick = () => speakText(current?.ENG);
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
        voices.find(v => preferred.includes(v.name) && v.lang.startsWith('en'))
        || voices.find(v => v.lang === 'en-US')
        || voices[0];
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
    items.forEach(item => {
      const w = stats.weights[item.ENG] || 1;
      for (let i = 0; i < w; i++) pool.push(item);
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
     PRONÚNCIA (STT)
  ======================= */

  function normalize(text) {
    return text.toLowerCase().replace(/[^a-z']/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function similarity(a, b) {
    let same = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) same++;
    }
    return same / Math.max(a.length, b.length);
  }

  function adjustLevel(success) {
    let i = levels.indexOf(stats.level);
    if (success && i < levels.length - 1) i++;
    if (!success && i > 0) i--;
    stats.level = levels[i];
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

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !current) return;

    const rec = new SR();
    rec.lang = 'en-US';

    rec.onresult = async e => {
      const spoken = normalize(e.results[0][0].transcript);
      const target = normalize(current.ENG);
      const score = similarity(spoken, target);

      englishText.innerHTML = highlightDifferences(target, spoken);
      document.querySelectorAll('[data-word]').forEach(el =>
        el.onclick = () => speakText(el.dataset.word)
      );

      if (score >= 0.75) {
        feedback.textContent = '✅ Boa pronúncia';
        stats.hits++;
        adjustLevel(true);
      } else {
        feedback.textContent = '❌ Atenção às palavras';
        stats.errors++;
        adjustLevel(false);
      }

      await saveUserData();
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
    saveUserData();
    loadDataset();
  }

  function toggleExamMode() {
    examMode = !examMode;
    saveUserData();
    nextSentence();
    updateUI();
  }

  function resetProgress() {
    if (!confirm('Deseja apagar todo o progresso?')) return;
    stats = { level: 'A1', hits: 0, errors: 0, weights: {} };
    saveUserData();
    location.reload();
  }

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent = `Nível atual: ${stats.level}`;
    examModeBtn.textContent = examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
    toggleDatasetBtn.textContent = `Dataset: ${datasetKey}`;
  }

  async function saveUserData() {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), {
      stats,
      dataset: datasetKey,
      examMode
    }, { merge: true });
  }

});
