/**
 * Client UI pieces shared by the Clients page, client detail page, Settings and the entry form:
 * status badge, Add/Edit client, Change fee, Record payment, Mark as paid, delete with Undo.
 */
import { CONFIG } from './config.js';
import {
  createClient, updateClient, createTransaction, updateTransaction, deleteTransaction, restoreTransaction, explainError,
} from './store.js';
import { STATUS, clientMonth, feeForMonth, currentFee } from './clients-lib.js';
import {
  esc, formatINR, formatDate, monthLabel, currentMonthKey, todayISO, addDays, evaluateExpression, toPaise, fromPaise, makeRefNo,
} from './utils.js';
import { ic, icons, openModal, toast, confirmDialog, busy } from './ui.js';

export function statusBadge(status, { small = false, partial = false } = {}) {
  const s = STATUS[status] || STATUS.unpaid;
  const label = status === 'overdue' && partial ? 'Partial · overdue' : s.label;
  return `<span class="cstatus cstatus--${s.tone} ${small ? 'cstatus--sm' : ''}">${ic(s.icon)}${label}</span>`;
}

/** Client avatar: logo if set, otherwise the first letter. */
export function clientAvatar(c, { tag = 'span', href = '', cls = '' } = {}) {
  const inner = c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy">` : esc((c.name || '?').slice(0, 1).toUpperCase());
  return `<${tag} class="cavatar ${c.logo ? 'cavatar--logo' : ''} ${cls}"${href ? ` href="${esc(href)}"` : ''}>${inner}</${tag}>`;
}

/**
 * Shrink a logo to a 160px square (kept whole, centred, transparent background)
 * and return a small data URL (~5–15 KB) that is stored on the client record.
 */
async function makeLogo(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image (PNG, JPG, WEBP or SVG).');
  if (file.size > 8 * 1024 * 1024) throw new Error('Logo is larger than 8 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = url; });
    const S = 160, pad = 8, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const k = Math.min((S - pad * 2) / (img.naturalWidth || S), (S - pad * 2) / (img.naturalHeight || S));
    const w = (img.naturalWidth || S) * k, h = (img.naturalHeight || S) * k;
    cv.getContext('2d').drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
    let out = cv.toDataURL('image/webp', 0.86);
    if (!out.startsWith('data:image/webp')) out = cv.toDataURL('image/png');
    if (out.length > 38000) out = cv.toDataURL('image/jpeg', 0.8);
    if (out.length > 38000) throw new Error('This logo is too detailed — try a simpler PNG.');
    return out;
  } finally { URL.revokeObjectURL(url); }
}

const field = (label, inner, { hint = '', full = false, name = '' } = {}) =>
  `<div class="field ${full ? 'field--full' : ''}" ${name ? `data-field="${name}"` : ''}><label class="field__label">${label}</label>${inner}${hint ? `<span class="field__hint">${hint}</span>` : ''}<span class="field__error"><i data-lucide="alert-circle" class="ic--xs"></i><span></span></span></div>`;

