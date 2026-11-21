# Spec: PLS-TO Records System

## Goal
An Electron desktop app on one PC (React + Tailwind, Node, local MySQL) where HR staff log in, encode Personnel Locator Slip (PLS) and Travel Order (TO) records for the Mayor's Office and the Sangguniang Bayan (SB) with auto-numbers that reset monthly, print them as filled .xlsx forms or numbered blank forms, and see who is out today and per-office reports.

## Assumptions
- One PC runs the app and MySQL locally (WAMP, MySQL 5.7). No network access needed.
- Database connection defaults to localhost, user `root`, empty password, database `pls_to`. A `.env` file in the app's data folder overrides them per installed device.
- Users are HR/records staff only. Roles: **admin** and **encoder**. Employees never log in.
- Admin-only: manage user accounts. Everything else is open to both roles.
- The first run creates one admin account. The admin must change its password at first login.
- Two form types: PLS and TO. Two issuing offices: Mayor's Office and SB.
- Four independent counters: Mayor PLS, Mayor TO, SB PLS, SB TO.
- Number format: `YYYY-MM-N` for the Mayor's Office (`2026-01-1`), `SB YYYY-MM-N` for SB (`SB 2026-01-1`). N resets to 1 on the first record of each month. The month is the month the record is created, not the travel date.
- Print layouts come from `examples/actual_files/` (`NEW PLS.xlsx`, `NEW TO.xlsx`, `NEW PLS SB.xlsx`, `NEW TO SB.xlsx`): A4 portrait, logo header, up to 5 name rows, recommending and approving signatory blocks.
- Mayor's Office forms: recommending = Department Head, approving = Municipal Mayor (or OIC/Acting). SB forms: recommending = SB Secretary, approving = Municipal Vice Mayor (or OIC/Acting).
- Signatories change often (OIC, Acting). Staff can set an office default and override it per record.
- Records are never permanently deleted. Archive only. Exception: unused Blank issued forms of a past month can be deleted (US-18, user decision 2026-11-21).

## User Stories

### US-1: Log in and log out
**As** HR staff, **I want** to log in with username and password, **so that** only staff can access records.

**Accepts when:**
- [ ] Valid username and password opens the dashboard.
- [ ] Logout ends the session. Every page after logout redirects to login.
- [ ] Passwords are stored hashed.
- [ ] First run creates an admin account that must set a new password at first login.

**Rejects when:**
- [ ] Wrong username or password shows "Invalid username or password" and does not say which one is wrong.
- [ ] A disabled account cannot log in.
- [ ] A page cannot be opened without a session.

### US-2: Manage user accounts (admin)
**As** an admin, **I want** to add encoders, reset passwords, and disable accounts, **so that** I control who has access.

**Accepts when:**
- [ ] Admin adds a user with username, full name, role, and initial password.
- [ ] Admin resets a user's password.
- [ ] Admin disables and re-enables a user after a confirmation that names the user.

**Rejects when:**
- [ ] An encoder cannot open the user management page or call its API.
- [ ] A duplicate username is rejected with a message.
- [ ] An admin cannot disable their own account or the last active admin.

### US-3: Manage offices and employees
Changed 2026-11-20: added restore from archive, office archive blocked while it has active employees, fixed employment status list (user decisions before Phase 0 plan).

**As** HR staff, **I want** a master list of offices and employees (name, designation, employment status, office), **so that** encoders pick names instead of typing them and office reports stay accurate.

**Accepts when:**
- [ ] Staff add, edit, and archive offices.
- [ ] Staff add, edit, and archive employees.
- [ ] Archived employees and offices disappear from pick lists but remain on old records.
- [ ] The list searches by name and filters by office.
- [ ] Employment status is one of: Permanent, Casual, Coterminous, Contractual, Job Order.
- [ ] An "Archived" filter lists archived offices and employees. Restore returns them to pick lists.

**Rejects when:**
- [ ] An employee without a name or office is rejected with a field message.
- [ ] An office with active employees cannot be archived. The message says "Move or archive its N employees first."
- [ ] A duplicate employee (same name in the same office) is rejected.
- [ ] Archiving needs a confirmation that names the item. Cancel changes nothing.

