document.addEventListener('DOMContentLoaded', async () => {

  const { doc, getDoc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js');
  const { onAuthStateChanged } =
    await import('https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js');

  const auth = window.firebaseAuth;
  const db = window.firebaseDb;

  let userRef = null;

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

  onAuthStateChanged(auth, async user => {
    if (!user) return;

    userRef = doc(db, 'users', user.uid);

    const snap = await getDoc(userRef);
    if (snap.exists()) stats = snap.data();

    init();
  });

  function init() {
    initVoices();
    loadDataset();
    updateUI();
  }

  function saveStats() {
    if (userRef) setDoc(userRef, stats);
  }

  /* === TTS === */

  let selectedVoice = null;

  function initVoices() {
    function pick() {
      const v = speechSynthesis.getVoices();
      selectedVoice = v.find(x => x.lang.startsWith('en')) || v[0];
    }
    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  function speak(text) {
    speechSynthesis.cancel();
    speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (selectedVoice) u.voice = selectedVoice;
    speechSynthesis.speak(u);
  }

  /* === DATA === */

  async function loadDataset() {
    const res = await fetch(DATASETS[datasetKey]);
    data = await res.json();
    nextSentence();
  }

  function nextSentence() {
    current = data[Math.floor(Math.random() * data.length)];
    englishText.textContent = examMode ? '🎧 Ouça e repita' : current.ENG;
    translationText.textContent = current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent = '';
  }

  /* === STT === */

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      feedback.textContent = '❌ STT não suportado';
      return;
    }

    const r = new SR();
    r.lang = 'en-US';

    r.onresult = e => {
      const spoken = e.results[0][0].transcript.toLowerCase();
      const target = current.ENG.toLowerCase();

      if (spoken === target) {
        stats.hits++;
        feedback.textContent = '✅ Boa pronúncia';
      } else {
        stats.errors++;
        feedback.textContent = '❌ Tente novamente';
      }

      saveStats();
      updateUI();
    };

    r.start();
  }

  /* === UI === */

  playBtn.onclick = () => speak(current.ENG);
  micBtn.onclick = listen;
  nextBtn.onclick = nextSentence;
  translateBtn.onclick = () => translationText.classList.toggle('hidden');

  function updateUI() {
    hits.textContent = stats.hits;
    errors.textContent = stats.errors;
    levelText.textContent = `Nível atual: ${stats.level}`;
  }

});
