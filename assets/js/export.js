/* PDF export (html2canvas + jsPDF, one page captured at a time) and Excel
   export (ExcelJS) for the invoice. */

// A4 page geometry (mm), and the CSS px equivalent at 96 px/inch used to lay
// out the off-screen render at the same width the PDF's content area will
// have, so measurements taken on it (see splitInvoiceIntoPdfPages) match.
const PDF_MARGIN_MM = 8;
const PDF_PAGE_MM = { width: 210, height: 297 }; // A4 portrait
const MM_TO_PX = 96 / 25.4;
const PDF_CONTENT_WIDTH_MM = PDF_PAGE_MM.width - PDF_MARGIN_MM * 2;
const PDF_CONTENT_WIDTH_PX = Math.floor(PDF_CONTENT_WIDTH_MM * MM_TO_PX);
const PDF_CONTENT_HEIGHT_PX = Math.floor((PDF_PAGE_MM.height - PDF_MARGIN_MM * 2) * MM_TO_PX);
// Leave a little slack below the true page height for estimation error in
// splitInvoiceIntoPdfPages (fonts/layout can shift a pixel or two between
// the measurement pass and the real capture of the same content).
const PDF_PAGE_HEIGHT_BUDGET_PX = PDF_CONTENT_HEIGHT_PX - 20;
const ITEMS_PER_PDF_PAGE = 30;

// A table's <thead> only repeats automatically on every printed page when a
// browser's native print engine paginates it (window.print()) - not when a
// tool rasterizes the page into one tall image and slices it into
// page-sized chunks, which is how this export used to work (via html2pdf.js,
// which bundles html2canvas + jsPDF behind a single `.save()` call). That
// slicing approach turned out to have a second, independent problem: on any
// page where content was pushed down to avoid a row splitting mid-page
// (html2pdf's `pagebreak.avoid`), a faint phantom line could appear in the
// blank space left behind - reproducible even with plain html2pdf and no
// custom pagination, so it's an artifact of slicing one giant canvas into
// pages, not something fixable by rearranging the DOM going into it.
//
// splitInvoiceIntoPdfPages sidesteps both problems by not rendering a single
// tall image at all: it decides the page breaks itself (measuring real row
// heights on the mounted, correctly-A4-width clone) and rebuilds the invoice
// as one independent DOM tree per PDF page, each with its own real <thead>.
// exportInvoiceToPdf then captures each page with its own html2canvas call
// and places it on its own jsPDF page - there is no multi-page canvas to
// slice, so there's nothing for a row (or a border) to straddle.
function splitInvoiceIntoPdfPages(clone) {
  const table = clone.querySelector('.items-table');
  const tableWrapper = clone.querySelector('.table-responsive');
  const thead = table && table.querySelector('thead');
  const tbody = table && table.querySelector('tbody');
  if (!table || !tableWrapper || !thead || !tbody) return [clone];

  const rows = Array.from(tbody.children);
  const cloneTop = clone.getBoundingClientRect().top;
  const letterheadHeight = tableWrapper.getBoundingClientRect().top - cloneTop;
  const headerHeight = thead.getBoundingClientRect().height;
  const rowHeights = rows.map((row) => row.getBoundingClientRect().height);

  // Walk the rows, starting a new group (new page) whenever the next row
  // would exceed the remaining budget for the current page, or the current
  // page has already reached the soft 30-item target. There's no attempt to
  // exactly fill every page - a group can end up smaller than 30 if rows
  // are tall (e.g. wrapped descriptions), which is fine.
  let budget = PDF_PAGE_HEIGHT_BUDGET_PX - letterheadHeight - headerHeight;
  let count = 0;
  const breaks = [];
  rowHeights.forEach((height, i) => {
    if (i > 0 && (count >= ITEMS_PER_PDF_PAGE || height > budget)) {
      breaks.push(i);
      budget = PDF_PAGE_HEIGHT_BUDGET_PX - headerHeight;
      count = 0;
    }
    budget -= height;
    count += 1;
  });
  const groups = [];
  let start = 0;
  breaks.forEach((idx) => {
    groups.push(rows.slice(start, idx));
    start = idx;
  });
  groups.push(rows.slice(start));

  // Everything before/after the items table (seller header, addresses,
  // totals, bank details...) only belongs on the first/last PDF page
  // respectively - collect it here so it can be reattached below.
  const before = [];
  const after = [];
  let seenWrapper = false;
  Array.from(clone.children).forEach((child) => {
    if (child === tableWrapper) {
      seenWrapper = true;
      return;
    }
    (seenWrapper ? after : before).push(child);
  });

  return groups.map((groupRows, g) => {
    const pageRoot = document.createElement('div');
    pageRoot.className = clone.className;
    if (g === 0) before.forEach((el) => pageRoot.appendChild(el));

    const newWrapper = document.createElement('div');
    newWrapper.className = tableWrapper.className;
    const newTable = document.createElement('table');
    newTable.className = table.className;
    newTable.appendChild(thead.cloneNode(true));
    const newTbody = document.createElement('tbody');
    // appendChild moves each <tr> out of the original tbody automatically.
    groupRows.forEach((row) => newTbody.appendChild(row));
    newTable.appendChild(newTbody);
    newWrapper.appendChild(newTable);
    pageRoot.appendChild(newWrapper);

    if (g === groups.length - 1) after.forEach((el) => pageRoot.appendChild(el));
    return pageRoot;
  });
}

