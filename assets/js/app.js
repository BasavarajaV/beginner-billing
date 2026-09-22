/* Main application state, rendering and event wiring for the invoice editor. */

function defaultItem() {
  return { description: '', qty: 1, unit: 'Nos', rate: 0 };
}

function defaultInvoice() {
  return {
    id: generateId(),
    title: 'TAX INVOICE',
    seller: { name: 'Your Company Name', address: 'Address line, City, State - PIN', phone: '', email: '' },
    invoiceNumber: 'INV-0001',
    invoiceDate: todayFormatted(),
    shippingAddress: '',
    billingAddress: '',
    items: [defaultItem()],
    taxPercent: 0,
    bank: { name: '', bank: '', accountNo: '', ifsc: '' },
    signatoryName: '',
  };
}

let state = Storage.loadDraft() || defaultInvoice();

// --- DOM refs -------------------------------------------------------------
const sheet = document.getElementById('invoice-sheet');
const itemsBody = document.getElementById('items-body');
const subtotalEl = document.getElementById('subtotal-value');
const taxAmountEl = document.getElementById('tax-amount-value');
const totalEl = document.getElementById('total-value');
const totalWordsEl = document.getElementById('total-words-value');

// --- Rendering --------------------------------------------------------------
function renderFieldsFromState() {
  sheet.querySelectorAll('[data-path]').forEach((el) => {
    const path = el.dataset.path;
    if (path.startsWith('items.')) return; // handled by renderItems
    const value = getPath(state, path);
    el.value = value == null ? '' : value;
  });
}

const ITEM_ROW_COLUMN_COUNT = 8; // drag handle, Sl No, description, qty, unit, rate, amount, delete

// A thin row sitting between two item rows (and before the first / after
// the last) with a "+" that inserts a new item at exactly that position -
// see input/add_button_enhacement.md. `no-export no-print` keep it out of
// the PDF/print output the same way the drag handle and delete button are;
// `data-insert-at` (not `data-index`) is what lets the drag-and-drop
// handlers above tell it apart from a real item row.
function insertGapRowTemplate(insertAt) {
  return `
    <tr class="insert-gap-row no-export no-print" data-insert-at="${insertAt}">
      <td colspan="${ITEM_ROW_COLUMN_COUNT}">
        <button type="button" class="insert-gap-btn" tabindex="-1" title="Insert an item here">
          <i class="bi bi-plus-lg"></i>
        </button>
      </td>
    </tr>`;
}

function itemRowTemplate(item, index) {
  const amount = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  return `
    <tr data-index="${index}">
      <td class="text-center no-export no-print drag-handle-cell">
        <i class="bi bi-grip-vertical drag-handle" title="Drag to reorder"></i>
      </td>
      <td class="text-center sl-no">${index + 1}</td>
      <td>
        <textarea rows="1" class="plain-input item-desc" data-path="items.${index}.description"
          placeholder="Item description">${item.description || ''}</textarea>
      </td>
      <td>
        <input type="number" step="any" class="plain-input text-end" data-path="items.${index}.qty" value="${item.qty}">
      </td>
      <td>
        <input type="text" class="plain-input text-center" data-path="items.${index}.unit" value="${item.unit || ''}">
      </td>
      <td>
        <input type="number" step="0.01" class="plain-input text-end" data-path="items.${index}.rate" value="${item.rate}">
      </td>
      <td class="text-end amount-cell" id="amt-${index}">${formatMoney(amount)}</td>
      <td class="text-center no-export no-print">
        <button type="button" class="btn btn-sm btn-outline-danger btn-del-row" title="Remove item">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    </tr>`;
}

function renderItems() {
  const rowsHtml = [insertGapRowTemplate(0)];
  state.items.forEach((item, index) => {
    rowsHtml.push(itemRowTemplate(item, index));
    rowsHtml.push(insertGapRowTemplate(index + 1));
  });
  itemsBody.innerHTML = rowsHtml.join('');
  autoGrowAll();
}

function insertItemAt(index) {
  state.items.splice(index, 0, defaultItem());
}

