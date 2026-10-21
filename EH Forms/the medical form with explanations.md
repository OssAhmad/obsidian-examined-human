---
EH form: false
---

# Examined Human Medical Form

> [!info] Collection design draft
> This form defines a proposed user workflow only. Medical discovery, catalog management, validation, and import are not implemented. Keep `EH form: false` while drafting and retain the source report. The [README](../README.md#health-collection-drafts) defines the shared health vocabulary and Daily Medication/Symptoms sections.

Use one Medical Form for one source report: a laboratory report with many results, a consultation record, an imaging report, or a hospital discharge summary. A discharge summary containing several days of activity is still one report. Do not assemble a whole medical episode into one continuously updated form, and do not create a separate form for each result. Daily medication intakes and everyday symptoms belong in the Daily Form.

The header describes the report once. Each measurement or procedure then needs only its compact row. Keep the original report, including any narrative that is not extracted into rows, at the referenced vault path.

#### EH Medical Form
report:
performed:
reported:
source:

HEADER DEFINITIONS:

- `report`: a descriptive title, such as `October blood tests`, `Abdominal ultrasound`, or `Hospital discharge summary`.
- `performed`: when the sample was collected, examination occurred, or reported treatment took place. Use `YYYY-MM-DD`, add `HH:mm` when known, or use `YYYY-MM-DD to YYYY-MM-DD` when the report covers several days. Leave it blank when unknown; do not substitute the report's issue date.
- `reported`: when the report was issued or the clinician documented the findings. Use `YYYY-MM-DD`, adding `HH:mm` when known. This is distinct from when you received or entered the report. Leave it blank when unknown.
- `source`: the vault-relative path to the original report or consultation note. Add a page or location in row notes when useful. If the source has not been attached, leave this blank rather than inventing a path.

For a complex report, include each known result or procedure date in its row's notes. The general header must not silently assign the discharge date to earlier measurements. Unknown dates remain unknown.

##### Measurements

FORMAT:
`measurement | value | notes`

The measurement is a canonical catalog name or an alias for exactly that measurement. The proposed catalog defines its accepted value type and its unit where applicable. Catalogs and alias resolution are part of the proposed design; no health-catalog command exists yet.

The value can be a number, a number with a comparison operator such as `<0.01`, a qualitative result such as `no`, `negative`, `trace`, or `indeterminate`, or written text such as a clinician's assessment or imaging impression. The accepted values depend on the particular measurement. Do not convert a qualitative result into a numeric zero or convert an unperformed test into a negative result.

For numeric results, the person or agent entering the form converts the source quantity into the measurement catalog's unit when the conversion is established. Preserve the original value and unit in notes when converted, and preserve the report-specific reference range and flag when supplied. An uncertain conversion is a gap to resolve, not a reason to guess. The intended stored record must retain the unit used at import even if the catalog later changes.

EXAMPLES (illustrative only; do not copy these below `ENTRIES:` unless they match the real report):

- `Systolic blood pressure | 118 | Measured seated; catalog unit is mmHg.`
- `Blood in urine | no | Source result: negative.`
- `Urine protein | trace | Qualitative result as printed.`
- `Left kidney length | 108 | Catalog unit is mm; source page 1.`
- `Chest X-ray impression | No focal consolidation. | Verbatim conclusion; source page 2.`
- `Clinician assessment | Patient reports intermittent headaches. | Transcribed from the consultation note.`
- `Hemoglobin | 11.2 | Collected 2026-10-18 07:40; catalog unit is g/dL; source page 3.`
- `Hemoglobin | 11.6 | Collected 2026-10-20 08:10; catalog unit is g/dL; source page 4.`

Use separate rows for individual panel results: a CBC is a group of tests, not one numeric measurement. Keep left/right, specimen, or other distinctions in the canonical measurement identity when they identify different measurements. Repeated measurements within one report remain separate rows; preserve their dates and context in notes.

Imaging findings, written impressions, diagnoses, and clinician notes can be text-valued measurements. There are no separate Vital Signs, Conditions, or Allergies sections. A clinician-recorded allergy finding can appear here; a reaction experienced during an ordinary day belongs in Daily Symptoms. Preserve the original wording and uncertainty instead of forcing every narrative into a number or yes/no answer. Long values and notes may wrap visually in the editor; the original report remains the full source.

ENTRIES:


##### Procedures

FORMAT:
`procedure | notes`

Use a canonical procedure name or alias. Each row records something documented as performed. Include known dates, sites, laterality, and other context in notes. Keep an order or recommendation distinct from a completed procedure; do not enter it here as though it happened. Findings from an examination belong under Measurements in this same form.

EXAMPLES (illustrative only; do not copy these below `ENTRIES:` unless they match the real report):

- `Chest tube insertion | 2026-10-18 14:00; left side; documented on discharge summary page 2.`
- `Chest tube removal | 2026-10-21; documented on discharge summary page 2.`
- `Upper gastrointestinal endoscopy | 2026-10-19; findings recorded under Measurements.`
- `Abdominal ultrasound | Examination documented in the attached report.`

Leave a section blank when it has not been recorded or the source gives no information about it. Use a standalone `none` only when explicitly asserting that there are no entries for that section; never mix it with rows. A `no` or `negative` measurement value applies only to that measurement and does not mean the whole report has no findings.

ENTRIES:


#### END