async function exportInvoiceToPdf(sheetEl, state) {
  const clone = sheetEl.cloneNode(true);
  clone.classList.add('pdf-export-clone');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));

  clone.querySelectorAll('.no-export').forEach((el) => el.remove());

  clone.querySelectorAll('input, textarea').forEach((el) => {
    const tag = el.tagName === 'TEXTAREA' ? 'div' : 'span';
    const replacement = document.createElement(tag);
    replacement.className = el.className;
    replacement.textContent = el.value && el.value.length ? el.value : ' ';
    el.replaceWith(replacement);
  });

  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  // Match the PDF's content width (A4 width minus its page margins) rather
  // than the full page width, so splitInvoiceIntoPdfPages's measurements
  // and every page's real capture see the same text wrapping.
  wrapper.style.width = `${PDF_CONTENT_WIDTH_PX}px`;
  wrapper.style.zIndex = '-9999';
  wrapper.style.pointerEvents = 'none';
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  const pages = splitInvoiceIntoPdfPages(clone);

  // html2canvas mis-captures whenever the page itself is scrolled (a real
  // scenario here, since the form is taller than the viewport and users
  // naturally scroll down while filling it in) - it has previously produced
  // a blank gap at the top of a capture for exactly this reason. Force an
  // instant scroll to the top and wait for any in-flight smooth-scroll
  // (e.g. from a focused field) to fully settle before capturing, then
  // restore the user's scroll position afterwards.
  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  const originalScrollBehavior = document.documentElement.style.scrollBehavior;
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, 0);
  // A field's native focus scroll-into-view (e.g. from clicking "Add Item",
  // which focuses the new row's textarea) can still be mid-animation here.
  // Disabling smooth scrolling and calling scrollTo(0, 0) doesn't cancel an
  // already-running animation, so it can keep nudging the page away from
  // (0, 0) for a while after this point, even past a fixed wait - on a long
  // invoice with many items this window was wide enough to still be
  // scrolled when html2canvas captured, reproducing the blank-gap bug this
  // function otherwise guards against. Re-assert the reset until the
  // position actually stays put instead of guessing a fixed delay.
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (window.scrollX === 0 && window.scrollY === 0) break;
    window.scrollTo(0, 0);
  }

  try {
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    for (let i = 0; i < pages.length; i++) {
      wrapper.innerHTML = '';
      wrapper.appendChild(pages[i]);
      // Let layout settle after swapping in this page's content before
      // capturing it.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const imgHeightMm = (canvas.height / canvas.width) * PDF_CONTENT_WIDTH_MM;
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_CONTENT_WIDTH_MM, imgHeightMm);
    }
    const filename = `Invoice-${(state.invoiceNumber || 'draft').replace(/[^\w-]+/g, '_')}.pdf`;
    pdf.save(filename);
    showToast('PDF downloaded');
  } finally {
    wrapper.remove();
    window.scrollTo(originalScrollX, originalScrollY);
    document.documentElement.style.scrollBehavior = originalScrollBehavior;
  }
}

function invoiceTotals(state) {
  const subtotal = state.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const taxAmount = subtotal * ((Number(state.taxPercent) || 0) / 100);
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}