function computeTotals() {
  const subtotal = state.items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const taxPercent = Number(state.taxPercent) || 0;
  const taxAmount = subtotal * (taxPercent / 100);
  const total = subtotal + taxAmount;
  return { subtotal, taxAmount, total };
}

function renderTotals() {
  const { subtotal, taxAmount, total } = computeTotals();
  subtotalEl.textContent = formatMoney(subtotal);
  taxAmountEl.textContent = formatMoney(taxAmount);
  totalEl.textContent = formatMoney(total);
  totalWordsEl.textContent = numberToWords(total);
}

function updateRowAmount(index) {
  const item = state.items[index];
  if (!item) return;
  const amount = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  const cell = document.getElementById(`amt-${index}`);
  if (cell) cell.textContent = formatMoney(amount);
}

function renderAll() {
  renderFieldsFromState();
  renderItems();
  renderTotals();
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
function autoGrowAll() {
  sheet.querySelectorAll('textarea').forEach(autoGrow);
}

// --- Autosave ---------------------------------------------------------------
let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => Storage.saveDraft(state), 400);
}

// --- Event wiring: generic field binding ------------------------------------
sheet.addEventListener('input', (e) => {
  const el = e.target;
  const path = el.dataset.path;
  if (!path) return;

  const lastKey = path.split('.').pop();
  const isNumeric = lastKey === 'qty' || lastKey === 'rate' || lastKey === 'taxPercent';
  const value = isNumeric ? (parseFloat(el.value) || 0) : el.value;

  setPath(state, path, value);

  if (el.tagName === 'TEXTAREA') autoGrow(el);

  if (path.startsWith('items.')) {
    const idx = Number(path.split('.')[1]);
    updateRowAmount(idx);
    renderTotals();
  } else if (lastKey === 'taxPercent') {
    renderTotals();
  }
  scheduleAutosave();
});

itemsBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-del-row');
  if (!btn) return;
  const row = btn.closest('tr');
  const index = Number(row.dataset.index);
  state.items.splice(index, 1);
  if (state.items.length === 0) state.items.push(defaultItem());
  renderItems();
  renderTotals();
  scheduleAutosave();
});

itemsBody.addEventListener('click', (e) => {
  const insertBtn = e.target.closest('.insert-gap-btn');
  if (!insertBtn) return;
  const insertAt = Number(insertBtn.closest('.insert-gap-row').dataset.insertAt);
  insertItemAt(insertAt);
  renderItems();
  renderTotals();
  scheduleAutosave();
  const newRow = itemsBody.querySelector(`tr[data-index="${insertAt}"]`);
  if (newRow) newRow.querySelector('.item-desc').focus();
});

// --- Reordering items by drag-and-drop ---------------------------------------
// The whole <tr> is the thing that gets dragged (so drop-target detection and
// the drag ghost cover the full row), but it only becomes `draggable` while
// the grip handle is held - otherwise dragging text inside a description
// textarea, or a click-drag anywhere else in the row, would start a row drag
// by accident. `mouseup` (a plain click, no drag) resets it back off; a real
// drag's own `dragend` also resets it, so this is just a harmless no-op then.
itemsBody.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  handle.closest('tr').draggable = true;
});

itemsBody.addEventListener('mouseup', () => {
  itemsBody.querySelectorAll('tr[draggable="true"]').forEach((row) => {
    row.draggable = false;
  });
});

itemsBody.addEventListener('dragstart', (e) => {
  const row = e.target.closest('tr');
  if (!row || !row.draggable) return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', row.dataset.index);
  row.classList.add('dragging');
});

function clearDropTargetMarkers() {
  itemsBody.querySelectorAll('.drop-target-before, .drop-target-after').forEach((row) => {
    row.classList.remove('drop-target-before', 'drop-target-after');
  });
}

itemsBody.addEventListener('dragover', (e) => {
  // `tr[data-index]` (not just 'tr') so the thin insert-item gap rows -
  // which have no `data-index` - are never mistaken for a drop target.
  const row = e.target.closest('tr[data-index]');
  if (!row) return;
  e.preventDefault(); // required to allow this row to be a drop target
  e.dataTransfer.dropEffect = 'move';
  clearDropTargetMarkers();
  const rect = row.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  row.classList.add(before ? 'drop-target-before' : 'drop-target-after');
});

