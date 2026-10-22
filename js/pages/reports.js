import { boot } from '../layout.js';
import { watchTransactions, watchSettings, explainError } from '../store.js';
import { summarize, groupTotals } from '../filters.js';
import {
  currentMonthKey, addMonths, monthLabel, monthShort, daysInMonth, monthStart, monthEnd, weekStart, addDays,
  formatINR, formatDate, esc, pct, fromPaise, todayISO, qp, financialYear,
} from '../utils.js';
import { icons, emptyState, errorState, toast, ic } from '../ui.js';
import { lineDaily } from '../charts.js';
import { rankList, deltaBadge } from '../widgets.js';
import { exportCSV, exportPDF } from '../export.js';

const ctx = await boot('reports', { title: 'Monthly reports' });
const $ = (id) => document.getElementById(id);
let tx = [], budget = 0, loaded = false;
let mk = /^\d{4}-\d{2}$/.test(qp('month') || '') ? qp('month') : currentMonthKey();

watchSettings((s) => { budget = s.monthlyBudget || 0; if (loaded) render(); });
watchTransactions((list) => { tx = list; loaded = true; render(); }, (err) => {
  document.querySelector('.kpis').insertAdjacentHTML('beforebegin', `<div class="panel">${errorState({ title: 'Could not load entries', message: explainError(err), compact: true })}</div>`); icons();
});
document.addEventListener('themechange', () => loaded && render());

