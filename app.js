document.addEventListener('DOMContentLoaded', () => {

  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];

  let data = [];
  let current = null;
  let examMode = false;

  let stats = {
    level: 'A1',
    hits: 0,
    errors: 0,
    weights: {}
  };

  const englishText = document.getElementById('englishText');
  const translationText = document.getElementById('translationText');
  const feedback = document.getElementById('feedback');
  const hitsEl = document.getElementById('hits');
  const errorsEl = document.getElementById('errors');
  const levelText = document.getElementById('levelText');

  /* ================= AUTH ================= */

  auth.onAuthStateChanged(async user => {
    if (!user) {
      location.href = 'login.html';
      return;
    }

    const ref = db.collection('users').doc(user.uid);
    const snap = await ref.get();

    if (snap.exists) {
      stats = snap.data().stats;
      examMode = snap.data().examMode;
    } else {
      await ref.set({ stats, examMode });
    }

    loadDataset();
    updateUI();
  });

  document.getElementById('logoutBtn').onclick = async () => {
    await auth.signOut();
    location.href = 'login.html';
  };

  /* ================= DATA ================= */

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
    feedback.textContent = '';
  }

  /* ================= SPEECH ================= */

  function speak(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  document.getElementById('playBtn').onclick = () => speak(current.ENG);

  /* ================= LISTEN ================= */

  document.getElementById('micBtn').onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-US';

    rec.onresult = e => {
      const spoken = e.results[0][0].transcript.toLowerCase();
      const target = current.ENG.toLowerCase();

      if (spoken === target) {
        stats.hits++;
        advanceLevel(true);
        feedback.textContent = '✅ Boa pronúncia';
      } else {
        stats.errors++;
        advanceLevel(false);
        feedback.textContent = '❌ Tente novamente';
      }

      saveStats();
      updateUI();
    };

    rec.start();
  };

  function advanceLevel(success) {
    let i = levels.indexOf(stats.level);
    if (success && i < levels.length - 1) stats.level = levels[i + 1];
    if (!success && i > 0) stats.level = levels[i - 1];
  }

  /* ================= UI ================= */

  document.getElementById('translateBtn').onclick = () =>
    translationText.classList.toggle('hidden');

  document.getElementById('nextBtn').onclick = nextSentence;

  document.getElementById('examModeBtn').onclick = () => {
    examMode = !examMode;
    nextSentence();
    saveStats();
  };

  function updateUI() {
    hitsEl.textContent = stats.hits;
    errorsEl.textContent = stats.errors;
    levelText.textContent = `Nível: ${stats.level}`;
    document.getElementById('examModeBtn').textContent =
      examMode ? '📝 Modo exame: ON' : '📝 Modo exame: OFF';
  }

  async function saveStats() {
    const user = auth.currentUser;
    if (user) {
      await db.collection('users').doc(user.uid).set(
        { stats, examMode },
        { merge: true }
      );
    }
  }

});