itemsBody.addEventListener('drop', (e) => {
  const targetRow = e.target.closest('tr[data-index]');
  if (!targetRow) return;
  e.preventDefault();
  clearDropTargetMarkers();

  const fromIndex = Number(e.dataTransfer.getData('text/plain'));
  const targetIndex = Number(targetRow.dataset.index);
  const rect = targetRow.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;

  // `insertAt` is expressed in the array as it stands right now (before the
  // dragged item is removed); removing an earlier item shifts every later
  // index down by one, so that has to be corrected for before re-inserting.
  let insertAt = before ? targetIndex : targetIndex + 1;
  if (fromIndex < insertAt) insertAt -= 1;

  if (insertAt !== fromIndex) {
    const [moved] = state.items.splice(fromIndex, 1);
    state.items.splice(insertAt, 0, moved);
    renderItems();
    renderTotals();
    scheduleAutosave();
  }
});

itemsBody.addEventListener('dragend', (e) => {
  const row = e.target.closest('tr');
  if (row) row.draggable = false;
  itemsBody.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  clearDropTargetMarkers();
});

document.getElementById('btn-add-item').addEventListener('click', () => {
  state.items.push(defaultItem());
  renderItems();
  scheduleAutosave();
  // `tr[data-index]` (not just 'tr') to skip past the trailing insert-gap
  // row that now follows the last real item row.
  const itemRows = itemsBody.querySelectorAll('tr[data-index]');
  const lastRow = itemRows[itemRows.length - 1];
  lastRow.querySelector('.item-desc').focus();
});

// --- Toolbar actions ---------------------------------------------------------
document.getElementById('btn-new').addEventListener('click', () => {
  if (!confirm('Start a new blank invoice? Unsaved changes to the current draft will be lost.')) return;
  state = defaultInvoice();
  renderAll();
  Storage.saveDraft(state);
  showToast('New invoice started');
});

document.getElementById('btn-save').addEventListener('click', () => {
  Storage.saveInvoice(state);
  Storage.saveDraft(state);
  showToast(`Saved "${state.invoiceNumber || 'Invoice'}"`);
});

document.getElementById('btn-print').addEventListener('click', () => {
  window.print();
});

document.getElementById('btn-export-pdf').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await exportInvoiceToPdf(sheet, state);
  } catch (err) {
    console.error(err);
    showToast('PDF export failed. See console for details.');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-export-excel').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await exportInvoiceToExcel(state);
  } catch (err) {
    console.error(err);
    showToast('Excel export failed. See console for details.');
  } finally {
    btn.disabled = false;
  }
});

// --- Saved invoices modal -----------------------------------------------------
const invoicesModalEl = document.getElementById('modal-invoices');
invoicesModalEl.addEventListener('show.bs.modal', () => {
  const list = document.getElementById('invoices-list');
  const invoices = Storage.getInvoices();
  if (invoices.length === 0) {
    list.innerHTML = '<p class="text-muted mb-0">No saved invoices yet. Use "Save" to add one.</p>';
    return;
  }
  list.innerHTML = invoices.map((inv) => {
    const { total } = (function () {
      const subtotal = inv.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
      const tax = subtotal * ((Number(inv.taxPercent) || 0) / 100);
      return { total: subtotal + tax };
    })();
    return `
      <div class="list-row" data-id="${inv.id}">
        <div class="list-row-info">
          <strong>${inv.invoiceNumber || 'Untitled'}</strong>
          <span class="text-muted"> — ${inv.seller?.name || ''}</span>
          <div class="text-muted small">${inv.invoiceDate || ''} &middot; ₹${formatMoney(total)}</div>
        </div>
        <div class="list-row-actions">
          <button class="btn btn-sm btn-primary btn-load-invoice">Load</button>
          <button class="btn btn-sm btn-outline-danger btn-delete-invoice"><i class="bi bi-trash3"></i></button>
        </div>
      </div>`;
  }).join('');
});