### US-4: Manage signatories
Changed 2026-11-21: restore from archive, archive blocked while a signatory is an office default (user decisions before Phase 1 plan).

**As** HR staff, **I want** to keep a list of signatories (name and title, e.g. "VINCENT E. HERMOSO, OIC - MUNICIPAL MAYOR") and set each office's default, **so that** forms print the correct signer even when OIC or Acting officials change.

**Accepts when:**
- [ ] Staff add, edit, and archive signatories with name, title, and role (Recommending or Approving).
- [ ] Staff set the default recommending and approving signatory for the Mayor's Office and for SB.
- [ ] Changing a default affects only records created after the change.
- [ ] A record keeps the signatory name and title it was saved with, even after the signatory is edited or archived.
- [ ] An "Archived" filter lists archived signatories. Restore returns them to pick lists.

**Rejects when:**
- [ ] A signatory without a name or title is rejected.
- [ ] An archived signatory cannot be picked on new records.
- [ ] A signatory that is an office default cannot be archived. The message says "It is the default for <office>. Choose another default first."
- [ ] Archiving needs a confirmation that names the signatory. Cancel changes nothing.

### US-5: Create a PLS or TO record
Changed 2026-11-21: paper first. A record is created only by issuing a blank form (US-7, US-16) and encoding the returned paper (US-17); there is no direct input. These rules apply when encoding; the number and signatories are set when the blank is issued (user decision before Phase 9).
Changed 2026-11-21: required fields, optional vehicle and return, editable filed date, employee details kept as saved, overlap warning (user decisions before Phase 1 plan).
Changed 2026-11-21: purpose limited to 360 characters so it fits the 4 printed lines (user decision before Phase 2 plan).

**As** HR staff, **I want** to choose PLS or TO and the issuing office, then fill in the details, **so that** the record gets the next number automatically.

**Accepts when:**
- [ ] The form asks for: form type, issuing office, date, 1 to 5 employees (from the master list), destination, vehicle, inclusive dates, departure date and time, return date and time, purpose, recommending signatory, approving signatory.
- [ ] Signatories pre-fill with the office default and can be changed.
- [ ] Saving assigns the next number for that form type, office, and month (e.g. `2026-11-1`, then `2026-11-2`, and `SB 2026-11-1` separately).
- [ ] The first record of a new month starts at 1.
- [ ] Save shows a loading state, then a success message with the number.
- [ ] Required: form type, issuing office, date filed, 1 to 5 employees, destination, inclusive dates, departure date and time, purpose, both signatories. Vehicle and return are optional.
- [ ] Date filed pre-fills with today and can be changed. The number's month is still the month the record is created.
- [ ] A record keeps each employee's name, designation, and employment status as they were when saved.
- [ ] When an employee is already on another active PLS or TO whose inclusive dates overlap, Save shows a warning naming the employee, the other record's number, and its dates (e.g. "Ana Cruz already has TO 2026-11-3 on 2026-11-20 to 2026-11-22"). Nothing is saved until staff click "Save anyway". Cancel keeps the form as it was.

**Rejects when:**
- [ ] A 6th employee cannot be added.
- [ ] Missing required fields show a message next to each field.
- [ ] Return before departure is rejected.
- [ ] Inclusive end date before start date is rejected.
- [ ] An archived employee or signatory cannot be picked.
- [ ] Clicking Save twice creates one record with one number.
- [ ] Two numbers are never the same for one counter, even after a restore (US-14).
- [ ] A purpose longer than 360 characters is rejected with "At most 360 characters".
- [ ] No record can be created without first issuing a blank form: the app has no "type a whole application and Save" form and refuses direct-create requests.

### US-6: Print a filled form as .xlsx
Changed 2026-11-21: Print opens the preview (US-15) before the save dialog (user request after Phase 2).
Changed 2026-11-21: date and time formats, Mayor's TO prints the recommending signatory, where Print is offered, empty optional fields stay as blank lines (user decisions before Phase 2 plan).

**As** HR staff, **I want** to print a record on the official PLS or TO layout, **so that** it can be signed on paper.

