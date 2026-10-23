/**
 * App shell: sidebar, top bar, theme, notifications, keyboard shortcuts.
 * Every page calls boot('<page-id>') first.
 */
import { CONFIG, isFirebaseConfigured, isDriveConfigured } from './config.js';
import { requireMember, logout, canWrite, isAdmin, roleLabel } from './auth.js';
import { watchTransactions, watchSettings, watchClients } from './store.js';
import { monthSummary } from './clients-lib.js';
import { summarize } from './filters.js';
import { esc, initials, longToday, currentMonthKey, formatINR, pct } from './utils.js';
import { ic, icons, openModal } from './ui.js';

export const LOGO_SVG = `<img src="assets/logo.svg" class="logo-mark" alt="" width="34" height="34">`;

const NAV = [
  { group: 'Overview', items: [
    { id: 'dashboard', href: 'dashboard.html', icon: 'layout-dashboard', label: 'Dashboard' },
    { id: 'entries', href: 'entries.html', icon: 'receipt-text', label: 'All entries' },
  ] },
  { group: 'ODEA office', items: [
    { id: 'add-entry', href: 'add-entry.html', icon: 'building-2', label: 'Office expense', write: true },
  ] },
  { group: 'Clients', items: [
    { id: 'clients', href: 'clients.html', icon: 'hand-coins', label: 'Client payments' },
    { id: 'add-client-expense', href: 'add-entry.html?scope=client', icon: 'briefcase', label: 'Client expense', write: true },
  ] },
  { group: 'Insights', items: [
    { id: 'reports', href: 'reports.html', icon: 'chart-column-big', label: 'Monthly reports' },
    { id: 'bills', href: 'bills.html', icon: 'images', label: 'Bills vault' },
  ] },
  { group: 'Workspace', items: [
    { id: 'settings', href: 'settings.html', icon: 'settings-2', label: 'Settings' },
  ] },
];

/* ---------------- Theme ---------------- */
const THEME_KEY = 'odea-theme';
export const getTheme = () => localStorage.getItem(THEME_KEY) || 'light';
export function setTheme(t) {
  localStorage.setItem(THEME_KEY, t);
  document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.dispatchEvent(new CustomEvent('themechange'));
}

/* ---------------- Shell ---------------- */
function renderSidebar(active) {
  const el = document.getElementById('sidebar');
  el.innerHTML = `
    <div class="sidebar__brand">
      <a href="dashboard.html" class="brand">${LOGO_SVG}<span class="brand__text"><strong>${esc(CONFIG.appName)}</strong><small>${esc(CONFIG.companyName)}</small></span></a>
      <button class="icon-btn sidebar__close" type="button" aria-label="Close menu">${ic('x')}</button>
    </div>
    <a href="add-entry.html" class="sidebar__cta" data-requires="write">${ic('plus')}<span>New entry</span><kbd>N</kbd></a>
    <nav class="sidebar__nav" aria-label="Main">
      ${NAV.map((g) => `<div class="nav-group"><div class="nav-group__label">${g.group}</div>
        ${g.items.map((it) => `<a href="${it.href}" class="nav-link ${it.id === active ? 'is-active' : ''}" ${it.id === active ? 'aria-current="page"' : ''} ${it.write ? 'data-requires="write"' : ''} title="${it.label}">
          ${ic(it.icon)}<span>${it.label}</span></a>`).join('')}</div>`).join('')}
    </nav>
    <div class="sidebar__foot">
      <div class="drive-status ${isDriveConfigured() ? 'is-on' : ''}" title="${isDriveConfigured() ? 'Bills save to Google Drive' : 'Drive not connected'}">
        ${ic(isDriveConfigured() ? 'hard-drive-upload' : 'hard-drive')}
        <span>${isDriveConfigured() ? 'Drive connected' : 'Drive not connected'}</span>
      </div>
      <button class="nav-link sidebar__collapse" type="button" title="Expand">${ic('panel-left-close')}<span>Collapse</span></button>
    </div>`;
}