document.getElementById('invoices-list').addEventListener('click', (e) => {
  const row = e.target.closest('.list-row');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('.btn-load-invoice')) {
    const invoice = Storage.getInvoices().find((i) => i.id === id);
    if (invoice) {
      state = JSON.parse(JSON.stringify(invoice));
      renderAll();
      scheduleAutosave();
      bootstrap.Modal.getInstance(invoicesModalEl).hide();
      showToast(`Loaded "${invoice.invoiceNumber}"`);
    }
  } else if (e.target.closest('.btn-delete-invoice')) {
    if (confirm('Delete this saved invoice? This cannot be undone.')) {
      Storage.deleteInvoice(id);
      row.remove();
    }
  }
});

// --- Company / seller profiles modal -------------------------------------------
const profilesModalEl = document.getElementById('modal-profiles');
function renderProfilesList() {
  const list = document.getElementById('profiles-list');
  const profiles = Storage.getProfiles();
  if (profiles.length === 0) {
    list.innerHTML = '<p class="text-muted mb-0">No saved companies yet.</p>';
    return;
  }
  list.innerHTML = profiles.map((p) => `
    <div class="list-row" data-id="${p.id}">
      <div class="list-row-info">
        <strong>${p.name}</strong>
        <div class="text-muted small">${p.seller.phone || ''} ${p.seller.email ? ' &middot; ' + p.seller.email : ''}</div>
      </div>
      <div class="list-row-actions">
        <button class="btn btn-sm btn-primary btn-load-profile">Use</button>
        <button class="btn btn-sm btn-outline-danger btn-delete-profile"><i class="bi bi-trash3"></i></button>
      </div>
    </div>`).join('');
}
profilesModalEl.addEventListener('show.bs.modal', renderProfilesList);

document.getElementById('btn-save-profile').addEventListener('click', () => {
  const input = document.getElementById('profile-name-input');
  const name = input.value.trim() || state.seller.name;
  Storage.saveProfile({
    id: generateId(),
    name,
    seller: { ...state.seller },
    bank: { ...state.bank },
  });
  input.value = '';
  renderProfilesList();
  showToast(`Saved company "${name}"`);
});

document.getElementById('profiles-list').addEventListener('click', (e) => {
  const row = e.target.closest('.list-row');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('.btn-load-profile')) {
    const profile = Storage.getProfiles().find((p) => p.id === id);
    if (profile) {
      state.seller = { ...profile.seller };
      state.bank = { ...profile.bank };
      renderFieldsFromState();
      autoGrowAll();
      scheduleAutosave();
      bootstrap.Modal.getInstance(profilesModalEl).hide();
      showToast(`Applied company "${profile.name}"`);
    }
  } else if (e.target.closest('.btn-delete-profile')) {
    if (confirm('Delete this saved company profile?')) {
      Storage.deleteProfile(id);
      row.remove();
    }
  }
});

// --- Bulk import (CSV/Excel) modal ---------------------------------------------
const importModalEl = document.getElementById('modal-import');
const importDropzone = document.getElementById('import-dropzone');
const importFileInput = document.getElementById('import-file-input');
const importErrorEl = document.getElementById('import-error');
const importProgressBar = document.getElementById('import-progress-bar');
const importProgressLabel = document.getElementById('import-progress-label');
const importSummaryEl = document.getElementById('import-summary');
const importConfirmBtn = document.getElementById('btn-import-confirm');

// Parsed items wait here, not in `state`, until the user confirms via the
// review step's "Import" button - Cancel (or closing the modal) just drops
// this and nothing about the invoice changes.
let pendingImportItems = null;

function setImportStep(step) {
  document.getElementById('import-step-choose').classList.toggle('d-none', step !== 'choose');
  document.getElementById('import-step-progress').classList.toggle('d-none', step !== 'progress');
  document.getElementById('import-step-review').classList.toggle('d-none', step !== 'review');
  document.getElementById('import-review-footer').classList.toggle('d-none', step !== 'review');
}

function resetImportModal() {
  pendingImportItems = null;
  importErrorEl.classList.add('d-none');
  importFileInput.value = '';
  setImportStep('choose');
}

function setImportProgress(fraction, label) {
  const pct = Math.round(fraction * 100);
  importProgressBar.style.width = `${pct}%`;
  importProgressBar.textContent = `${pct}%`;
  importProgressBar.setAttribute('aria-valuenow', String(pct));
  if (label) importProgressLabel.textContent = label;
}

