import { boot } from '../layout.js';
import { CONFIG } from '../config.js';
import {
  watchTransactions, watchSettings, getTransaction, createTransaction, updateTransaction, explainError,
} from '../store.js';
import { uploadBill, prepareBill, trashBill, isDriveConfigured, getBillURL } from '../drive.js';
import { validateEntry } from '../validation.js';
import {
  todayISO, addDays, monthKey, evaluateExpression, formatINR, formatDate, formatBytes, billFolderName,
  makeRefNo, toPaise, esc, qp, debounce,
} from '../utils.js';
import { icons, toast, confirmDialog, ic, openLightbox } from '../ui.js';

const ctx = await boot('add-entry', { title: 'New entry' });
if (!ctx.canWrite) { location.replace('entries.html'); await new Promise(() => {}); }   // viewers can't add entries

const form = document.getElementById('entry-form');
const $ = (id) => document.getElementById(id);
const F = (name) => form.elements[name];
const DRAFT_KEY = 'odea-ledger-draft';

const editId = qp('id');
const dupId = qp('dup');
let editing = null;          // existing transaction when editing
let allTx = [];              // all transactions (for autofill + duplicate check)
let categories = [...CONFIG.defaultCategories];
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
fillSelect(F('category'), categories, { placeholder: 'Select category' });

watchSettings((s) => {
  categories = s.categories;
  const extra = editing && !categories.includes(editing.category) ? [editing.category] : [];   // keep an old category when editing
  fillSelect(F('category'), [...categories, ...extra], { placeholder: 'Select category' });
});

