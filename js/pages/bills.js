import { boot } from '../layout.js';
import { watchTransactions } from '../store.js';
import { listBills, getBillURL, isDriveConfigured, driveViewUrl } from '../drive.js';
import { esc, formatINR, formatDate, formatBytes, debounce } from '../utils.js';
import { icons, ic, emptyState, errorState, openLightbox } from '../ui.js';
import { openEntryDetail } from '../widgets.js';

const ctx = await boot('bills', { title: 'Bills vault' });
const $ = (id) => document.getElementById(id);
const grid = $('v-grid');

let data = null, tx = [], linkMap = new Map();
const state = { folder: '', q: '', link: '', sort: 'new', page: 1, size: 12 };
const PAGE_SIZES = [12, 24, 48];

watchTransactions((list) => {
  tx = list;
  linkMap = new Map(list.filter((t) => t.bill?.fileId).map((t) => [t.bill.fileId, t]));
  if (data) render();
});

/* ---------------- Load ---------------- */
async function load() {
  if (!isDriveConfigured()) {
    grid.innerHTML = emptyState({ icon: 'hard-drive', title: 'Google Drive is not connected yet',
      message: `Deploy the Apps Script in <code>apps-script/Code.gs</code> and paste its URL into <code>js/config.js</code>. The README has a 5-minute walkthrough.`,
      action: ctx.isAdmin ? '<a class="btn btn--primary btn--sm" href="settings.html#drive"><i data-lucide="settings-2"></i>Open Drive settings</a>' : '' });
    grid.classList.add('is-state'); icons(grid); return;
  }
  grid.classList.add('is-state');
  grid.innerHTML = `<div class="vault__skeleton">${Array.from({ length: 8 }, () => '<div class="bill-card bill-card--sk"><span class="sk" style="height:100%"></span></div>').join('')}</div>`;
  const btn = $('v-refresh'); btn.disabled = true;
  try {
    data = await listBills();
    $('v-open').href = data.root.url; $('v-open').hidden = false;
    $('vault-sub').innerHTML = `Drive › <strong>${esc(data.root.name)}</strong> — one folder per month, created automatically.`;
    render();
  } catch (e) {
    grid.innerHTML = errorState({ title: 'Could not open the Drive folder', message: e.message,
      extra: '<button class="btn btn--light btn--sm" type="button" data-retry><i data-lucide="refresh-cw"></i>Try again</button>' });
    icons(grid);
  } finally { btn.disabled = false; }
}

function allFiles() {
  if (!data) return [];
  const out = [];
  data.folders.forEach((f) => f.files.forEach((file) => out.push({ ...file, folder: f.name })));
  (data.looseFiles || []).forEach((file) => out.push({ ...file, folder: '(root)' }));
  return out;
}

