/**
 * Google Drive client — talks to the Apps Script web app in apps-script/Code.gs.
 *
 * Why a proxy? GitHub Pages is static, so it can't hold Google credentials.
 * The Apps Script runs as the company Google account, owns the "ODEA Ledger Bills"
 * folder, and only acts after verifying the caller's Firebase ID token against
 * the Firestore users list. Bills stay PRIVATE in Drive — previews are streamed
 * through the proxy, never through public share links.
 */
import { CONFIG, isDriveConfigured } from './config.js';
import { auth } from './firebase.js';

export { isDriveConfigured };

async function call(action, payload = {}, { timeoutMs = 60000 } = {}) {
  if (!isDriveConfigured()) throw new Error('Google Drive is not connected yet. Add the Apps Script URL in js/config.js.');
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const token = await user.getIdToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    // text/plain keeps this a "simple" CORS request (no preflight) which Apps Script supports.
    res = await fetch(CONFIG.driveProxyUrl, {
      method: 'POST', body: JSON.stringify({ action, token, ...payload }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl.signal, redirect: 'follow',
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Google Drive took too long to respond.' : 'Could not reach Google Drive. Check your connection.');
  } finally { clearTimeout(timer); }
  let json;
  try { json = await res.json(); } catch { throw new Error('Unexpected response from the Drive service. Re-deploy the Apps Script (see README).'); }
  if (!json.ok) throw new Error(json.error || 'Drive request failed');
  return json;
}

/* ---------------- Image compression ---------------- */
/**
 * Phone photos of bills are often 4–8 MB. We resize to ≤1800px and re-encode as
 * JPEG (~200–500 KB) — still perfectly readable, and Drive space lasts years.
 */
export async function prepareBill(file) {
  const { maxSizeMB, maxDimension, jpegQuality } = CONFIG.bills;
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  if (!isImage && !isPdf) throw new Error('Only images (JPG, PNG, WEBP, HEIC*) or PDF bills are allowed.');
  if (file.size > maxSizeMB * 1024 * 1024) throw new Error(`File is larger than ${maxSizeMB} MB.`);
  if (isPdf || file.type === 'image/gif' || file.type === 'image/svg+xml') return { blob: file, mimeType: file.type, originalSize: file.size };

  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch {
    // Some formats (e.g. HEIC on non-Safari) can't be decoded in the browser — upload as-is.
    return { blob: file, mimeType: file.type || 'application/octet-stream', originalSize: file.size };
  }
  const ratio = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  if (ratio === 1 && file.size < 450 * 1024) { bitmap.close?.(); return { blob: file, mimeType: file.type, originalSize: file.size }; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);   // transparent PNGs → white
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', jpegQuality));
  if (!blob || blob.size >= file.size) return { blob: file, mimeType: file.type, originalSize: file.size };
  return { blob, mimeType: 'image/jpeg', originalSize: file.size };
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(blob);
});

/**
 * Upload a bill. The Apps Script files it under  <root>/<YYYY-MM Month>/  automatically.
 * @returns {Promise<{fileId,name,mimeType,size,folderName,folderId,webViewLink}>}
 */
export async function uploadBill(file, { date, title, refNo }, preparedAlready = null) {
  const prepared = preparedAlready || await prepareBill(file);
  const ext = prepared.mimeType === 'application/pdf' ? 'pdf' : (prepared.mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const safeTitle = String(title || 'bill').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'bill';
  const fileName = `${date}_${refNo}_${safeTitle}.${ext}`;
  const data = await toBase64(prepared.blob);
  const res = await call('upload', { fileName, mimeType: prepared.mimeType, data, date }, { timeoutMs: 120000 });
  return { ...res.file, compressedFrom: prepared.originalSize };
}

/* ---------------- Previews (cached per page) ---------------- */
const cache = new Map();
/**
 * Returns an object URL for a bill. kind: 'thumb' (small, fast) | 'full'.
 */
export function getBillURL(fileId, kind = 'full') {
  const key = `${kind}:${fileId}`;
  if (!cache.has(key)) {
    const p = call(kind === 'thumb' ? 'thumb' : 'file', { fileId })
      .then(({ mimeType, data }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      })
      .catch((e) => { cache.delete(key); throw e; });
    cache.set(key, p);
  }
  return cache.get(key);
}

export const listBills = () => call('list').then((r) => r);
export const trashBill = (fileId) => call('trash', { fileId });
export const pingDrive = () => call('ping', {}, { timeoutMs: 20000 });
export const driveViewUrl = (fileId) => `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
