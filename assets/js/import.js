/* Bulk import of line items from a CSV or Excel (.xlsx) file. Pure parsing/
   validation logic lives here; the bulk-import modal in app.js owns the UI
   and decides what to do with the result (it stages it behind an OK/Cancel
   step before touching `state`). */

const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
const IMPORT_DEFAULT_ITEM = { qty: 1, unit: 'Nos', rate: 0 };

// Our column headers, matched case-insensitively/trimmed. Extra columns in
// the file (e.g. "Amount") are simply never looked up, so they're ignored.
const IMPORT_COLUMNS = ['description', 'qty', 'unit', 'rate'];

function importCellToText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    // ExcelJS cell values can be rich text, a formula result, or a Date.
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return importCellToText(value.result);
    if (value instanceof Date) return value.toISOString();
    return '';
  }
  return String(value);
}

// A small hand-written CSV parser (rather than split(',')) so quoted fields
// containing commas, escaped quotes ("") or embedded newlines are handled
// correctly - a naive split breaks on any of those, which real spreadsheet
// exports commonly contain.
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // skip - normalizes CRLF, bare LF below ends the row either way
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

function readFileWithProgress(file, asText, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read the file.'));
    reader.onload = () => resolve(reader.result);
    if (asText) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

// Returns an array of rows (each an array of cell strings), first row being
// the header row - regardless of whether the source was CSV or XLSX.
async function extractRowsFromFile(file, onReadProgress) {
  const isCsv = /\.csv$/i.test(file.name);
  if (isCsv) {
    const text = await readFileWithProgress(file, true, onReadProgress);
    return parseCsvText(text);
  }
  const buffer = await readFileWithProgress(file, false, onReadProgress);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  const rows = [];
  if (worksheet) {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values; // 1-indexed, values[0] is unused
      const cells = [];
      for (let c = 1; c < values.length; c++) cells.push(importCellToText(values[c]));
      if (cells.some((cell) => cell.trim() !== '')) rows.push(cells);
    });
  }
  return rows;
}

function mapImportColumns(headerRow) {
  const normalized = headerRow.map((h) => importCellToText(h).trim().toLowerCase());
  const map = {};
  IMPORT_COLUMNS.forEach((field) => {
    map[field] = normalized.indexOf(field);
  });
  return map;
}

// Empty cell -> `undefined` (caller applies the default). Non-empty but not
// a number -> `ok: false` (caller ignores the whole row).
function parseImportNumberCell(row, colIndex) {
  if (colIndex < 0) return { ok: true, value: undefined };
  const trimmed = importCellToText(row[colIndex]).trim();
  if (trimmed === '') return { ok: true, value: undefined };
  const num = Number(trimmed);
  return Number.isNaN(num) ? { ok: false, value: undefined } : { ok: true, value: num };
}

function buildImportedItem(row, colMap) {
  const description = colMap.description >= 0 ? importCellToText(row[colMap.description]).trim() : '';
  if (!description) return { ignored: true };

  const qty = parseImportNumberCell(row, colMap.qty);
  const rate = parseImportNumberCell(row, colMap.rate);
  if (!qty.ok || !rate.ok) return { ignored: true };

  const unit = colMap.unit >= 0 ? importCellToText(row[colMap.unit]).trim() : '';

  return {
    ignored: false,
    item: {
      description,
      qty: qty.value !== undefined ? qty.value : IMPORT_DEFAULT_ITEM.qty,
      unit: unit || IMPORT_DEFAULT_ITEM.unit,
      rate: rate.value !== undefined ? rate.value : IMPORT_DEFAULT_ITEM.rate,
    },
  };
}

/**
 * Reads, validates and converts a CSV/XLSX file into invoice line items.
 * Never touches app state. Throws with a user-facing message for anything
 * that stops the whole file being processed (too large, wrong type, no
 * "Description" column); per-row problems (empty description, non-numeric
 * Qty/Rate) just increment `ignoredCount` instead.
 */
async function importItemsFromFile(file, { onProgress } = {}) {
  const report = (fraction, label) => {
    if (onProgress) onProgress(fraction, label);
  };

  if (file.size > IMPORT_MAX_FILE_BYTES) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(2)} MB). The limit is 2 MB.`);
  }
  if (!/\.(csv|xlsx)$/i.test(file.name)) {
    throw new Error('Please choose a .csv or .xlsx file.');
  }

  report(0.02, 'Reading file…');
  const rows = await extractRowsFromFile(file, (readFraction) => {
    report(0.02 + readFraction * 0.38, 'Reading file…');
  });

  if (rows.length === 0) {
    throw new Error('That file has no rows to import.');
  }

  const colMap = mapImportColumns(rows[0]);
  if (colMap.description < 0) {
    throw new Error('Could not find a "Description" column. The first row must contain column headers (Description, Qty, Unit, Rate).');
  }

  const dataRows = rows.slice(1);
  const items = [];
  let ignoredCount = 0;
  report(0.4, 'Importing items…');
  for (let i = 0; i < dataRows.length; i++) {
    const result = buildImportedItem(dataRows[i], colMap);
    if (result.ignored) ignoredCount += 1;
    else items.push(result.item);

    // Yield periodically so the progress bar actually paints, instead of
    // blocking the main thread for the whole loop on a large file.
    if (i % 200 === 0) {
      report(0.4 + (i / dataRows.length) * 0.6, 'Importing items…');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
  report(1, 'Done');

  return { items, importedCount: items.length, ignoredCount, totalRows: dataRows.length };
}
