# ODEA Ledger

Office expense & bill manager for **ODEA Development**.
Plain HTML, CSS and vanilla JavaScript — hosted free on **GitHub Pages**, data in **Firebase Firestore**, bill images in **Google Drive** (one folder per month, created automatically).

```
Browser (GitHub Pages)  ──►  Firebase Auth (Google sign-in)
        │                ──►  Firestore  — text only: entries, settings, team   (~1 KB per entry)
        └──────────────► Apps Script web app ──► Google Drive / ODEA Ledger Bills / 2026-10 October / bill.jpg
```

Firestore's free tier (1 GiB) holds roughly **a million entries** because only text and Drive links are stored there. Images never touch Firestore.

---

## Features

| # | Feature | Where |
|---|---|---|
| 1 | Google sign-in, team list with **Admin / Editor / Viewer** roles (enforced by Firestore rules) | Sign-in, Settings |
| 2 | Entry form: date, type, **calculating amount field** (`1200+350*2`, `1000+18%`), quick +₹ chips, category, payee, GST, client/project, notes | New entry |
| 3 | Bill upload: drag & drop, browse, **paste with Ctrl+V**, **phone camera**; photos auto-compressed (5 MB → ~300 KB) | New entry |
| 4 | Bills filed to Drive automatically in **`YYYY-MM Month`** folders | Apps Script |
| 5 | Live receipt preview while typing, shows exactly which Drive folder the bill goes to | New entry |
| 6 | **Smart autofill**: picking a payee you've used before fills its category, title, client and GST | New entry |
| 7 | **Duplicate warning** — same day, same amount, same payee | New entry |
| 8 | Unsaved-draft recovery, Save & add another, Ctrl+Enter to save | New entry |
| 9 | Entries table: S.No, date, Txn ID, title, category, type, client, method, amount, **bill** — sort, search, pagination | Entries |
| 10 | Filters: All time, Today, This week, This month, Last month, **This FY (Apr–Mar)**, pick any month, custom date range, type, category, method, client, missing bill | Entries |
| 11 | **Totals for whatever is filtered** — expenses, income, net, count, average, GST | Entries |
| 12 | **Bill hover preview** in the table (desktop), click for full-screen viewer with zoom/rotate/download/open in Drive | Entries, Dashboard |
| 13 | Export filtered entries to **CSV** (Excel-safe, ₹ and Tamil names intact) and a **branded PDF statement** (KPI tiles, category & method breakdown, table with clickable bill links, sign-off lines, page numbers) | Entries, Reports, Dashboard |
| 14 | Dashboard: 4 required cards, budget meter, income/net/avg/GST/bills strip, daily chart, category donut, 6-month trend, recent entries, top payees/clients/methods | Dashboard |
| 15 | Monthly reports: month navigator, deltas vs previous month, day-by-day and week-by-week, category comparison, 12-month history, FY total | Reports |
| 16 | **Bills vault**: every file in the Drive folder by month, thumbnails, search, linked/unlinked filter, storage used | Bills vault |
| 17 | Monthly **budget** with 80% / 100% alerts | Settings, bell |
| 18 | Notification bell: budget alerts, missing bills, entries waiting to sync | Top bar |
| 19 | Edit, **duplicate** (for recurring bills), delete with confirmation and **Undo** | Entries |
| 20 | Works **offline** — entries queue and sync when back online | Everywhere |
| 21 | Dark mode, collapsible sidebar, keyboard shortcuts (`N`, `/`, `G D`…, `?`) | Everywhere |
| 22 | Category manager (add / remove / drag to reorder), full JSON backup | Settings |
| 23 | Audit trail on each entry: created by / last edited by, with times | Entry details |

All figures are calculated from the live database. Nothing is hard-coded and there is no sample data.

---

## Clients (fixed monthly fees)

- **Settings → Clients**: add each client with their fixed monthly fee, billing start month and optional due day. Change a fee any time — past months keep the old fee (fee history).
- **Client payments** page: every client's status for the month — Paid / Partially paid / Not paid / Overdue — with Record payment (full or partial, any number per month), Mark paid, and Undo on everything.
- **Client expense** form: pick the client from the dropdown; it shows what they paid this month, what's been spent, what's left, and what will be left after this expense (red when negative).
- **Balance** = received from the client − spent on the client. Monthly and weekly reports, CSV and PDF export.
- Office expenses stay separate (**Office expense** form) and the office budget only counts office spending.

## Setup (about 20 minutes)

### 1. Firebase project (database + sign-in)

