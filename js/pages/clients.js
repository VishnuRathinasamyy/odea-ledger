import { boot } from '../layout.js';
import { watchClients, watchTransactions, explainError } from '../store.js';
import { monthSummary, clientMonth, isActiveIn, isClientPayment, isClientExpense } from '../clients-lib.js';
import {
  currentMonthKey, addMonths, monthLabel, monthStart, monthEnd, weekStart, addDays, formatINR, formatDate, esc, qp, debounce, fromPaise,
} from '../utils.js';
import { icons, ic, emptyState, errorState, toast } from '../ui.js';
import { statusBadge, openClientForm, openPaymentForm, markPaid, clientAvatar } from '../client-ui.js';
import { exportClientReportCSV, exportClientReportPDF } from '../export.js';

const ctx = await boot('clients', { title: 'Clients' });
const $ = (id) => document.getElementById(id);
const body = $('c-body');

let clients = [], tx = [], gotClients = false, gotTx = false;
const state = {
  month: /^\d{4}-\d{2}$/.test(qp('month') || '') ? qp('month') : currentMonthKey(),
  view: ['status', 'monthly', 'weekly'].includes(qp('view')) ? qp('view') : 'status',
  filter: 'all', q: '',
};

watchClients((list) => { clients = list; gotClients = true; render(); }, (e) => fail(e));
watchTransactions((list) => { tx = list; gotTx = true; render(); }, (e) => fail(e));
function fail(e) { body.innerHTML = errorState({ title: 'Could not load clients', message: explainError(e) }); icons(body); }

/* ---------------- Controls ---------------- */
function syncURL() {
  const p = new URLSearchParams();
  if (state.month !== currentMonthKey()) p.set('month', state.month);
  if (state.view !== 'status') p.set('view', state.view);
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}
const go = (m) => { state.month = m; syncURL(); render(); };
document.querySelectorAll('.month-nav [data-step]').forEach((b) => b.addEventListener('click', () => go(addMonths(state.month, Number(b.dataset.step)))));
$('c-picker').addEventListener('change', (e) => e.target.value && go(e.target.value));
$('c-month').addEventListener('click', () => $('c-picker').showPicker?.());
$('c-today').addEventListener('click', () => go(currentMonthKey()));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; syncURL(); render(); }));
$('c-q').addEventListener('input', debounce((e) => { state.q = e.target.value.trim().toLowerCase(); render(); }, 150));
$('c-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { state.filter = b.dataset.filter; render(); } });
$('c-add').addEventListener('click', () => openClientForm(null, { existingNames: clients.map((c) => c.name) }));
$('c-pay').addEventListener('click', () => openPaymentForm({ clients, tx, month: state.month }));

/* ---------------- Render ---------------- */
function render() {
  if (!gotClients || !gotTx) { body.innerHTML = `<div class="ccards">${'<div class="ccard ccard--sk"><span class="sk" style="height:100%"></span></div>'.repeat(6)}</div>`; return; }
  const mk = state.month, isCur = mk === currentMonthKey();
  $('c-month').textContent = monthLabel(mk);
  $('c-picker').value = mk;
  $('c-today').hidden = isCur;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.view));
  $('c-tools').hidden = state.view !== 'status';

  const s = monthSummary(clients, tx, mk);
  const due = s.rows.filter((r) => r.expectedPaise);
  $('k-exp').textContent = formatINR(s.expected);
  $('k-exp-m').textContent = `${due.length} client${due.length === 1 ? '' : 's'} on a fixed fee`;
  $('k-rec').textContent = formatINR(s.received);
  $('k-rec-bar').style.width = `${s.pct}%`;
  $('k-rec-bar').className = `meter__fill ${s.pct >= 100 ? '' : s.pct >= 50 ? 'is-warn' : 'is-over'}`;
  $('k-rec-m').textContent = s.expected ? `${s.pct.toFixed(0)}% collected · ${s.count(['paid', 'advance'])} of ${due.length} fully paid` : 'No fixed fees this month';
  $('k-rem').textContent = formatINR(s.remaining);
  const late = s.count('overdue'), part = s.rows.filter((r) => r.partial).length, un = s.count('unpaid');
  $('k-rem-m').innerHTML = [late && `<span class="tag tag--expense">${late} overdue</span>`, part && `<span class="tag tag--pending">${part} partial</span>`, un && `<span class="tag">${un} not paid</span>`].filter(Boolean).join('') || '<span class="tag tag--income">All collected</span>';
  $('k-bal').textContent = (s.balance < 0 ? '−' : '') + formatINR(Math.abs(s.balance));
  $('k-bal').className = `kpi__value money ${s.balance < 0 ? 'amount--expense' : s.balance > 0 ? 'amount--income' : ''}`;
  $('k-bal-m').textContent = `${formatINR(s.spent)} spent on clients this month`;

  if (!clients.length) {
    body.innerHTML = emptyState({ icon: 'briefcase', title: 'No clients yet', message: 'Add each client with their fixed monthly fee. Then record payments as they come in — full or partial.',
      action: ctx.isAdmin ? '<button class="btn btn--primary btn--sm" type="button" data-add-first><i data-lucide="user-plus"></i>Add your first client</button>' : '<p class="muted">Ask an admin to add clients in Settings.</p>' });
    body.querySelector('[data-add-first]')?.addEventListener('click', () => $('c-add').click());
    icons(body); return;
  }
  if (state.view === 'status') renderStatus(s);
  else if (state.view === 'monthly') renderMonthly(s);
  else renderWeekly();
  icons(document.getElementById('content'));
}

