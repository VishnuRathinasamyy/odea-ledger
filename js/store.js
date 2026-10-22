/**
 * Firestore data layer. Collections:
 *   transactions/{autoId}  — one document per entry (text + Drive links only)
 *   settings/app           — categories, monthly budget
 *   users/{email}          — who can use the app and their role (admin | editor | viewer)
 *
 * Amounts are stored as integer paise (amountPaise) — never floats.
 */
import {
  db, auth, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, serverTimestamp,
} from './firebase.js';
import { CONFIG } from './config.js';
import { fromPaise } from './utils.js';

const txCol = () => collection(db, 'transactions');
const me = () => (auth.currentUser?.email || '').toLowerCase();

/* ---------------- Transactions ---------------- */
function normalize(snap) {
  const d = snap.data();
  return {
    id: snap.id,
    ...d,
    amount: fromPaise(d.amountPaise),
    createdAtDate: d.createdAt?.toDate?.() || null,
    updatedAtDate: d.updatedAt?.toDate?.() || null,
    pending: snap.metadata?.hasPendingWrites || false,
  };
}

/** Newest first: by date, then by creation time. */
export function sortTransactions(list) {
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAtDate?.getTime?.() || Infinity) - (a.createdAtDate?.getTime?.() || Infinity));
}

// One realtime listener per page, shared by every consumer (page + notifications).
let txCache = null, txError = null, txUnsub = null;
const txListeners = new Set();

export function watchTransactions(onData, onError) {
  txListeners.add({ onData, onError });
  if (txCache) onData(txCache);
  if (txError) onError?.(txError);
  if (!txUnsub) {
    txUnsub = onSnapshot(
      query(txCol(), orderBy('date', 'desc')),
      { includeMetadataChanges: false },
      (snap) => {
        txError = null;
        txCache = sortTransactions(snap.docs.map(normalize));
        txListeners.forEach((l) => l.onData(txCache));
      },
      (err) => { txError = err; txListeners.forEach((l) => l.onError?.(err)); },
    );
  }
  return () => txListeners.forEach((l) => { if (l.onData === onData) txListeners.delete(l); });
}
export const cachedTransactions = () => txCache || [];

export async function getTransaction(id) {
  const snap = await getDoc(doc(db, 'transactions', id));
  return snap.exists() ? normalize(snap) : null;
}

/**
 * Firestore resolves writes only after the server acknowledges them.
 * When offline we return immediately — the write stays queued in the local
 * cache and syncs automatically once the connection is back.
 */
function commit(promise) {
  if (!navigator.onLine) { promise.catch((e) => console.error('Queued write failed', e)); return Promise.resolve({ queued: true }); }
  return promise.then((r) => ({ queued: false, ref: r }));
}

export function createTransaction(data) {
  const email = me();
  return commit(addDoc(txCol(), {
    ...data,
    createdBy: email, updatedBy: email,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
}

export function updateTransaction(id, data) {
  return commit(updateDoc(doc(db, 'transactions', id), { ...data, updatedBy: me(), updatedAt: serverTimestamp() }));
}

export function deleteTransaction(id) {
  return commit(deleteDoc(doc(db, 'transactions', id)));
}

/** Re-create a deleted entry with the same id (used by "Undo"). */
export function restoreTransaction(tx) {
  const { id, amount, createdAtDate, updatedAtDate, pending, createdAt, updatedAt, ...rest } = tx;
  return commit(setDoc(doc(db, 'transactions', id), { ...rest, createdBy: me(), updatedBy: me(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
}

/* ---------------- Settings ---------------- */
export const DEFAULT_SETTINGS = () => ({ categories: [...CONFIG.defaultCategories], monthlyBudgetPaise: 0 });
let settingsCache = null, settingsUnsub = null;
const settingsListeners = new Set();

export function watchSettings(onData) {
  settingsListeners.add(onData);
  if (settingsCache) onData(settingsCache);
  if (!settingsUnsub) {
    settingsUnsub = onSnapshot(doc(db, 'settings', 'app'), (snap) => {
      const d = snap.exists() ? snap.data() : {};
      settingsCache = {
        ...DEFAULT_SETTINGS(), ...d,
        categories: Array.isArray(d.categories) && d.categories.length ? d.categories : [...CONFIG.defaultCategories],
        monthlyBudget: fromPaise(d.monthlyBudgetPaise || 0),
      };
      settingsListeners.forEach((fn) => fn(settingsCache));
    }, (err) => {
      console.warn('Settings unavailable, using defaults', err);
      settingsCache = { ...DEFAULT_SETTINGS(), monthlyBudget: 0 };
      settingsListeners.forEach((fn) => fn(settingsCache));
    });
  }
  return () => settingsListeners.delete(onData);
}

export function saveSettings(patch) {
  return commit(setDoc(doc(db, 'settings', 'app'), { ...patch, updatedBy: me(), updatedAt: serverTimestamp() }, { merge: true }));
}

/* ---------------- Users & roles ---------------- */
export async function getProfile(email) {
  const snap = await getDoc(doc(db, 'users', email.toLowerCase()));
  return snap.exists() ? { email: snap.id, ...snap.data() } : null;
}
export async function listUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => ({ email: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email));
}
export function saveUser(email, { role, name = '' }) {
  return commit(setDoc(doc(db, 'users', email.trim().toLowerCase()), { role, name, addedBy: me(), addedAt: serverTimestamp() }, { merge: true }));
}
export function removeUser(email) {
  return commit(deleteDoc(doc(db, 'users', email.toLowerCase())));
}

/** Friendly message for Firestore errors. */
export function explainError(err) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'You do not have permission for this action. Ask an admin to check your role.';
  if (code.includes('unavailable')) return 'Cannot reach the database right now. Check your internet connection.';
  if (code.includes('unauthenticated')) return 'Your session expired. Please sign in again.';
  if (code.includes('failed-precondition')) return 'Database is not ready (index or setup missing). See README.';
  return err?.message || 'Unexpected error';
}
