<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
  import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
  import { getFirestore } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyDHEzqBQ00kk3zACQU_tqJzvAVFM6erxks",
    authDomain: "tca-listen-english.firebaseapp.com",
    projectId: "tca-listen-english",
    storageBucket: "tca-listen-english.firebasestorage.app",
    messagingSenderId: "727416842890",
    appId: "1:727416842890:web:89b1d0215b297a7563db73"
  };

  const app = initializeApp(firebaseConfig);

  window.firebaseAuth = getAuth(app);
  window.firebaseDb = getFirestore(app);
  window.googleProvider = new GoogleAuthProvider();
</script>