**Accepts when:**
- [ ] Print generates an .xlsx matching the issuing office's and form type's template: logo, A4 portrait, the record's number, date, names with designation and employment status, destination, vehicle, dates, times, purpose, and both signatory names and titles.
- [ ] The file opens in Excel and prints on one A4 page.
- [ ] Staff choose where to save it. The app offers to open it after saving.
- [ ] Dates print as "November 20, 2026". Inclusive dates print as one range ("November 20-22, 2026", "November 30 - December 2, 2026"). Times print as "8:00 AM".
- [ ] Every form prints both signatories' names and titles, including the Mayor's Office Travel Order, which uses the same layout as the SB forms (name, then title below).
- [ ] An empty vehicle or return keeps the form's blank line for handwriting.
- [ ] Print is offered right after a record is saved and for each blank form (US-7).
- [ ] Print opens the preview first (US-15). The save dialog appears only after "Save as Excel".

**Rejects when:**
- [ ] An archived record cannot be printed until it is restored.
- [ ] A failed save (e.g. file open in Excel) shows an error and does not change the record.

### US-7: Issue a numbered blank form
Changed 2026-11-21: when filling a Mayor's Office blank, the Department Head starts as the Mayor's Office recommending default (US-4) and staff change it to the head who signed (user decision during Phase 9 review).
Changed 2026-11-21: a Mayor's Office blank leaves the Department Head line empty; it is picked when filling in (user decision before Phase 8, blanks are taken at random by any department).
Changed 2026-11-21: after issuing, the preview (US-15) opens before the save dialog (user request after Phase 2).
Changed 2026-11-21: confirmation before issuing, blank-forms list, signatories fixed when filling (user decisions before Phase 2 plan).

**As** HR staff, **I want** to print a blank form that already has a number, **so that** an employee can fill it by hand while the number stays reserved.

**Accepts when:**
- [ ] Staff choose form type and issuing office, then "Issue blank".
- [ ] It takes the next number from the same counter as US-5 and saves a record with status **Blank issued**.
- [ ] The printed .xlsx has the number and signatories filled and all other fields blank. On a Mayor's Office blank the recommending signatory is left empty as on the official paper: the PLS keeps its empty line with "DEPARTMENT HEAD" under it, the Travel Order keeps its empty space.
- [ ] Staff later open the Blank issued record, fill the details, and save. The number does not change and the status becomes **Filled**.
- [ ] "Issue blank" asks for confirmation naming the form type and office and that it reserves the next number. Cancel reserves nothing.
- [ ] The New record page lists Blank issued records with "Fill in" and "Print again".
- [ ] Filling in uses the same rules as US-5 (required fields, 1 to 5 employees, purpose limit, overlap warning).

**Rejects when:**
- [ ] When filling in, form type, issuing office, number, and the printed signatories cannot be changed. A Mayor's Office blank requires the active Department Head who signed (recommending role), pre-filled with the Mayor's Office recommending default and changeable; Approved by stays as printed.
- [ ] A Blank issued record does not appear in "who is out today" or office reports until it is filled.

### US-8: Edit a record
Changed 2026-11-21: people already on a record stay valid when edited, overlap warning applies, blank forms are filled not edited (user decisions before Phase 3 plan).

**As** HR staff, **I want** to fix a record's details, **so that** mistakes can be corrected.

**Accepts when:**
- [ ] Every field from US-5 can be edited except number, form type, and issuing office.
- [ ] Save shows success and the new values appear in the list and on the next print.
- [ ] Employees and signatories already on the record stay valid and keep their saved details even if archived since. Newly added ones must be active and are saved with their current details.
- [ ] The US-5 overlap warning applies, ignoring the record being edited.
- [ ] A Blank issued record is completed with "Fill in" (US-7), not Edit.

**Rejects when:**
- [ ] The same validation as US-5 applies.
- [ ] Number, form type, and issuing office cannot be changed.

### US-9: Archive and restore a record
Changed 2026-11-21: Blank issued forms can be archived too (user decision before Phase 3 plan).
Changed 2026-11-21: Restore warns on overlap (user decision in Phase 3 review).
Changed 2026-11-21: unused blanks of a past month can be deleted (US-18, user decision before Phase 8).