/* ----- Status cards ----- */
function renderStatus(s) {
  const counts = { all: s.rows.length, pending: s.count(['unpaid', 'partial', 'overdue']), partial: s.rows.filter((r) => r.partial).length, overdue: s.count('overdue'), paid: s.count(['paid', 'advance']) };
  const chip = (id, label) => `<button type="button" class="chip ${state.filter === id ? 'is-active' : ''}" data-filter="${id}">${label} <span class="chip__count">${counts[id]}</span></button>`;
  $('c-chips').innerHTML = chip('all', 'All') + chip('pending', 'Not fully paid') + chip('partial', 'Partial') + chip('overdue', 'Overdue') + chip('paid', 'Paid');

  const want = { all: null, pending: ['unpaid', 'partial', 'overdue'], partial: 'partial', overdue: ['overdue'], paid: ['paid', 'advance'] }[state.filter];
  const order = { overdue: 0, partial: 1, unpaid: 2, advance: 3, paid: 4, nofee: 5, inactive: 6 };
  const rows = s.rows.filter((r) => (!want || (want === 'partial' ? r.partial : want.includes(r.status))) && (!state.q || r.client.name.toLowerCase().includes(state.q)))
    .sort((a, b) => order[a.status] - order[b.status] || a.client.name.localeCompare(b.client.name));
  if (!rows.length) { body.innerHTML = emptyState({ icon: 'search-x', title: 'No clients match', compact: true }); return; }

  body.innerHTML = `<div class="ccards">${rows.map((r) => card(r)).join('')}</div>`;
}

function card(r) {
  const c = r.client;
  const neg = r.balancePaise < 0;
  return `<article class="ccard ccard--${r.status}" data-id="${c.id}">
    <header class="ccard__head">
      <a class="ccard__name" href="client.html?id=${encodeURIComponent(c.id)}&month=${r.month}">${clientAvatar(c)}<span><strong>${esc(c.name)}</strong><small>${r.expected ? `${formatINR(r.expected, { decimals: false })} / month` : 'No fixed fee'}</small></span></a>
      ${statusBadge(r.status, { small: true, partial: r.partial })}
    </header>
    <div class="ccard__progress">
      <div class="ccard__nums"><span><small>Received</small><b class="amount--income">${formatINR(r.received)}</b></span>
        <span class="t-right"><small>${r.extra ? 'Extra' : 'Remaining'}</small><b class="${r.remaining ? 'amount--expense' : ''}">${formatINR(r.extra || r.remaining)}</b></span></div>
      <div class="meter"><div class="meter__fill ${r.pct >= 100 ? '' : r.pct ? 'is-warn' : 'is-over'}" style="width:${r.pct}%"></div></div>
      ${r.payments.length ? `<div class="ccard__pills">${r.payments.map((p) => `<span title="${esc(p.notes || '')}">${ic('check', 'ic--xs')}${formatDate(p.date).slice(0, 6)} · ${formatINR(p.amount, { decimals: false })}</span>`).join('')}</div>` : ''}
    </div>
    <div class="ccard__money">
      <div><small>Spent on client</small><b>${formatINR(r.spent)}</b></div>
      <div><small>Balance</small><b class="${neg ? 'amount--expense' : r.balancePaise > 0 ? 'amount--income' : ''}">${neg ? '−' : ''}${formatINR(Math.abs(r.balance))}</b></div>
    </div>
    <footer class="ccard__actions">
      ${ctx.canWrite ? `<button type="button" class="btn btn--dark btn--sm" data-act="pay">${ic('plus')}Payment</button>
      ${r.remaining ? `<button type="button" class="btn btn--light btn--sm" data-act="paid">${ic('check-check')}Mark paid</button>` : ''}
      <a class="btn btn--ghost btn--sm" href="add-entry.html?scope=client&client=${encodeURIComponent(c.id)}">${ic('arrow-up-right')}Expense</a>` : ''}
      <a class="icon-btn icon-btn--sm ccard__open" href="client.html?id=${encodeURIComponent(c.id)}&month=${r.month}" aria-label="Open ${esc(c.name)}">${ic('chevron-right')}</a>
    </footer>
  </article>`;
}

