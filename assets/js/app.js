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

function itemRowTemplate(item, index) {
  const amount = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  return `
    <tr data-index="${index}">
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
      <td class="text-center no-export">
        <button type="button" class="btn btn-sm btn-outline-danger btn-del-row" title="Remove item">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    </tr>`;
}

function renderItems() {
  itemsBody.innerHTML = state.items.map(itemRowTemplate).join('');
  autoGrowAll();
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

document.getElementById('btn-add-item').addEventListener('click', () => {
  state.items.push(defaultItem());
  renderItems();
  scheduleAutosave();
  const rows = itemsBody.querySelectorAll('tr');
  const lastRow = rows[rows.length - 1];
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

// --- Init ---------------------------------------------------------------------
renderAll();
