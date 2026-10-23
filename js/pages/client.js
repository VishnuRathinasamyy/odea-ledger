import { boot } from '../layout.js';
import { watchClients, watchTransactions, explainError } from '../store.js';
import { clientMonth, clientMonths, clientTotals, currentFee, isClientPayment, isClientExpense, paymentMonth } from '../clients-lib.js';
import { currentMonthKey, monthLabel, formatINR, formatDate, esc, qp, fromPaise } from '../utils.js';
import { icons, ic, emptyState, errorState } from '../ui.js';
import { statusBadge, clientAvatar, openClientForm, openFeeForm, openPaymentForm, deletePayment, toggleArchive } from '../client-ui.js';
import { billCell, wireBills, openEntryDetail, deleteEntryFlow, canDeleteEntry } from '../widgets.js';

const ctx = await boot('clients', { title: 'Client' });
const $ = (id) => document.getElementById(id);
const id = qp('id');
const focusMonth = /^\d{4}-\d{2}$/.test(qp('month') || '') ? qp('month') : currentMonthKey();

let clients = [], tx = [], gotC = false, gotT = false;
watchClients((l) => { clients = l; gotC = true; render(); }, fail);
watchTransactions((l) => { tx = l; gotT = true; render(); }, fail);
function fail(e) { document.querySelector('.kpis').outerHTML = `<div class="panel">${errorState({ title: 'Could not load', message: explainError(e), compact: true })}</div>`; icons(); }

const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const signed = (v) => `<span class="${v < 0 ? 'amount--expense' : v > 0 ? 'amount--income' : ''}">${v < 0 ? '−' : ''}${formatINR(Math.abs(v))}</span>`;
const client = () => clients.find((c) => c.id === id);