body.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const c = clients.find((x) => x.id === b.closest('[data-id]').dataset.id);
  if (b.dataset.act === 'pay') openPaymentForm({ clients, tx, clientId: c.id, month: state.month });
  if (b.dataset.act === 'paid') markPaid(c, tx, state.month);
});

/* ----- Monthly report ----- */
const signed = (v) => `<span class="${v < 0 ? 'amount--expense' : v > 0 ? 'amount--income' : ''}">${v < 0 ? '−' : ''}${formatINR(Math.abs(v))}</span>`;
function renderMonthly(s) {
  const months = Array.from({ length: 6 }, (_, i) => addMonths(state.month, i - 5));
  const rows = s.rows.slice().sort((a, b) => a.client.name.localeCompare(b.client.name));
  body.innerHTML = `
    <div class="table-wrap"><table class="table table--compact">
      <thead><tr><th>Client</th><th class="t-right">Fixed fee</th><th class="t-right">Received</th><th class="t-right">Remaining</th><th>Status</th><th class="t-right">Spent</th><th class="t-right">Balance</th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-href="client.html?id=${r.client.id}&month=${r.month}">
        <td><span class="cname">${clientAvatar(r.client, { cls: 'cavatar--sm' })}<strong>${esc(r.client.name)}</strong></span>${r.payments.length > 1 ? `<small class="muted"> · ${r.payments.length} payments</small>` : ''}</td>
        <td class="t-right money">${formatINR(r.expected)}</td><td class="t-right money amount--income">${formatINR(r.received)}</td>
        <td class="t-right money ${r.remaining ? 'amount--expense' : ''}">${formatINR(r.remaining)}</td><td>${statusBadge(r.status, { small: true, partial: r.partial })}</td>
        <td class="t-right money">${formatINR(r.spent)}</td><td class="t-right money"><strong>${signed(r.balance)}</strong></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total · ${monthLabel(state.month)}</td><td class="t-right money">${formatINR(s.expected)}</td><td class="t-right money amount--income">${formatINR(s.received)}</td>
        <td class="t-right money amount--expense">${formatINR(s.remaining)}</td><td>${s.pct.toFixed(0)}% collected</td><td class="t-right money">${formatINR(s.spent)}</td><td class="t-right money">${signed(s.balance)}</td></tr></tfoot>
    </table></div>
    <div class="chistory">
      <h4>Last 6 months</h4>
      <div class="table-wrap"><table class="table table--compact table--matrix">
        <thead><tr><th>Client</th>${months.map((m) => `<th class="t-center">${monthLabel(m, true)}</th>`).join('')}</tr></thead>
        <tbody>${clients.filter((c) => months.some((m) => isActiveIn(c, m))).map((c) => `<tr><td><strong>${esc(c.name)}</strong></td>${months.map((m) => {
          const x = clientMonth(c, tx, m);
          if (x.status === 'inactive') return '<td class="t-center muted">—</td>';
          return `<td class="t-center"><button type="button" class="mcell mcell--${x.status}" data-month="${m}" title="${esc(`${c.name} · ${monthLabel(m)}: received ${formatINR(x.received)} of ${formatINR(x.expected)} · spent ${formatINR(x.spent)}`)}">${formatINR(x.received, { decimals: false })}<small>${x.expected ? `${Math.round(x.pct)}%` : '—'}</small></button></td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="legend-line"><span class="mcell mcell--paid"></span>Paid <span class="mcell mcell--partial"></span>Partial <span class="mcell mcell--overdue"></span>Overdue <span class="mcell mcell--unpaid"></span>Not paid yet</p>
    </div>`;
}

/* ----- Weekly report ----- */
function renderWeekly() {
  const mk = state.month, end = monthEnd(mk), weeks = [];
  for (let ws = weekStart(monthStart(mk)); ws <= end; ws = addDays(ws, 7)) {
    weeks.push({ from: ws < monthStart(mk) ? monthStart(mk) : ws, to: addDays(ws, 6) > end ? end : addDays(ws, 6) });
  }
  const inWeek = (t, w) => t.date >= w.from && t.date <= w.to;
  const list = clients.filter((c) => isActiveIn(c, mk) || tx.some((t) => t.clientId === c.id && t.date.startsWith(mk)));
  const cell = (inP, outP) => (!inP && !outP) ? '<div class="wcell wcell--empty">—</div>'
    : `<div class="wcell">${inP ? `<span class="amount--income">+${formatINR(fromPaise(inP), { decimals: false })}</span>` : ''}${outP ? `<span class="amount--expense">−${formatINR(fromPaise(outP), { decimals: false })}</span>` : ''}</div>`;
  const totals = weeks.map(() => ({ i: 0, o: 0 }));
  let gi = 0, gout = 0;
  const rows = list.map((c) => {
    let ri = 0, ro = 0;
    const cells = weeks.map((w, k) => {
      const i = tx.filter((t) => isClientPayment(t, c.id) && inWeek(t, w)).reduce((s, t) => s + t.amountPaise, 0);
      const o = tx.filter((t) => isClientExpense(t, c.id) && inWeek(t, w)).reduce((s, t) => s + t.amountPaise, 0);
      ri += i; ro += o; totals[k].i += i; totals[k].o += o; return `<td>${cell(i, o)}</td>`;
    }).join('');
    gi += ri; gout += ro;
    return `<tr><td><strong>${esc(c.name)}</strong></td>${cells}<td>${cell(ri, ro)}</td><td class="t-right money"><strong>${signed(fromPaise(ri - ro))}</strong></td></tr>`;
  }).join('');
  body.innerHTML = `<p class="report-note">${ic('info', 'ic--xs')}Money received (+) and spent (−) on each client, by the date it happened. Weeks run Monday to Sunday.</p>
    <div class="table-wrap"><table class="table table--compact table--weekly">
      <thead><tr><th>Client</th>${weeks.map((w, k) => `<th>Week ${k + 1}<small>${formatDate(w.from).slice(0, 6)} – ${formatDate(w.to).slice(0, 6)}</small></th>`).join('')}<th>Month</th><th class="t-right">Net</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td>${totals.map((t) => `<td>${cell(t.i, t.o)}</td>`).join('')}<td>${cell(gi, gout)}</td><td class="t-right money">${signed(fromPaise(gi - gout))}</td></tr></tfoot>
    </table></div>`;
}

body.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-href]'); if (tr) { location.href = tr.dataset.href; return; }
  const m = e.target.closest('.mcell[data-month]'); if (m) go(m.dataset.month);
});

/* ---------------- Export ---------------- */
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', async () => {
  $('c-export').classList.remove('is-open');
  const s = monthSummary(clients, tx, state.month);
  if (!s.rows.length) return toast('No clients to export for this month', 'warning');
  if (b.dataset.export === 'csv') { exportClientReportCSV(s, state.month); return toast('Client report exported', 'success'); }
  const close = toast('Preparing PDF…', 'info', { duration: 0 });
  try { await exportClientReportPDF(s, state.month, { preparedBy: ctx.profile.name }); close(); toast('PDF downloaded', 'success'); }
  catch (err) { close(); toast('PDF export failed', 'error', { detail: err.message }); }
}));

render();
