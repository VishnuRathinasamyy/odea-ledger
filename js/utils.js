/**
 * Pure helpers: money, dates, text, and the safe amount calculator.
 * Dates are handled as 'YYYY-MM-DD' strings in IST so a 11:30 PM entry never
 * lands in the next day/month because of UTC conversion.
 */
import { CONFIG } from './config.js';

/* ---------------- Money ---------------- */
const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrFmt0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,25,000.00 */
export const formatINR = (rupees, { decimals = true } = {}) =>
  (decimals ? inrFmt : inrFmt0).format(Number(rupees) || 0);

/** 1,25,000.00 (no symbol — for CSV / tables that already show ₹) */
export const formatNumber = (rupees) => numFmt.format(Number(rupees) || 0);

/** ₹1.25 L / ₹2.40 Cr / ₹8.5K — for chart axes */
export function formatCompactINR(rupees) {
  const n = Math.abs(Number(rupees) || 0);
  const sign = rupees < 0 ? '−' : '';
  if (n >= 1e7) return `${sign}₹${trim(n / 1e7)} Cr`;
  if (n >= 1e5) return `${sign}₹${trim(n / 1e5)} L`;
  if (n >= 1e3) return `${sign}₹${trim(n / 1e3)}K`;
  return `${sign}₹${Math.round(n)}`;
}
const trim = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '');

/** Money is stored as integer paise to avoid floating-point drift. */
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const fromPaise = (paise) => (Number(paise) || 0) / 100;
/** Sum in paise then convert — exact. */
export const sumAmount = (list) => fromPaise(list.reduce((s, t) => s + (t.amountPaise || 0), 0));

/* ---------------- Dates (IST, string based) ---------------- */
const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayISO = () => isoFmt.format(new Date());
export const isoFromDate = (d) => isoFmt.format(d);
export const monthKey = (iso) => iso.slice(0, 7);
export const currentMonthKey = () => monthKey(todayISO());

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (iso) => iso.split('-').map(Number);
const utc = (iso) => { const [y, m, d] = parts(iso); return new Date(Date.UTC(y, m - 1, d || 1)); };
const fromUTC = (dt) => dt.toISOString().slice(0, 10);

export function addDays(iso, n) { const d = utc(iso); d.setUTCDate(d.getUTCDate() + n); return fromUTC(d); }
export function addMonths(mk, n) { const [y, m] = parts(mk); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return fromUTC(d).slice(0, 7); }
export function daysInMonth(mk) { const [y, m] = parts(mk); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export const monthStart = (mk) => `${mk}-01`;
export const monthEnd = (mk) => `${mk}-${String(daysInMonth(mk)).padStart(2, '0')}`;
export const dayOfWeek = (iso) => utc(iso).getUTCDay();
/** Monday-based week start */
export const weekStart = (iso) => addDays(iso, -((dayOfWeek(iso) + 6) % 7));

/** Indian financial year: 1 April → 31 March */
export function financialYear(iso = todayISO()) {
  const [y, m] = parts(iso);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}-${String(start + 1).slice(2)}` };
}

export const monthLabel = (mk, short = false) => { const [y, m] = parts(mk); return `${(short ? MONTHS_SHORT : MONTHS)[m - 1]} ${y}`; };
export const monthShort = (mk) => MONTHS_SHORT[parts(mk)[1] - 1];
export function formatDate(iso, { withDay = false } = {}) {
  if (!iso) return '—';
  const [y, m, d] = parts(iso);
  const base = `${String(d).padStart(2, '0')} ${MONTHS_SHORT[m - 1]} ${y}`;
  return withDay ? `${DAYS_SHORT[dayOfWeek(iso)]}, ${base}` : base;
}
export function longToday() {
  return new Intl.DateTimeFormat('en-IN', { timeZone: CONFIG.timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
}
export function formatDateTime(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: CONFIG.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
export const isValidISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(utc(s)) === s;

/** Drive folder name for a bill dated `iso`: "2026-10 October" — sorts correctly in Drive. */
export const billFolderName = (iso) => `${monthKey(iso)} ${MONTHS[parts(iso)[1] - 1]}`;

/* ---------------- Text ---------------- */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const initials = (name = '') => name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'U';
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export const pct = (part, whole) => (whole ? (part / whole) * 100 : 0);

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function formatBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), 3);
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Short human reference shown as "Transaction ID": OD-2610-7K3Q */
export function makeRefNo(iso) {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const rand = crypto.getRandomValues(new Uint8Array(4));
  const code = Array.from(rand, (b) => alphabet[b % alphabet.length]).join('');
  return `OD-${iso.slice(2, 4)}${iso.slice(5, 7)}-${code}`;
}

/* ---------------- Calculator ----------------
 * Safe arithmetic for the amount field: "1200 + 350.50*2 - 10%" etc.
 * Recursive-descent parser — never uses eval().
 * Supports + − × ÷ ( ), commas as thousands separators, ₹ symbol,
 * and a trailing percent meaning "of the running value" (e.g. 1000+18% = 1180).
 */
export function evaluateExpression(input) {
  const src = String(input ?? '')
    .replace(/[₹,\s]/g, '')
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-');
  if (!src) return { ok: false, empty: true };
  if (!/^[\d.+\-*/()%]+$/.test(src)) return { ok: false, error: 'Only numbers and + − × ÷ ( ) % are allowed' };

  let i = 0;
  const peek = () => src[i];
  const eat = (c) => (src[i] === c ? (i++, true) : false);

  function number() {
    const start = i;
    while (i < src.length && /[\d.]/.test(src[i])) i++;
    const raw = src.slice(start, i);
    if (!raw || (raw.match(/\./g) || []).length > 1) throw new Error('Invalid number');
    return parseFloat(raw);
  }
  function factor() {
    if (eat('+')) return factor();
    if (eat('-')) return -factor();
    if (eat('(')) { const v = expr(); if (!eat(')')) throw new Error('Missing )'); return v; }
    return number();
  }
  function term() {
    let v = factor();
    for (;;) {
      if (eat('*')) v *= factor();
      else if (eat('/')) { const d = factor(); if (d === 0) throw new Error('Division by zero'); v /= d; }
      else return v;
    }
  }
  function expr() {
    let v = term();
    for (;;) {
      if (peek() === '+' || peek() === '-') {
        const op = src[i++];
        let r = term();
        if (eat('%')) r = (v * r) / 100;       // 1000 + 18%  → 1180
        v = op === '+' ? v + r : v - r;
      } else if (eat('%')) { v = v / 100; }     // bare 50% → 0.5
      else return v;
    }
  }
  try {
    const value = expr();
    if (i !== src.length) throw new Error('Unexpected character');
    if (!Number.isFinite(value)) throw new Error('Invalid result');
    const rounded = Math.round(value * 100) / 100;
    return { ok: true, value: rounded, isExpression: /[+\-*/()%]/.test(src.replace(/^[+-]/, '')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Read a query-string param */
export const qp = (name) => new URLSearchParams(location.search).get(name);
