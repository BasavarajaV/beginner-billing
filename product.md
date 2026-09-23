# Invoice Generator

A small, no-backend web app for creating, editing and exporting invoices —
built to replace filling out a spreadsheet by hand.

## The problem

Invoices were being put together by manually editing a reference Excel
spreadsheet for every new bill — copying it, retyping line items, redoing
the totals by hand, and hoping nothing was miscounted. That's slow, easy to
get wrong, and awkward to reuse across different companies or sellers.

This project turns that spreadsheet into an actual editable web page: add,
edit and reorder line items freely, and let the totals, tax and
amount-in-words calculate themselves. It's built so the same tool works for
any company's invoices, not just one hard-coded business.

## Features

- **A full, editable invoice layout** — seller details, invoice number and
  date, shipping/billing addresses, bank details and an authorized-signature
  block, all inline-editable on the page itself.
- **Line items that are easy to manage**:
  - add, edit or delete a row
  - drag a row (via its grip handle) to reorder it
  - insert a new row at an exact position with a small "+" that appears
    between any two existing rows
  - bulk-import items from a CSV or Excel file, with a preview step
    (append or replace) before anything is actually added
- **Automatic calculations** — subtotal, tax %, total, and the total spelled
  out in words (Indian numbering: Lakh/Crore).
- **Export**, matching a real printed invoice:
  - **PDF**, correctly paginated for long item lists, with the column
    header repeating on every page
  - **Excel (.xlsx)**, formatted with the same borders, merges and layout
    as the original spreadsheet
  - **Print**, straight from the browser
- **Save and reuse**:
  - the current invoice autosaves as a draft
  - explicitly save invoices into a reusable "Saved Invoices" list
  - save a seller + bank combination as a "Company" profile to reuse across
    invoices

## How to use it

Open `index.html` (or serve the folder), fill in the invoice details, and
add line items one at a time, by dragging to reorder, or by importing a
CSV/Excel file in bulk. When it's ready, use **Export PDF**, **Export
Excel**, or **Print**. Use **Save** to keep the invoice for later, and
**Companies** to reuse the same seller/bank details on the next one.

## Data storage

There's no server or database — everything runs in the browser. The current
draft, your saved invoices, and any saved company profiles are all kept in
the browser's `localStorage`, on that one device. That means:

- nothing you type is sent anywhere; it stays on your machine
- it isn't synced between browsers or devices
- clearing your browser's site data will clear it too, so exporting a PDF
  or Excel copy of anything important is worth doing

## Under the hood

Plain HTML, CSS and JavaScript — no framework, no build step, no
`package.json`. Styling is Bootstrap 5; PDF export uses `html2canvas` +
`jsPDF`, and Excel export uses `ExcelJS`, all loaded from a CDN. Opening
`index.html` directly (or serving the folder with any static file server)
is enough to run it.
