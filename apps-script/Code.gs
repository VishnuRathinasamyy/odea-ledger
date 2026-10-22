/**
 * ODEA Ledger — Google Drive bill service (Google Apps Script web app)
 * ---------------------------------------------------------------------
 * Runs as the company Google account that owns the bills folder.
 * The website sends:  { action, token, ...payload }  as a text/plain POST.
 *
 * Every request is authorised by asking Firestore for users/{email} WITH the
 * caller's own Firebase ID token. Firestore validates the token (signature,
 * expiry, project) and your security rules decide if the user is a member —
 * so there is no shared secret anywhere in the website.
 *
 * Script Properties (Project Settings → Script properties):
 *   FIREBASE_PROJECT_ID   required  e.g. odea-ledger
 *   ROOT_FOLDER_ID        optional  use an existing Drive folder; otherwise
 *                                   "ODEA Ledger Bills" is created on first use
 *
 * Folder layout created automatically:
 *   ODEA Ledger Bills/
 *     2026-10 October/
 *       2026-10-22_OD-2610-7K3Q_Office-rent.jpg
 *     2026-11 November/ …
 */

var ROOT_NAME = 'ODEA Ledger Bills';
var MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
var MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
var ALLOWED_TYPES = /^(image\/(jpeg|jpg|png|webp|gif|heic|heif)|application\/pdf)$/;
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var WRITE_ROLES = { admin: true, editor: true };

/* ------------------------------------------------------------------ */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var who = verifyCaller_(req.token);
    out = route_(req, who);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'ODEA Ledger Drive service', note: 'Use POST from the ODEA Ledger app.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(req, who) {
  switch (req.action) {
    case 'ping': return ping_(who);
    case 'upload': requireWrite_(who); return upload_(req, who);
    case 'thumb': return sendFile_(req.fileId, true);
    case 'file': return sendFile_(req.fileId, false);
    case 'list': return list_();
    case 'trash': requireWrite_(who); return trash_(req.fileId, who);
    default: throw new Error('Unknown action');
  }
}

/* ------------------------- Authorisation -------------------------- */
function verifyCaller_(token) {
  if (!token || typeof token !== 'string') throw new Error('Not signed in');
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var claims = decodeJwt_(token);   // only used to build the lookup path; Firestore verifies the token itself
  var projectId = prop_('FIREBASE_PROJECT_ID', true);
  if (claims.aud !== projectId) throw new Error('This token belongs to a different Firebase project.');
  var email = String(claims.email || '').toLowerCase();
  if (!email) throw new Error('Your Google account has no email.');

  var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) +
            '/databases/(default)/documents/users/' + encodeURIComponent(email);
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code === 401) throw new Error('Your session expired. Refresh the page and try again.');
  if (code === 403 || code === 404) throw new Error('Your account is not on the ODEA Ledger team list.');
  if (code !== 200) throw new Error('Could not verify your account (HTTP ' + code + ').');

  var doc = JSON.parse(res.getContentText());
  var role = doc.fields && doc.fields.role && doc.fields.role.stringValue;
  if (!role) throw new Error('No role assigned to your account.');
  var who = { email: email, role: role };
  // Cache for 5 minutes, never beyond the token's own expiry
  var ttl = Math.max(1, Math.min(300, (claims.exp || 0) - Math.floor(Date.now() / 1000) - 30));
  cache.put(key, JSON.stringify(who), ttl);
  return who;
}

function decodeJwt_(token) {
  var parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid session token');
  var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString());
}

function requireWrite_(who) {
  if (!WRITE_ROLES[who.role]) throw new Error('Your role (' + who.role + ') cannot change bills.');
}

/* ----------------------------- Actions ---------------------------- */
function ping_(who) {
  var root = getRoot_();
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  return {
    ok: true, email: who.email, role: who.role,
    owner: Session.getEffectiveUser().getEmail(),
    root: { id: root.getId(), name: root.getName(), url: root.getUrl() },
    monthFolder: folderName_(today),
  };
}