**As** HR staff, **I want** to archive a wrong or cancelled record, **so that** it leaves the active list without losing its number.

**Accepts when:**
- [ ] Archive asks for confirmation naming the record number. Cancel changes nothing.
- [ ] An archived record is hidden from the default list, reports, and "out today".
- [ ] The "Archived" filter shows archived records. Restore returns a record to the active list.
- [ ] Restoring a filled record lists overlapping active records for its employees (US-5 warning) with "Restore anyway" or Cancel. Cancel keeps it archived. A Blank issued record restores with no check.
- [ ] A Blank issued form can be archived (lost or spoiled paper). Its number stays reserved.

**Rejects when:**
- [ ] An archived record's number is never reused.
- [ ] No permanent delete exists, except unused Blank issued forms of a past month (US-18).

### US-10: Browse, search, and filter records
Changed 2026-11-21: the date range filter matches travel (inclusive) dates; reprint from the record (user decision before Phase 3 plan).

**As** HR staff, **I want** to find records quickly, **so that** I can view, edit, or reprint them.

**Accepts when:**
- [ ] The list shows number, form type, issuing office, names, destination, and inclusive dates, newest first.
- [ ] Search matches number, employee name, destination, or purpose.
- [ ] Filters: form type, issuing office, employee office, date range, status (Filled, Blank issued, Archived).
- [ ] Opening a record shows all its details, with Edit, Print, and Archive or Restore.
- [ ] The date range filter shows records whose inclusive dates overlap the range.

**Rejects when:**
- [ ] A search with no results shows "No records found", not an empty table.

### US-11: See who is out today
**As** HR staff, **I want** to see which employees are out on a PLS or TO today, **so that** I can answer "where is this person?".

**Accepts when:**
- [ ] The dashboard lists every employee on an active Filled record whose inclusive dates include today, with office, form type, number, destination, and return time.
- [ ] Staff can pick another date instead of today.
- [ ] The list groups or filters by office.

**Rejects when:**
- [ ] Archived and Blank issued records do not appear.

### US-12: Per-office report and Excel export
**As** HR staff, **I want** a report of PLS and TO records per office for a date range, **so that** I can monitor who applied.

**Accepts when:**
- [ ] Filters: office, form type, date range.
- [ ] The report shows each employee's records and a count per office and form type.
- [ ] Export saves the same rows as an .xlsx.

**Rejects when:**
- [ ] Archived and Blank issued records are excluded.
- [ ] A date range with end before start is rejected.

### US-13: Back up the database
**As** HR staff, **I want** to save a .sql backup to a folder or USB, **so that** records survive a PC failure.

**Accepts when:**
- [ ] Backup writes a .sql file named with date and time (e.g. `pls-to-backup-2026-11-20-1430.sql`) to the chosen folder.
- [ ] It shows success with the file path, or the error if it fails.

**Rejects when:**
- [ ] A failed backup leaves no partial file that looks valid.

### US-14: Restore from a backup
**As** HR staff, **I want** to restore a .sql backup, **so that** I can recover records after a failure.

**Accepts when:**
- [ ] Restore asks for confirmation naming the file and stating that all current data will be replaced. Cancel changes nothing.
- [ ] Before restoring, the app saves an automatic backup of the current data and shows its path.
- [ ] After restore, the user is logged out and must log in again.

**Rejects when:**
- [ ] A file that is not a valid backup of this app is rejected and current data is unchanged.

### US-15: Preview a form before saving it
**As** HR staff, **I want** to see the filled PLS or TO form on screen before saving it, **so that** I can check names, designations, dates, and signatories before it is printed.

**Accepts when:**
- [ ] Print, Print again, and Issue blank (after its confirmation) open an on-screen preview of the form, drawn from the same template as the .xlsx: logo, lines, fonts, and every filled cell.
- [ ] The preview shows the same values the .xlsx will contain: number, date, names, designations, employment status, destination, dates, times, purpose, and both signatories.
- [ ] "Save as Excel" continues to the save dialog and the US-6 flow. "Close" or Escape returns with nothing saved.
- [ ] The preview shows "Preparing preview…" while it loads, and an error message if it fails.

