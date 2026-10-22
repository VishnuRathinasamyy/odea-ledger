import { boot } from '../layout.js';
import { CONFIG } from '../config.js';
import { watchTransactions, watchSettings, explainError } from '../store.js';
import {
  PRESETS, defaultFilters, applyFilters, summarize, rangeLabel, describeFilters, filtersFromURL, filtersToURL,
} from '../filters.js';
import { esc, formatINR, formatDate, debounce, addMonths, currentMonthKey, qp } from '../utils.js';
import { icons, ic, emptyState, errorState, skeletonRows, toast } from '../ui.js';
import { billCell, wireBills, openEntryDetail, deleteEntryFlow, typeTag, canDeleteEntry } from '../widgets.js';
import { exportCSV, exportPDF } from '../export.js';

const $ = (id) => document.getElementById(id);
$('tbody').innerHTML = skeletonRows(8, 10);
const ctx = await boot('entries', { title: 'Entries' });

let tx = [], filtered = [], loaded = false;
const f = filtersFromURL();
let categories = [...CONFIG.defaultCategories];

/* ---------------- Controls ---------------- */
$('presets').innerHTML = PRESETS.map((p) => `<button type="button" class="chip" role="tab" data-preset="${p.id}">${p.id === 'pick' ? ic('calendar') : p.id === 'range' ? ic('calendar-range') : ''}${p.label}</button>`).join('');
$('f-payment').insertAdjacentHTML('beforeend', CONFIG.paymentMethods.map((m) => `<option>${esc(m)}</option>`).join(''));
$('f-size').innerHTML = CONFIG.pageSizes.map((n) => `<option value="${n}">${n}</option>`).join('');

function syncControls() {
  document.querySelectorAll('[data-preset]').forEach((b) => { const on = b.dataset.preset === f.preset; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
  $('pick-month').hidden = f.preset !== 'pick';
  $('pick-range').hidden = f.preset !== 'range';
  $('f-month').value = f.month || currentMonthKey();
  $('f-from').value = f.from; $('f-to').value = f.to;
  $('f-q').value = f.q; $('f-type').value = f.type; $('f-payment').value = f.payment; $('f-bill').value = f.bill;
  $('f-category').value = f.category; $('f-client').value = f.client; $('f-size').value = String(f.size);
  const d = defaultFilters();
  $('f-clear').hidden = ['type', 'category', 'payment', 'client', 'bill', 'q'].every((k) => !f[k]) && f.preset === d.preset;
  document.querySelectorAll('.th-sort').forEach((b) => {
    const on = b.dataset.sort === f.sort; b.classList.toggle('is-sorted', on);
    b.lastElementChild.outerHTML = ic(on ? (f.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-down-up');
  });
  icons($('table').querySelector('thead'));
}

function update(patch, { resetPage = true } = {}) {
  Object.assign(f, patch);
  if (resetPage) f.page = 1;
  filtersToURL(f); syncControls(); render();
}

$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]'); if (!b) return;
  const p = b.dataset.preset;
  update({ preset: p, ...(p === 'pick' && !f.month ? { month: currentMonthKey() } : {}) });
  if (p === 'range') setTimeout(() => $('f-from').focus(), 50);
});
$('f-month').addEventListener('change', (e) => e.target.value && update({ month: e.target.value }));
$('pick-month').addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) update({ month: addMonths(f.month || currentMonthKey(), Number(b.dataset.step)) }); });
$('f-from').addEventListener('change', (e) => update({ from: e.target.value }));
$('f-to').addEventListener('change', (e) => update({ to: e.target.value }));
$('f-q').addEventListener('input', debounce((e) => update({ q: e.target.value.trim() }), 220));
[['f-type', 'type'], ['f-category', 'category'], ['f-payment', 'payment'], ['f-client', 'client'], ['f-bill', 'bill']]
  .forEach(([id, key]) => $(id).addEventListener('change', (e) => update({ [key]: e.target.value })));
