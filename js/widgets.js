/**
 * Reusable rendered pieces shared by several pages:
 * bill cells, ranked lists, delta badges, entry detail modal, delete flow.
 */
import { esc, formatINR, formatDate, formatDateTime, pct, monthLabel } from './utils.js';
import { ic, icons, openModal, openLightbox, confirmDialog, toast, attachHoverPreview, busy } from './ui.js';
import { getBillURL, driveViewUrl, trashBill, isDriveConfigured } from './drive.js';
import { deleteTransaction, restoreTransaction, explainError } from './store.js';

export const typeTag = (t) => `<span class="tag tag--dot tag--${t.type}">${t.type === 'income' ? 'Income' : 'Expense'}</span>`;
export const amountHTML = (t) => `<span class="amount amount--${t.type}">${t.type === 'income' ? '+' : '−'} ${formatINR(t.amount)}</span>`;

/** Table cell for a bill: hover → preview, click → lightbox. */
export function billCell(t) {
  if (!t.bill?.fileId) return `<span class="bill-none">${ic('file-x-2')}No bill</span>`;
  const pdf = t.bill.mimeType === 'application/pdf';
  return `<button type="button" class="bill-chip" data-preview data-bill="${esc(t.id)}" aria-label="View bill for ${esc(t.title)}">
    <span class="bill-chip__thumb">${ic(pdf ? 'file-text' : 'image')}</span>${pdf ? 'PDF' : 'View'}</button>`;
}

/** Wire hover-preview + click-to-open for every [data-bill] inside root. getTx(id) → transaction */
export function wireBills(root, getTx) {
  attachHoverPreview(root, async (el) => {
    const t = getTx(el.dataset.bill);
    const pdf = t.bill.mimeType === 'application/pdf';
    const url = await getBillURL(t.bill.fileId, pdf ? 'thumb' : 'full');
    return { url, name: t.bill.name || t.title, isPdf: pdf, caption: `${formatDate(t.date)} · ${formatINR(t.amount)}` };
  });
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-bill]'); if (!el) return;
    e.stopPropagation();
    openBill(getTx(el.dataset.bill));
  });
}

export function openBill(t) {
  openLightbox({
    load: () => getBillURL(t.bill.fileId, 'full'),
    name: t.bill.name || t.title, mimeType: t.bill.mimeType,
    driveUrl: t.bill.webViewLink || driveViewUrl(t.bill.fileId),
    caption: `${formatDate(t.date)} · ${formatINR(t.amount)}`,
  });
}

/** Ranked list with proportional bars */
export function rankList(groups, { limit = 5, emptyText = 'Nothing yet', total } = {}) {
  if (!groups.length) return `<li class="rank__empty">${esc(emptyText)}</li>`;
  const sum = total ?? groups.reduce((s, g) => s + g.total, 0);
  const max = groups[0].total || 1;
  return groups.slice(0, limit).map((g, i) => `
    <li class="rank__item">
      <span class="rank__pos">${i + 1}</span>
      <div class="rank__main">
        <div class="rank__row"><span class="rank__name" title="${esc(g.key)}">${esc(g.key)}</span><strong class="money">${formatINR(g.total)}</strong></div>
        <div class="rank__bar"><span style="width:${Math.max(3, (g.total / max) * 100)}%"></span></div>
        <small>${g.count} entr${g.count === 1 ? 'y' : 'ies'} · ${pct(g.total, sum).toFixed(1)}%</small>
      </div>
    </li>`).join('');
}

/** For spending, "up" is bad. invert=true for income. */
export function deltaBadge(cur, prev, { invert = false, suffix = 'vs last month' } = {}) {
  if (!prev && !cur) return `<span class="delta delta--flat">—</span><span>${suffix}</span>`;
  if (!prev) return `<span class="delta delta--flat">New</span><span>${suffix}</span>`;
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.5) return `<span class="delta delta--flat">${ic('minus')}0%</span><span>${suffix}</span>`;
  const up = d > 0;
  const good = invert ? up : !up;
  return `<span class="delta ${good ? 'delta--good' : 'delta--bad'}">${ic(up ? 'trending-up' : 'trending-down')}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}%</span><span>${suffix}</span>`;
}

/* ---------------- Entry detail modal ---------------- */
export const canDeleteEntry = (ctx, t) => !!ctx && (ctx.isAdmin || (ctx.canWrite && t.createdBy === ctx.profile?.email));

