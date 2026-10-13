# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

- 2026-10-13, planning: inspected the scaffold and profiled the fixed seed: 500 people, 12 projects, 126,195 assignments spanning 2025-06-02 through 2027-01-03. Repeated-looking assignments have distinct IDs; all must contribute to totals.
- Proposed calculation rules (not implemented): Monday weeks, inclusive assignment dates, Mon–Fri workdays, and selected-range clipping with matching capacity proration. The schema has no capacity history, so a weekly-hours edit applies to past weeks too; make that scope visible.
- Independent seed checks under those rules: Ana has 40h/40h in the week starting 2025-12-29; Bo 32h/40h, Cem 4h/20h, Dee 45h/40h, and Eli 20h/0h in the week starting 2026-01-05. The week starting 2026-10-12 has no allocations; retain the scaffold's initial range for the demo.
- Proposed implementation: aggregate only overlapping assignments in SQL; use optional server roster pagination and bounded table rendering. Confirm saves before refreshing the active range, reject obsolete reads across navigation and saves, and distinguish a failed save from a successful save whose refresh failed.
- Verification priorities: hand-checked seed totals, partial/weekend/year boundaries, zero capacity, failed-save draft retention, late-response races, and short/two-year ranges in the browser. Docker is available, but services were not started during this planning-only pass; application code is unchanged.
