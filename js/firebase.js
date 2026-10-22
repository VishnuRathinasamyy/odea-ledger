/**
 * Firebase bootstrap. Every other module imports Firebase functions from here,
 * so the SDK version lives in exactly one place.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged, setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { CONFIG } from './config.js';

export const app = initializeApp(CONFIG.firebase);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Offline cache: entries typed while offline are queued and synced automatically.
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  firestore = initializeFirestore(app, {});
}
export const db = firestore;

export {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, serverTimestamp,
};
