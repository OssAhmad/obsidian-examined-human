---
EH form: false
---

# Health import examples

These four forms contain fictional test data. They are for manual import in a disposable database, not personal health history. No sample has been imported automatically.

1. In Examined Human settings, create and select a new database such as `EH-medical-demo.db`. Keep a note of your original database path so you can switch back afterwards. A new database already has the health schema. For an existing official v1 database, use **Upgrade medical database** and review its backup confirmation.
2. Run **Manage health catalogs** and create these records. Leave aliases blank. The unit column is entered only for numeric measurements and medication. Select the listed value type for measurements.

| Catalog | Canonical name | Unit | Measurement value type |
| --- | --- | --- | --- |
| People | EH example person | — | — |
| Measurements | EH example glucose | mg/dL | number |
| Measurements | EH example urine result | — | qualitative |
| Measurements | EH example imaging impression | — | text |
| Procedures | EH example imaging | — | — |
| Medications | EH example 10 mg tablet | tablet | — |
| Symptoms | EH example headache | — | — |

3. Open `01 Lab.md` and `02 Imaging.md` individually and run **Import or reimport Medical Form from Active File**. Review their entries and confirm each import.
4. Open `2026-10-23.md` and `2026-10-24.md` individually and run **Import Daily Form from Active File**. Their dates are past dates as of 2026-10-25. Both forms have empty Admin Events, so they also work for later reimport.
5. Open **Imported forms and health records**. Expect four imported forms, two health days, one with entries and one with explicit `none`. Use the Medical report buttons to inspect its entries.
6. To test Medical reimport, edit a value in `01 Lab.md`, remove another measurement row, and invoke the same import command again. The confirmation must show the old row counts and require acknowledgement. After confirmation the selected report has the revised entries; the imaging report remains unchanged.
7. To test Daily reimport, change a recorded symptom note or change the Medication section to standalone `none`, then reimport that complete Daily Form. Review the deletion warning. Blank means unrecorded; `none` means an explicit absence.

Keep the original forms. Medical import retains source forms automatically. For this experiment leave automatic Daily cleanup disabled. Finish by restoring your original database path and using Refresh.
