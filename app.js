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

const englishText = document.getElementById('englishText');
const translationText = document.getElementById('translationText');
const feedback = document.getElementById('feedback');
const hitsEl = document.getElementById('hits');
const errorsEl = document.getElementById('errors');
const levelText = document.getElementById('levelText');

let stats = { level: 'A1', hits: 0, errors: 0 };
let current = null;
let data = [];

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = 'login.html';
    return;
  }

  document.getElementById('logoutBtn').onclick = async () => {
    await signOut(auth);
    location.href = 'login.html';
  };

  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    stats = snap.data().stats;
  } else {
    await setDoc(ref, { stats });
  }

  loadData();
});

async function loadData() {
  const res = await fetch('data/frases.json');
  data = await res.json();
  next();
  updateUI();
}

function next() {
  current = data.find(d => d.CEFR === stats.level) || data[0];
  englishText.textContent = current.ENG;
  translationText.textContent = current.PTBR;
  translationText.classList.add('hidden');
}

document.getElementById('playBtn').onclick = () => {
  const u = new SpeechSynthesisUtterance(current.ENG);
  u.lang = 'en-US';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

document.getElementById('micBtn').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.onresult = async e => {
    const ok = e.results[0][0].confidence > 0.7;
    ok ? stats.hits++ : stats.errors++;
    await setDoc(doc(db, 'users', auth.currentUser.uid), { stats });
    updateUI();
  };
  rec.start();
};

document.getElementById('translateBtn').onclick = () =>
  translationText.classList.toggle('hidden');

document.getElementById('nextBtn').onclick = next;

function updateUI() {
  hitsEl.textContent = stats.hits;
  errorsEl.textContent = stats.errors;
  levelText.textContent = `Nível: ${stats.level}`;
}
