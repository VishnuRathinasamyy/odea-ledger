import { boot } from '../layout.js';
import { CONFIG } from '../config.js';
import {
  watchTransactions, watchSettings, watchClients, getTransaction, createTransaction, updateTransaction, explainError,
} from '../store.js';
import { uploadBill, prepareBill, trashBill, isDriveConfigured, getBillURL } from '../drive.js';
import { validateEntry } from '../validation.js';
import { clientMonth, currentFee } from '../clients-lib.js';
import {
  todayISO, addDays, monthKey, monthLabel, evaluateExpression, formatINR, formatDate, formatBytes, billFolderName,
  makeRefNo, toPaise, fromPaise, esc, qp, debounce,
} from '../utils.js';
import { icons, toast, confirmDialog, ic, openLightbox } from '../ui.js';

const editId = qp('id');
const dupId = qp('dup');
const startScope = qp('scope') === 'client' ? 'client' : 'office';
const ctx = await boot(startScope === 'client' && !editId ? 'add-client-expense' : 'add-entry', { title: startScope === 'client' ? 'Client expense' : 'Office expense' });
if (!ctx.canWrite) { location.replace('entries.html'); await new Promise(() => {}); }   // viewers can't add entries

const form = document.getElementById('entry-form');
const $ = (id) => document.getElementById(id);
const F = (name) => form.elements[name];
const DRAFT_KEY = 'odea-ledger-draft';

let editing = null;          // existing transaction when editing
let allTx = [];              // all transactions (for autofill, duplicate check, client balance)
let clients = [];
let settings = { categories: [...CONFIG.defaultCategories], clientCategories: [...CONFIG.clientCategories] };
let bill = { state: 'none' }; // none | existing | new | removed
let uploadedBill = null;      // keeps a finished upload if the DB write fails, so retry doesn't re-upload
let saving = false;

