/* localStorage-backed persistence for the current draft, saved invoices
   and reusable seller/company profiles. */

const STORAGE_KEYS = {
  DRAFT: 'invoiceApp.draft',
  INVOICES: 'invoiceApp.invoices',
  PROFILES: 'invoiceApp.profiles',
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Failed to read', key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const Storage = {
  saveDraft(state) {
    writeJSON(STORAGE_KEYS.DRAFT, state);
  },
  loadDraft() {
    return readJSON(STORAGE_KEYS.DRAFT, null);
  },

  getInvoices() {
    return readJSON(STORAGE_KEYS.INVOICES, []);
  },
  saveInvoice(invoice) {
    const invoices = Storage.getInvoices();
    const idx = invoices.findIndex((i) => i.id === invoice.id);
    const toSave = { ...invoice, updatedAt: Date.now() };
    if (idx >= 0) invoices[idx] = toSave;
    else invoices.unshift(toSave);
    writeJSON(STORAGE_KEYS.INVOICES, invoices);
    return toSave;
  },
  deleteInvoice(id) {
    const invoices = Storage.getInvoices().filter((i) => i.id !== id);
    writeJSON(STORAGE_KEYS.INVOICES, invoices);
  },

  getProfiles() {
    return readJSON(STORAGE_KEYS.PROFILES, []);
  },
  saveProfile(profile) {
    const profiles = Storage.getProfiles();
    const idx = profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) profiles[idx] = profile;
    else profiles.unshift(profile);
    writeJSON(STORAGE_KEYS.PROFILES, profiles);
    return profile;
  },
  deleteProfile(id) {
    const profiles = Storage.getProfiles().filter((p) => p.id !== id);
    writeJSON(STORAGE_KEYS.PROFILES, profiles);
  },
};