function fieldError(el, name, msg) {
  const f = el.querySelector(`[data-field="${name}"]`); if (!f) return;
  f.classList.add('has-error'); f.querySelector('.field__error span').textContent = msg;
  f.querySelector('input,select')?.focus();
}
const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const PAY_KEYS = ['refNo', 'date', 'month', 'forMonth', 'type', 'scope', 'clientId', 'clientName', 'client', 'vendor', 'category', 'title', 'amountPaise', 'paymentMethod', 'notes', 'description', 'project', 'gstRate', 'bill'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const money = (raw) => { const r = evaluateExpression(raw); return r.ok ? r.value : NaN; };

/* ---------------- Add / edit client ---------------- */
export function openClientForm(client = null, { existingNames = [] } = {}) {
  const editing = !!client;
  const { el, close } = openModal({
    title: editing ? `Edit ${client.name}` : 'Add client', size: 'md',
    body: `<form class="form-grid" data-form novalidate>
      <div class="logo-pick field--full">
        <span class="logo-pick__preview" data-logo-preview></span>
        <div class="logo-pick__text"><strong>Client logo</strong><small>Optional · PNG with transparent background looks best</small>
          <div class="logo-pick__btns"><button type="button" class="btn btn--light btn--sm" data-logo-pick>${ic('image-up')}Upload logo</button>
          <button type="button" class="btn btn--ghost btn--sm" data-logo-remove hidden>${ic('trash-2')}Remove</button></div></div>
        <input type="file" accept="image/*" data-logo-file hidden>
      </div>
      ${field('Client name <span class="req">*</span>', `<input class="input" name="name" maxlength="100" value="${esc(client?.name || '')}" placeholder="e.g. Fascinito" autofocus>`, { full: true, name: 'name' })}
      ${editing ? '' : field('Fixed monthly fee <span class="req">*</span>', `<div class="amount-input amount-input--sm"><span class="amount-input__cur">₹</span><input class="amount-input__field" name="fee" inputmode="decimal" placeholder="e.g. 50000"></div>`, { name: 'fee', hint: 'What this client pays you every month. You can change it later.' })}
      ${field('Billing starts from', `<input class="input" type="month" name="startMonth" value="${esc(client?.startMonth || currentMonthKey())}">`, { hint: 'First month a payment is expected' })}
      ${field('Payment due by', `<select class="select" name="dueDay"><option value="">No due date</option>${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${Number(client?.dueDay) === i + 1 ? 'selected' : ''}>${ordinal(i + 1)} of the month</option>`).join('')}</select>`, { hint: 'After this day, unpaid shows as Overdue' })}
      ${field('Contact person', `<input class="input" name="contactName" maxlength="100" value="${esc(client?.contactName || '')}" placeholder="optional">`)}
      ${field('Phone', `<input class="input" name="phone" maxlength="30" inputmode="tel" value="${esc(client?.phone || '')}" placeholder="optional">`)}
      ${field('Notes', `<textarea class="textarea" name="notes" maxlength="1000" rows="2" placeholder="Scope, GST no., anything useful">${esc(client?.notes || '')}</textarea>`, { full: true })}
    </form>`,
    footer: `<button class="btn btn--ghost" data-no type="button">Cancel</button><button class="btn btn--primary" data-yes type="button">${ic('check')}${editing ? 'Save client' : 'Add client'}</button>`,
  });
  const form = el.querySelector('[data-form]');
  el.querySelector('[data-no]').onclick = () => close();

  let logo = client?.logo || null;
  const showLogo = () => {
    const nm = form.elements.name.value.trim() || client?.name || '?';
    el.querySelector('[data-logo-preview]').innerHTML = clientAvatar({ name: nm, logo }, { cls: 'cavatar--xl' });
    el.querySelector('[data-logo-remove]').hidden = !logo;
  };
  el.querySelector('[data-logo-pick]').onclick = () => el.querySelector('[data-logo-file]').click();
  el.querySelector('[data-logo-preview]').onclick = () => el.querySelector('[data-logo-file]').click();
  el.querySelector('[data-logo-remove]').onclick = () => { logo = null; showLogo(); };
  el.querySelector('[data-logo-file]').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { logo = await makeLogo(f); showLogo(); } catch (err) { toast('Could not use that logo', 'error', { detail: err.message }); }
  };
  form.elements.name.addEventListener('input', showLogo);
  showLogo();

  const submit = async () => {
    form.querySelectorAll('.has-error').forEach((f) => f.classList.remove('has-error'));
    const v = Object.fromEntries(new FormData(form));
    const name = v.name.trim().replace(/\s+/g, ' ');
    if (!name) return fieldError(el, 'name', 'Enter the client name');
    if (existingNames.some((n) => n.toLowerCase() === name.toLowerCase() && n !== client?.name)) return fieldError(el, 'name', 'A client with this name already exists');
    const data = { name, startMonth: v.startMonth || currentMonthKey(), dueDay: v.dueDay ? Number(v.dueDay) : null,
      contactName: v.contactName.trim(), phone: v.phone.trim(), notes: v.notes.trim(), logo: logo || null };
    if (!editing) {
      const fee = money(v.fee);
      if (!(fee >= 0) || v.fee.trim() === '') return fieldError(el, 'fee', 'Enter the monthly fee (0 if none)');
      data.feeHistory = [{ from: data.startMonth, feePaise: toPaise(fee) }];
    }
    const done = busy(el.querySelector('[data-yes]'), 'Saving…');
    try {
      if (editing) await updateClient(client.id, data); else await createClient(data);
      toast(editing ? 'Client updated' : `${name} added`, 'success'); close();
    } catch (e) { toast('Could not save the client', 'error', { detail: explainError(e) }); done(); }
  };
  el.querySelector('[data-yes]').onclick = submit;
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

/* ---------------- Change the fixed fee (with history + undo) ---------------- */
export function openFeeForm(client) {
  const cur = currentFee(client);
  const { el, close } = openModal({
    title: `Monthly fee · ${client.name}`, size: 'sm',
    body: `<form class="form-grid form-grid--1" data-form novalidate>
      <p class="muted">Current fee: <strong>${formatINR(fromPaise(cur))}</strong> per month. Past months keep the fee they had.</p>
      ${field('New monthly fee <span class="req">*</span>', `<div class="amount-input amount-input--sm"><span class="amount-input__cur">₹</span><input class="amount-input__field" name="fee" inputmode="decimal" value="${fromPaise(cur) || ''}" autofocus></div>`, { name: 'fee' })}
      ${field('Applies from', `<input class="input" type="month" name="from" value="${currentMonthKey()}">`, { hint: 'This month and every month after' })}
      ${client.feeHistory.length ? `<div class="fee-history"><small>Fee history</small>${client.feeHistory.slice().reverse().map((h) => `<div><span>From ${monthLabel(h.from)}</span><b>${formatINR(fromPaise(h.feePaise))}</b></div>`).join('')}</div>` : ''}
    </form>`,
    footer: `<button class="btn btn--ghost" data-no type="button">Cancel</button><button class="btn btn--primary" data-yes type="button">${ic('check')}Update fee</button>`,
  });
  const form = el.querySelector('[data-form]');
  el.querySelector('[data-no]').onclick = () => close();
  const submit = async () => {
    const v = Object.fromEntries(new FormData(form));
    const fee = money(v.fee);
    if (!(fee >= 0) || v.fee.trim() === '') return fieldError(el, 'fee', 'Enter a valid amount');
    const from = v.from || currentMonthKey();
    const before = client.feeHistory.slice();
    const next = before.filter((h) => h.from < from).concat({ from, feePaise: toPaise(fee) });
    const done = busy(el.querySelector('[data-yes]'), 'Saving…');
    try {
      await updateClient(client.id, { feeHistory: next });
      close();
      toast(`Fee set to ${formatINR(fee)} from ${monthLabel(from)}`, 'success', {
        duration: 8000, action: { label: 'Undo', onClick: () => updateClient(client.id, { feeHistory: before }).then(() => toast('Fee change undone', 'success')) },
      });
    } catch (e) { toast('Could not update the fee', 'error', { detail: explainError(e) }); done(); }
  };
  el.querySelector('[data-yes]').onclick = submit;
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

/* ---------------- Record / edit a client payment ---------------- */
function paymentPayload(client, { amount, date, forMonth, method, notes }, refNo) {
  return {
    refNo: refNo || makeRefNo(date), date, month: date.slice(0, 7), forMonth,
    type: 'income', scope: 'client', clientId: client.id, clientName: client.name, client: client.name, vendor: client.name,
    category: 'Client Payments', title: `Payment · ${client.name} · ${monthLabel(forMonth, true)}`,
    amountPaise: toPaise(amount), paymentMethod: method, notes: notes || '', description: '', project: '', gstRate: 0, bill: null,
  };
}

/**
 * openPaymentForm({ clients, tx, clientId, month, payment })
 * `payment` = existing payment transaction to edit.
 */
export function openPaymentForm({ clients, tx, clientId = '', month = currentMonthKey(), payment = null }) {
  const active = clients.filter((c) => !c.archived || c.id === clientId || c.id === payment?.clientId);
  const pre = payment ? { clientId: payment.clientId, month: payment.forMonth || payment.month } : { clientId, month };
  const { el, close } = openModal({
    title: payment ? 'Edit payment' : 'Record client payment', size: 'md',
    body: `<form class="form-grid" data-form novalidate>
      ${field('Client <span class="req">*</span>', `<select class="select" name="clientId" ${payment ? 'disabled' : ''}><option value="">Select client</option>${active.map((c) => `<option value="${c.id}" ${c.id === pre.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`, { name: 'clientId' })}
      ${field('Payment for month', `<input class="input" type="month" name="forMonth" value="${pre.month}">`, { hint: 'The month this money is for' })}
      <div class="pay-summary field--full" data-summary></div>
      ${field('Amount received <span class="req">*</span>', `<div class="amount-input amount-input--sm"><span class="amount-input__cur">₹</span><input class="amount-input__field" name="amount" inputmode="decimal" placeholder="0.00" value="${payment ? payment.amount : ''}" autofocus></div>
        <div class="quick-add" data-quick></div>`, { name: 'amount', full: true })}
      ${field('Date received', `<input class="input" type="date" name="date" value="${payment?.date || todayISO()}" max="${addDays(todayISO(), 1)}">`)}
      ${field('Received via', `<select class="select" name="method">${CONFIG.paymentMethods.map((m) => `<option ${m === (payment?.paymentMethod || 'Bank Transfer') ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
      ${field('Reference / note', `<input class="input" name="notes" maxlength="300" value="${esc(payment?.notes || '')}" placeholder="UTR no., invoice no., 1st half…">`, { full: true })}
    </form>`,
    footer: `<button class="btn btn--ghost" data-no type="button">Cancel</button><button class="btn btn--primary" data-yes type="button">${ic('check')}${payment ? 'Save payment' : 'Record payment'}</button>`,
  });
  const form = el.querySelector('[data-form]');
  const F = (n) => form.elements[n];
  if (payment) F('clientId').value = payment.clientId;
  el.querySelector('[data-no]').onclick = () => close();

  const summary = () => {
    const c = clients.find((x) => x.id === F('clientId').value);
    const box = el.querySelector('[data-summary]'), quick = el.querySelector('[data-quick]');
    if (!c) { box.innerHTML = ''; quick.innerHTML = ''; return; }
    const others = payment ? tx.filter((t) => t.id !== payment.id) : tx;
    const m = clientMonth(c, others, F('forMonth').value || currentMonthKey());
    box.innerHTML = `<div><small>Fixed fee</small><b>${formatINR(m.expected)}</b></div><div><small>Already received</small><b class="amount--income">${formatINR(m.received)}</b></div>
      <div><small>Remaining</small><b class="${m.remaining ? 'amount--expense' : 'amount--income'}">${formatINR(m.remaining)}</b></div>`;
    const chips = [];
    if (m.remaining) chips.push(`<button type="button" data-set="${m.remaining}">Full remaining · ${formatINR(m.remaining, { decimals: false })}</button>`);
    if (m.expected && m.remaining > m.expected / 2) chips.push(`<button type="button" data-set="${m.expected / 2}">Half · ${formatINR(m.expected / 2, { decimals: false })}</button>`);
    quick.innerHTML = chips.join('');
  };
  form.addEventListener('change', summary);
  el.querySelector('[data-quick]').addEventListener('click', (e) => { const b = e.target.closest('[data-set]'); if (b) F('amount').value = b.dataset.set; });
  summary();

  const submit = async () => {
    form.querySelectorAll('.has-error').forEach((f) => f.classList.remove('has-error'));
    const c = clients.find((x) => x.id === F('clientId').value);
    if (!c) return fieldError(el, 'clientId', 'Choose the client');
    const amount = money(F('amount').value);
    if (!(amount > 0)) return fieldError(el, 'amount', 'Enter the amount received');
    const v = { amount, date: F('date').value || todayISO(), forMonth: F('forMonth').value || currentMonthKey(), method: F('method').value, notes: F('notes').value.trim() };
    const done = busy(el.querySelector('[data-yes]'), 'Saving…');
    try {
      if (payment) {
        const before = pick(payment, PAY_KEYS);
        await updateTransaction(payment.id, paymentPayload(c, v, payment.refNo));
        close();
        toast('Payment updated', 'success', { duration: 8000, action: { label: 'Undo', onClick: () => updateTransaction(payment.id, before).then(() => toast('Change undone', 'success')) } });
      } else {
        const res = await createTransaction(paymentPayload(c, v));
        close();
        const after = clientMonth(c, [...tx, { ...paymentPayload(c, v), amount }], v.forMonth);
        toast(`${formatINR(amount)} received from ${c.name}`, 'success', {
          detail: after.remaining ? `${formatINR(after.remaining)} still remaining for ${monthLabel(v.forMonth)}` : `${monthLabel(v.forMonth)} is fully paid`,
          duration: 8000, action: res.ref ? { label: 'Undo', onClick: () => deleteTransaction(res.ref.id).then(() => toast('Payment removed', 'success')) } : null,
        });
      }
    } catch (e) { toast('Could not save the payment', 'error', { detail: explainError(e) }); done(); }
  };
  el.querySelector('[data-yes]').onclick = submit;
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

/** One click: record the remaining amount for the month as received today. */
export async function markPaid(client, tx, month) {
  const m = clientMonth(client, tx, month);
  if (!m.remaining) return toast(`${client.name} has already paid for ${monthLabel(month)}`, 'info');
  const ok = await confirmDialog({ title: `Mark ${esc(client.name)} as paid?`, confirmText: `Record ${formatINR(m.remaining)}`,
    message: `This records <strong>${formatINR(m.remaining)}</strong> received today for <strong>${monthLabel(month)}</strong>${m.received ? ` (on top of ${formatINR(m.received)} already received)` : ''}.` });
  if (!ok) return;
  try {
    const res = await createTransaction(paymentPayload(client, { amount: m.remaining, date: todayISO(), forMonth: month, method: 'Bank Transfer', notes: m.received ? 'Balance payment' : 'Full payment' }));
    toast(`${client.name} · ${monthLabel(month)} marked as paid`, 'success', {
      duration: 8000, action: res.ref ? { label: 'Undo', onClick: () => deleteTransaction(res.ref.id).then(() => toast('Undone', 'success')) } : null,
    });
  } catch (e) { toast('Could not record the payment', 'error', { detail: explainError(e) }); }
}

export async function deletePayment(t) {
  const ok = await confirmDialog({ title: 'Delete this payment?', danger: true, confirmText: 'Delete',
    message: `<strong>${formatINR(t.amount)}</strong> from <strong>${esc(t.clientName || '')}</strong> on ${formatDate(t.date)} will be removed. The client's paid status updates instantly.` });
  if (!ok) return;
  try {
    await deleteTransaction(t.id);
    toast('Payment deleted', 'success', { duration: 8000, action: { label: 'Undo', onClick: () => restoreTransaction(t).then(() => toast('Payment restored', 'success')) } });
  } catch (e) { toast('Could not delete', 'error', { detail: explainError(e) }); }
}

/** Archive (stop billing from this month) or restore a client, with undo. */
export async function toggleArchive(client) {
  const archiving = !client.archived;
  const ok = await confirmDialog({
    title: archiving ? `Archive ${esc(client.name)}?` : `Restore ${esc(client.name)}?`, confirmText: archiving ? 'Archive' : 'Restore',
    message: archiving ? `No fee will be expected from <strong>${monthLabel(currentMonthKey())}</strong> onwards and the client is hidden from dropdowns. All history stays.` : 'The client becomes active again and the monthly fee is expected from this month.',
  });
  if (!ok) return;
  const before = client.archivedFrom || null;
  try {
    await updateClient(client.id, { archivedFrom: archiving ? currentMonthKey() : null });
    toast(archiving ? 'Client archived' : 'Client restored', 'success', { action: { label: 'Undo', onClick: () => updateClient(client.id, { archivedFrom: before }) } });
  } catch (e) { toast('Could not update', 'error', { detail: explainError(e) }); }
}

export { feeForMonth, currentFee };
export const icRefresh = () => icons();