function renderTopbar(title, subtitle) {
  const el = document.getElementById('topbar');
  el.innerHTML = `
    <button class="icon-btn topbar__menu" type="button" aria-label="Open menu">${ic('menu')}</button>
    <div class="topbar__title">
      <h1>${esc(title)}</h1>
      <p>${esc(subtitle || longToday())}</p>
    </div>
    <form class="topbar__search" role="search" action="entries.html">
      ${ic('search')}
      <input type="search" name="q" placeholder="Search entries, vendors, clients…" autocomplete="off" aria-label="Search entries">
      <kbd>/</kbd>
    </form>
    <div class="topbar__actions">
      <a href="entries.html?focus=search" class="icon-btn topbar__search-btn" aria-label="Search">${ic('search')}</a>
      <span class="net-pill" id="net-pill" hidden>${ic('wifi-off')}<span>Offline</span></span>
      <button class="icon-btn" id="theme-btn" type="button" aria-label="Toggle dark mode">${ic('moon')}</button>
      <div class="dropdown" id="notif">
        <button class="icon-btn" type="button" aria-label="Notifications" aria-haspopup="true">${ic('bell')}<span class="badge" hidden></span></button>
        <div class="dropdown__menu dropdown__menu--wide" role="menu"><div class="dropdown__head">Alerts</div><div class="notif-list"><div class="notif-empty">Loading…</div></div></div>
      </div>
      <div class="dropdown" id="profile">
        <button class="avatar-btn" type="button" aria-haspopup="true"><span class="avatar"><span class="sk sk--circle"></span></span><span class="avatar-btn__name"></span>${ic('chevron-down', 'ic--xs')}</button>
        <div class="dropdown__menu" role="menu">
          <div class="profile-card"></div>
          <a href="settings.html" class="dropdown__item">${ic('settings-2')} Settings</a>
          <button type="button" class="dropdown__item" data-act="shortcuts">${ic('keyboard')} Keyboard shortcuts</button>
          <button type="button" class="dropdown__item dropdown__item--danger" data-act="logout">${ic('log-out')} Sign out</button>
        </div>
      </div>
    </div>`;
}

function wireShell() {
  const app = document.getElementById('app');
  const COLLAPSE_KEY = 'odea-sidebar-collapsed';
  if (localStorage.getItem(COLLAPSE_KEY) === '1') app.classList.add('is-collapsed');

  const openDrawer = () => app.classList.add('is-drawer-open');
  const closeDrawer = () => app.classList.remove('is-drawer-open');
  document.querySelector('.topbar__menu').onclick = openDrawer;
  document.querySelector('.sidebar__close').onclick = closeDrawer;
  document.getElementById('scrim').onclick = closeDrawer;
  document.querySelector('.sidebar__collapse').onclick = () => {
    const c = app.classList.toggle('is-collapsed');
    localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 260);   // let charts re-fit
  };

  // dropdowns
  document.querySelectorAll('.dropdown').forEach((dd) => {
    dd.querySelector(':scope > button').addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.dropdown.is-open').forEach((o) => o !== dd && o.classList.remove('is-open'));
      dd.classList.toggle('is-open');
    });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown__menu')) document.querySelectorAll('.dropdown.is-open').forEach((o) => o.classList.remove('is-open')); });
  document.querySelector('[data-act="logout"]').onclick = logout;
  document.querySelector('[data-act="shortcuts"]').onclick = showShortcuts;

  // theme
  const themeBtn = document.getElementById('theme-btn');
  const syncThemeIcon = () => { themeBtn.innerHTML = ic(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'); icons(themeBtn); };
  themeBtn.onclick = () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); syncThemeIcon(); };
  syncThemeIcon();

  // online / offline
  const pill = document.getElementById('net-pill');
  const net = () => { pill.hidden = navigator.onLine; };
  addEventListener('online', net); addEventListener('offline', net); net();

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-wrap')) return;
    if (e.key === '/') { e.preventDefault(); const s = document.querySelector('[data-page-search]') || document.querySelector('.topbar__search input'); s?.focus(); }
    else if (e.key.toLowerCase() === 'n' && document.body.dataset.canWrite === '1') location.href = 'add-entry.html';
    else if (e.key.toLowerCase() === 'g') { window.__g = Date.now(); }
    else if (window.__g && Date.now() - window.__g < 800) {
      const map = { d: 'dashboard', e: 'entries', c: 'clients', r: 'reports', b: 'bills', s: 'settings' };
      if (map[e.key]) location.href = `${map[e.key]}.html`;
      window.__g = 0;
    } else if (e.key === '?') showShortcuts();
  });
}

function showShortcuts() {
  const rows = [['N', 'New entry'], ['/', 'Search'], ['G then D', 'Dashboard'], ['G then E', 'Entries'], ['G then C', 'Client payments'], ['G then R', 'Reports'], ['G then B', 'Bills vault'], ['G then S', 'Settings'], ['Ctrl + Enter', 'Save the entry form'], ['Esc', 'Close dialogs'], ['?', 'This help']];
  openModal({ title: 'Keyboard shortcuts', size: 'sm', body: `<dl class="shortcuts">${rows.map(([k, v]) => `<dt>${k.split(' ').map((x) => (['then', '+'].includes(x) ? `<span>${x}</span>` : `<kbd>${x}</kbd>`)).join(' ')}</dt><dd>${v}</dd>`).join('')}</dl>` });
}