/* ---------------- Select options ---------------- */
function fillSelect(sel, items, { placeholder, value } = {}) {
  const cur = value ?? sel.value;
  sel.innerHTML = (placeholder ? `<option value="">${placeholder}</option>` : '') + items.map((i) => `<option value="${esc(i.value ?? i)}">${esc(i.label ?? i)}</option>`).join('');
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
fillSelect(F('paymentMethod'), CONFIG.paymentMethods, { placeholder: 'Select method', value: 'UPI' });
fillSelect(F('gstRate'), CONFIG.gstRates.map((r) => ({ value: String(r), label: r ? `${r}% GST` : 'No GST' })), { value: '0' });

const scope = () => form.querySelector('input[name="scope"]:checked').value;
const catsFor = (sc) => (sc === 'client' ? settings.clientCategories : settings.categories);
function fillCategories() {
  const list = [...catsFor(scope())];
  const keep = F('category').value || editing?.category;
  if (keep && !list.includes(keep) && editing) list.push(keep);   // keep an old category when editing
  fillSelect(F('category'), list, { placeholder: 'Select category', value: keep });
}
function fillClients() {
  const keepId = F('clientId').value || editing?.clientId || qp('client') || '';
  const list = clients.filter((c) => !c.archived || c.id === keepId);
  const mk = monthKey(F('date').value || todayISO());
  fillSelect(F('clientId'), list.map((c) => {
    const m = clientMonth(c, allTx.filter((t) => t.id !== editing?.id), mk);
    return { value: c.id, label: `${c.name}  —  ${m.balancePaise < 0 ? '−' : ''}${formatINR(Math.abs(m.balance), { decimals: false })} left · ${monthLabel(mk, true)}` };
  }), { placeholder: clients.length ? 'Select client' : 'No clients yet — add one in Settings', value: keepId });
}

watchSettings((s) => { settings = s; fillCategories(); });
watchClients((list) => { clients = list; fillClients(); refresh(); });
watchTransactions((list) => {
  allTx = list;
  const uniq = (fn) => [...new Set(list.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('dl-vendor').innerHTML = uniq((t) => t.vendor).map((v) => `<option value="${esc(v)}">`).join('');
  $('dl-project').innerHTML = uniq((t) => t.project).map((v) => `<option value="${esc(v)}">`).join('');
  fillClients(); refresh();
});

/* ---------------- Office / client switch ---------------- */
function setScope(sc, { focus = false } = {}) {
  form.querySelector(`input[name="scope"][value="${sc}"]`).checked = true;
  form.querySelector('.client-field').hidden = sc !== 'client';
  fillCategories();
  if (!editing) {
    document.querySelector('.topbar__title h1').textContent = sc === 'client' ? 'Client expense' : 'Office expense';
    $('form-eyebrow').textContent = sc === 'client' ? 'Client expense' : 'Office expense';
  }
  if (focus && sc === 'client' && !F('clientId').value) F('clientId').focus();
  refresh();
}
form.querySelectorAll('input[name="scope"]').forEach((r) => r.addEventListener('change', () => { F('category').value = ''; setScope(scope(), { focus: true }); clearError('category'); }));
F('clientId').addEventListener('change', () => { clearError('clientId'); refresh(); });

function fillForm(t) {
  F('type').value = t.type || 'expense';
  F('date').value = t.date;
  setScope(t.scope === 'client' ? 'client' : 'office');
  if (t.clientId) { fillClients(); F('clientId').value = t.clientId; }
  F('amount').value = t.amount.toFixed(2).replace(/\.00$/, '');
  F('title').value = t.title || '';
  fillCategories(); F('category').value = t.category || '';
  F('paymentMethod').value = t.paymentMethod || '';
  F('vendor').value = t.vendor || ''; F('project').value = t.project || '';
  F('description').value = t.description || ''; F('notes').value = t.notes || '';
  F('gstRate').value = String(t.gstRate || 0);
  if (t.gstRate || t.project || t.notes) $('more-details').open = true;
  refresh();
}

F('date').value = todayISO();
F('date').max = addDays(todayISO(), 1);

/* ---------------- Amount calculator ---------------- */
const amountEl = F('amount');
function refreshAmount() {
  const res = evaluateExpression(amountEl.value);
  const calc = $('amount-calc');
  $('calc-badge').hidden = !(res.ok && res.isExpression);
  if (res.ok && res.isExpression) calc.innerHTML = `<span>=</span><strong>${formatINR(res.value)}</strong><button type="button" class="link" id="apply-calc">Use this</button>`;
  else if (!res.ok && !res.empty && amountEl.value.trim()) calc.innerHTML = `<span class="calc-err">${esc(res.error)}</span>`;
  else calc.innerHTML = res.ok ? `<span class="muted">${formatINR(res.value)}</span>` : '';
  return res;
}
amountEl.addEventListener('input', () => { refreshAmount(); clearError('amount'); refresh(); });
amountEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === '=') {
    const r = evaluateExpression(amountEl.value);
    if (r.ok && r.isExpression) { e.preventDefault(); amountEl.value = String(r.value); refreshAmount(); refresh(); }
  }
});
amountEl.addEventListener('blur', () => { const r = evaluateExpression(amountEl.value); if (r.ok && r.isExpression) { amountEl.value = String(r.value); refreshAmount(); } });
$('amount-calc').addEventListener('click', (e) => { if (e.target.id === 'apply-calc') { amountEl.value = String(evaluateExpression(amountEl.value).value); refreshAmount(); refresh(); amountEl.focus(); } });
document.querySelector('.quick-add').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  if (b.dataset.add === 'clear') amountEl.value = '';
  else { const r = evaluateExpression(amountEl.value); amountEl.value = String(((r.ok ? r.value : 0) + Number(b.dataset.add)).toFixed(2)).replace(/\.00$/, ''); }
  refreshAmount(); refresh(); clearError('amount');
});
document.querySelector('.date-quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]'); if (!b) return;
  F('date').value = addDays(todayISO(), Number(b.dataset.day)); fillClients(); refresh(); clearError('date');
});
F('date').addEventListener('change', () => fillClients());

/* ---------------- Smart autofill from the payee's last entry ---------------- */
F('vendor').addEventListener('change', () => {
  const v = F('vendor').value.trim().toLowerCase(); if (!v) return;
  const last = allTx.find((t) => t.type === 'expense' && (t.vendor || '').toLowerCase() === v);
  if (!last) { $('vendor-hint').textContent = 'New payee'; return; }
  const filled = [];
  if (!F('category').value && catsFor(scope()).includes(last.category)) { F('category').value = last.category; filled.push('category'); }
  if (!F('title').value) { F('title').value = last.title; filled.push('reason'); }
  if (last.gstRate && F('gstRate').value === '0') { F('gstRate').value = String(last.gstRate); filled.push('GST'); }
  $('vendor-hint').innerHTML = `Last paid ${formatINR(last.amount)} on ${formatDate(last.date)}${filled.length ? ` · filled ${filled.join(', ')}` : ''}`;
  refresh();
});

