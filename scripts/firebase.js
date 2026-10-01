import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "REPLACE_WITH_FIREBASE_WEB_API_KEY",
  authDomain: "vivid-cinema.firebaseapp.com",
  projectId: "vivid-cinema",
  appId: "1:1016345599146:web:bc00fd2f6ac15486ba44d3",
  messagingSenderId: "1016345599146"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
