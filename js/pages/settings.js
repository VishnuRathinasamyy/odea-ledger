import { boot, getTheme, setTheme } from '../layout.js';
import { CONFIG, isDriveConfigured } from '../config.js';
import { watchSettings, saveSettings, listUsers, saveUser, removeUser, watchTransactions, explainError } from '../store.js';
import { pingDrive } from '../drive.js';
import { roleLabel } from '../auth.js';
import { esc, evaluateExpression, toPaise, formatINR, initials, todayISO } from '../utils.js';
import { icons, ic, toast, confirmDialog, busy } from '../ui.js';
import { exportCSV, download } from '../export.js';

const ctx = await boot('settings', { title: 'Settings' });
const $ = (id) => document.getElementById(id);
let settings = null, tx = [];

if (!ctx.isAdmin) document.querySelector('[data-viewer-note]').hidden = false;

/* ---------------- Budget ---------------- */
watchSettings((s) => {
  settings = s;
  if (document.activeElement !== $('budget-input')) $('budget-input').value = s.monthlyBudget ? String(s.monthlyBudget) : '';
  $('budget-hint').textContent = s.monthlyBudget ? `Current budget: ${formatINR(s.monthlyBudget)} per month` : 'No budget set';
  renderCategories();
});
$('budget-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = $('budget-input').value.trim();
  const r = raw ? evaluateExpression(raw) : { ok: true, value: 0 };
  if (!r.ok || r.value < 0) return toast('Enter a valid amount', 'warning');
  const done = busy(e.submitter, 'Saving…');
  try { await saveSettings({ monthlyBudgetPaise: toPaise(r.value) }); toast(r.value ? `Budget set to ${formatINR(r.value)}` : 'Budget removed', 'success'); }
  catch (err) { toast('Could not save', 'error', { detail: explainError(err) }); }
  finally { done(); }
});

/* ---------------- Categories ---------------- */
function renderCategories() {
  if (!settings) return;
  const used = new Map(); tx.forEach((t) => used.set(t.category, (used.get(t.category) || 0) + 1));
  $('cat-list').innerHTML = settings.categories.map((c, i) => `
    <span class="cat-pill" draggable="true" data-i="${i}">${ic('grip-vertical', 'ic--xs cat-pill__grip')}<span>${esc(c)}</span>
      ${used.get(c) ? `<small>${used.get(c)}</small>` : ''}
      <button type="button" data-remove="${i}" aria-label="Remove ${esc(c)}">${ic('x', 'ic--xs')}</button></span>`).join('');
  icons($('cat-list'));
}
watchTransactions((list) => { tx = list; renderCategories(); });

async function saveCats(list, msg) {
  try { await saveSettings({ categories: list }); if (msg) toast(msg, 'success', { duration: 2500 }); }
  catch (err) { toast('Could not save categories', 'error', { detail: explainError(err) }); }
}
$('cat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('cat-input').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (settings.categories.some((c) => c.toLowerCase() === name.toLowerCase())) return toast('That category already exists', 'warning');
  const list = [...settings.categories];
  const other = list.indexOf('Other');
  other >= 0 ? list.splice(other, 0, name) : list.push(name);   // keep "Other" last
  $('cat-input').value = '';
  saveCats(list, `Added “${name}”`);
});
$('cat-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-remove]'); if (!b) return;
  const name = settings.categories[Number(b.dataset.remove)];
  if (settings.categories.length <= 1) return toast('Keep at least one category', 'warning');
  if (!(await confirmDialog({ title: `Remove “${esc(name)}”?`, message: 'It will disappear from the entry form. Existing entries keep this category.', confirmText: 'Remove', danger: true }))) return;
  saveCats(settings.categories.filter((c) => c !== name), `Removed “${name}”`);
});
// Drag to reorder
let dragFrom = null;
$('cat-list').addEventListener('dragstart', (e) => { const p = e.target.closest('[data-i]'); if (p) { dragFrom = Number(p.dataset.i); p.classList.add('is-dragging'); } });
$('cat-list').addEventListener('dragover', (e) => e.preventDefault());
$('cat-list').addEventListener('drop', (e) => {
  e.preventDefault(); const p = e.target.closest('[data-i]'); if (p == null || dragFrom == null) return;
  const to = Number(p.dataset.i); if (to === dragFrom) return;
  const list = [...settings.categories]; const [m] = list.splice(dragFrom, 1); list.splice(to, 0, m); dragFrom = null;
  saveCats(list);
});
$('cat-list').addEventListener('dragend', () => { dragFrom = null; $('cat-list').querySelectorAll('.is-dragging').forEach((x) => x.classList.remove('is-dragging')); });
$('cat-reset').addEventListener('click', async () => {
  if (await confirmDialog({ title: 'Restore default categories?', message: 'Your custom categories will be replaced by the default list. Past entries are not changed.', confirmText: 'Restore' }))
    saveCats([...CONFIG.defaultCategories], 'Default categories restored');
});

