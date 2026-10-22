/**
 * CSV and PDF exports of whatever the user is currently looking at.
 * jsPDF is loaded on demand so normal page loads stay light.
 */
import { CONFIG } from './config.js';
import { formatDate, formatDateTime, formatNumber, todayISO, slug } from './utils.js';
import { summarize, groupTotals } from './filters.js';
import { driveViewUrl } from './drive.js';

/* ---------------- CSV ---------------- */
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const gstOf = (t) => (t.gstRate ? Math.round((t.amountPaise * t.gstRate) / (100 + t.gstRate)) / 100 : 0);

export function exportCSV(rows, { name = 'transactions' } = {}) {
  const head = ['S.No', 'Transaction ID', 'Date', 'Type', 'Category', 'Title', 'Description', 'Paid To / Vendor', 'Client', 'Project',
    'Payment Method', 'Amount (INR)', 'GST %', 'GST Amount (INR)', 'Bill (Google Drive)', 'Bill Folder', 'Notes', 'Entered By'];
  const lines = [head.map(csvCell).join(',')];
  rows.forEach((t, i) => lines.push([
    i + 1, t.refNo || t.id, t.date, t.type === 'income' ? 'Income' : 'Expense', t.category, t.title, t.description, t.vendor,
    t.client, t.project, t.paymentMethod, Number(t.amount.toFixed(2)), t.gstRate || 0, gstOf(t),
    t.bill?.fileId ? (t.bill.webViewLink || driveViewUrl(t.bill.fileId)) : '', t.bill?.folderName || '', t.notes, t.createdBy,
  ].map(csvCell).join(',')));
  // BOM so Excel opens UTF-8 (₹, Tamil names) correctly
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${slug(CONFIG.appName)}_${slug(name)}_${todayISO()}.csv`);
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------------- PDF ---------------- */
const loadScript = (src) => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const s = document.createElement('script'); s.src = src; s.onload = resolve;
  s.onerror = () => reject(new Error('Could not load the PDF engine. Check your connection.'));
  document.head.append(s);
});
async function loadJsPDF() {
  if (!window.jspdf?.jsPDF) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  if (!window.jspdf.jsPDF.API.autoTable) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
  return window.jspdf.jsPDF;
}
let fontCache = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  const get = async (f) => {
    const buf = await (await fetch(new URL(`../assets/fonts/${f}`, import.meta.url))).arrayBuffer();
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  try { fontCache = { regular: await get('Manrope-Regular.ttf'), bold: await get('Manrope-Bold.ttf') }; }
  catch { fontCache = false; }
  return fontCache;
}

// Palette (RGB)
const INK = [20, 22, 27], ACCENT = [241, 90, 34], MUTED = [110, 114, 124], LINE = [228, 226, 219],
  SOFT = [248, 247, 243], RED = [200, 52, 52], GREEN = [14, 140, 96];

/**
 * exportPDF({ title, period, rows, filtersText, preparedBy, fileName })
 * Produces an A4-landscape statement: branded header, KPI tiles,
 * category & payment-mode breakdown, full transaction table, totals, sign-off.
 */
export async function exportPDF({ title = 'Financial Statement', period = '', rows, filtersText = '', preparedBy = '', fileName = 'statement' }) {
  const jsPDF = await loadJsPDF();
  const fonts = await loadFonts();
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  let F = 'helvetica';
  if (fonts) {
    pdf.addFileToVFS('Manrope-Regular.ttf', fonts.regular); pdf.addFont('Manrope-Regular.ttf', 'Manrope', 'normal');
    pdf.addFileToVFS('Manrope-Bold.ttf', fonts.bold); pdf.addFont('Manrope-Bold.ttf', 'Manrope', 'bold');
    F = 'Manrope';
  }
  // Without the embedded font the ₹ glyph would not render — fall back to "Rs."
  const money = (n) => `${fonts ? '₹' : 'Rs. '}${formatNumber(n)}`;
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 36;
  const s = summarize(rows);

  /* Header band */
  const header = (first) => {
    pdf.setFillColor(...INK); pdf.rect(0, 0, W, first ? 92 : 46, 'F');
    pdf.setFillColor(...ACCENT); pdf.rect(0, first ? 92 : 46, W, 3, 'F');
    // logo mark
    const ly = first ? 28 : 12;
    pdf.setFillColor(...ACCENT); pdf.roundedRect(M, ly, 22, 22, 5, 5, 'F');
    pdf.setFillColor(...INK); pdf.circle(M + 11, ly + 11, 5.2, 'F');
    pdf.setFillColor(...ACCENT); pdf.circle(M + 11, ly + 11, 2.4, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont(F, 'bold'); pdf.setFontSize(first ? 13 : 11);
    pdf.text(CONFIG.companyName, M + 32, ly + (first ? 10 : 15));
    if (first) {
      pdf.setFont(F, 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(190, 192, 198);
      pdf.text(`${CONFIG.appName} · ${CONFIG.companyTagline}`, M + 32, ly + 22);
      pdf.setFont(F, 'bold'); pdf.setFontSize(18); pdf.setTextColor(255, 255, 255);
      pdf.text(title, W - M, 44, { align: 'right' });
      pdf.setFont(F, 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...ACCENT);
      pdf.text(period, W - M, 62, { align: 'right' });
    } else {
      pdf.setFont(F, 'normal'); pdf.setFontSize(9); pdf.setTextColor(190, 192, 198);
      pdf.text(`${title} · ${period}`, W - M, 27, { align: 'right' });
    }
  };
  header(true);

  /* Meta line */
  let y = 118;
  pdf.setFont(F, 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...MUTED);
  pdf.text(`Generated ${formatDateTime(new Date())}${preparedBy ? `  ·  by ${preparedBy}` : ''}`, M, y);
  if (filtersText) pdf.text(pdf.splitTextToSize(`Filters: ${filtersText}`, W / 2)[0], W - M, y, { align: 'right' });

  /* KPI tiles */
  y += 14;
  const tiles = [
    ['TOTAL EXPENSES', money(s.expense), RED, `${s.expenseCount} expense entr${s.expenseCount === 1 ? 'y' : 'ies'}`],
    ['TOTAL INCOME', money(s.income), GREEN, `${s.incomeCount} income entr${s.incomeCount === 1 ? 'y' : 'ies'}`],
    ['NET BALANCE', (s.net < 0 ? '−' : '') + money(Math.abs(s.net)), s.net < 0 ? RED : GREEN, 'Income − Expenses'],
    ['ENTRIES', String(s.count), INK, s.gst ? `GST paid ${money(s.gst)}` : `Avg expense ${money(s.avgExpense)}`],
  ];
  const gap = 12, tw = (W - M * 2 - gap * 3) / 4, th = 64;
  tiles.forEach(([label, value, color, sub], i) => {
    const x = M + i * (tw + gap);
    pdf.setFillColor(...SOFT); pdf.setDrawColor(...LINE); pdf.setLineWidth(0.6); pdf.roundedRect(x, y, tw, th, 6, 6, 'FD');
    pdf.setFillColor(...color); pdf.rect(x, y + 10, 2.5, th - 20, 'F');
    pdf.setFont(F, 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...MUTED); pdf.text(label, x + 14, y + 19);
    pdf.setFontSize(16); pdf.setTextColor(...color); pdf.text(value, x + 14, y + 40);
    pdf.setFont(F, 'normal'); pdf.setFontSize(8); pdf.setTextColor(...MUTED); pdf.text(sub, x + 14, y + 54);
  });
  y += th + 22;

  /* Breakdowns: categories (left) + payment methods (right) */
  const cats = groupTotals(rows, (t) => t.category).slice(0, 8);
  const modes = groupTotals(rows, (t) => t.paymentMethod).slice(0, 8);
  if (cats.length) {
    const colW = (W - M * 2 - 24) / 2;
    const block = (x, heading, data) => {
      pdf.setFont(F, 'bold'); pdf.setFontSize(10); pdf.setTextColor(...INK); pdf.text(heading, x, y);
      const max = data[0]?.total || 1; let yy = y + 14;
      data.forEach((g) => {
        pdf.setFont(F, 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...INK);
        pdf.text(pdf.splitTextToSize(g.key, colW * 0.36)[0], x, yy + 7);
        const bx = x + colW * 0.38, bw = colW * 0.37;
        pdf.setFillColor(238, 236, 230); pdf.roundedRect(bx, yy + 1.5, bw, 7, 3.5, 3.5, 'F');
        pdf.setFillColor(...ACCENT); pdf.roundedRect(bx, yy + 1.5, Math.max(4, (bw * g.total) / max), 7, 3.5, 3.5, 'F');
        pdf.setFont(F, 'bold'); pdf.text(money(g.total), x + colW, yy + 7, { align: 'right' });
        yy += 16;
      });
      return yy;
    };
    const y1 = block(M, 'Expenses by category', cats);
    const y2 = modes.length ? block(M + colW + 24, 'Expenses by payment method', modes) : y;
    y = Math.max(y1, y2) + 18;
  }

  /* Transactions table */
  pdf.setFont(F, 'bold'); pdf.setFontSize(10); pdf.setTextColor(...INK); pdf.text(`Transactions (${rows.length})`, M, y);
  const body = rows.map((t, i) => [
    i + 1, formatDate(t.date), t.refNo || '', `${t.title}${t.vendor ? `\n${t.vendor}` : ''}`, t.category || '',
    [t.client, t.project].filter(Boolean).join(' · ') || '—', t.paymentMethod || '—',
    (t.type === 'income' ? '+ ' : '− ') + money(t.amount), t.bill?.fileId ? 'View' : '—',
  ]);
  pdf.autoTable({
    startY: y + 8, margin: { left: M, right: M, top: 64, bottom: 40 },
    head: [['#', 'Date', 'Ref', 'Title / Paid to', 'Category', 'Client / Project', 'Mode', 'Amount', 'Bill']],
    body,
    foot: [['', '', '', '', '', '', 'Net', (s.net < 0 ? '− ' : '+ ') + money(Math.abs(s.net)), '']],
    theme: 'plain', showFoot: 'lastPage', showHead: 'everyPage', rowPageBreak: 'avoid',
    styles: { font: F, fontSize: 8.2, textColor: INK, cellPadding: { top: 6, bottom: 6, left: 6, right: 6 }, lineColor: LINE, lineWidth: { bottom: 0.5 }, valign: 'middle' },
    headStyles: { font: F, fontStyle: 'bold', fillColor: INK, textColor: [255, 255, 255], fontSize: 8 },
    footStyles: { font: F, fontStyle: 'bold', fillColor: SOFT, textColor: INK, fontSize: 9.5 },
    alternateRowStyles: { fillColor: [251, 250, 247] },
    columnStyles: {
      0: { cellWidth: 24, textColor: MUTED }, 1: { cellWidth: 62 }, 2: { cellWidth: 70, textColor: MUTED, fontSize: 7.5 },
      3: { cellWidth: 'auto' }, 4: { cellWidth: 90 }, 5: { cellWidth: 96 }, 6: { cellWidth: 76 },
      7: { cellWidth: 88, halign: 'right', fontStyle: 'bold' }, 8: { cellWidth: 34, halign: 'center' },
    },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 7) d.cell.styles.textColor = rows[d.row.index].type === 'income' ? GREEN : RED;
      if (d.section === 'body' && d.column.index === 8 && rows[d.row.index].bill?.fileId) d.cell.styles.textColor = ACCENT;
      if (d.section === 'foot' && d.column.index === 7) { d.cell.styles.halign = 'right'; d.cell.styles.textColor = s.net < 0 ? RED : GREEN; }
      if (d.section === 'foot' && d.column.index === 6) d.cell.styles.halign = 'right';
    },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === 8) {
        const t = rows[d.row.index];
        if (t.bill?.fileId) pdf.link(d.cell.x, d.cell.y, d.cell.width, d.cell.height, { url: t.bill.webViewLink || driveViewUrl(t.bill.fileId) });
      }
    },
    didDrawPage: (d) => { if (d.pageNumber > 1) header(false); },
  });

  /* Sign-off */
  let endY = pdf.lastAutoTable.finalY + 46;
  if (endY > H - 80) { pdf.addPage(); header(false); endY = 110; }
  pdf.setDrawColor(...LINE); pdf.setLineWidth(0.8);
  [['Prepared by', preparedBy], ['Verified by', ''], ['Approved by', '']].forEach(([label, name], i) => {
    const x = M + i * 200;
    pdf.line(x, endY, x + 160, endY);
    pdf.setFont(F, 'normal'); pdf.setFontSize(8); pdf.setTextColor(...MUTED); pdf.text(label, x, endY + 13);
    if (name) { pdf.setTextColor(...INK); pdf.text(name, x, endY - 6); }
  });

  /* Footer on every page */
  const total = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.5); pdf.line(M, H - 26, W - M, H - 26);
    pdf.setFont(F, 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...MUTED);
    pdf.text(`${CONFIG.companyName} · Confidential · Bills are stored in the company Google Drive`, M, H - 14);
    pdf.text(`Page ${i} of ${total}`, W - M, H - 14, { align: 'right' });
  }
  pdf.save(`${slug(CONFIG.appName)}_${slug(fileName)}_${todayISO()}.pdf`);
}