function render() {
  if (!gotC || !gotT) return;
  const c = client();
  if (!c) {
    document.querySelector('.content').innerHTML = `<div class="panel">${emptyState({ icon: 'user-x', title: 'Client not found', message: 'It may have been deleted.', action: '<a class="btn btn--light btn--sm" href="clients.html">Back to clients</a>' })}</div>`;
    icons(); return;
  }
  document.title = `${c.name} · ODEA Ledger`;
  document.querySelector('.topbar__title h1').textContent = c.name;
  const m = clientMonth(c, tx, focusMonth);
  const t = clientTotals(c, tx);

  $('d-eyebrow').innerHTML = c.archived ? `Archived since ${monthLabel(c.archivedFrom)}` : 'Client';
  $('d-name').innerHTML = `${clientAvatar(c, { cls: 'cavatar--lg' })}${esc(c.name)} ${statusBadge(m.status, { small: true, partial: m.partial })}`;
  $('d-sub').textContent = `${currentFee(c) ? `${formatINR(fromPaise(currentFee(c)))} fixed every month` : 'No fixed fee'}${c.dueDay ? ` · due by the ${ordinal(c.dueDay)}` : ''}${c.contactName ? ` · ${c.contactName}` : ''}`;
  $('d-expense').href = `add-entry.html?scope=client&client=${encodeURIComponent(c.id)}`;
  $('d-exp-all').href = `entries.html?preset=all&scope=client&client=${encodeURIComponent(c.name)}`;

  $('d-m-label').textContent = monthLabel(focusMonth);
  $('d-m-rec').textContent = formatINR(m.received);
  $('d-m-bar').style.width = `${m.pct}%`;
  $('d-m-bar').className = `meter__fill ${m.pct >= 100 ? '' : m.pct ? 'is-warn' : 'is-over'}`;
  $('d-m-meta').innerHTML = m.expected ? `of ${formatINR(m.expected, { decimals: false })} · ${m.remaining ? `<b style="color:#FF8A7A">${formatINR(m.remaining, { decimals: false })} remaining</b>` : 'fully paid'}` : 'No fixed fee this month';
  $('d-t-rec').textContent = formatINR(t.received);
  $('d-t-sp').textContent = formatINR(t.spent);
  $('d-t-bal').innerHTML = signed(t.balance);
  $('d-t-bal-m').innerHTML = t.dues ? `<span class="tag tag--expense">${formatINR(t.dues, { decimals: false })} pending dues</span>` : '<span class="tag tag--income">No pending dues</span>';

  /* Month ledger */
  $('d-months').innerHTML = clientMonths(c, tx).map((mk) => {
    const x = clientMonth(c, tx, mk);
    return `<tr class="${mk === focusMonth ? 'is-current' : ''}"><td><strong>${monthLabel(mk)}</strong>${x.payments.length > 1 ? `<small class="muted"> · ${x.payments.length} parts</small>` : ''}</td>
      <td class="t-right money">${formatINR(x.expected)}</td><td class="t-right money amount--income">${formatINR(x.received)}</td>
      <td class="t-right money ${x.remaining ? 'amount--expense' : ''}">${formatINR(x.remaining)}</td><td>${statusBadge(x.status, { small: true, partial: x.partial })}</td>
      <td class="t-right money">${formatINR(x.spent)}</td><td class="t-right money"><strong>${signed(x.balance)}</strong></td></tr>`;
  }).join('');

  /* Info */
  const fh = c.feeHistory.slice().reverse();
  $('d-info').innerHTML = `
    <div><dt>Billing since</dt><dd>${c.startMonth ? monthLabel(c.startMonth) : '—'}</dd></div>
    <div><dt>Payment due</dt><dd>${c.dueDay ? `By the ${ordinal(c.dueDay)} of each month` : 'No due date'}</dd></div>
    <div><dt>Contact</dt><dd>${esc([c.contactName, c.phone].filter(Boolean).join(' · ') || '—')}</dd></div>
    <div><dt>Fee history</dt><dd>${fh.length ? fh.map((h) => `<div class="fee-row"><span>From ${monthLabel(h.from)}</span><b>${formatINR(fromPaise(h.feePaise))}</b></div>`).join('') : '—'}</dd></div>
    ${c.notes ? `<div><dt>Notes</dt><dd>${esc(c.notes)}</dd></div>` : ''}
    ${ctx.isAdmin ? `<div><dt></dt><dd><button type="button" class="btn btn--ghost btn--sm" data-archive>${ic(c.archived ? 'archive-restore' : 'archive')}${c.archived ? 'Restore client' : 'Archive client'}</button></dd></div>` : ''}`;
  $('d-info').querySelector('[data-archive]')?.addEventListener('click', () => toggleArchive(c));

  /* Payments */
  const pays = tx.filter((x) => isClientPayment(x, c.id)).sort((a, b) => b.date.localeCompare(a.date));
  $('d-pay-sub').textContent = `${pays.length} payment${pays.length === 1 ? '' : 's'} · ${formatINR(t.received)} in total`;
  $('d-payments').innerHTML = pays.length ? pays.map((p) => `<tr data-id="${p.id}">
      <td class="cell-muted">${formatDate(p.date)}</td><td>${monthLabel(paymentMonth(p), true)}</td>
      <td class="t-right"><span class="amount amount--income">+ ${formatINR(p.amount)}</span></td><td class="cell-muted">${esc(p.paymentMethod || '—')}</td>
      <td class="cell-muted">${esc(p.notes || '—')}</td><td class="cell-muted">${esc((p.createdBy || '').split('@')[0])}</td>
      <td class="t-right"><div class="row-actions">${ctx.canWrite ? `<button class="icon-btn icon-btn--sm" type="button" data-edit-pay title="Edit" aria-label="Edit payment">${ic('pencil')}</button>` : ''}
        ${canDeleteEntry(ctx, p) ? `<button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-del-pay title="Delete" aria-label="Delete payment">${ic('trash-2')}</button>` : ''}</div></td></tr>`).join('')
    : `<tr><td colspan="7">${emptyState({ icon: 'hand-coins', title: 'No payments yet', compact: true })}</td></tr>`;

  /* Expenses */
  const exps = tx.filter((x) => isClientExpense(x, c.id)).sort((a, b) => b.date.localeCompare(a.date));
  $('d-exp-sub').textContent = `${exps.length} expense${exps.length === 1 ? '' : 's'} · ${formatINR(t.spent)} in total`;
  $('d-expenses').innerHTML = exps.length ? exps.slice(0, 50).map((e) => `<tr data-id="${e.id}" class="is-click">
      <td class="cell-muted">${formatDate(e.date)}</td><td><div class="cell-title"><strong>${esc(e.title)}</strong>${e.vendor ? `<small>${esc(e.vendor)}</small>` : ''}</div></td>
      <td><span class="tag">${esc(e.category)}</span></td><td class="t-right"><span class="amount amount--expense">− ${formatINR(e.amount)}</span></td>
      <td class="t-center">${billCell(e)}</td>
      <td class="t-right"><div class="row-actions">${ctx.canWrite ? `<a class="icon-btn icon-btn--sm" href="add-entry.html?id=${encodeURIComponent(e.id)}" title="Edit" aria-label="Edit">${ic('pencil')}</a>` : ''}
        ${canDeleteEntry(ctx, e) ? `<button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-del-exp title="Delete" aria-label="Delete">${ic('trash-2')}</button>` : ''}</div></td></tr>`).join('')
    : `<tr><td colspan="6">${emptyState({ icon: 'receipt', title: 'Nothing spent on this client yet', compact: true })}</td></tr>`;

  icons(document.getElementById('content'));
}

const byId = (x) => tx.find((t) => t.id === x);
$('d-payments').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]'); if (!row) return;
  const p = byId(row.dataset.id);
  if (e.target.closest('[data-edit-pay]')) openPaymentForm({ clients, tx, payment: p });
  if (e.target.closest('[data-del-pay]')) deletePayment(p);
});
wireBills($('d-expenses'), byId);
$('d-expenses').addEventListener('click', (e) => {
  if (e.target.closest('[data-bill], a')) return;
  const row = e.target.closest('tr[data-id]'); if (!row) return;
  if (e.target.closest('[data-del-exp]')) { deleteEntryFlow(byId(row.dataset.id)); return; }
  openEntryDetail(byId(row.dataset.id), ctx);
});
$('d-pay').addEventListener('click', () => openPaymentForm({ clients, tx, clientId: id, month: focusMonth }));
$('d-edit').addEventListener('click', () => openClientForm(client(), { existingNames: clients.map((c) => c.name) }));
$('d-fee').addEventListener('click', () => openFeeForm(client()));
