/**
 * Client money maths — pure functions, no Firebase.
 *
 * A client payment  = transaction { scope:'client', type:'income',  clientId, forMonth:'YYYY-MM' }
 * A client expense  = transaction { scope:'client', type:'expense', clientId }   (month = its date)
 *
 *   Expected (fixed fee) for a month = the fee in force that month (fee history keeps old fees)
 *   Received  = Σ payments whose forMonth is that month (partial payments add up)
 *   Remaining = Expected − Received (never below 0)
 *   Spent     = Σ client expenses dated in that month
 *   Balance   = Received − Spent  → negative means you spent more than the client paid (shown in red)
 */
import { currentMonthKey, todayISO, addMonths, fromPaise } from './utils.js';

export const isClientPayment = (t, id) => t.scope === 'client' && t.type === 'income' && (!id || t.clientId === id);
export const isClientExpense = (t, id) => t.scope === 'client' && t.type === 'expense' && (!id || t.clientId === id);
export const paymentMonth = (t) => t.forMonth || t.month || (t.date || '').slice(0, 7);
export const scopeOf = (t) => t.scope || 'office';

/** Fee (paise) in force for month mk. */
export function feeForMonth(client, mk) {
  let fee = 0;
  for (const h of client.feeHistory || []) if (h.from <= mk) fee = h.feePaise;
  return fee;
}
export const currentFee = (client) => feeForMonth(client, currentMonthKey());

export function isActiveIn(client, mk) {
  if (client.startMonth && mk < client.startMonth) return false;
  if (client.archivedFrom && mk >= client.archivedFrom) return false;
  return true;
}

export const STATUS = {
  paid: { label: 'Paid', tone: 'income', icon: 'check-circle-2' },
  advance: { label: 'Paid + extra', tone: 'income', icon: 'badge-plus' },
  partial: { label: 'Partially paid', tone: 'warning', icon: 'circle-dashed' },
  unpaid: { label: 'Not paid', tone: 'muted', icon: 'circle' },
  overdue: { label: 'Overdue', tone: 'expense', icon: 'alert-circle' },
  nofee: { label: 'No fixed fee', tone: 'muted', icon: 'minus-circle' },
  inactive: { label: 'Not active', tone: 'muted', icon: 'pause-circle' },
};

/** Everything about one client in one month. Amounts in paise and rupees. */
export function clientMonth(client, tx, mk) {
  const payments = tx.filter((t) => isClientPayment(t, client.id) && paymentMonth(t) === mk)
    .sort((a, b) => a.date.localeCompare(b.date));
  const expenses = tx.filter((t) => isClientExpense(t, client.id) && t.date.startsWith(mk))
    .sort((a, b) => b.date.localeCompare(a.date));
  const active = isActiveIn(client, mk);
  const expectedPaise = active ? feeForMonth(client, mk) : 0;
  const receivedPaise = payments.reduce((s, t) => s + t.amountPaise, 0);
  const spentPaise = expenses.reduce((s, t) => s + t.amountPaise, 0);
  const remainingPaise = Math.max(0, expectedPaise - receivedPaise);
  const extraPaise = Math.max(0, receivedPaise - expectedPaise);

  let status;
  if (!active && !receivedPaise) status = 'inactive';
  else if (!expectedPaise) status = receivedPaise ? 'paid' : 'nofee';
  else if (receivedPaise >= expectedPaise) status = extraPaise ? 'advance' : 'paid';
  else {
    const cur = currentMonthKey();
    const due = client.dueDay ? Number(client.dueDay) : 0;
    const late = mk < cur || (mk === cur && due && Number(todayISO().slice(8)) > due);
    status = late ? 'overdue' : receivedPaise ? 'partial' : 'unpaid';
    if (late && receivedPaise) status = 'overdue';   // still overdue, the partial pills show what came in
  }
  const balancePaise = receivedPaise - spentPaise;
  return {
    month: mk, active, status, payments, expenses,
    expectedPaise, receivedPaise, spentPaise, remainingPaise, extraPaise, balancePaise,
    expected: fromPaise(expectedPaise), received: fromPaise(receivedPaise), spent: fromPaise(spentPaise),
    remaining: fromPaise(remainingPaise), extra: fromPaise(extraPaise), balance: fromPaise(balancePaise),
    pct: expectedPaise ? Math.min(100, (receivedPaise / expectedPaise) * 100) : (receivedPaise ? 100 : 0),
    partial: receivedPaise > 0 && receivedPaise < expectedPaise,
  };
}

/** Months from the client's start (or first activity) to `until`, newest first. */
export function clientMonths(client, tx, until = currentMonthKey()) {
  const mine = tx.filter((t) => t.scope === 'client' && t.clientId === client.id);
  let first = client.startMonth || until;
  mine.forEach((t) => { const m = t.type === 'income' ? paymentMonth(t) : t.date.slice(0, 7); if (m < first) first = m; });
  const out = [];
  for (let m = until; m >= first && out.length < 120; m = addMonths(m, -1)) out.push(m);
  return out;
}

/** All-time totals for a client. */
export function clientTotals(client, tx) {
  let receivedPaise = 0, spentPaise = 0;
  tx.forEach((t) => {
    if (isClientPayment(t, client.id)) receivedPaise += t.amountPaise;
    else if (isClientExpense(t, client.id)) spentPaise += t.amountPaise;
  });
  const cur = currentMonthKey();
  const duesPaise = clientMonths(client, tx, cur).reduce((s, m) => s + clientMonth(client, tx, m).remainingPaise, 0);
  return {
    receivedPaise, spentPaise, balancePaise: receivedPaise - spentPaise, duesPaise,
    received: fromPaise(receivedPaise), spent: fromPaise(spentPaise), balance: fromPaise(receivedPaise - spentPaise), dues: fromPaise(duesPaise),
  };
}

/** Totals across clients for a month. */
export function monthSummary(clients, tx, mk) {
  const rows = clients.filter((c) => isActiveIn(c, mk) || tx.some((t) => t.clientId === c.id && (paymentMonth(t) === mk || t.date.startsWith(mk))))
    .map((c) => ({ client: c, ...clientMonth(c, tx, mk) }));
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const expectedPaise = sum('expectedPaise'), receivedPaise = sum('receivedPaise'), spentPaise = sum('spentPaise'), remainingPaise = sum('remainingPaise');
  return {
    rows, expectedPaise, receivedPaise, spentPaise, remainingPaise,
    expected: fromPaise(expectedPaise), received: fromPaise(receivedPaise), spent: fromPaise(spentPaise),
    remaining: fromPaise(remainingPaise), balance: fromPaise(receivedPaise - spentPaise),
    pct: expectedPaise ? Math.min(100, (receivedPaise / expectedPaise) * 100) : 0,
    count: (st) => rows.filter((r) => (Array.isArray(st) ? st.includes(r.status) : r.status === st)).length,
  };
}