/* ---------------- Bill handling ---------------- */
const dz = $('dropzone');
if (!isDriveConfigured()) { $('drive-warn').hidden = false; dz.classList.add('is-disabled'); $('camera-btn').disabled = true; }

async function acceptFile(file) {
  if (!file || !isDriveConfigured()) return;
  try {
    dz.classList.add('is-processing');
    const prepared = await prepareBill(file);
    setBill({ state: 'new', file, prepared, url: URL.createObjectURL(prepared.blob) });
  } catch (e) { toast('Could not use that file', 'error', { detail: e.message }); }
  finally { dz.classList.remove('is-processing'); }
}

function setBill(next) {
  if (bill.url && bill.state === 'new') URL.revokeObjectURL(bill.url);
  bill = next; uploadedBill = null;
  const empty = dz.querySelector('.dropzone__empty'), box = dz.querySelector('.dropzone__file');
  const showing = bill.state === 'new' || bill.state === 'existing';
  empty.hidden = showing; box.hidden = !showing;
  dz.classList.toggle('has-file', showing);
  if (bill.state === 'new') {
    const pdf = bill.prepared.mimeType === 'application/pdf';
    box.querySelector('.dropzone__preview').innerHTML = pdf ? `<div class="dz-pdf">${ic('file-text')}<span>PDF</span></div>` : `<img src="${bill.url}" alt="Bill preview">`;
    box.querySelector('strong').textContent = bill.file.name || 'Pasted image';
    const saved = bill.prepared.blob.size < bill.prepared.originalSize;
    box.querySelector('.dropzone__meta span').innerHTML = saved
      ? `${formatBytes(bill.prepared.originalSize)} → <b>${formatBytes(bill.prepared.blob.size)}</b> after compression`
      : formatBytes(bill.prepared.blob.size);
  } else if (bill.state === 'existing') {
    const pdf = bill.meta.mimeType === 'application/pdf';
    box.querySelector('.dropzone__preview').innerHTML = '<div class="spinner"></div>';
    getBillURL(bill.meta.fileId, pdf ? 'thumb' : 'full')
      .then((u) => { if (bill.state === 'existing') box.querySelector('.dropzone__preview').innerHTML = `<img src="${u}" alt="Bill">`; })
      .catch(() => { box.querySelector('.dropzone__preview').innerHTML = `<div class="dz-pdf">${ic('image-off')}</div>`; icons(box); });
    box.querySelector('strong').textContent = bill.meta.name || 'Saved bill';
    box.querySelector('.dropzone__meta span').innerHTML = `In Drive › ${esc(bill.meta.folderName || 'Bills')}`;
  }
  icons(dz); refresh();
}

dz.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'remove') { e.stopPropagation(); setBill({ state: editing?.bill?.fileId ? 'removed' : 'none' }); return; }
  if (act === 'replace' || !dz.classList.contains('has-file')) { e.stopPropagation(); $('bill-input').click(); return; }
  if (e.target.closest('.dropzone__preview')) {
    if (bill.state === 'new') openLightbox({ src: bill.url, name: bill.file.name, mimeType: bill.prepared.mimeType });
    if (bill.state === 'existing') openLightbox({ load: () => getBillURL(bill.meta.fileId, 'full'), name: bill.meta.name, mimeType: bill.meta.mimeType, driveUrl: bill.meta.webViewLink });
  }
});
dz.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === dz) { e.preventDefault(); $('bill-input').click(); } });
$('bill-input').addEventListener('change', (e) => { acceptFile(e.target.files[0]); e.target.value = ''; });
$('camera-input').addEventListener('change', (e) => { acceptFile(e.target.files[0]); e.target.value = ''; });
$('camera-btn').addEventListener('click', () => $('camera-input').click());
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); }));
dz.addEventListener('drop', (e) => acceptFile(e.dataTransfer.files[0]));
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && /^image\/|application\/pdf/.test(i.type));
  if (item) { e.preventDefault(); acceptFile(item.getAsFile()); toast('Bill pasted from clipboard', 'info', { duration: 2500 }); }
});

/* ---------------- Live preview + client balance ---------------- */
function values() {
  const sc = scope();
  return {
    type: F('type').value || 'expense', scope: sc, clientId: sc === 'client' ? F('clientId').value : '',
    date: F('date').value, amount: F('amount').value, title: F('title').value.trim(), category: F('category').value,
    paymentMethod: F('paymentMethod').value, vendor: F('vendor').value.trim(),
    project: F('project').value.trim(), description: F('description').value.trim(), notes: F('notes').value.trim(),
    gstRate: Number(F('gstRate').value) || 0,
  };
}
const selectedClient = () => clients.find((c) => c.id === F('clientId').value);