/* ---------------- Render ---------------- */
function render() {
  const files = allFiles();
  const unlinked = files.filter((f) => !linkMap.has(f.id)).length;
  $('v-stats').hidden = false;
  $('vs-files').textContent = files.length;
  $('vs-folders').textContent = data.folders.length;
  $('vs-size').textContent = formatBytes(files.reduce((s, f) => s + (f.size || 0), 0));
  $('vs-unlinked').textContent = unlinked;

  const folders = [...data.folders].sort((a, b) => b.name.localeCompare(a.name));
  $('v-folders').innerHTML = `<button type="button" class="chip ${!state.folder ? 'is-active' : ''}" data-folder="">All <span class="chip__count">${files.length}</span></button>`
    + folders.map((f) => `<button type="button" class="chip ${state.folder === f.name ? 'is-active' : ''}" data-folder="${esc(f.name)}">${ic('folder')}${esc(f.name)} <span class="chip__count">${f.files.length}</span></button>`).join('');

  const q = state.q.toLowerCase();
  let list = files.filter((f) => {
    if (state.folder && f.folder !== state.folder) return false;
    const t = linkMap.get(f.id);
    if (state.link === 'linked' && !t) return false;
    if (state.link === 'unlinked' && t) return false;
    if (q && !`${f.name} ${t?.title || ''} ${t?.vendor || ''} ${t?.refNo || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sorters = { new: (a, b) => (b.created || '').localeCompare(a.created || ''), old: (a, b) => (a.created || '').localeCompare(b.created || ''), name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => (b.size || 0) - (a.size || 0) };
  list.sort(sorters[state.sort]);

  // Pagination — only the current page's thumbnails are ever requested from Drive
  const pages = Math.max(1, Math.ceil(list.length / state.size));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.size;
  const total = list.length;
  list = list.slice(start, start + state.size);
  renderPager(total, pages, start);

  if (!files.length) {
    grid.classList.add('is-state');
    grid.innerHTML = emptyState({ icon: 'folder-open', title: 'The bills folder is empty', message: 'Bills you attach to entries are saved here automatically, inside a folder for each month.',
      action: ctx.canWrite ? '<a class="btn btn--primary btn--sm" href="add-entry.html"><i data-lucide="plus"></i>Add an entry with a bill</a>' : '' });
    icons(grid); return;
  }
  if (!list.length) {
    grid.classList.add('is-state');
    grid.innerHTML = emptyState({ icon: 'search-x', title: 'No bills match', message: 'Try another month or clear the search.', compact: true });
    icons(grid); return;
  }
  grid.classList.remove('is-state');
  grid.innerHTML = list.map((f) => {
    const t = linkMap.get(f.id);
    const pdf = f.mimeType === 'application/pdf';
    const isImg = f.mimeType?.startsWith('image/') || pdf;
    return `<article class="bill-card" data-file="${esc(f.id)}">
      <button type="button" class="bill-card__thumb" data-open aria-label="Preview ${esc(f.name)}">
        ${isImg ? `<span class="bill-card__ph">${ic(pdf ? 'file-text' : 'image')}</span><img data-src="${esc(f.id)}" alt="" hidden>` : `<span class="bill-card__ph">${ic('file')}</span>`}
        ${pdf ? '<span class="bill-card__badge">PDF</span>' : ''}
      </button>
      <div class="bill-card__body">
        <strong class="bill-card__name" title="${esc(f.name)}">${esc(f.name)}</strong>
        <small class="muted">${esc(f.folder)} · ${formatBytes(f.size)}</small>
        ${t ? `<button type="button" class="bill-card__link" data-entry="${t.id}"><span class="amount amount--${t.type}">${formatINR(t.amount)}</span><span>${esc(t.title)}</span></button>`
          : '<span class="tag tag--pending">Not linked to an entry</span>'}
      </div>
      <div class="bill-card__actions">
        <span class="muted">${f.created ? formatDate(f.created.slice(0, 10)) : ''}</span>
        <a class="icon-btn icon-btn--sm" href="${esc(f.webViewLink || driveViewUrl(f.id))}" target="_blank" rel="noopener" title="Open in Drive" aria-label="Open in Drive">${ic('external-link')}</a>
      </div>
    </article>`;
  }).join('');
  icons(grid);
  lazyThumbs();
}

function renderPager(total, pages, start) {
  const foot = $('v-pager-foot');
  foot.hidden = total <= PAGE_SIZES[0];
  if (foot.hidden) return;
  $('v-pager-info').textContent = `Showing ${start + 1}–${Math.min(start + state.size, total)} of ${total} bills`;
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - state.page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  $('v-pager').innerHTML = `<button type="button" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${ic('chevron-left')}</button>
    ${nums.map((p) => (p === '…' ? '<span class="pager__gap">…</span>' : `<button type="button" data-page="${p}" class="${p === state.page ? 'is-active' : ''}">${p}</button>`)).join('')}
    <button type="button" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''} aria-label="Next page">${ic('chevron-right')}</button>`;
  icons($('v-pager'));
}

/* Thumbnails load only when scrolled into view, through the authenticated proxy */
let observer;
function lazyThumbs() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    observer.unobserve(en.target);
    const img = en.target.querySelector('img[data-src]'); if (!img) return;
    const id = img.dataset.src;
    getBillURL(id, 'thumb').then((url) => { img.onload = () => { img.hidden = false; img.previousElementSibling?.remove(); }; img.src = url; })
      .catch(() => { const ph = img.previousElementSibling; if (ph) { ph.innerHTML = ic('image-off'); ph.title = 'Preview unavailable'; icons(ph); } });
  }), { rootMargin: '200px' });
  // Watch the (always visible) thumbnail box, not the hidden <img> — hidden elements never "intersect".
  grid.querySelectorAll('img[data-src]').forEach((i) => observer.observe(i.closest('.bill-card__thumb')));
}

/* ---------------- Interactions ---------------- */
$('v-folders').addEventListener('click', (e) => { const b = e.target.closest('[data-folder]'); if (b) { state.folder = b.dataset.folder; state.page = 1; render(); } });
$('v-q').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; render(); }, 200));
$('v-link').addEventListener('change', (e) => { state.link = e.target.value; state.page = 1; render(); });
$('v-sort').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; render(); });
$('v-size').innerHTML = PAGE_SIZES.map((n) => `<option value="${n}">${n}</option>`).join('');
$('v-size').addEventListener('change', (e) => { state.size = Number(e.target.value); state.page = 1; render(); });
$('v-pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
  state.page = Number(b.dataset.page); render();
  document.querySelector('.vault').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('v-refresh').addEventListener('click', load);
grid.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) return load();
  const card = e.target.closest('[data-file]'); if (!card) return;
  const f = allFiles().find((x) => x.id === card.dataset.file);
  const ent = e.target.closest('[data-entry]');
  if (ent) return openEntryDetail(tx.find((t) => t.id === ent.dataset.entry), ctx);
  if (e.target.closest('[data-open]')) {
    const t = linkMap.get(f.id);
    openLightbox({ load: () => getBillURL(f.id, 'full'), name: f.name, mimeType: f.mimeType, driveUrl: f.webViewLink || driveViewUrl(f.id),
      caption: t ? `${formatDate(t.date)} · ${formatINR(t.amount)}` : f.folder });
  }
});

load();