**Rejects when:**
- [ ] An archived record cannot be previewed ("Restore this record before printing.").
- [ ] An unsaved form cannot be previewed, because its number does not exist yet.
- [ ] Closing the preview writes no file.
- [ ] Text typed into a record shows as plain text in the preview and never runs as page code.

### US-16: Print a stack of blank forms
**As** HR staff, **I want** to print many numbered blank forms in one step, **so that** I can leave a stack on the desk for any employee to take.

**Accepts when:**
- [ ] Staff choose the stack (Mayor's Office or Sangguniang Bayan) and how many (1 to 50). The employee's office is not chosen, because any employee can take a form.
- [ ] Signatories pre-fill from the office defaults (US-4) and staff can change them (OIC, Acting). Mayor's Office stack: Approved by only; the Department Head line is printed empty. SB stack: Recommending approval and Approved by.
- [ ] Before anything is reserved, a confirmation names the form type, stack, count, the expected number range, and the chosen signatories. Cancel reserves nothing.
- [ ] Confirming reserves consecutive numbers from the US-5 counter and saves one Blank issued record per number. The success message shows the real range issued.
- [ ] The preview (US-15) shows the first form and how many the file holds. "Save as Excel" saves one .xlsx with one page per form, each on the official A4 layout.

**Rejects when:**
- [ ] A count below 1 or above 50 is refused with a message, and nothing is reserved.
- [ ] A stack is not issued without its required signatories, and an archived signatory cannot be chosen.
- [ ] Two stacks, or a stack and a new record, never get the same number.

### US-17: Encode a returned form by its number
**As** HR staff, **I want** to type the number printed on a returned form, **so that** I open the right blank and link it to the employee who used it.

**Accepts when:**
- [ ] The New record page has a "Number on the returned form" box. A Blank issued number opens Fill in (US-7) for that blank.
- [ ] Filling in links the number to the employees chosen there, with their current office, designation, and status saved on the record.
- [ ] The "Blank forms to fill" list stays available.

**Rejects when:**
- [ ] An unknown number shows "No blank form has this number. Check the number on the paper."
- [ ] A number already filled shows "<number> is already encoded." with a link to open it.
- [ ] An archived blank shows "<number> was voided."
- [ ] Extra spaces around the typed number are ignored.

### US-18: Delete unused blanks of a past month
**As** HR staff, **I want** to delete the blank forms nobody used once their month is over, **so that** unused forms are not stored.

**Accepts when:**
- [ ] "Blank forms to fill" shows, for each past month that still has unused blanks, "Delete <n> unused blanks of <Month YYYY>".
- [ ] A confirmation names the month, the count, and that it cannot be undone. Cancel deletes nothing.
- [ ] Confirming permanently deletes those Blank issued records (active or archived) and shows "Deleted <n> unused blanks of <Month YYYY>".

**Rejects when:**
- [ ] Blanks of the current month cannot be deleted, so a deleted number can never be issued again.
- [ ] Filled records, and blanks filled in the meantime, are never deleted.

## Critical workflows
- CW-1: Issue and print a record: US-1 → US-3 → US-4 → US-16 → US-17 → US-6 (changed 2026-11-21: paper first, the record is encoded from a returned blank)
- CW-2: Blank form lifecycle: US-1 → US-7 → US-8 → US-11
- CW-3: Recover data: US-13 → US-14 → US-1 → US-10
- CW-4: Blank stack lifecycle: US-16 → US-17 → US-11 → US-18

## Out of Scope
- Multi-PC or LAN access: single PC was chosen.
- Web/browser version: Electron only.
- Employees filing their own requests: staff encode everything.
- Approval workflow (Draft/Approved/Returned): signing happens on paper.
- Permanent delete: archive only.
- More than 5 names per slip: staff create a second slip.
- Import from the HRMO Excel file: the master list is maintained in the app.
- PDF output: .xlsx only.

## Open Questions
- None.
