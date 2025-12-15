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
   ESTADO
======================= */

const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];

let stats = {
  level: 'A1',
  hits: 0,
  errors: 0,
  weights: {}
};

let data = [];
let current = null;
let examMode = false;

/* =======================
   DOM
======================= */

const englishText = document.getElementById('englishText');
const translationText = document.getElementById('translationText');
const feedback = document.getElementById('feedback');
const hitsEl = document.getElementById('hits');
const errorsEl = document.getElementById('errors');
const levelText = document.getElementById('levelText');

/* =======================
   AUTH
======================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = 'login.html';
    return;
  }

  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    stats = snap.data().stats;
    examMode = snap.data().examMode || false;
  } else {
    await setDoc(ref, { stats, examMode });
  }

  await loadDataset();
  updateUI();
});

/* =======================
   DATA
======================= */

async function loadDataset() {
  const res = await fetch('data/frases.json');
  data = await res.json();
  nextSentence();
}

function nextSentence() {
  const filtered = data.filter(d => d.CEFR === stats.level);
  current = filtered[Math.floor(Math.random() * filtered.length)];
  englishText.textContent = examMode ? '🎧 Ouça e repita' : current.ENG;
  translationText.textContent = current.PTBR;
  translationText.classList.add('hidden');
}

/* =======================
   VOZ
======================= */

function speak(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* =======================
   EVENTOS
======================= */

playBtn.onclick = () => speak(current.ENG);
translateBtn.onclick = () => translationText.classList.toggle('hidden');
nextBtn.onclick = nextSentence;
examModeBtn.onclick = () => {
  examMode = !examMode;
  nextSentence();
  save();
};
logoutBtn.onclick = async () => {
  await signOut(auth);
  location.href = 'login.html';
};

/* =======================
   PROGRESSÃO CEFR
======================= */

micBtn.onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'en-US';

  rec.onresult = e => {
    const spoken = e.results[0][0].transcript.toLowerCase();
    const target = current.ENG.toLowerCase();

    if (spoken === target) {
      stats.hits++;
      if (levels.indexOf(stats.level) < levels.length - 1) {
        stats.level = levels[levels.indexOf(stats.level) + 1];
      }
      feedback.textContent = '✅ Boa pronúncia';
    } else {
      stats.errors++;
      if (levels.indexOf(stats.level) > 0) {
        stats.level = levels[levels.indexOf(stats.level) - 1];
      }
      feedback.textContent = '❌ Atenção';
    }

    save();
    updateUI();
  };

  rec.start();
};

async function save() {
  hitsEl.textContent = stats.hits;
  errorsEl.textContent = stats.errors;
  levelText.textContent = `Nível: ${stats.level}`;

  const user = auth.currentUser;
  if (user) {
    await setDoc(doc(db, 'users', user.uid), { stats, examMode });
  }
}

function updateUI() {
  hitsEl.textContent = stats.hits;
  errorsEl.textContent = stats.errors;
  levelText.textContent = `Nível: ${stats.level}`;
}