/* ---------------- Notifications ---------------- */
function wireNotifications(profile) {
  let tx = [], settings = null, clients = [];
  const render = () => {
    const mk = currentMonthKey();
    const month = tx.filter((t) => t.date?.startsWith(mk));
    const s = summarize(month);
    const office = summarize(month.filter((t) => (t.scope || 'office') === 'office'));
    const items = [];
    const budget = settings?.monthlyBudget || 0;
    if (budget) {
      const used = pct(office.expense, budget);
      if (used >= 100) items.push({ tone: 'danger', icon: 'flame', title: 'Office budget exceeded', text: `${formatINR(office.expense)} spent of ${formatINR(budget)} (${used.toFixed(0)}%)`, href: 'reports.html' });
      else if (used >= 80) items.push({ tone: 'warning', icon: 'gauge', title: `${used.toFixed(0)}% of office budget used`, text: `${formatINR(budget - office.expense)} left this month`, href: 'reports.html' });
    }
    if (clients.length) {
      const cs = monthSummary(clients, tx, mk);
      const late = cs.rows.filter((r) => r.status === 'overdue');
      if (late.length) items.push({ tone: 'danger', icon: 'alert-circle', title: `${late.length} client${late.length > 1 ? 's' : ''} overdue`, text: `${late.slice(0, 3).map((r) => r.client.name).join(', ')}${late.length > 3 ? '…' : ''} · ${formatINR(late.reduce((a, r) => a + r.remaining, 0), { decimals: false })} pending`, href: 'clients.html' });
      const neg = cs.rows.filter((r) => r.balancePaise < 0);
      if (neg.length) items.push({ tone: 'warning', icon: 'trending-down', title: `Spent more than received on ${neg.length} client${neg.length > 1 ? 's' : ''}`, text: neg.slice(0, 3).map((r) => r.client.name).join(', '), href: 'clients.html?view=monthly' });
    }
    if (s.missingBills) items.push({ tone: 'info', icon: 'file-warning', title: `${s.missingBills} expense${s.missingBills > 1 ? 's' : ''} without a bill`, text: 'This month — attach bills for clean records', href: 'entries.html?preset=month&type=expense&bill=without' });
    const pending = tx.filter((t) => t.pending).length;
    if (pending) items.push({ tone: 'warning', icon: 'refresh-cw', title: `${pending} entr${pending > 1 ? 'ies' : 'y'} waiting to sync`, text: 'Saved on this device — will upload when online', href: 'entries.html' });
    if (!isDriveConfigured() && isAdmin(profile)) items.push({ tone: 'warning', icon: 'hard-drive', title: 'Google Drive not connected', text: 'Bills cannot be uploaded until it is set up', href: 'settings.html#drive' });

    const list = document.querySelector('#notif .notif-list');
    const badge = document.querySelector('#notif .badge');
    badge.hidden = !items.length; badge.textContent = items.length;
    list.innerHTML = items.length ? items.map((n) => `<a href="${n.href}" class="notif notif--${n.tone}">${ic(n.icon)}<span><strong>${esc(n.title)}</strong><small>${esc(n.text)}</small></span></a>`).join('')
      : `<div class="notif-empty">${ic('check-check')}<span>All caught up</span></div>`;
    icons(list);
  };
  watchTransactions((list) => { tx = list; render(); }, () => {});
  watchSettings((s) => { settings = s; render(); });
  watchClients((list) => { clients = list; render(); }, () => {});
}

/* ---------------- Boot ---------------- */
export async function boot(pageId, { title, subtitle } = {}) {
  if (!isFirebaseConfigured()) { location.replace('index.html'); return new Promise(() => {}); }
  renderSidebar(pageId);
  renderTopbar(title || document.title.split('·')[0].trim(), subtitle);
  wireShell();
  icons(document.getElementById('app'));

  const ctx = await requireMember();
  const { profile } = ctx;
  ctx.canWrite = canWrite(profile);
  ctx.isAdmin = isAdmin(profile);
  document.body.dataset.role = profile.role;
  document.body.dataset.canWrite = ctx.canWrite ? '1' : '0';
  document.body.dataset.isAdmin = ctx.isAdmin ? '1' : '0';

  // profile UI
  const av = profile.photo ? `<img src="${esc(profile.photo)}" alt="" referrerpolicy="no-referrer">` : esc(initials(profile.name));
  document.querySelector('.avatar-btn .avatar').innerHTML = av;
  document.querySelector('.avatar-btn__name').textContent = profile.name.split(' ')[0];
  document.querySelector('.profile-card').innerHTML = `<span class="avatar avatar--lg">${av}</span><div><strong>${esc(profile.name)}</strong><small>${esc(profile.email)}</small><span class="role-tag role-tag--${profile.role}">${roleLabel(profile.role)}</span></div>`;

  wireNotifications(profile);
  document.body.classList.remove('is-booting');
  return ctx;
}