1. Go to **console.firebase.google.com** → *Add project* → name it `odea-ledger` (Google Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
3. **Authentication → Settings → Authorized domains → Add domain** → `YOUR-GITHUB-USERNAME.github.io`
4. **Build → Firestore Database → Create database** → *Production mode* → location **asia-south1 (Mumbai)**.
5. **Firestore → Rules** → replace everything with the contents of [`firebase/firestore.rules`](firebase/firestore.rules) → **Publish**.
6. **Project settings (⚙) → General → Your apps → Web (`</>`)** → register app → copy the `firebaseConfig` values into `js/config.js`.
7. **Add yourself as the first admin** — Firestore → *Start collection* `users` → Document ID = **your Gmail in lowercase** (e.g. `odeagroups@gmail.com`) → field `role` (string) = `admin` → Save.
   After that, add everyone else from **Settings → Team access** inside the app.

### 2. Google Drive bill service (Apps Script)

Do this signed in as the Google account whose Drive should hold the bills.

1. Open **script.google.com** → *New project* → name it `ODEA Ledger Drive`.
2. Replace `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. ⚙ *Project Settings* → tick **Show "appsscript.json"** → open it and replace it with [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. ⚙ *Project Settings → Script properties → Add*:
   - `FIREBASE_PROJECT_ID` = your Firebase project ID (e.g. `odea-ledger`)
   - *(optional)* `ROOT_FOLDER_ID` = ID of an existing Drive folder to use. The ID is the last part of the folder URL: `drive.google.com/drive/folders/`**`1AbCdEf…`**. Skip it and the script creates **"ODEA Ledger Bills"** for you.
5. Select the `setup` function → **Run** → allow the permissions. Check *Execution log* for the folder link.
6. **Deploy → New deployment → ⚙ Web app** → *Execute as*: **Me** · *Who has access*: **Anyone** → Deploy.
7. Copy the **Web app URL** (ends in `/exec`) into `driveProxyUrl` in `js/config.js`.

> "Anyone" only means the URL is reachable. Every request must carry a valid Firebase sign-in token **and** that user must be on the team list, or the script refuses. Bills stay private in Drive — the app streams previews through the script; nothing is shared publicly.
> When you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

### 3. Publish on GitHub Pages

```bash
git init && git add . && git commit -m "ODEA Ledger"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/odea-ledger.git
git push -u origin main
```
GitHub → repo → **Settings → Pages → Source: Deploy from a branch → main / (root)**.
Open `https://YOUR-USERNAME.github.io/odea-ledger/`.

### 4. First run checklist
- [ ] Sign in with the admin Gmail → you land on the dashboard.
- [ ] **Settings → Google Drive → Test connection** shows "Working" and the folder link.
- [ ] Add an entry with a photo → it appears in Entries, the dashboard updates, and the photo is in Drive under this month's folder.
- [ ] Hover the bill chip in Entries → preview appears. Export a PDF.
- [ ] Add a teammate's Gmail in Settings → Team access, then ask them to sign in.

---

## Configuration you supply (`js/config.js`)

| Key | What | Where to find it |
|---|---|---|
| `firebase.*` | Web app config | Firebase → Project settings → Your apps |
| `driveProxyUrl` | Apps Script `/exec` URL | Apps Script → Deploy → Manage deployments |
| `companyName`, `appName` | Branding on screens & PDFs | — |
| `defaultCategories`, `paymentMethods`, `gstRates` | Form options (categories are editable in Settings) | — |
| `bills.maxDimension`, `bills.jpegQuality` | Compression of bill photos | — |

None of these are secrets. There are no private keys anywhere in the website.

---

## Security model

- **Authentication**: Google sign-in via Firebase Auth. No password checks in JavaScript.
- **Authorisation**: `users/{email}` with `role`. Firestore rules check membership & role on **every** read and write — hiding buttons in the UI is only cosmetic.
- **Server-side validation** (rules): field whitelist, types and lengths, date format, `month` must match `date`, amount stored as **integer paise** (> 0, ≤ ₹10 Cr), GST rate from a fixed list, Drive links must be `drive.google.com`. `createdBy`/`createdAt` can never be rewritten. Editors can delete only their own entries; admins can delete any.
- **Drive**: the Apps Script verifies the caller's Firebase token by reading their Firestore profile with it; it only reads/trashes files that live inside the bills folder, rejects non-image/PDF uploads and anything over 10 MB.
- **Deletes**: confirmation dialog + Undo. Bills are never deleted permanently by the app — at most moved to Drive trash (recoverable for 30 days).
- Removing a teammate takes effect immediately for the database and within 5 minutes for Drive (token cache).

## Data model (`transactions` collection)

| Field | Type | Notes |
|---|---|---|
| `refNo` | string | Human ID shown as Txn ID, e.g. `OD-2610-7K3Q` |
| `date` | string `YYYY-MM-DD` | Payment date in IST — no timezone drift |
| `month` | string `YYYY-MM` | For monthly grouping |
| `type` | `expense` \| `income` | |
| `amountPaise` | integer | ₹1,250.50 → `125050` (no floating-point errors) |
| `category`, `title`, `paymentMethod` | string | required |
| `description`, `vendor`, `client`, `project`, `notes` | string | optional |
| `gstRate` | 0/5/12/18/28 | GST included in the amount |
| `bill` | map \| null | `fileId, name, mimeType, size, folderName, folderId, webViewLink` |
| `createdBy`, `updatedBy`, `createdAt`, `updatedAt` | | audit trail |

Calculations: **Total expenses** = Σ expense amounts in the period · **Total income** = Σ income amounts · **Net** = income − expenses. Sums are done in paise, then formatted in the Indian system (₹1,25,000.00).

## Project structure

```
index.html            Sign-in
dashboard.html        Summary cards, charts, rankings
add-entry.html        Entry form (also edit ?id= and duplicate ?dup=)
entries.html          Filterable table + exports
reports.html          Month-by-month report
bills.html            Drive bills vault
settings.html         Budget, categories, team, Drive, appearance, backup
css/  base · layout · components · pages · responsive
js/   config · firebase · auth · store (Firestore) · drive (Apps Script client)
      utils (money/dates/calculator) · validation · filters · charts · export (CSV/PDF)
      ui (toasts/modals/lightbox) · widgets · layout (shell) · pages/*.js
apps-script/          Code.gs + appsscript.json  (Drive service)
firebase/             firestore.rules
assets/               logo, favicon, Manrope TTF (for ₹ in PDFs)
```

## Limits worth knowing
- Apps Script free quotas are generous for an office (thousands of uploads/day). Each preview is fetched through the script, so the first view of a bill takes ~1–2 s; it's cached for the rest of the page visit.
- The app loads all entries on each page (fast up to tens of thousands). If it ever grows past that, switch the realtime query to a date window.
- HEIC photos from iPhones upload as-is on browsers that can't decode them (Drive still previews them).