export function openEntryDetail(t, ctx = {}) {
  const canWrite = !!ctx.canWrite;
  const canDelete = canDeleteEntry(ctx, t);
  const isPay = t.scope === 'client' && t.type === 'income';
  const row = (label, value, full = false) => value ? `<div class="detail__item ${full ? 'detail__item--full' : ''}"><dt>${label}</dt><dd>${esc(value)}</dd></div>` : '';
  const gst = t.gstRate ? (t.amount * t.gstRate) / (100 + t.gstRate) : 0;
  const { el, close } = openModal({
    title: t.refNo || 'Entry', size: 'md',
    body: `
      <div class="detail-hero">
        <div><div class="detail-hero__amount amount--${t.type}">${t.type === 'income' ? '+' : '−'} ${formatINR(t.amount)}</div>
          <div class="muted">${esc(t.title)}</div></div>
        <div class="detail-hero__tags">${typeTag(t)}${t.pending ? '<span class="tag tag--pending">Syncing</span>' : ''}</div>
      </div>
      <dl class="detail">
        ${row('Date', formatDate(t.date, { withDay: true }))}
        ${row('Category', t.category)}
        ${row('Paid to / Vendor', t.vendor)}
        ${row('Payment method', t.paymentMethod)}
        ${row('For', t.scope === 'client' ? `Client · ${t.clientName || t.client || ''}` : 'ODEA office')}
        ${t.forMonth ? row('Payment for', monthLabel(t.forMonth)) : (!t.scope ? row('Client', t.client) : '')}${row('Project', t.project)}
        ${t.gstRate ? row('GST', `${t.gstRate}% · ${formatINR(gst)} included`) : ''}
        ${row('Description', t.description, true)}
        ${row('Notes', t.notes, true)}
      </dl>
      ${t.bill?.fileId ? `<div class="detail-bill" data-open-bill><div class="spinner"></div></div>
        <div class="detail-bill__meta">${ic('folder')}<span>Drive › ${esc(t.bill.folderName || 'Bills')} › ${esc(t.bill.name || '')}</span>
        <a class="link" href="${esc(t.bill.webViewLink || driveViewUrl(t.bill.fileId))}" target="_blank" rel="noopener">Open in Drive ${ic('external-link', 'ic--xs')}</a></div>`
      : isPay ? '' : `<div class="detail-nobill">${ic('file-x-2')}<span>No bill attached to this entry.</span>${canWrite ? `<a class="link" href="add-entry.html?id=${encodeURIComponent(t.id)}#bill">Attach one</a>` : ''}</div>`}
      <div class="audit"><span>Entered by ${esc(t.createdBy || '—')} · ${formatDateTime(t.createdAtDate)}</span>
        ${t.updatedBy && t.updatedAtDate && Math.abs(t.updatedAtDate - t.createdAtDate) > 2000 ? `<span>Last edited by ${esc(t.updatedBy)} · ${formatDateTime(t.updatedAtDate)}</span>` : ''}</div>`,
    footer: canWrite ? `
      ${canDelete ? `<button class="btn btn--ghost btn--sm" data-act="delete" type="button">${ic('trash-2')}Delete</button>` : ''}
      <span style="flex:1"></span>
      ${isPay ? `<a class="btn btn--dark btn--sm" href="client.html?id=${encodeURIComponent(t.clientId)}">${ic('external-link')}Open client</a>`
      : `<a class="btn btn--light btn--sm" href="add-entry.html?dup=${encodeURIComponent(t.id)}">${ic('copy')}Duplicate</a>
      <a class="btn btn--dark btn--sm" href="add-entry.html?id=${encodeURIComponent(t.id)}">${ic('pencil')}Edit</a>`}` : '',
  });
  const billBox = el.querySelector('[data-open-bill]');
  if (billBox) {
    const pdf = t.bill.mimeType === 'application/pdf';
    getBillURL(t.bill.fileId, pdf ? 'thumb' : 'full')
      .then((url) => { billBox.innerHTML = `<img src="${url}" alt="Bill">`; })
      .catch((e) => { billBox.innerHTML = `<div class="state state--compact state--error">${ic('image-off')}<p class="state__msg">${esc(e.message)}</p></div>`; icons(billBox); });
    billBox.onclick = () => openBill(t);
  }
  el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => { if (await deleteEntryFlow(t)) close(); });
}

/* ---------------- Delete with confirmation + undo ---------------- */
export async function deleteEntryFlow(t) {
  const hasBill = !!t.bill?.fileId && isDriveConfigured();
  const ok = await confirmDialogWithBill(t, hasBill);
  if (!ok) return false;
  try {
    await deleteTransaction(t.id);
    if (ok === 'with-bill') trashBill(t.bill.fileId).catch((e) => toast('Entry deleted, but the bill could not be moved to Drive trash', 'warning', { detail: e.message }));
    toast('Entry deleted', 'success', {
      detail: `${t.title} · ${formatINR(t.amount)}`, duration: 7000,
      action: ok === 'with-bill' ? null : { label: 'Undo', onClick: () => restoreTransaction(t).then(() => toast('Entry restored', 'success')).catch((e) => toast('Could not restore', 'error', { detail: explainError(e) })) },
    });
    return true;
  } catch (e) {
    toast('Could not delete the entry', 'error', { detail: explainError(e) });
    return false;
  }
}

function confirmDialogWithBill(t, hasBill) {
  if (!hasBill) {
    return confirmDialog({ title: 'Delete this entry?', danger: true, confirmText: 'Delete entry',
      message: `<strong>${esc(t.title)}</strong> · ${formatINR(t.amount)} on ${formatDate(t.date)} will be removed from the ledger and every total.` });
  }
  return new Promise((resolve) => {
    let done = false;
    const { el, close } = openModal({
      title: 'Delete this entry?', size: 'sm',
      body: `<div class="confirm"><div class="confirm__icon">${ic('alert-triangle')}</div>
        <p><strong>${esc(t.title)}</strong> · ${formatINR(t.amount)} on ${formatDate(t.date)} will be removed from the ledger and every total.</p>
        <label class="switch"><input type="checkbox" data-trash><span class="switch__track"></span><span>Also move the bill to Drive trash</span></label>
        <small class="muted">Leave this off to keep the bill in Drive for your records.</small></div>`,
      footer: `<button class="btn btn--ghost" data-no type="button">Cancel</button><button class="btn btn--danger" data-yes type="button">Delete entry</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    el.querySelector('[data-no]').onclick = () => close();
    el.querySelector('[data-yes]').onclick = () => { done = true; resolve(el.querySelector('[data-trash]').checked ? 'with-bill' : true); close(); };
  });
}

/** Category colour (stable per name) */
export function categoryColor(name, categories = []) {
  const vars = ['--c1', '--c3', '--c4', '--c5', '--c6', '--c7', '--c2', '--c8'];
  const i = Math.max(0, categories.indexOf(name));
  return `var(${vars[i % vars.length]})`;
}

export { busy };
