# Roadmap

## Part one — Encode and print PLS and TO forms

### Phase 0 — Login and employee master list NEXT

Proves the stack end to end (Electron, React + Tailwind, Node, local MySQL) with the smallest real outcome. Every later story needs a logged-in user and employees to pick.
Covers US-1, US-3.

- Staff log in and log out. First run creates the admin and forces a password change.
- Staff add, edit, archive, and search offices and employees.

**Done when:** in the packaged Electron app, the seeded admin changes the password, logs in, adds an office and an employee, archives the employee, and logs out. Pages refuse access after logout. Every US-1 and US-3 condition passes in E2E.

Deliberately not built, and why: user management, because Phase 6 owns US-2. Records and numbering, because Phase 1 owns US-5.

### Phase 1 — Signatories and record creation with auto-numbering LATER

A record needs signatories and employees, and the numbering rule is the core business rule.
Covers US-4, US-5.

- Staff maintain signatories and office defaults.
- Staff create PLS and TO records for both offices with numbers from 4 monthly counters.

**Done when:** records created in two different months and for all 4 counters get the right numbers (`2026-11-1`, `SB 2026-11-1`, reset on a new month). A double-click on Save creates one record.

Deliberately not built, and why: printing, because Phase 2 owns US-6. Record list and edit, because Phase 3 owns US-8 and US-10.

### Phase 2 — Print filled and blank forms LATER

Covers US-6, US-7.

- Filled .xlsx on the official layout for all 4 templates.
- Numbered blank form that reserves a number and is filled later.

### Phase 3 — Browse, edit, archive LATER

Covers US-8, US-9, US-10.

- Search and filter records, edit details, archive and restore.

## Part two — Monitoring and data safety

### Phase 4 — Out today and per-office reports LATER

Covers US-11, US-12.

- Dashboard of employees out on a date, per-office report with .xlsx export.

### Phase 5 — Backup and restore LATER

Covers US-13, US-14.

- .sql backup to a chosen folder, restore with automatic pre-restore backup.

### Phase 6 — User account management LATER

Covers US-2.

- Admin adds encoders, resets passwords, disables accounts.
