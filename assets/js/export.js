/* PDF export (html2pdf.js) and Excel export (ExcelJS) for the invoice. */

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
    replacement.textContent = el.value && el.value.length ? el.value : ' ';
    el.replaceWith(replacement);
  });

  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  wrapper.style.width = '794px';
  wrapper.style.zIndex = '-9999';
  wrapper.style.pointerEvents = 'none';
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  // html2pdf's internal render overlay uses position:fixed, which
  // html2canvas mis-captures whenever the page itself is scrolled (a real
  // scenario here, since the form is taller than the viewport and users
  // naturally scroll down while filling it in). Force an instant scroll to
  // the top and wait a couple of paint frames so any in-flight smooth-scroll
  // (e.g. from a focused field) has fully settled before capture starts,
  // then restore the user's scroll position afterwards.
  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  const originalScrollBehavior = document.documentElement.style.scrollBehavior;
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const filename = `Invoice-${(state.invoiceNumber || 'draft').replace(/[^\w-]+/g, '_')}.pdf`;
  const opt = {
    margin: 8,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] },
  };

  try {
    await html2pdf().set(opt).from(clone).save();
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
