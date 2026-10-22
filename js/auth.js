/**
 * Authentication: Google sign-in through Firebase Auth.
 * Membership + role come from Firestore users/{email}; the same Firestore rules
 * enforce them server-side, so hiding buttons here is only a convenience.
 */
import { auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from './firebase.js';
import { getProfile } from './store.js';

const PROFILE_KEY = 'odea-ledger-profile';

export function waitForUser() {
  return new Promise((resolve) => { const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); }); });
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // Popups are often blocked on mobile / in-app browsers → fall back to redirect.
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

export async function logout() {
  sessionStorage.removeItem(PROFILE_KEY);
  await signOut(auth);
  location.replace('index.html');
}

const never = () => new Promise(() => {});

/** Resolve the signed-in member or redirect to the sign-in page. */
export async function requireMember() {
  const user = await waitForUser();
  const here = location.pathname.split('/').pop() + location.search;
  if (!user) { location.replace(`index.html?next=${encodeURIComponent(here)}`); return never(); }

  let profile = null;
  try {
    profile = await getProfile(user.email);
  } catch (e) {
    if (String(e.code).includes('permission-denied')) profile = null;
    else {
      // Offline or transient error — reuse the profile from this browser session if we have one.
      const cached = JSON.parse(sessionStorage.getItem(PROFILE_KEY) || 'null');
      if (cached?.email === user.email.toLowerCase()) profile = cached; else throw e;
    }
  }
  if (!profile) {
    await signOut(auth);
    location.replace(`index.html?denied=${encodeURIComponent(user.email)}`);
    return never();
  }
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return {
    user,
    profile: { ...profile, email: user.email.toLowerCase(), name: user.displayName || profile.name || user.email.split('@')[0], photo: user.photoURL || '' },
  };
}

export const canWrite = (p) => p?.role === 'admin' || p?.role === 'editor';
export const isAdmin = (p) => p?.role === 'admin';
export const roleLabel = (r) => ({ admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }[r] || r);