function refreshBalance(amt) {
  const box = $('cbal'), hint = $('client-hint');
  const c = scope() === 'client' ? selectedClient() : null;
  if (!c) { box.innerHTML = ''; hint.textContent = scope() === 'client' && !clients.length ? 'Add clients in Settings → Clients first.' : ''; return; }
  const mk = monthKey(F('date').value || todayISO());
  const m = clientMonth(c, allTx.filter((t) => t.id !== editing?.id), mk);
  const after = m.balance - (F('type').value === 'income' ? -amt : amt);
  box.innerHTML = `
    <div><small>Received · ${monthLabel(mk, true)}</small><b class="amount--income">${formatINR(m.received, { decimals: false })}</b></div>
    <div><small>Spent so far</small><b>${formatINR(m.spent, { decimals: false })}</b></div>
    <div class="${m.balancePaise < 0 ? 'is-neg' : ''}"><small>Left now</small><b class="${m.balancePaise < 0 ? 'amount--expense' : ''}">${m.balancePaise < 0 ? '−' : ''}${formatINR(Math.abs(m.balance), { decimals: false })}</b></div>
    <div class="${after < 0 ? 'is-neg' : ''}"><small>After this</small><b class="${after < 0 ? 'amount--expense' : 'amount--income'}">${after < 0 ? '−' : ''}${formatINR(Math.abs(after), { decimals: false })}</b></div>`;
  const fee = fromPaise(currentFee(c));
  hint.innerHTML = m.remaining
    ? `${esc(c.name)} still owes ${formatINR(m.remaining, { decimals: false })} of the ${formatINR(m.expected, { decimals: false })} fee for ${monthLabel(mk)}.`
    : fee ? `${esc(c.name)} has paid ${monthLabel(mk)} in full.` : '';
}

function refresh() {
  const v = values(); const r = evaluateExpression(v.amount); const amt = r.ok ? r.value : 0;
  $('pv-amount').textContent = formatINR(amt);
  $('pv-amount').className = `receipt__amount amount--${v.type}`;
  $('pv-type').textContent = v.type === 'income' ? 'Income · money in' : 'Expense · money out';
  const c = v.scope === 'client' ? selectedClient() : null;
  $('pv-for').textContent = v.scope === 'client' ? (c ? c.name : 'Choose a client') : 'ODEA office';
  $('pv-date').textContent = v.date ? formatDate(v.date, { withDay: true }) : '—';
  $('pv-cat').textContent = v.category || '—';
  $('pv-vendor').textContent = v.vendor || '—';
  $('pv-mode').textContent = v.paymentMethod || '—';
  $('pv-gst-row').hidden = !v.gstRate;
  if (v.gstRate) { const g = (amt * v.gstRate) / (100 + v.gstRate); $('pv-gst').textContent = `${formatINR(amt - g)} + ${formatINR(g)}`; $('gst-hint').textContent = `GST portion: ${formatINR(g)}`; }
  else $('gst-hint').textContent = 'For bills with a GST invoice';
  $('pv-bill').innerHTML = { new: `<span class="tag tag--income">New file</span>`, existing: `<span class="tag">Saved</span>`, removed: `<span class="tag tag--expense">Will be removed</span>` }[bill.state] || 'Not attached';
  $('pv-folder').querySelector('span').textContent = v.date ? `Drive › ODEA Ledger Bills › ${billFolderName(v.date)}` : '—';
  $('bill-sub').textContent = v.date ? `Saved to Drive › ${billFolderName(v.date)}` : 'Saved to Google Drive in a monthly folder';
  refreshBalance(amt);
}
form.addEventListener('input', (e) => { if (e.target !== amountEl) { refresh(); clearError(e.target.name); } saveDraft(); });
form.addEventListener('change', () => { refresh(); saveDraft(); });

