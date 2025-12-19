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
    hits: { A1:1, A2:3, B1:5, B2:7, C1:9, C2:10 },
    errors:{ A1:-10, A2:-8, B1:-6, B2:-4, C1:-2, C2:-1 }
  };

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

  let selectedVoice = null;

  const englishText = document.getElementById('englishText');
  const translationText = document.getElementById('translationText');
  const feedback = document.getElementById('feedback');
  const hitsEl = document.getElementById('hits');
  const errorsEl = document.getElementById('errors');
  const levelText = document.getElementById('levelText');
  const toggleDatasetBtn = document.getElementById('toggleDataset');
  const examModeBtn = document.getElementById('examModeBtn');

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

    stats.score = Number.isFinite(stats.score) ? stats.score : 0;
    init();
  });

  function init() {
    initVoices();
    bindEvents();
    loadDataset();
    updateUI();
  }

  function bindEvents() {
    playBtn.onclick = speakSentence;
    micBtn.onclick = listen;
    translateBtn.onclick = toggleTranslation;
    nextBtn.onclick = nextSentence;
    resetBtn.onclick = resetProgress;
    toggleDatasetBtn.onclick = toggleDataset;
    examModeBtn.onclick = toggleExamMode;
  }

  function initVoices() {
    const preferred = ['Samantha','Daniel','Aaron'];
    const pick = () => {
      const v = speechSynthesis.getVoices();
      selectedVoice =
        v.find(x=>preferred.includes(x.name)&&x.lang.startsWith('en')) ||
        v.find(x=>x.lang==='en-US') || v[0];
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  function speakText(t) {
    if (!t) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'en-US';
    if (selectedVoice) u.voice = selectedVoice;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  function speakSentence(){ if(current) speakText(current.ENG); }
  function speakWord(w){ speakText(w); }

  async function loadDataset() {
    const r = await fetch(DATASETS[datasetKey]);
    data = await r.json();
    nextSentence();
    updateUI();
  }

  function weightedRandom(items){
    const p=[];
    items.forEach(i=>{
      const w=stats.weights[i.ENG]||1;
      for(let j=0;j<w;j++)p.push(i);
    });
    return p[Math.floor(Math.random()*p.length)];
  }

  function nextSentence(){
    const f=data.filter(d=>d.CEFR===stats.level);
    current=weightedRandom(f.length?f:data);
    englishText.textContent=examMode?'🎧 Ouça e repita':current.ENG;
    translationText.textContent=current.PTBR;
    translationText.classList.add('hidden');
    feedback.textContent='';
  }

  function normalize(t){
    return t.toLowerCase().replace(/[^a-z']/g,' ').replace(/\s+/g,' ').trim();
  }

  function similarity(a,b){
    let s=0;
    for(let i=0;i<Math.min(a.length,b.length);i++)
      if(a[i]===b[i])s++;
    return s/Math.max(a.length,b.length);
  }

  function levelFromScore(score) {
    if (score <= 30) return 'A1';
    if (score >= 31 && score <= 60) return 'A2';
    if (score >= 61 && score <= 70) return 'B1';
    if (score >= 71 && score <= 80) return 'B2';
    if (score >= 81 && score <= 90) return 'C1';
    if (score >= 91) return 'C2';
  }

  function adjustLevelByScore(success){
    const q=current.CEFR;
    stats.score += success
      ? SCORE_RULES.hits[q]
      : SCORE_RULES.errors[q];
    stats.level=levelFromScore(stats.score);
  }

  function listen(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR||!current){feedback.textContent='❌ Não suportado';return;}
    const r=new SR(); r.lang='en-US';
    r.onstart=()=>feedback.textContent='🎙️ Ouvindo...';
    r.onresult=e=>{
      const sp=normalize(e.results[0][0].transcript);
      const tg=normalize(current.ENG);
      const sc=similarity(sp,tg);
      if(sc>=0.75){
        feedback.textContent='✅ Boa pronúncia';
        stats.hits++; adjustLevelByScore(true);
      }else{
        feedback.textContent='❌ Atenção às palavras';
        stats.errors++; adjustLevelByScore(false);
      }
      saveAll(); updateUI();
    };
    r.start();
  }

  function toggleTranslation(){ translationText.classList.toggle('hidden'); }

  function toggleDataset(){
    datasetKey=datasetKey==='frases'?'palavras':'frases';
    toggleDatasetBtn.textContent=`Dataset: ${datasetKey}`;
    saveAll(); loadDataset();
  }

  function toggleExamMode(){
    examMode=!examMode;
    saveAll(); nextSentence(); updateUI();
  }

  function resetProgress(){
    if(!confirm('Deseja apagar todo o progresso?'))return;
    stats={level:'A1',score:0,hits:0,errors:0,weights:{}};
    examMode=false; datasetKey='frases';
    saveAll(); loadDataset();
  }

  function updateUI(){
    hitsEl.textContent=stats.hits;
    errorsEl.textContent=stats.errors;
    levelText.textContent=`Nível: ${stats.level} | Pontos: ${stats.score}`;
    examModeBtn.textContent=examMode?'📝 Modo exame: ON':'📝 Modo exame: OFF';
    toggleDatasetBtn.textContent=`Dataset: ${datasetKey}`;
  }

  function saveAll(){
    if(!firebaseReady||!userRef)return;
    setDoc(userRef,{stats,datasetKey,examMode});
  }

});
