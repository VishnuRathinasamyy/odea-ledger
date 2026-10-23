/**
 * Filtering + totals. All calculations run on the live Firestore data.
 *   Total Expenses = Σ expense amounts in range
 *   Total Income   = Σ income amounts in range
 *   Net Balance    = Income − Expenses
 */
import {
  todayISO, monthKey, addMonths, monthStart, monthEnd, weekStart, financialYear,
  monthLabel, formatDate, fromPaise,
} from './utils.js';

export const PRESETS = [
  { id: 'all', label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'lastmonth', label: 'Last month' },
  { id: 'fy', label: 'This FY' },
  { id: 'pick', label: 'Pick month' },
  { id: 'range', label: 'Date range' },
];

export const defaultFilters = () => ({
  preset: 'month', month: monthKey(todayISO()), from: '', to: '',
  scope: '', type: '', category: '', payment: '', client: '', bill: '', q: '',
  sort: 'date', dir: 'desc', page: 1, size: 25,
});

/** Turn the preset into a concrete inclusive [from, to] range (ISO strings) or null for all time. */
export function resolveRange(f) {
  const t = todayISO();
  switch (f.preset) {
    case 'today': return { from: t, to: t };
    case 'week': return { from: weekStart(t), to: t };
    case 'month': { const m = monthKey(t); return { from: monthStart(m), to: monthEnd(m) }; }
    case 'lastmonth': { const m = addMonths(monthKey(t), -1); return { from: monthStart(m), to: monthEnd(m) }; }
    case 'fy': { const fy = financialYear(t); return { from: fy.from, to: fy.to }; }
    case 'pick': { const m = f.month || monthKey(t); return { from: monthStart(m), to: monthEnd(m) }; }
    case 'range': return (f.from || f.to) ? { from: f.from || '0000-01-01', to: f.to || '9999-12-31' } : null;
    default: return null;
  }
}

export function rangeLabel(f) {
  const t = todayISO();
  switch (f.preset) {
    case 'today': return `Today · ${formatDate(t)}`;
    case 'week': return `This week · ${formatDate(weekStart(t))} – ${formatDate(t)}`;
    case 'month': return monthLabel(monthKey(t));
    case 'lastmonth': return monthLabel(addMonths(monthKey(t), -1));
    case 'fy': return financialYear(t).label;
    case 'pick': return monthLabel(f.month || monthKey(t));
    case 'range': return f.from || f.to ? `${f.from ? formatDate(f.from) : 'Start'} – ${f.to ? formatDate(f.to) : 'Today'}` : 'All time';
    default: return 'All time';
  }
}

export function applyFilters(list, f) {
  const r = resolveRange(f);
  const q = (f.q || '').trim().toLowerCase();
  const out = list.filter((t) => {
    if (r && (t.date < r.from || t.date > r.to)) return false;
    if (f.scope && (t.scope || 'office') !== f.scope) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.payment && t.paymentMethod !== f.payment) return false;
    if (f.client && (t.clientName || t.client || '') !== f.client) return false;
    if (f.bill === 'with' && !t.bill?.fileId) return false;
    if (f.bill === 'without' && t.bill?.fileId) return false;
    if (q) {
      const hay = [t.title, t.vendor, t.clientName, t.client, t.project, t.description, t.notes, t.category, t.refNo, t.paymentMethod, String(t.amount)]
        .join(' ').toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  return sortList(out, f.sort, f.dir);
}

export function sortList(list, key = 'date', dir = 'desc') {
  const m = dir === 'asc' ? 1 : -1;
  const val = {
    date: (t) => t.date + (t.createdAtDate ? t.createdAtDate.toISOString() : '~'),
    amount: (t) => t.amountPaise,
    title: (t) => (t.title || '').toLowerCase(),
    category: (t) => (t.category || '').toLowerCase(),
  }[key] || ((t) => t.date);
  return [...list].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * m; });
}

/** Totals in paise, then converted — exact to the paisa. */
export function summarize(list) {
  let exp = 0, inc = 0, gst = 0, nExp = 0, nInc = 0, noBill = 0;
  for (const t of list) {
    if (t.type === 'income') { inc += t.amountPaise; nInc++; }
    else {
      exp += t.amountPaise; nExp++;
      if (t.gstRate) gst += Math.round((t.amountPaise * t.gstRate) / (100 + t.gstRate));
      if (!t.bill?.fileId) noBill++;
    }
  }
  return {
    expense: fromPaise(exp), income: fromPaise(inc), net: fromPaise(inc - exp), gst: fromPaise(gst),
    count: list.length, expenseCount: nExp, incomeCount: nInc, missingBills: noBill,
    avgExpense: nExp ? fromPaise(Math.round(exp / nExp)) : 0,
  };
}

/** Group expense totals by a key → [{ key, total, count }] sorted desc. */
export function groupTotals(list, keyFn, { type = 'expense' } = {}) {
  const map = new Map();
  for (const t of list) {
    if (type && t.type !== type) continue;
    const k = keyFn(t) || '—';
    const g = map.get(k) || { key: k, paise: 0, count: 0 };
    g.paise += t.amountPaise; g.count++; map.set(k, g);
  }
  return [...map.values()].map((g) => ({ ...g, total: fromPaise(g.paise) })).sort((a, b) => b.paise - a.paise);
}

/** Human summary of the active filters, used in exports. */
export function describeFilters(f) {
  const bits = [rangeLabel(f)];
  if (f.scope) bits.push(f.scope === 'client' ? 'Client money' : 'Office only');
  if (f.type) bits.push(f.type === 'income' ? 'Income only' : 'Expenses only');
  if (f.category) bits.push(`Category: ${f.category}`);
  if (f.payment) bits.push(`Paid via ${f.payment}`);
  if (f.client) bits.push(`Client: ${f.client}`);
  if (f.bill === 'with') bits.push('With bill'); if (f.bill === 'without') bits.push('Missing bill');
  if (f.q) bits.push(`Search: "${f.q}"`);
  return bits.join(' · ');
}

/* ---------------- URL sync (so filters survive refresh / can be bookmarked) ---------------- */
const KEYS = ['preset', 'month', 'from', 'to', 'scope', 'type', 'category', 'payment', 'client', 'bill', 'q', 'sort', 'dir', 'page', 'size'];
export function filtersFromURL(base = defaultFilters()) {
  const p = new URLSearchParams(location.search);
  const f = { ...base };
  KEYS.forEach((k) => { if (p.has(k)) f[k] = p.get(k); });
  f.page = Math.max(1, parseInt(f.page, 10) || 1);
  f.size = parseInt(f.size, 10) || base.size;
  if (p.has('q') && !p.has('preset')) f.preset = 'all';   // global search → search everything
  return f;
}
export function filtersToURL(f) {
  const d = defaultFilters(); const p = new URLSearchParams();
  KEYS.forEach((k) => { if (f[k] !== undefined && f[k] !== '' && String(f[k]) !== String(d[k])) p.set(k, f[k]); });
  if (f.preset !== d.preset || f.q) p.set('preset', f.preset);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}
