import { isFirebaseConfigured } from '../config.js';
import { icons } from '../ui.js';
import { esc } from '../utils.js';

const alertBox = document.getElementById('login-alert');
const btn = document.getElementById('google-btn');
document.getElementById('year').textContent = new Date().getFullYear();

function showAlert(html, tone = 'error') {
  alertBox.className = `login__alert login__alert--${tone}`;
  alertBox.innerHTML = html; alertBox.hidden = false; icons(alertBox);
}

icons();

if (!isFirebaseConfigured()) {
  btn.disabled = true;
  showAlert(`<i data-lucide="wrench"></i><div><strong>Setup needed</strong><span>Add your Firebase project details in <code>js/config.js</code>. The README walks through it step by step.</span></div>`, 'warning');
} else {
  init();
}

async function init() {
  // Imported lazily so the setup notice above works even without a valid Firebase config.
  const { waitForUser, signInWithGoogle, requireMember } = await import('../auth.js');
  const { getRedirectResult, auth } = await import('../firebase.js');

  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  const target = next && /^[\w-]+\.html(\?.*)?$/.test(next) ? next : 'dashboard.html';   // only same-site pages

  if (params.get('denied')) {
    showAlert(`<i data-lucide="user-x"></i><div><strong>No access yet</strong><span><b>${esc(params.get('denied'))}</b> is not on the team list. Ask an admin to add this email in Settings → Team access.</span></div>`);
  }

  getRedirectResult(auth).catch((e) => showAlert(`<i data-lucide="alert-octagon"></i><div><strong>Sign-in failed</strong><span>${esc(e.message)}</span></div>`));

  const user = await waitForUser();
  if (user && !params.get('denied')) { btn.disabled = true; await requireMember(); location.replace(target); return; }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Opening Google…';
    try {
      const cred = await signInWithGoogle();
      if (cred) { btn.querySelector('span').textContent = 'Checking access…'; await requireMember(); location.replace(target); }
    } catch (e) {
      btn.disabled = false; btn.querySelector('span').textContent = 'Continue with Google';
      if (e.code === 'auth/popup-closed-by-user') return;
      const msg = e.code === 'auth/unauthorized-domain'
        ? 'This website address is not authorised in Firebase. Add it under Authentication → Settings → Authorized domains.'
        : e.message;
      showAlert(`<i data-lucide="alert-octagon"></i><div><strong>Sign-in failed</strong><span>${esc(msg)}</span></div>`);
    }
  });
}