/* ---------------- Errors ---------------- */
function showErrors(errors) {
  form.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
  Object.entries(errors).forEach(([k, msg]) => {
    const f = form.querySelector(`[data-field="${k}"]`); if (!f) return;
    f.classList.add('has-error'); f.querySelector('.field__error span').textContent = msg;
  });
  const first = form.querySelector('.field.has-error input, .field.has-error select');
  first?.focus(); first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearError(name) { form.querySelector(`[data-field="${name}"]`)?.classList.remove('has-error'); }

/* ---------------- Draft (new entries only; convenience, not storage) ---------------- */
const saveDraft = debounce(() => {
  if (editing || dupId) return;
  const v = values();
  if (v.amount || v.title || v.vendor || v.notes) localStorage.setItem(DRAFT_KEY, JSON.stringify(v));
}, 400);
function restoreDraft() {
  let d; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d) return;
  if (qp('scope') && d.scope !== startScope) return;   // came here for a different kind of entry
  setScope(d.scope === 'client' ? 'client' : 'office');
  if (d.clientId) { fillClients(); F('clientId').value = d.clientId; }
  ['date', 'amount', 'title', 'category', 'paymentMethod', 'vendor', 'project', 'notes'].forEach((k) => { if (d[k]) F(k).value = d[k]; });
  F('gstRate').value = String(d.gstRate || 0);
  refreshAmount(); refresh();
  toast('Restored your unsaved entry', 'info', { action: { label: 'Discard', onClick: () => { localStorage.removeItem(DRAFT_KEY); resetForm(); } } });
}

/* ---------------- Save ---------------- */
function setStatus(text) {
  const s = $('save-status');
  if (!text) { s.hidden = true; return; }
  s.hidden = false; s.querySelector('span:last-child').textContent = text;
}

async function save({ another = false } = {}) {
  if (saving) return;
  const v = values();
  const cats = catsFor(v.scope);
  const { valid, errors, amount } = validateEntry(v, { categories: editing ? [...cats, editing.category] : cats });
  if (!valid) { showErrors(errors); toast('Please fix the highlighted fields', 'warning', { duration: 3000 }); return; }
  amountEl.value = String(amount); refreshAmount();
  const amountPaise = toPaise(amount);
  const c = v.scope === 'client' ? selectedClient() : null;

  if (!editing) {
    const key = (v.vendor || v.title).toLowerCase();
    const dup = allTx.find((t) => t.date === v.date && t.amountPaise === amountPaise && (t.vendor || t.title || '').toLowerCase() === key);
    if (dup && !(await confirmDialog({ title: 'Looks like a duplicate', confirmText: 'Save anyway',
      message: `An entry for <strong>${formatINR(amount)}</strong> to <strong>${esc(dup.vendor || dup.title)}</strong> already exists on ${formatDate(dup.date)} (${esc(dup.refNo || '')}). Save another one?` }))) return;
  }
  if (bill.state === 'new' && !navigator.onLine) { toast('You are offline', 'error', { detail: 'Bills need an internet connection to upload. Remove the bill to save the entry offline, or try again when online.' }); return; }

  saving = true;
  const saveBtn = $('save-btn'), anotherBtn = $('save-another');
  saveBtn.disabled = anotherBtn.disabled = true;
  const refNo = editing?.refNo || makeRefNo(v.date);

  try {
    let billMeta = editing?.bill || null;
    if (bill.state === 'new') {
      if (!uploadedBill) {
        setStatus('Uploading bill to Google Drive…');
        uploadedBill = await uploadBill(bill.file, { date: v.date, title: c ? `${c.name} ${v.title}` : v.title, refNo }, bill.prepared);
      }
      const { fileId, name, mimeType, size, folderName, folderId, webViewLink } = uploadedBill;
      billMeta = { fileId, name, mimeType, size, folderName, folderId, webViewLink };
    } else if (bill.state === 'removed') billMeta = null;

    setStatus(editing ? 'Saving changes…' : 'Saving entry…');
    const payload = {
      refNo, date: v.date, month: monthKey(v.date), type: v.type, category: v.category, title: v.title,
      description: v.description, amountPaise, paymentMethod: v.paymentMethod, vendor: v.vendor,
      scope: v.scope, clientId: c ? c.id : '', clientName: c ? c.name : '', client: c ? c.name : (editing && !editing.scope ? editing.client || '' : ''),
      project: v.project, notes: v.notes, gstRate: v.gstRate, bill: billMeta,
    };
    const res = editing ? await updateTransaction(editing.id, payload) : await createTransaction(payload);

    const oldBill = editing?.bill?.fileId;
    if (oldBill && (bill.state === 'new' || bill.state === 'removed')) trashBill(oldBill).catch(() => {});

    localStorage.removeItem(DRAFT_KEY);
    uploadedBill = null;
    let detail = `${v.title} · ${formatINR(amount)}${billMeta && bill.state === 'new' ? ` · bill filed in ${billMeta.folderName}` : ''}`;
    if (c) {
      const m = clientMonth(c, [...allTx.filter((t) => t.id !== editing?.id && t.refNo !== refNo), { ...payload, amount }], v.date.slice(0, 7));
      detail = `${c.name}: ${m.balancePaise < 0 ? '−' : ''}${formatINR(Math.abs(m.balance))} left for ${monthLabel(v.date.slice(0, 7))}`;
    }
    toast(res.queued ? 'Saved on this device — will sync when online' : editing ? 'Changes saved' : 'Expense saved', res.queued ? 'warning' : 'success', {
      detail, action: !editing && !another ? (c ? { label: 'Open client', onClick: () => (location.href = `client.html?id=${c.id}`) } : { label: 'View entries', onClick: () => (location.href = 'entries.html') }) : null,
    });

    if (editing) { setTimeout(() => (location.href = c ? `client.html?id=${c.id}` : 'entries.html'), 700); return; }
    resetForm({ keep: another ? { date: v.date, paymentMethod: v.paymentMethod, scope: v.scope, clientId: v.clientId, project: v.project, category: v.category } : null });
    if (another) F('amount').focus();
  } catch (e) {
    console.error(e);
    const msg = e.code ? explainError(e) : e.message;
    toast(uploadedBill ? 'Bill uploaded, but the entry was not saved' : 'Could not save the entry', 'error', {
      detail: `${msg} Your details are still in the form — try again.`,
    });
  } finally {
    saving = false; setStatus(null); saveBtn.disabled = anotherBtn.disabled = false;
  }
}