// True when the invoice is still just the single blank row every new
// invoice starts with - used to default the append/replace choice below to
// "Replace" in that case, since there's nothing meaningful to append to.
function hasOnlyUntouchedDefaultItem() {
  const [only] = state.items;
  return state.items.length === 1
    && !only.description
    && Number(only.qty) === 1
    && (only.unit || 'Nos') === 'Nos'
    && Number(only.rate) === 0;
}

async function handleImportFile(file) {
  importErrorEl.classList.add('d-none');

  // Fail fast on the size/type checks before showing the progress step, so
  // an obviously-bad file doesn't flash a loader it'll never need.
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    importErrorEl.textContent = `File is too large (${(file.size / (1024 * 1024)).toFixed(2)} MB). The limit is 2 MB.`;
    importErrorEl.classList.remove('d-none');
    return;
  }
  if (!/\.(csv|xlsx)$/i.test(file.name)) {
    importErrorEl.textContent = 'Please choose a .csv or .xlsx file.';
    importErrorEl.classList.remove('d-none');
    return;
  }

  setImportStep('progress');
  setImportProgress(0, 'Reading file…');

  try {
    const result = await importItemsFromFile(file, { onProgress: setImportProgress });
    Storage.saveLastImportFile(file);
    pendingImportItems = result.items;

    const modeChoiceEl = document.getElementById('import-mode-choice');
    if (result.items.length === 0) {
      importSummaryEl.innerHTML = `
        <p class="mb-0">No valid items were found in <strong>${file.name}</strong>
        (${result.ignoredCount} row(s) ignored).</p>`;
      importConfirmBtn.disabled = true;
      modeChoiceEl.classList.add('d-none');
    } else {
      importSummaryEl.innerHTML = `
        <p class="mb-1"><strong>${result.items.length}</strong> item(s) ready to import from <strong>${file.name}</strong>.</p>
        ${result.ignoredCount > 0
          ? `<p class="text-muted small mb-0">${result.ignoredCount} row(s) were ignored (missing description, or a non-numeric Qty/Rate).</p>`
          : ''}`;
      importConfirmBtn.disabled = false;
      modeChoiceEl.classList.remove('d-none');
      // Default to "Replace" for a still-blank invoice (nothing meaningful
      // to append to), "Append" otherwise - either way, the user can switch
      // it before confirming.
      const defaultMode = hasOnlyUntouchedDefaultItem() ? 'replace' : 'append';
      document.getElementById(`import-mode-${defaultMode}`).checked = true;
    }
    setImportStep('review');
  } catch (err) {
    console.error(err);
    importErrorEl.textContent = err.message || 'Could not import that file.';
    importErrorEl.classList.remove('d-none');
    setImportStep('choose');
  }
}

importModalEl.addEventListener('show.bs.modal', resetImportModal);
importModalEl.addEventListener('hidden.bs.modal', () => {
  pendingImportItems = null;
});

document.getElementById('btn-import-browse').addEventListener('click', (e) => {
  e.stopPropagation(); // the dropzone itself is also click-to-browse; avoid opening the picker twice
  importFileInput.click();
});
importDropzone.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', () => {
  if (importFileInput.files[0]) handleImportFile(importFileInput.files[0]);
});

['dragenter', 'dragover'].forEach((evt) => {
  importDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    importDropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  importDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    importDropzone.classList.remove('dragover');
  });
});
importDropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleImportFile(file);
});

document.getElementById('btn-import-cancel-review').addEventListener('click', resetImportModal);

importConfirmBtn.addEventListener('click', () => {
  if (!pendingImportItems || pendingImportItems.length === 0) return;

  const modeInput = document.querySelector('input[name="import-mode"]:checked');
  const mode = modeInput ? modeInput.value : 'append';
  state.items = mode === 'replace' ? pendingImportItems : state.items.concat(pendingImportItems);

  renderItems();
  renderTotals();
  scheduleAutosave();
  showToast(`${pendingImportItems.length} item(s) imported`);
  pendingImportItems = null;
  bootstrap.Modal.getInstance(importModalEl).hide();
});

// --- Init ---------------------------------------------------------------------
renderAll();
