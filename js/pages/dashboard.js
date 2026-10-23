import { boot } from '../layout.js';
import { watchTransactions, watchSettings, watchClients, explainError } from '../store.js';
import { monthSummary } from '../clients-lib.js';
import { statusBadge, clientAvatar } from '../client-ui.js';
import { summarize, groupTotals } from '../filters.js';
import {
  todayISO, currentMonthKey, addMonths, monthLabel, monthShort, daysInMonth, esc, formatINR, formatDate, pct, fromPaise,
} from '../utils.js';
import { icons, countUp, emptyState, errorState, ic } from '../ui.js';
import { lineDaily, doughnut, barTrend, palette } from '../charts.js';
import { rankList, deltaBadge, openEntryDetail, billCell, wireBills } from '../widgets.js';
import { exportPDF } from '../export.js';

const ctx = await boot('dashboard', { title: 'Dashboard' });
const $ = (id) => document.getElementById(id);
let tx = [], clients = [], settings = { categories: [], monthlyBudget: 0 }, ready = false;

// Greeting by IST hour
const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
$('greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${ctx.profile.name.split(' ')[0]}`;
$('dash-month').textContent = monthLabel(currentMonthKey());

watchSettings((s) => { settings = s; if (ready) render(); });
watchClients((l) => { clients = l; if (ready) render(); }, () => {});
watchTransactions((list) => { tx = list; ready = true; render(); }, (err) => {
  document.querySelector('.kpis').insertAdjacentHTML('beforebegin', `<div class="panel">${errorState({ title: 'Could not load entries', message: explainError(err), compact: true })}</div>`);
  icons();
});
document.addEventListener('themechange', () => ready && render());

const fmt = (v) => formatINR(v);

function render() {
  const today = todayISO();
  const mk = currentMonthKey(), lastMk = addMonths(mk, -1);
  const inMonth = (m) => tx.filter((t) => t.date.startsWith(m));
  const month = inMonth(mk), last = inMonth(lastMk);
  const isOffice = (t) => (t.scope || 'office') === 'office';
  const sO = summarize(month.filter(isOffice)), sOL = summarize(last.filter(isOffice));
  const sClient = summarize(month.filter((t) => t.scope === 'client'));
  const cs = monthSummary(clients, tx, mk);
  const sM = summarize(month), sL = sOL, sT = summarize(tx.filter((t) => t.date === today));
  const yesterday = summarize(tx.filter((t) => t.date === addDaysISO(today, -1)));

  // Same-period comparison: this month so far vs the same days of last month
  const dayNo = Number(today.slice(8));
  const lastSameDays = summarize(last.filter((t) => isOffice(t) && Number(t.date.slice(8)) <= dayNo));

  /* KPI cards */
  countUp($('k-month'), sO.expense, fmt);
  countUp($('k-today'), sT.expense, fmt);
  countUp($('k-last'), sT.income, fmt);
  countUp($('k-count'), cs.received, fmt);
  $('k-today-meta').innerHTML = deltaBadge(sT.expense, yesterday.expense, { suffix: 'vs yesterday' });
  $('k-last-meta').innerHTML = sT.incomeCount
    ? `<span>${sT.incomeCount} payment${sT.incomeCount === 1 ? '' : 's'}</span>${deltaBadge(sT.income, yesterday.income, { invert: true, suffix: 'vs yesterday' })}`
    : `<span>Nothing received yet today</span>`;
  $('k-count-meta').innerHTML = cs.expected
    ? `<span>of ${formatINR(cs.expected, { decimals: false })}</span>${cs.remaining ? `<span class="tag tag--expense">${formatINR(cs.remaining, { decimals: false })} pending</span>` : '<span class="tag tag--income">All collected</span>'}`
    : `<a class="link" href="clients.html">Set up clients</a>`;

  const budget = settings.monthlyBudget || 0;
  const fill = document.querySelector('#k-budget .meter__fill');
  if (budget) {
    const used = pct(sO.expense, budget);
    fill.style.width = `${Math.min(100, used)}%`;
    fill.className = `meter__fill ${used >= 100 ? 'is-over' : used >= 80 ? 'is-warn' : ''}`;
    $('k-budget-text').innerHTML = used >= 100
      ? `<strong style="color:#FF8A7A">${formatINR(sO.expense - budget)} over</strong>&nbsp;budget of ${formatINR(budget, { decimals: false })}`
      : `${used.toFixed(0)}% of ${formatINR(budget, { decimals: false })} budget · ${formatINR(budget - sO.expense, { decimals: false })} left`;
  } else {
    fill.style.width = '0';
    $('k-budget-text').innerHTML = `${deltaBadge(sO.expense, lastSameDays.expense, { suffix: 'vs same days last month' })}`;
  }

  /* Secondary strip */
  $('s-income').textContent = fmt(sClient.expense);
  $('s-net').textContent = (sM.net < 0 ? '−' : '') + fmt(Math.abs(sM.net));
  $('s-net').className = `stat__value money ${sM.net < 0 ? 'amount--expense' : sM.net > 0 ? 'amount--income' : ''}`;
  $('s-avg').textContent = fmt(sO.expense / dayNo);
  $('s-gst').textContent = fmt(sM.gst);
  $('s-bills').innerHTML = sM.expenseCount
    ? `${sM.expenseCount - sM.missingBills}<small> / ${sM.expenseCount}</small>${sM.missingBills ? ` <a class="link" href="entries.html?preset=month&type=expense&bill=without">${sM.missingBills} missing</a>` : ''}`
    : '—';

  /* Charts — never show sample data; show empty states instead */
  renderDaily(month.filter(isOffice), mk, budget);
  renderCategories(month);
  renderTrend(mk);

  /* Recent */
  const recent = tx.slice(0, 6);
  $('recent').innerHTML = recent.length ? recent.map((t) => `
    <li class="recent__item" data-id="${t.id}" tabindex="0">
      <span class="recent__icon recent__icon--${t.type}">${ic(t.type === 'income' ? 'arrow-down-left' : 'arrow-up-right')}</span>
      <span class="recent__main"><strong>${esc(t.title)}</strong><small>${formatDate(t.date)} · ${esc(t.category)}${t.vendor ? ` · ${esc(t.vendor)}` : ''}</small></span>
      <span class="recent__right"><span class="amount amount--${t.type}">${t.type === 'income' ? '+' : '−'}${formatINR(t.amount)}</span>${t.bill?.fileId ? billCell(t) : ''}</span>
    </li>`).join('')
    : `<li>${emptyState({ icon: 'receipt', title: 'No entries yet', message: 'Your first office payment will show up here.', compact: true,
        action: ctx.canWrite ? '<a class="btn btn--primary btn--sm" href="add-entry.html"><i data-lucide="plus"></i>Add the first entry</a>' : '' })}</li>`;

  /* Rankings (this month) */
  $('rank-vendor').innerHTML = rankList(groupTotals(month, (t) => t.vendor || (t.scope === 'client' ? `${t.clientName} (client)` : 'Payee not entered')), { emptyText: 'No payees this month' });
  const order = { overdue: 0, partial: 1, unpaid: 2, advance: 3, paid: 4, nofee: 5, inactive: 6 };
  const crow = cs.rows.filter((r) => r.expectedPaise || r.receivedPaise).sort((a, b) => order[a.status] - order[b.status]).slice(0, 6);
  $('rank-client').innerHTML = crow.length ? crow.map((r) => `<li>${clientAvatar(r.client, { tag: 'a', href: `client.html?id=${encodeURIComponent(r.client.id)}` })}
      <div class="cmini__main"><div class="cmini__row"><strong>${esc(r.client.name)}</strong>${statusBadge(r.status, { small: true, partial: r.partial })}</div>
      <div class="meter"><div class="meter__fill ${r.pct >= 100 ? '' : r.pct ? 'is-warn' : 'is-over'}" style="width:${r.pct}%"></div></div>
      <div class="cmini__row"><small class="muted">${formatINR(r.received, { decimals: false })} of ${formatINR(r.expected, { decimals: false })}</small><small class="${r.balancePaise < 0 ? 'amount--expense' : 'muted'}">Balance ${r.balancePaise < 0 ? '−' : ''}${formatINR(Math.abs(r.balance), { decimals: false })}</small></div></div></li>`).join('')
    : `<li class="rank__empty">${clients.length ? 'No fees due this month' : '<a class="link" href="clients.html">Add your clients</a> to track payments'}</li>`;
  $('rank-mode').innerHTML = rankList(groupTotals(month, (t) => t.paymentMethod), { emptyText: 'No payments this month' });
  icons(document.getElementById('content'));
}

function renderDaily(month, mk, budget) {
  const box = $('daily-box');
  const expenses = month.filter((t) => t.type === 'expense');
  $('daily-sub').textContent = `ODEA office · ${monthLabel(mk)} · bars per day, line = running total`;
  if (!expenses.length) { box.innerHTML = emptyState({ icon: 'chart-no-axes-column', title: 'No spending this month yet', message: 'The daily chart appears after the first expense.', compact: true }); return; }
  if (!box.querySelector('canvas')) box.innerHTML = '<canvas id="chart-daily"></canvas>';
  const days = Number(todayISO().startsWith(mk) ? todayISO().slice(8) : daysInMonth(mk));
  const daily = Array(days).fill(0);
  expenses.forEach((t) => { const d = Number(t.date.slice(8)) - 1; if (d < days) daily[d] += t.amountPaise; });
  let run = 0;
  const cumulative = daily.map((p) => fromPaise(run += p));
  lineDaily('daily', box.querySelector('canvas'), {
    labels: daily.map((_, i) => `${i + 1} ${monthShort(mk)}`), daily: daily.map(fromPaise), cumulative, budget,
  });
}

function renderCategories(month) {
  const box = $('cat-box');
  const groups = groupTotals(month, (t) => t.category);
  if (!groups.length) {
    box.classList.add('is-empty');
    $('cat-legend').innerHTML = '';
    box.querySelector('.donut__chart').hidden = true;
    if (!box.querySelector('.state')) box.insertAdjacentHTML('afterbegin', emptyState({ icon: 'chart-pie', title: 'No categories yet', message: 'Add an expense to see the split.', compact: true }));
    return;
  }
  box.querySelector('.state')?.remove(); box.querySelector('.donut__chart').hidden = false;
  const top = groups.slice(0, 6);
  if (groups.length > 6) top.push({ key: 'Others', total: groups.slice(6).reduce((s, g) => s + g.total, 0), count: groups.slice(6).reduce((s, g) => s + g.count, 0) });
  const total = groups.reduce((s, g) => s + g.total, 0);
  doughnut('cat', $('chart-cat'), { labels: top.map((g) => g.key), values: top.map((g) => g.total) });
  $('cat-total').textContent = formatINR(total, { decimals: false });
  const colors = palette().series;
  $('cat-legend').innerHTML = top.map((g, i) => `<li><span class="legend__dot" style="background:${colors[i % colors.length]}"></span>
    <a class="legend__name" title="${esc(g.key)}" href="entries.html?preset=month&type=expense&category=${encodeURIComponent(g.key === 'Others' ? '' : g.key)}">${esc(g.key)}</a>
    <span class="legend__val"><strong class="money">${formatINR(g.total, { decimals: false })}</strong><small>${pct(g.total, total).toFixed(0)}%</small></span></li>`).join('');
}

function renderTrend(mk) {
  const box = $('trend-box');
  const months = Array.from({ length: 6 }, (_, i) => addMonths(mk, i - 5));
  const sums = months.map((m) => summarize(tx.filter((t) => t.date.startsWith(m))));
  if (!sums.some((s) => s.count)) { box.innerHTML = emptyState({ icon: 'chart-column', title: 'No history yet', message: 'Monthly bars build up as you add entries.', compact: true }); return; }
  if (!box.querySelector('canvas')) box.innerHTML = '<canvas id="chart-trend"></canvas>';
  barTrend('trend', box.querySelector('canvas'), {
    labels: months.map((m) => monthLabel(m, true)), expense: sums.map((s) => s.expense), income: sums.map((s) => s.income),
  });
}

function addDaysISO(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/* Interactions */
$('recent').addEventListener('click', (e) => {
  if (e.target.closest('[data-bill]')) return;
  const li = e.target.closest('[data-id]'); if (li) openEntryDetail(tx.find((t) => t.id === li.dataset.id), ctx);
});
$('recent').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('[data-id]')?.click(); });
wireBills($('recent'), (id) => tx.find((t) => t.id === id));

/* Summary cards open their page */
document.querySelectorAll('.kpi[data-href]').forEach((card) => {
  const go = (e) => { if (!e.target.closest('a')) location.href = card.dataset.href; };
  card.addEventListener('click', go);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
});

$('dash-pdf').addEventListener('click', async (e) => {
  const btn = e.currentTarget; const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner spinner--sm"></span><span>Preparing…</span>';
  try {
    const mk = currentMonthKey();
    await exportPDF({ title: 'Monthly Statement', period: monthLabel(mk), rows: tx.filter((t) => t.date.startsWith(mk)), preparedBy: ctx.profile.name, fileName: mk });
  } catch (err) { (await import('../ui.js')).toast('PDF export failed', 'error', { detail: err.message }); }
  finally { btn.disabled = false; btn.innerHTML = html; icons(btn); }
});