function upload_(req, who) {
  var mime = String(req.mimeType || '').toLowerCase();
  if (!ALLOWED_TYPES.test(mime)) throw new Error('Only images or PDF bills are allowed.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date || '')) throw new Error('Invalid bill date.');
  if (!req.data) throw new Error('No file received.');

  var bytes = Utilities.base64Decode(req.data);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('File is larger than 10 MB.');
  var name = String(req.fileName || 'bill').replace(/[\\\/:*?"<>|]+/g, '-').slice(0, 150);

  var folder = monthFolder_(req.date);
  var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  file.setDescription('Uploaded via ODEA Ledger by ' + who.email + ' on ' + new Date().toISOString());
  return {
    ok: true,
    file: {
      fileId: file.getId(), name: file.getName(), mimeType: file.getMimeType(), size: file.getSize(),
      folderName: folder.getName(), folderId: folder.getId(), webViewLink: file.getUrl(),
    },
  };
}

function sendFile_(fileId, thumb) {
  var file = getBillFile_(fileId);
  var blob = null;
  if (thumb) {
    try { blob = file.getThumbnail(); } catch (e) { blob = null; }
    if (!blob && file.getSize() > 3 * 1024 * 1024) throw new Error('Preview not ready yet — open it in Drive.');
  }
  if (!blob) {
    if (file.getSize() > MAX_DOWNLOAD_BYTES) throw new Error('File too large to preview — open it in Drive.');
    blob = file.getBlob();
  }
  return { ok: true, mimeType: blob.getContentType() || file.getMimeType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function list_() {
  var root = getRoot_();
  var folders = [];
  var it = root.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    folders.push({ id: f.getId(), name: f.getName(), url: f.getUrl(), files: filesIn_(f) });
  }
  return { ok: true, root: { id: root.getId(), name: root.getName(), url: root.getUrl() }, folders: folders, looseFiles: filesIn_(root) };
}

function filesIn_(folder) {
  var out = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var file = it.next();
    out.push({
      id: file.getId(), name: file.getName(), mimeType: file.getMimeType(), size: file.getSize(),
      created: file.getDateCreated().toISOString(), updated: file.getLastUpdated().toISOString(), webViewLink: file.getUrl(),
    });
  }
  return out;
}

function trash_(fileId, who) {
  var file = getBillFile_(fileId);
  file.setDescription((file.getDescription() || '') + '\nMoved to trash via ODEA Ledger by ' + who.email + ' on ' + new Date().toISOString());
  file.setTrashed(true);
  return { ok: true };
}

/* ----------------------------- Helpers ---------------------------- */
function prop_(name, required) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  if (required && !v) throw new Error('Apps Script is missing the "' + name + '" script property.');
  return v;
}

function getRoot_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ROOT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { throw new Error('ROOT_FOLDER_ID is set but the folder cannot be opened by the script owner.'); }
  }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    id = props.getProperty('ROOT_FOLDER_ID');
    if (id) return DriveApp.getFolderById(id);
    var existing = DriveApp.getRootFolder().getFoldersByName(ROOT_NAME);
    var folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(ROOT_NAME);
    props.setProperty('ROOT_FOLDER_ID', folder.getId());
    return folder;
  } finally { lock.releaseLock(); }
}

function folderName_(isoDate) {
  var m = Number(isoDate.slice(5, 7));
  return isoDate.slice(0, 7) + ' ' + MONTHS[m - 1];
}

/** Finds or creates the "YYYY-MM Month" folder. Locked so two uploads can't create duplicates. */
function monthFolder_(isoDate) {
  var root = getRoot_();
  var name = folderName_(isoDate);
  var it = root.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    it = root.getFoldersByName(name);
    return it.hasNext() ? it.next() : root.createFolder(name);
  } finally { lock.releaseLock(); }
}

/** Only files inside the bills folder (or its month folders) can be read or trashed. */
function getBillFile_(fileId) {
  if (!fileId || !/^[\w-]{10,}$/.test(fileId)) throw new Error('Invalid file id.');
  var file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { throw new Error('Bill not found in Drive (it may have been deleted).'); }
  if (file.isTrashed()) throw new Error('This bill is in the Drive trash.');
  var rootId = getRoot_().getId();
  var parents = file.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    if (p.getId() === rootId) return file;
    var gp = p.getParents();
    while (gp.hasNext()) if (gp.next().getId() === rootId) return file;
  }
  throw new Error('That file is outside the ODEA Ledger bills folder.');
}

/** Run once from the editor to authorise the script and create the folder. */
function setup() {
  var root = getRoot_();
  Logger.log('Bills folder ready: ' + root.getName() + ' → ' + root.getUrl());
  Logger.log('FIREBASE_PROJECT_ID = ' + (prop_('FIREBASE_PROJECT_ID') || '(not set — add it in Project Settings → Script properties)'));
}
