---
EH form: false
---

# Medical Dashboard review — 2026-10-26

Five fictional source notes are dated October 20, 21, 22, 24, and 25. Each contains one Daily Form and one Medical Form, so importing all five notes yields five Daily medical logs and five Medical reports. The October 24 report also includes a repeated result dated October 23. These are deliberately unimported source notes, not personal health history.

## Before importing

1. Reload Examined Human in Wax Vault so the review build is running.
2. Prefer a new disposable database such as `EH-medical-dashboard-review.db` in Settings → Examined Human → General. Remember your original path so you can switch back. New databases already include the medical tables. For an older database, use **Settings → Examined Human → General → Tools and maintenance → Medical database migration**. Migration is not a command-palette action.
3. Use **Manage health catalogs** to define the records below. They match the earlier example vocabulary; do not create duplicates if those exact canonical records already exist. Leave aliases blank. Only numeric measurements and medication need units.

| Catalog | Canonical name | Unit | Measurement value type |
| --- | --- | --- | --- |
| People | EH example person | — | — |
| Measurements | EH example glucose | mg/dL | number |
| Measurements | EH example urine result | — | qualitative |
| Measurements | EH example imaging impression | — | text |
| Procedures | EH example imaging | — | — |
| Medications | EH example 10 mg tablet | tablet | — |
| Symptoms | EH example headache | — | — |

## Import and browse

1. Start with `2026-10-20.md`. Use **Import Daily Form from Active File**. Its two Admin Events create the fictional engagement and cash account used by the other notes. Review the source and confirmation before importing.
2. In that same note run **Import or reimport Medical Form from Active File**. This is a separate import. Repeat both imports for October 21, 22, 24, and 25.
3. Open **Medical Dashboard**. The imported-record list belongs on the right. Select a report and check that its table stays in the original row order; select a Daily medical log to see Medication and Symptoms. This build does not group measurements into laboratory categories.
4. Open **Daily Assessment** and select the same dates. Check the Medical entries and their states, as well as the fictional transaction and valuation data from the nested Financial section.
5. October 20 and 22 contain medication and symptoms. October 21 explicitly records `none` in both sections. October 24 leaves Medication blank, while October 25 leaves Symptoms blank. A blank must display as unrecorded, distinct from `none`.
6. Medical reimport should replace only the selected report after acknowledgement. For Daily reimport of October 20, first remove its two already-executed Admin Events, leaving that section empty; the canonical engagement and account remain.

Leave automatic Daily Form cleanup disabled for review so the paired source notes stay readable. The plugin, source notes, and sample data are staged for owner review. No version bump, commit, tag, push, or public release has been performed.