function resetForm({ keep = null } = {}) {
  ['amount', 'title', 'vendor', 'project', 'description', 'notes'].forEach((k) => { F(k).value = ''; });
  F('type').value = 'expense';
  form.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
  F('date').value = keep?.date || todayISO();
  F('paymentMethod').value = keep?.paymentMethod || 'UPI';
  F('gstRate').value = '0';
  setScope(keep?.scope || startScope);
  F('category').value = keep?.category || '';
  if (keep) { F('clientId').value = keep.clientId || ''; F('project').value = keep.project || ''; }
  $('vendor-hint').textContent = '';
  setBill({ state: 'none' });
  refreshAmount(); refresh();
}

form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
$('save-another').addEventListener('click', () => save({ another: true }));
form.addEventListener('reset', (e) => {
  e.preventDefault();
  if (editing) { fillForm(editing); setBill(editing.bill?.fileId ? { state: 'existing', meta: editing.bill } : { state: 'none' }); return; }
  localStorage.removeItem(DRAFT_KEY); resetForm();
});
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); } });
window.addEventListener('beforeunload', (e) => { if (saving) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- Initial state: new / edit / duplicate ---------------- */
setScope(startScope);
if (editId || dupId) {
  const src = await getTransaction(editId || dupId).catch(() => null);
  if (!src) { toast('That entry could not be found', 'error'); history.replaceState?.(null, '', 'add-entry.html'); }
  else if (src.scope === 'client' && src.type === 'income') {
    // Client payments are edited from the client's page.
    location.replace(`client.html?id=${encodeURIComponent(src.clientId)}`); await new Promise(() => {});
  } else {
    if (editId) editing = src;
    fillForm(src);
    if (editId) {
      document.title = 'Edit entry · ODEA Ledger';
      document.querySelector('.topbar__title h1').textContent = 'Edit entry';
      $('form-eyebrow').textContent = `Editing ${src.refNo || ''}`;
      $('form-title').textContent = src.title;
      $('form-sub').textContent = src.type === 'income'
        ? 'This is an older income entry. Record new client payments from the Clients page.'
        : `Created by ${src.createdBy || '—'}. Changes update every total instantly.`;
      $('save-btn').querySelector('span').textContent = 'Save changes';
      $('save-another').hidden = true;
      $('pv-ref').textContent = src.refNo || '';
      if (src.bill?.fileId) setBill({ state: 'existing', meta: src.bill });
    } else {
      F('date').value = todayISO();
      $('form-eyebrow').textContent = 'Duplicate entry';
      $('form-sub').textContent = `Copied from “${src.title}”. Check the date and amount, then save.`;
    }
  }
} else {
  restoreDraft();
}
if (location.hash === '#bill') setTimeout(() => $('bill').scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);

refreshAmount(); refresh();
icons(form);
(scope() === 'client' && !F('clientId').value ? F('clientId') : amountEl).focus({ preventScroll: true });