watchTransactions((list) => {
  allTx = list;
  const uniq = (fn) => [...new Set(list.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('dl-vendor').innerHTML = uniq((t) => t.vendor).map((v) => `<option value="${esc(v)}">`).join('');
  $('dl-client').innerHTML = uniq((t) => t.client).map((v) => `<option value="${esc(v)}">`).join('');
  $('dl-project').innerHTML = uniq((t) => t.project).map((v) => `<option value="${esc(v)}">`).join('');
});

function fillForm(t) {
  form.querySelector(`input[name="type"][value="${t.type}"]`).checked = true;
  F('date').value = t.date;
  F('amount').value = t.amount.toFixed(2).replace(/\.00$/, '');
  F('title').value = t.title || '';
  if (!categories.includes(t.category)) fillSelect(F('category'), [...categories, t.category], { placeholder: 'Select category' });
  F('category').value = t.category || '';
  F('paymentMethod').value = t.paymentMethod || '';
  F('vendor').value = t.vendor || ''; F('client').value = t.client || ''; F('project').value = t.project || '';
  F('description').value = t.description || ''; F('notes').value = t.notes || '';
  F('gstRate').value = String(t.gstRate || 0);
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
  F('date').value = addDays(todayISO(), Number(b.dataset.day)); refresh(); clearError('date');
});

/* ---------------- Smart autofill from the payee's last entry ---------------- */
F('vendor').addEventListener('change', () => {
  const v = F('vendor').value.trim().toLowerCase(); if (!v) return;
  const last = allTx.find((t) => (t.vendor || '').toLowerCase() === v);
  if (!last) { $('vendor-hint').textContent = 'New payee'; return; }
  const filled = [];
  if (!F('category').value && categories.includes(last.category)) { F('category').value = last.category; filled.push('category'); }
  if (!F('title').value) { F('title').value = last.title; filled.push('title'); }
  if (!F('client').value && last.client) { F('client').value = last.client; filled.push('client'); }
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
  // clicking the preview opens it large
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

/* ---------------- Live preview ---------------- */
function values() {
  return {
    type: form.querySelector('input[name="type"]:checked').value,
    date: F('date').value, amount: F('amount').value, title: F('title').value.trim(), category: F('category').value,
    paymentMethod: F('paymentMethod').value, vendor: F('vendor').value.trim(), client: F('client').value.trim(),
    project: F('project').value.trim(), description: F('description').value.trim(), notes: F('notes').value.trim(),
    gstRate: Number(F('gstRate').value) || 0,
  };
}
function refresh() {
  const v = values(); const r = evaluateExpression(v.amount); const amt = r.ok ? r.value : 0;
  $('pv-amount').textContent = formatINR(amt);
  $('pv-amount').className = `receipt__amount amount--${v.type}`;
  $('pv-type').textContent = v.type === 'income' ? 'Income · money in' : 'Expense · money out';
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
  if (v.amount || v.title || v.vendor || v.description) localStorage.setItem(DRAFT_KEY, JSON.stringify(v));
}, 400);
function restoreDraft() {
  let d; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d) return;
  form.querySelector(`input[name="type"][value="${d.type}"]`)?.click();
  ['date', 'amount', 'title', 'category', 'paymentMethod', 'vendor', 'client', 'project', 'description', 'notes'].forEach((k) => { if (d[k]) F(k).value = d[k]; });
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
  const { valid, errors, amount } = validateEntry(v, { categories: editing ? [...categories, editing.category] : categories });
  if (!valid) { showErrors(errors); toast('Please fix the highlighted fields', 'warning', { duration: 3000 }); return; }
  amountEl.value = String(amount); refreshAmount();

  const amountPaise = toPaise(amount);
  // Possible duplicate? (same day, same amount, same payee/title)
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
    /* 1. Upload the bill to Drive (if a new one was chosen) */
    let billMeta = editing?.bill || null;
    if (bill.state === 'new') {
      if (!uploadedBill) {
        setStatus('Uploading bill to Google Drive…');
        uploadedBill = await uploadBill(bill.file, { date: v.date, title: v.title, refNo }, bill.prepared);
      }
      const { fileId, name, mimeType, size, folderName, folderId, webViewLink } = uploadedBill;
      billMeta = { fileId, name, mimeType, size, folderName, folderId, webViewLink };
    } else if (bill.state === 'removed') billMeta = null;

    /* 2. Save the text record to Firestore */
    setStatus(editing ? 'Saving changes…' : 'Saving entry…');
    const payload = {
      refNo, date: v.date, month: monthKey(v.date), type: v.type, category: v.category, title: v.title,
      description: v.description, amountPaise, paymentMethod: v.paymentMethod, vendor: v.vendor, client: v.client,
      project: v.project, notes: v.notes, gstRate: v.gstRate, bill: billMeta,
    };
    const res = editing ? await updateTransaction(editing.id, payload) : await createTransaction(payload);

    /* 3. Tidy up a replaced/removed bill (moved to Drive trash, recoverable for 30 days) */
    const oldBill = editing?.bill?.fileId;
    if (oldBill && (bill.state === 'new' || bill.state === 'removed')) trashBill(oldBill).catch(() => {});

    localStorage.removeItem(DRAFT_KEY);
    uploadedBill = null;
    toast(res.queued ? 'Saved on this device — will sync when online' : editing ? 'Changes saved' : 'Entry saved', res.queued ? 'warning' : 'success', {
      detail: `${v.title} · ${formatINR(amount)}${billMeta && bill.state === 'new' ? ` · bill filed in ${billMeta.folderName}` : ''}`,
      action: !editing && !another ? { label: 'View entries', onClick: () => (location.href = 'entries.html') } : null,
    });

    if (editing) { setTimeout(() => (location.href = 'entries.html'), 700); return; }
    resetForm({ keep: another ? { date: v.date, paymentMethod: v.paymentMethod, type: v.type, client: v.client, project: v.project } : null });
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
  ['amount', 'title', 'vendor', 'client', 'project', 'description', 'notes'].forEach((k) => { F(k).value = ''; });
  F('category').value = '';
  form.querySelector('input[name="type"][value="expense"]').checked = true;
  form.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
  F('date').value = keep?.date || todayISO();
  F('paymentMethod').value = keep?.paymentMethod || 'UPI';
  F('gstRate').value = '0';
  if (keep) { form.querySelector(`input[name="type"][value="${keep.type}"]`).checked = true; F('client').value = keep.client || ''; F('project').value = keep.project || ''; }
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
if (editId || dupId) {
  const src = await getTransaction(editId || dupId).catch(() => null);
  if (!src) { toast('That entry could not be found', 'error'); history.replaceState?.(null, '', 'add-entry.html'); }
  else {
    fillForm(src);
    if (editId) {
      editing = src;
      document.title = 'Edit entry · ODEA Ledger';
      document.querySelector('.topbar__title h1').textContent = 'Edit entry';
      $('form-eyebrow').textContent = `Editing ${src.refNo || ''}`;
      $('form-title').textContent = src.title;
      $('form-sub').textContent = `Created by ${src.createdBy || '—'}. Changes update every total instantly.`;
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
amountEl.focus({ preventScroll: true });
