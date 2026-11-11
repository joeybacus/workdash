# WorkDash · Neuro OPD

The online version of the Neuro OPD clinic program: one paste from WebHOMIS builds the
logsheet row, plans and decks the follow-up Tuesday, prints the Lab request, Rx + Med Cert
and S2 Rx, and keeps the logsheet in two-way sync with the OPD Google Sheet: each clinic's block in
OPD Patients is found by its DATE row (wherever it has moved), what's typed there shows up in
WorkDash, and edits in WorkDash are written back - only the cells that changed.

**This repository holds only the program.** There is no patient data and no key in it.
Patient data stays in the owner's Google Sheet; each computer connects once with the
Apps Script Web App address and key, which are kept only in that browser.

- `index.html`, `style.css`, `app.js` - the page
- `core.js` - WebHOMIS parsing, dates, follow-up planning (same rules as `opd_core.py`)
- `forms.js` - the printed forms (same layouts as `opd_forms.py`)
- `demo.js` - made-up patients and schedule for trying it out without a Google Sheet
- `tests.html` - open it to run the checks in the browser
