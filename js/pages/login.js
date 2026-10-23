import { isFirebaseConfigured } from '../config.js';
import { icons } from '../ui.js';

const alertBox = document.getElementById('login-alert');
const btn = document.getElementById('google-btn');
const label = btn.querySelector('span');
document.getElementById('year').textContent = new Date().getFullYear();

/** Short, friendly messages only. Technical details go to the browser console. */
function showAlert(text, tone = 'error') {
  alertBox.className = `lg-alert lg-alert--${tone}`;
  alertBox.innerHTML = `<i data-lucide="${tone === 'error' ? 'alert-circle' : 'info'}"></i><span></span>`;
  alertBox.querySelector('span').textContent = text;
  alertBox.hidden = false; icons(alertBox);
}
const hideAlert = () => { alertBox.hidden = true; };

icons();

if (!isFirebaseConfigured()) {
  btn.disabled = true;
  showAlert('Sign-in is not available yet.', 'warning');
  console.warn('[ODEA Ledger] Firebase config missing in js/config.js');
} else {
  init();
}

async function init() {
  const { waitForUser, signInWithGoogle, requireMember } = await import('../auth.js');
  const { getRedirectResult, auth } = await import('../firebase.js');

  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  const target = next && /^[\w-]+\.html(\?.*)?$/.test(next) ? next : 'dashboard.html';

  if (params.get('denied')) showAlert("This account doesn't have access. Please contact your admin.");

  getRedirectResult(auth).catch((e) => { console.error('[ODEA Ledger] sign-in', e); showAlert('Sign-in failed. Please try again.'); });

  const user = await waitForUser();
  if (user && !params.get('denied')) { btn.disabled = true; label.textContent = 'Signing you in…'; await requireMember(); location.replace(target); return; }

  btn.addEventListener('click', async () => {
    hideAlert();
    btn.disabled = true; label.textContent = 'Opening Google…';
    try {
      const cred = await signInWithGoogle();
      if (cred) { label.textContent = 'Signing you in…'; await requireMember(); location.replace(target); }
    } catch (e) {
      btn.disabled = false; label.textContent = 'Continue with Google';
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      console.error('[ODEA Ledger] sign-in', e.code, e.message);
      showAlert(e.code === 'auth/network-request-failed' ? 'No internet connection. Please try again.' : 'Sign-in failed. Please try again.');
    }
  });
}
