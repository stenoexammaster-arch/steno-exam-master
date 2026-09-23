// js/firebase-config.js
// Firebase + Firestore + Auth initialization

// Your original Firebase config
var firebaseConfig = {
  apiKey: "AIzaSyBZrUWeXGw1tYxRPtWJ6JMHchSkSBbfd54",
  authDomain: "stenotyping-91c6a.firebaseapp.com",
  projectId: "stenotyping-91c6a",
  storageBucket: "stenotyping-91c6a.firebasestorage.app",
  messagingSenderId: "885950226300",
  appId: "1:885950226300:web:df29d86a0dd72d31f30ef9",
  measurementId: "G-75GNKT8LBT"
};

// Initialize Firebase (avoid double-init)
if (!firebase.apps || !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
} else {
  firebase.app();
}

// Global helpers
try {
  if (firebase.firestore) {
    window.db = firebase.firestore();
  } else {
    window.db = null;
  }
} catch (e) {
  console.error("firebase.firestore error:", e);
  window.db = null;
}

try {
  if (firebase.auth) {
    window.auth = firebase.auth();
  } else {
    window.auth = null;
  }
} catch (e) {
  console.warn("firebase.auth not available on this page:", e);
  window.auth = null;
}