$('f-size').addEventListener('change', (e) => update({ size: Number(e.target.value) }));
$('f-clear').addEventListener('click', () => { const d = defaultFilters(); update({ ...d, size: f.size }); });
document.querySelector('#table thead').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  const key = b.dataset.sort;
  update({ sort: key, dir: f.sort === key && f.dir === 'desc' ? 'asc' : 'desc' }, { resetPage: false });
});
if (qp('focus') === 'search') setTimeout(() => $('f-q').focus(), 100);

/* ---------------- Data ---------------- */
watchSettings((s) => { categories = s.categories; fillDynamicSelects(); });
watchTransactions((list) => { tx = list; loaded = true; fillDynamicSelects(); render(); }, (err) => {
  $('tbody').innerHTML = `<tr><td colspan="10">${errorState({ title: 'Could not load entries', message: explainError(err) })}</td></tr>`;
  icons($('tbody'));
});

function fillDynamicSelects() {
  const cats = [...new Set([...categories, ...tx.map((t) => t.category)])].filter(Boolean);
  const clients = [...new Set(tx.map((t) => t.client).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('f-category').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  $('f-client').innerHTML = '<option value="">All clients</option>' + clients.map((c) => `<option>${esc(c)}</option>`).join('');
  $('f-category').value = f.category; $('f-client').value = f.client;
}

/* ---------------- Render ---------------- */
function render() {
  if (!loaded) return;
  filtered = applyFilters(tx, f);
  const s = summarize(filtered);
  const label = rangeLabel(f);
  $('range-eyebrow').textContent = label;
  $('t-exp').textContent = formatINR(s.expense);
  $('t-exp-n').textContent = `${s.expenseCount} expense${s.expenseCount === 1 ? '' : 's'}${s.gst ? ` · GST ${formatINR(s.gst)}` : ''}`;
  $('t-inc').textContent = formatINR(s.income);
  $('t-inc-n').textContent = `${s.incomeCount} income entr${s.incomeCount === 1 ? 'y' : 'ies'}`;
  $('t-net').textContent = (s.net < 0 ? '−' : '') + formatINR(Math.abs(s.net));
  $('t-net').className = `money ${s.net < 0 ? 'amount--expense' : s.net > 0 ? 'amount--income' : ''}`;
  $('t-count').textContent = s.count.toLocaleString('en-IN');
  $('t-avg').textContent = s.expenseCount ? `Avg expense ${formatINR(s.avgExpense)}` : ' ';
  $('table-title').textContent = `${s.count.toLocaleString('en-IN')} entr${s.count === 1 ? 'y' : 'ies'}`;
  $('table-sub').textContent = describeFilters(f);
  $('export-count').textContent = `Export ${s.count} filtered entr${s.count === 1 ? 'y' : 'ies'}`;

  const pages = Math.max(1, Math.ceil(filtered.length / f.size));
  if (f.page > pages) f.page = pages;
  const start = (f.page - 1) * f.size;
  const rows = filtered.slice(start, start + f.size);

  if (!rows.length) {
    const none = !tx.length;
    $('tbody').innerHTML = `<tr class="row-empty"><td colspan="10">${emptyState(none
      ? { icon: 'receipt', title: 'No entries yet', message: 'Every payment you record will appear here with its bill.', action: ctx.canWrite ? '<a class="btn btn--primary btn--sm" href="add-entry.html"><i data-lucide="plus"></i>Add the first entry</a>' : '' }
      : { icon: 'search-x', title: 'No entries match these filters', message: `Nothing found for ${esc(label)}${f.q ? ` and “${esc(f.q)}”` : ''}.`, action: '<button class="btn btn--light btn--sm" type="button" data-clear-all><i data-lucide="filter-x"></i>Clear filters</button>' })}</td></tr>`;
  } else {
    $('tbody').innerHTML = rows.map((t, i) => `
      <tr data-id="${t.id}" tabindex="0">
        <td class="cell-sno" data-label="S.No">${start + i + 1}</td>
        <td data-label="Date"><div class="cell-date"><span>${formatDate(t.date)}</span><small class="cell-ref">${esc(t.refNo || t.id.slice(0, 8))}${t.pending ? ' <span class="tag tag--pending">sync</span>' : ''}</small></div></td>
        <td data-label="Title"><div class="cell-title"><strong>${esc(t.title)}</strong>${t.vendor ? `<small>${esc(t.vendor)}</small>` : ''}</div></td>
        <td data-label="Category"><span class="tag">${esc(t.category)}</span></td>
        <td data-label="Type">${typeTag(t)}</td>
        <td class="t-right" data-label="Amount"><span class="amount amount--${t.type}">${t.type === 'income' ? '+' : '−'} ${formatINR(t.amount)}</span></td>
        <td class="t-center" data-label="Bill">${billCell(t)}</td>
        <td class="cell-muted cell-client" data-label="Client">${esc([t.client, t.project].filter(Boolean).join(' · ') || '—')}</td>
        <td class="cell-muted" data-label="Paid via">${esc(t.paymentMethod || '—')}</td>
        <td class="t-right cell-actions"><div class="row-actions">
          ${ctx.canWrite ? `<a class="icon-btn icon-btn--sm" href="add-entry.html?id=${encodeURIComponent(t.id)}" title="Edit" aria-label="Edit">${ic('pencil')}</a>
          ${canDeleteEntry(ctx, t) ? `<button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-del="${t.id}" title="Delete" aria-label="Delete">${ic('trash-2')}</button>` : ''}` : ''}
        </div></td>
      </tr>`).join('');
  }
  renderPager(pages);
  icons($('tbody'));
}

function renderPager(pages) {
  const total = filtered.length;
  const from = total ? (f.page - 1) * f.size + 1 : 0, to = Math.min(f.page * f.size, total);
  $('pager-info').textContent = total ? `Showing ${from}–${to} of ${total.toLocaleString('en-IN')}` : '';
  $('pager-foot').hidden = pages <= 1 && total <= CONFIG.pageSizes[0];
  const nums = [];
  for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - f.page) <= 1) nums.push(p); else if (nums[nums.length - 1] !== '…') nums.push('…');
  $('pager').innerHTML = `<button type="button" data-page="${f.page - 1}" ${f.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${ic('chevron-left')}</button>
    ${nums.map((p) => (p === '…' ? '<span class="pager__gap">…</span>' : `<button type="button" data-page="${p}" class="${p === f.page ? 'is-active' : ''}">${p}</button>`)).join('')}
    <button type="button" data-page="${f.page + 1}" ${f.page >= pages ? 'disabled' : ''} aria-label="Next page">${ic('chevron-right')}</button>`;
  icons($('pager'));
}
$('pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
  update({ page: Number(b.dataset.page) }, { resetPage: false });
  document.querySelector('.table-head').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------------- Row interactions ---------------- */
const byId = (id) => tx.find((t) => t.id === id);
wireBills($('tbody'), byId);
$('tbody').addEventListener('click', async (e) => {
  if (e.target.closest('[data-clear-all]')) { update({ ...defaultFilters(), preset: 'all', size: f.size }); return; }
  if (e.target.closest('[data-bill], a')) return;
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); await deleteEntryFlow(byId(del.dataset.del)); return; }
  const row = e.target.closest('tr[data-id]');
  if (row) openEntryDetail(byId(row.dataset.id), ctx);
});
$('tbody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-id]')) e.target.click(); });

/* ---------------- Export ---------------- */
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', async () => {
  document.getElementById('export-dd').classList.remove('is-open');
  if (!filtered.length) { toast('Nothing to export', 'warning', { detail: 'The current filters show no entries.' }); return; }
  const label = rangeLabel(f);
  if (b.dataset.export === 'csv') { exportCSV(filtered, { name: label }); toast(`Exported ${filtered.length} entries to CSV`, 'success'); return; }
  const close = toast('Preparing PDF statement…', 'info', { duration: 0 });
  try {
    await exportPDF({ title: 'Financial Statement', period: label, rows: filtered, filtersText: describeFilters(f), preparedBy: ctx.profile.name, fileName: label });
    close(); toast('PDF statement downloaded', 'success');
  } catch (err) { close(); toast('PDF export failed', 'error', { detail: err.message }); }
}));

syncControls();
