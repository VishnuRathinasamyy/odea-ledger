/**
 * Shared UI primitives: icons, toasts, confirm dialog, modal, lightbox,
 * hover preview for bills, empty / error states.
 */
import { esc } from './utils.js';

/* ---------------- Icons (Lucide) ---------------- */
export function icons(root = document) {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 }, nameAttr: 'data-lucide', root });
}
export const ic = (name, cls = '') => `<i data-lucide="${name}" class="ic ${cls}" aria-hidden="true"></i>`;

/* ---------------- Toasts ---------------- */
function toastHost() {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.className = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  return host;
}
/**
 * toast('Saved', 'success', { action: { label: 'Undo', onClick }, duration })
 */
export function toast(message, type = 'info', opts = {}) {
  const iconName = { success: 'check-circle-2', error: 'alert-octagon', warning: 'alert-triangle', info: 'info' }[type] || 'info';
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${ic(iconName, 'toast__icon')}<div class="toast__body"><div class="toast__msg">${esc(message)}</div>${opts.detail ? `<div class="toast__detail">${esc(opts.detail)}</div>` : ''}</div>
    ${opts.action ? `<button class="toast__action" type="button">${esc(opts.action.label)}</button>` : ''}
    <button class="toast__close" type="button" aria-label="Dismiss">${ic('x')}</button>`;
  toastHost().append(el);
  icons(el);
  const close = () => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 220); };
  el.querySelector('.toast__close').onclick = close;
  if (opts.action) el.querySelector('.toast__action').onclick = () => { opts.action.onClick(); close(); };
  const duration = opts.duration ?? (type === 'error' ? 7000 : 4000);
  if (duration) setTimeout(close, duration);
  return close;
}

/* ---------------- Modal ---------------- */
let openModals = 0;
/**
 * openModal({ title, body (html), footer (html), size: 'sm'|'md'|'lg', onClose })
 * Returns { el, close }.
 */
export function openModal({ title = '', body = '', footer = '', size = 'md', onClose, className = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `modal-wrap ${className}`;
  wrap.innerHTML = `
    <div class="modal modal--${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      ${title ? `<header class="modal__head"><h3 class="modal__title">${esc(title)}</h3>
      <button class="icon-btn modal__x" type="button" aria-label="Close">${ic('x')}</button></header>` : ''}
      <div class="modal__body">${body}</div>
      ${footer ? `<footer class="modal__foot">${footer}</footer>` : ''}
    </div>`;
  document.body.append(wrap);
  openModals++; document.body.classList.add('no-scroll');
  icons(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-open'));
  const prevFocus = document.activeElement;

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close(result) {
    document.removeEventListener('keydown', onKey);
    wrap.classList.remove('is-open');
    setTimeout(() => wrap.remove(), 200);
    if (--openModals <= 0) { openModals = 0; document.body.classList.remove('no-scroll'); }
    prevFocus?.focus?.();
    onClose?.(result);
  }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.modal__x')?.addEventListener('click', () => close());
  setTimeout(() => wrap.querySelector('[autofocus], .modal__foot .btn--primary, .modal__foot .btn--danger')?.focus(), 50);
  return { el: wrap, close };
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const { el, close } = openModal({
      title, size: 'sm',
      body: `<div class="confirm">${danger ? `<div class="confirm__icon">${ic('alert-triangle')}</div>` : ''}<p>${message}</p></div>`,
      footer: `<button class="btn btn--ghost" data-act="no" type="button">${esc(cancelText)}</button>
               <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="yes" type="button">${esc(confirmText)}</button>`,
      onClose: () => { if (!settled) { settled = true; resolve(false); } },
    });
    el.querySelector('[data-act="yes"]').onclick = () => { settled = true; resolve(true); close(); };
    el.querySelector('[data-act="no"]').onclick = () => close();
  });
}

/* ---------------- Lightbox ----------------
 * openLightbox({ load: () => Promise<objectURL>, name, driveUrl, mimeType, caption })
 */
export function openLightbox({ load, src, name = 'Bill', driveUrl, mimeType = '', caption = '' }) {
  const isPdf = mimeType === 'application/pdf';
  const { el, close } = openModal({
    size: 'xl', className: 'lightbox',
    body: `
      <div class="lightbox__bar">
        <div class="lightbox__name">${ic(isPdf ? 'file-text' : 'image')}<span>${esc(name)}</span>${caption ? `<small>${esc(caption)}</small>` : ''}</div>
        <div class="lightbox__tools">
          ${!isPdf ? `<button class="icon-btn" data-z="out" title="Zoom out" type="button">${ic('zoom-out')}</button>
          <button class="icon-btn" data-z="in" title="Zoom in" type="button">${ic('zoom-in')}</button>
          <button class="icon-btn" data-z="rot" title="Rotate" type="button">${ic('rotate-cw')}</button>` : ''}
          <a class="icon-btn" data-dl hidden title="Download" download="${esc(name)}">${ic('download')}</a>
          ${driveUrl ? `<a class="btn btn--sm btn--light" href="${esc(driveUrl)}" target="_blank" rel="noopener">${ic('external-link')} Open in Drive</a>` : ''}
          <button class="icon-btn lightbox__close" type="button" aria-label="Close">${ic('x')}</button>
        </div>
      </div>
      <div class="lightbox__stage"><div class="spinner spinner--lg"></div></div>`,
  });
  const stage = el.querySelector('.lightbox__stage');
  el.querySelector('.lightbox__close').onclick = () => close();

  let scale = 1, rot = 0;
  const apply = () => { const img = stage.querySelector('img'); if (img) img.style.transform = `scale(${scale}) rotate(${rot}deg)`; };
  el.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => {
    const z = b.dataset.z;
    if (z === 'in') scale = Math.min(scale + 0.25, 4);
    if (z === 'out') scale = Math.max(scale - 0.25, 0.5);
    if (z === 'rot') rot = (rot + 90) % 360;
    stage.classList.toggle('is-zoomed', scale > 1);
    apply();
  });

  Promise.resolve(src || load?.())
    .then((url) => {
      if (!url) throw new Error('No preview available');
      if (isPdf) stage.innerHTML = `<iframe src="${url}" title="${esc(name)}"></iframe>`;
      else stage.innerHTML = `<img src="${url}" alt="${esc(name)}" draggable="false">`;
      const dl = el.querySelector('[data-dl]'); dl.href = url; dl.hidden = false;
    })
    .catch((err) => {
      stage.innerHTML = errorState({ title: 'Could not load this bill', message: err.message, compact: true,
        extra: driveUrl ? `<a class="btn btn--light btn--sm" href="${esc(driveUrl)}" target="_blank" rel="noopener">${ic('external-link')} Try opening in Drive</a>` : '' });
      icons(stage);
    });
}