/* ---------------- Team ---------------- */
async function loadTeam() {
  if (!ctx.isAdmin) return;
  try {
    const users = await listUsers();
    const admins = users.filter((u) => u.role === 'admin').length;
    $('team-list').innerHTML = users.map((u) => {
      const me = u.email === ctx.profile.email;
      const locked = me || (u.role === 'admin' && admins <= 1);
      return `<div class="team__row" data-email="${esc(u.email)}">
        <span class="avatar">${esc(initials(u.name || u.email))}</span>
        <div class="team__who"><strong>${esc(u.name || u.email.split('@')[0])}${me ? ' <span class="tag">You</span>' : ''}</strong><small>${esc(u.email)}</small></div>
        <select class="select select--sm" data-role ${locked ? 'disabled title="You can’t change your own role or remove the last admin"' : ''}>
          ${['admin', 'editor', 'viewer'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}
        </select>
        <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-remove-user ${locked ? 'disabled' : ''} aria-label="Remove ${esc(u.email)}">${ic('user-minus')}</button>
      </div>`;
    }).join('');
    icons($('team-list'));
  } catch (err) { $('team-list').innerHTML = `<p class="field__error" style="display:flex">${esc(explainError(err))}</p>`; }
}
$('team-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('team-email').value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email address', 'warning');
  const done = busy(e.submitter, 'Adding…');
  try { await saveUser(email, { role: $('team-role').value }); $('team-email').value = ''; toast(`${email} can now sign in`, 'success', { detail: `Role: ${roleLabel($('team-role').value)}` }); loadTeam(); }
  catch (err) { toast('Could not add member', 'error', { detail: explainError(err) }); }
  finally { done(); }
});
$('team-list').addEventListener('change', async (e) => {
  if (!e.target.matches('[data-role]')) return;
  const email = e.target.closest('[data-email]').dataset.email;
  try { await saveUser(email, { role: e.target.value }); toast(`${email} is now ${roleLabel(e.target.value)}`, 'success'); loadTeam(); }
  catch (err) { toast('Could not change role', 'error', { detail: explainError(err) }); loadTeam(); }
});
$('team-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-remove-user]'); if (!b) return;
  const email = b.closest('[data-email]').dataset.email;
  if (!(await confirmDialog({ title: 'Remove access?', message: `<strong>${esc(email)}</strong> will no longer be able to open the ledger. Their past entries stay.`, confirmText: 'Remove access', danger: true }))) return;
  try { await removeUser(email); toast('Access removed', 'success'); loadTeam(); }
  catch (err) { toast('Could not remove', 'error', { detail: explainError(err) }); }
});
loadTeam();

/* ---------------- Drive ---------------- */
function driveCard(html) { $('drive-card').innerHTML = html; icons($('drive-card')); }
function renderDrive() {
  if (!isDriveConfigured()) {
    $('drive-steps').hidden = false;
    driveCard(`<div class="drive-card__status is-off">${ic('plug-zap')}<div><strong>Not connected</strong><small>No Apps Script URL in js/config.js yet</small></div></div>`);
    return;
  }
  driveCard(`<div class="drive-card__status is-on">${ic('hard-drive-upload')}<div><strong>Connected</strong><small>${esc(CONFIG.driveProxyUrl.replace(/^https:\/\//, '').slice(0, 52))}…</small></div>
    <button class="btn btn--light btn--sm" type="button" id="drive-test">${ic('activity')}Test connection</button></div><div id="drive-result"></div>`);
  $('drive-test').addEventListener('click', async (e) => {
    const done = busy(e.currentTarget, 'Testing…'); const out = $('drive-result');
    try {
      const r = await pingDrive();
      out.innerHTML = `<dl class="about about--drive">
        <div><dt>Status</dt><dd><span class="tag tag--income">${ic('check', 'ic--xs')}Working</span></dd></div>
        <div><dt>Bills folder</dt><dd><a class="link" href="${esc(r.root.url)}" target="_blank" rel="noopener">${esc(r.root.name)} ${ic('external-link', 'ic--xs')}</a></dd></div>
        <div><dt>Owner account</dt><dd>${esc(r.owner || '—')}</dd></div>
        <div><dt>Your access</dt><dd>${esc(roleLabel(r.role))} (${esc(r.email)})</dd></div>
        <div><dt>This month's folder</dt><dd>${esc(r.monthFolder)}</dd></div></dl>`;
    } catch (err) {
      out.innerHTML = `<p class="drive-err">${ic('alert-octagon')}<span>${esc(err.message)}</span></p>`;
    } finally { done(); icons(out); }
  });
}
renderDrive();

/* ---------------- Appearance ---------------- */
const themeVal = getTheme();
document.querySelector(`#theme-pick input[value="${themeVal}"]`).checked = true;
$('theme-pick').addEventListener('change', (e) => { setTheme(e.target.value); toast('Appearance updated', 'success', { duration: 1500 }); });

/* ---------------- Data ---------------- */
$('dl-csv').addEventListener('click', () => { if (!tx.length) return toast('No entries yet', 'warning'); exportCSV(tx, { name: 'all-entries' }); });
$('dl-json').addEventListener('click', () => {
  if (!tx.length) return toast('No entries yet', 'warning');
  const clean = tx.map(({ createdAtDate, updatedAtDate, pending, amount, createdAt, updatedAt, ...t }) => ({ ...t, amount, createdAt: createdAtDate?.toISOString() || null, updatedAt: updatedAtDate?.toISOString() || null }));
  download(new Blob([JSON.stringify({ app: CONFIG.appName, exportedAt: new Date().toISOString(), exportedBy: ctx.profile.email, settings, transactions: clean }, null, 2)], { type: 'application/json' }), `odea-ledger-backup_${todayISO()}.json`);
});
$('about').innerHTML = `
  <div><dt>Signed in as</dt><dd>${esc(ctx.profile.email)} · ${roleLabel(ctx.profile.role)}</dd></div>
  <div><dt>Database</dt><dd>Firebase Firestore · ${esc(CONFIG.firebase.projectId)}</dd></div>
  <div><dt>Timezone</dt><dd>${esc(CONFIG.timezone)} (all months are calculated in IST)</dd></div>
  <div><dt>Version</dt><dd>ODEA Ledger 1.0</dd></div>`;

// Scroll-spy for the settings nav
const links = [...document.querySelectorAll('.settings__nav a')];
const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (en.isIntersecting) links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${en.target.id}`));
}), { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('.setting').forEach((s) => spy.observe(s));
icons();