function go(month) { mk = month; history.replaceState(null, '', `?month=${mk}`); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
document.querySelectorAll('.month-nav [data-step]').forEach((b) => b.addEventListener('click', () => go(addMonths(mk, Number(b.dataset.step)))));
$('r-picker').addEventListener('change', (e) => e.target.value && go(e.target.value));
$('r-today').addEventListener('click', () => go(currentMonthKey()));
$('r-month').addEventListener('click', () => $('r-picker').showPicker?.());

const inMonth = (m) => tx.filter((t) => t.date.startsWith(m));

function render() {
  const prev = addMonths(mk, -1);
  const cur = inMonth(mk), last = inMonth(prev);
  const s = summarize(cur), p = summarize(last);
  const isCurrent = mk === currentMonthKey();

  $('r-month').textContent = monthLabel(mk);
  $('r-picker').value = mk;
  $('r-today').hidden = isCurrent;
  document.querySelector('.month-nav [data-step="1"]').disabled = mk >= currentMonthKey();

  $('r-exp').textContent = formatINR(s.expense);
  $('r-exp-d').innerHTML = deltaBadge(s.expense, p.expense, { suffix: `vs ${monthLabel(prev, true)}` });
  $('r-inc').textContent = formatINR(s.income);
  $('r-inc-d').innerHTML = deltaBadge(s.income, p.income, { invert: true, suffix: `vs ${monthLabel(prev, true)}` });
  $('r-net').textContent = (s.net < 0 ? '−' : '') + formatINR(Math.abs(s.net));
  $('r-net-d').innerHTML = `<span>Income − expenses</span>${budget ? `<span>· budget ${pct(s.expense, budget).toFixed(0)}% used</span>` : ''}`;
  $('r-count').textContent = s.count;
  const days = isCurrent ? Number(todayISO().slice(8)) : daysInMonth(mk);
  $('r-count-d').innerHTML = `<span>${formatINR(s.expense / days)} / day avg</span>${s.gst ? `<span>· GST ${formatINR(s.gst)}</span>` : ''}`;

  renderDaily(cur, days);
  renderWeeks(cur);
  renderCategories(cur, last);
  $('r-modes').innerHTML = rankList(groupTotals(cur, (t) => t.paymentMethod), { emptyText: 'No expenses this month' });
  $('r-vendors').innerHTML = rankList(groupTotals(cur, (t) => t.vendor), { emptyText: 'No payees recorded' });
  $('r-clients').innerHTML = rankList(groupTotals(cur, (t) => [t.client, t.project].filter(Boolean).join(' · ') || 'Internal / office'), { emptyText: 'No expenses this month' });
  renderHistory();
  icons(document.getElementById('content'));
}

function renderDaily(cur, days) {
  const box = $('r-daily-box');
  const exp = cur.filter((t) => t.type === 'expense');
  if (!exp.length) { box.innerHTML = emptyState({ icon: 'chart-no-axes-column', title: `No expenses in ${monthLabel(mk)}`, compact: true }); return; }
  if (!box.querySelector('canvas')) box.innerHTML = '<canvas></canvas>';
  const daily = Array(days).fill(0);
  exp.forEach((t) => { const d = Number(t.date.slice(8)) - 1; if (d < days) daily[d] += t.amountPaise; });
  let run = 0;
  lineDaily('r-daily', box.querySelector('canvas'), {
    labels: daily.map((_, i) => `${i + 1} ${monthShort(mk)}`), daily: daily.map(fromPaise), cumulative: daily.map((v) => fromPaise(run += v)), budget,
  });
}

function renderWeeks(cur) {
  const end = monthEnd(mk); const weeks = [];
  for (let ws = weekStart(monthStart(mk)); ws <= end; ws = addDays(ws, 7)) {
    const from = ws < monthStart(mk) ? monthStart(mk) : ws;
    const to = addDays(ws, 6) > end ? end : addDays(ws, 6);
    const list = cur.filter((t) => t.type === 'expense' && t.date >= from && t.date <= to);
    weeks.push({ from, to, total: fromPaise(list.reduce((a, t) => a + t.amountPaise, 0)), count: list.length });
  }
  const max = Math.max(...weeks.map((w) => w.total), 1);
  $('r-weeks').innerHTML = weeks.map((w, i) => `<li class="weeks__item">
    <div class="weeks__label"><strong>Week ${i + 1}</strong><small>${formatDate(w.from).slice(0, 6)} – ${formatDate(w.to).slice(0, 6)}</small></div>
    <div class="weeks__bar"><span style="width:${(w.total / max) * 100}%"></span></div>
    <div class="weeks__val"><strong class="money">${formatINR(w.total, { decimals: false })}</strong><small>${w.count} paid</small></div></li>`).join('');
}

function renderCategories(cur, last) {
  const now = groupTotals(cur, (t) => t.category);
  const before = new Map(groupTotals(last, (t) => t.category).map((g) => [g.key, g.total]));
  const keys = [...new Set([...now.map((g) => g.key), ...before.keys()])];
  const total = now.reduce((a, g) => a + g.total, 0);
  $('r-cat-sub').textContent = `${monthLabel(mk)} vs ${monthLabel(addMonths(mk, -1))}`;
  if (!keys.length) { $('r-cats').innerHTML = `<tr><td colspan="5">${emptyState({ icon: 'chart-pie', title: 'No expenses to break down', compact: true })}</td></tr>`; return; }
  const rows = keys.map((k) => ({ key: k, cur: now.find((g) => g.key === k)?.total || 0, prev: before.get(k) || 0, count: now.find((g) => g.key === k)?.count || 0 }))
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev);
  $('r-cats').innerHTML = rows.map((r) => {
    const diff = r.cur - r.prev;
    return `<tr>
      <td><a class="cat-link" href="entries.html?preset=pick&month=${mk}&type=expense&category=${encodeURIComponent(r.key)}">${esc(r.key)}</a><small class="muted"> · ${r.count}</small></td>
      <td class="t-right"><strong class="money">${formatINR(r.cur)}</strong></td>
      <td class="t-right cell-muted money">${formatINR(r.prev)}</td>
      <td class="t-right">${!r.prev ? '<span class="delta delta--flat">New</span>' : !r.cur ? '<span class="delta delta--good">−100%</span>'
        : `<span class="delta ${diff > 0 ? 'delta--bad' : diff < 0 ? 'delta--good' : 'delta--flat'}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(pct(diff, r.prev)).toFixed(0)}%</span>`}</td>
      <td><div class="share"><div class="share__bar"><span style="width:${pct(r.cur, total)}%"></span></div><span>${pct(r.cur, total).toFixed(1)}%</span></div></td>
    </tr>`;
  }).join('');
}

function renderHistory() {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(currentMonthKey(), -i));
  const data = months.map((m) => ({ m, s: summarize(inMonth(m)) }));
  const max = Math.max(...data.map((d) => d.s.expense), 1);
  $('r-history').innerHTML = data.map(({ m, s }) => `
    <tr class="${m === mk ? 'is-current' : ''}" data-month="${m}" tabindex="0">
      <td><strong>${monthLabel(m)}</strong></td>
      <td class="t-right money amount--expense">${s.expense ? formatINR(s.expense) : '—'}</td>
      <td class="t-right money amount--income">${s.income ? formatINR(s.income) : '—'}</td>
      <td class="t-right money"><strong class="${s.net < 0 ? 'amount--expense' : s.net > 0 ? 'amount--income' : ''}">${s.count ? (s.net < 0 ? '−' : '') + formatINR(Math.abs(s.net)) : '—'}</strong></td>
      <td class="t-right">${s.count || '—'}</td>
      <td class="t-right">${s.missingBills ? `<span class="tag tag--pending">${s.missingBills}</span>` : s.expenseCount ? `<span class="tag tag--income">${ic('check', 'ic--xs')}</span>` : '—'}</td>
      <td><div class="share__bar share__bar--thin"><span style="width:${(s.expense / max) * 100}%"></span></div></td>
    </tr>`).join('');
  const fy = financialYear();
  const fyS = summarize(tx.filter((t) => t.date >= fy.from && t.date <= fy.to));
  $('r-history-foot').innerHTML = `<tr><td>${fy.label} so far</td><td class="t-right money amount--expense">${formatINR(fyS.expense)}</td><td class="t-right money amount--income">${formatINR(fyS.income)}</td>
    <td class="t-right money ${fyS.net < 0 ? 'amount--expense' : 'amount--income'}">${(fyS.net < 0 ? '−' : '') + formatINR(Math.abs(fyS.net))}</td><td class="t-right">${fyS.count}</td><td class="t-right">${fyS.missingBills || '—'}</td><td></td></tr>`;
}
$('r-history').addEventListener('click', (e) => { const r = e.target.closest('[data-month]'); if (r) go(r.dataset.month); });
$('r-history').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('[data-month]')?.click(); });

/* Exports */
$('r-csv').addEventListener('click', () => {
  const rows = inMonth(mk);
  if (!rows.length) return toast('Nothing to export for this month', 'warning');
  exportCSV(rows, { name: mk }); toast(`Exported ${rows.length} entries`, 'success');
});
$('r-pdf').addEventListener('click', async (e) => {
  const rows = inMonth(mk);
  if (!rows.length) return toast('Nothing to export for this month', 'warning');
  const btn = e.currentTarget, html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner spinner--sm"></span><span>Preparing…</span>';
  try { await exportPDF({ title: 'Monthly Statement', period: monthLabel(mk), rows, preparedBy: ctx.profile.name, fileName: mk }); toast('PDF downloaded', 'success'); }
  catch (err) { toast('PDF export failed', 'error', { detail: err.message }); }
  finally { btn.disabled = false; btn.innerHTML = html; icons(btn); }
});