/* ---------------- Hover preview ----------------
 * Elements with [data-preview] get a floating preview card on hover (desktop).
 * resolver(el) → Promise<{ url, name, isPdf }>
 */
export function attachHoverPreview(root, resolver) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let card = document.getElementById('hover-preview');
  if (!card) { card = document.createElement('div'); card.id = 'hover-preview'; card.className = 'hover-preview'; document.body.append(card); }
  let timer, current;

  const position = (target) => {
    const r = target.getBoundingClientRect();
    const w = 280, h = 340, gap = 12;
    let left = r.right + gap; if (left + w > innerWidth - 8) left = r.left - w - gap;
    let top = r.top + r.height / 2 - h / 2; top = Math.max(8, Math.min(top, innerHeight - h - 8));
    card.style.left = `${Math.max(8, left)}px`; card.style.top = `${top}px`;
  };
  root.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-preview]'); if (!t || t === current) return;
    current = t; clearTimeout(timer);
    timer = setTimeout(async () => {
      if (current !== t) return;
      position(t);
      card.innerHTML = '<div class="hover-preview__img"><div class="spinner"></div></div><div class="hover-preview__cap">Loading bill…</div>';
      card.classList.add('is-visible');
      try {
        const { url, name, isPdf, caption } = await resolver(t);
        if (current !== t) return;
        card.innerHTML = `<div class="hover-preview__img">${isPdf ? `<div class="hover-preview__pdf">${ic('file-text')}<span>PDF bill</span></div>` : ''}${url ? `<img src="${url}" alt="">` : ''}</div>
          <div class="hover-preview__cap"><strong>${esc(name)}</strong>${caption ? `<span>${esc(caption)}</span>` : ''}<em>Click to open</em></div>`;
        icons(card);
      } catch (err) {
        if (current !== t) return;
        card.innerHTML = `<div class="hover-preview__img hover-preview__img--err">${ic('image-off')}</div><div class="hover-preview__cap">${esc(err.message)}</div>`;
        icons(card);
      }
    }, 180);
  });
  root.addEventListener('mouseout', (e) => {
    const t = e.target.closest('[data-preview]');
    if (!t || t.contains(e.relatedTarget)) return;
    clearTimeout(timer); current = null; card.classList.remove('is-visible');
  });
  window.addEventListener('scroll', () => { clearTimeout(timer); current = null; card.classList.remove('is-visible'); }, { passive: true, capture: true });
}

/* ---------------- States ---------------- */
export function emptyState({ icon = 'inbox', title, message = '', action = '', compact = false }) {
  return `<div class="state ${compact ? 'state--compact' : ''}"><div class="state__icon">${ic(icon)}</div>
    <h4 class="state__title">${esc(title)}</h4>${message ? `<p class="state__msg">${message}</p>` : ''}${action}</div>`;
}
export function errorState({ title = 'Something went wrong', message = '', extra = '', compact = false }) {
  return `<div class="state state--error ${compact ? 'state--compact' : ''}"><div class="state__icon">${ic('cloud-off')}</div>
    <h4 class="state__title">${esc(title)}</h4>${message ? `<p class="state__msg">${esc(message)}</p>` : ''}${extra}</div>`;
}
export const skeletonRows = (n = 6, cols = 6) =>
  Array.from({ length: n }, () => `<tr class="skeleton-row">${Array.from({ length: cols }, () => '<td><span class="sk"></span></td>').join('')}</tr>`).join('');

/** Set a button into a busy state; returns a restore function. */
export function busy(btn, label = 'Working…') {
  const html = btn.innerHTML; btn.disabled = true; btn.classList.add('is-busy');
  btn.innerHTML = `<span class="spinner spinner--sm"></span><span>${esc(label)}</span>`;
  return () => { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = html; icons(btn); };
}

/** Animate a number counting up inside an element. */
export function countUp(el, to, format, ms = 650) {
  const from = Number(el.dataset.value || 0); el.dataset.value = to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min((t - t0) / ms, 1), e = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