async function exportInvoiceToExcel(state) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Invoice', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { width: 6 }, { width: 42 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 14 },
  ];

  const thinBorder = { style: 'thin' };
  const border = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

  function setCell(addr, value, opts = {}) {
    const cell = ws.getCell(addr);
    cell.value = value;
    if (opts.bold || opts.size) cell.font = { bold: !!opts.bold, size: opts.size || 10 };
    if (opts.align || opts.wrap) {
      cell.alignment = { horizontal: opts.align, vertical: 'middle', wrapText: !!opts.wrap };
    }
    if (opts.border) cell.border = border;
    return cell;
  }

  ws.mergeCells('A1:D1');
  setCell('A1', state.seller.name || '', { bold: true, size: 14 });
  ws.mergeCells('E1:F1');
  setCell('E1', state.title || 'TAX INVOICE', { bold: true, size: 14, align: 'right' });

  ws.mergeCells('A2:F2');
  setCell('A2', state.seller.address || '', { wrap: true });
  ws.mergeCells('A3:F3');
  setCell('A3', state.seller.phone || '');
  ws.mergeCells('A4:F4');
  setCell('A4', state.seller.email || '');

  setCell('A6', 'Invoice Number');
  ws.mergeCells('B6:C6');
  setCell('B6', state.invoiceNumber || '', { bold: true });
  setCell('A7', 'Invoice Date');
  ws.mergeCells('B7:C7');
  setCell('B7', state.invoiceDate || '', { bold: true });

  ws.mergeCells('A9:C9');
  setCell('A9', 'Shipping Address:', { bold: true, border: true });
  ws.mergeCells('D9:F9');
  setCell('D9', 'Billing Address:', { bold: true, border: true });

  ws.mergeCells('A10:C13');
  setCell('A10', state.shippingAddress || '', { wrap: true, border: true });
  ws.mergeCells('D10:F13');
  setCell('D10', state.billingAddress || '', { wrap: true, border: true });

  const headerRow = 15;
  ['Sl No', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'].forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.border = border;
    cell.alignment = { horizontal: i === 1 ? 'left' : 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECEF' } };
  });

  let row = headerRow + 1;
  state.items.forEach((item, idx) => {
    const amount = (Number(item.qty) || 0) * (Number(item.rate) || 0);
    ws.getCell(row, 1).value = idx + 1;
    ws.getCell(row, 2).value = item.description || '';
    ws.getCell(row, 3).value = Number(item.qty) || 0;
    ws.getCell(row, 4).value = item.unit || '';
    ws.getCell(row, 5).value = Number(item.rate) || 0;
    ws.getCell(row, 6).value = amount;
    for (let c = 1; c <= 6; c++) {
      const cell = ws.getCell(row, c);
      cell.border = border;
      if (c === 5 || c === 6) cell.numFmt = '#,##0.00';
      if (c === 1 || c === 3) cell.alignment = { horizontal: 'center' };
    }
    row++;
  });

  const { subtotal, taxAmount, total } = invoiceTotals(state);

  function totalsRow(label, value, bold) {
    ws.mergeCells(`A${row}:E${row}`);
    const labelCell = ws.getCell(`A${row}`);
    labelCell.value = label;
    labelCell.font = { bold: !!bold };
    labelCell.alignment = { horizontal: 'right' };
    labelCell.border = border;
    const valCell = ws.getCell(`F${row}`);
    valCell.value = value;
    valCell.numFmt = '#,##0.00';
    valCell.font = { bold: !!bold };
    valCell.border = border;
    row++;
  }
  totalsRow('SubTotal', subtotal);
  totalsRow(`TAX (${Number(state.taxPercent) || 0}%)`, taxAmount);
  totalsRow('Total', total, true);

  row += 1;
  ws.mergeCells(`A${row}:F${row}`);
  setCell(`A${row}`, 'Total In Words:', { bold: true });
  row += 1;
  ws.mergeCells(`A${row}:F${row}`);
  setCell(`A${row}`, numberToWords(total), { wrap: true });
  row += 2;

  // Bank details on the left (A:D), authorized signature block on the right
  // (E:F), sharing the same row range so they sit side by side.
  ws.mergeCells(`A${row}:B${row}`);
  setCell(`A${row}`, 'Bank Details:', { bold: true });
  row += 1;

  [['Name', state.bank.name], ['Bank', state.bank.bank], ['Account No.', state.bank.accountNo], ['IFSC Code', state.bank.ifsc]]
    .forEach(([label, value]) => {
      setCell(`A${row}`, label, { bold: true });
      ws.mergeCells(`B${row}:D${row}`);
      setCell(`B${row}`, value || '');
      row += 1;
    });
  const bankEndRow = row - 1;

  // Signature line + name sit on the second-to-last row of the block, with
  // "Authorized Signature" as the caption on the last row, leaving blank
  // rows above for the physical signature (mirrors the source spreadsheet).
  const signatureNameRow = bankEndRow - 1;
  const signatureCaptionRow = bankEndRow;
  ws.mergeCells(`E${signatureNameRow}:F${signatureNameRow}`);
  const sigNameCell = setCell(`E${signatureNameRow}`, state.signatoryName || '', { bold: true, align: 'center' });
  sigNameCell.border = { top: thinBorder };
  ws.mergeCells(`E${signatureCaptionRow}:F${signatureCaptionRow}`);
  setCell(`E${signatureCaptionRow}`, 'Authorized Signature', { align: 'center' });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const filename = `Invoice-${(state.invoiceNumber || 'draft').replace(/[^\w-]+/g, '_')}.xlsx`;
  downloadBlob(blob, filename);
  showToast('Excel file downloaded');
}
