# Examined Human

Examined Human is a local-first Obsidian plugin for planning, recording, and reviewing a life through one connected body of information.

You write ordinary Markdown forms. Examined Human validates them, asks for confirmation before importing them, and turns the resulting history into a calendar and a set of dashboards for time, commitments, money, food, exercise, and milestones.

The connecting idea is an **engagement**: anything you meaningfully engage with, such as a person, relationship, course, project, practice, responsibility, hobby, or long-term goal. Sessions, transactions, milestones, and plans can all point to the same engagement.

Examined Human runs on desktop and mobile. Your notes and database remain in your vault. It does not require an account, server, Python installation, or cloud service.

> Current release: **0.9.6**
> Requires Obsidian **1.8.7 or newer**

## What you can do with it

The usual rhythm is:

1. Plan a day, week, or budget in Markdown.
2. Record what actually happened in a Daily Form.
3. Preview and validate the form.
4. Confirm the import.
5. Review the result in the calendar and dashboards.
6. Improve your canonical lists of engagements, foods, exercises, accounts, and aliases as your life changes.

Daily history acts like a receipt: changing a note does not silently change its imported data. You can explicitly reimport a complete Daily Form for today or a past date after reviewing a red replacement warning and confirming deletion of the old day. Future Daily Forms can be reviewed but cannot be imported. Weekly plans and budgets can be updated by importing the same period again.

If you are new, the shortest useful path is: create and test an empty database, copy the explained Daily Form into your journal workflow, seed one engagement through its Admin Events section, and import that form. You can add foods, accounts, exercises, Weekly plans, and budgets only when you need them.

## Installation

### Install from Community plugins

When Examined Human is available in the Obsidian Community plugins directory:

1. Open **Settings → Community plugins**.
2. Select **Browse**.
3. Search for **Examined Human**.
4. Install the plugin and enable it.

### Install manually

1. Download `main.js`, `manifest.json`, and `styles.css` from the same [Examined Human release](https://github.com/OssAhmad/obsidian-examined-human/releases).
2. In your vault, create `.obsidian/plugins/examined-human/`.
3. Copy the three downloaded files into that folder.
4. Reload Obsidian.
5. Open **Settings → Community plugins** and enable **Examined Human**.

Do not copy `data.json` from another vault. It contains settings that belong to that vault.

## First-time setup: from installation to a working plugin

Complete these steps in order. The first six establish a real, usable installation. Step 7 is an optional disposable practice run.

### 1. Choose or create your database

Open **Settings → Community plugins → Examined Human**.

In **Database path**, enter the location of the database relative to the root of your vault. For example:

- `EH.db` puts it at the vault root.
- `data/EH.db` puts it inside a `data` folder.

Do not enter a Windows drive path, an absolute path, or a path outside the vault.

Then choose one route:

- **New user:** enter the path you want and select **Create Schema v1 database**.
- **Existing user:** enter the vault-relative path of your existing compatible `.db` file.

Select **Test connection**. Continue only after Obsidian reports that the Examined Human database is OK.

If you are connecting an older pre-1.0 database and Settings offers an upgrade, make an independent copy first, preview the upgrade, read the confirmation carefully, and then decide whether to proceed.

### 2. Set the Journal folder

In the same settings page, set **Journal folder** to the vault-relative folder that contains your Daily Notes. Examined Human searches its subfolders too, so a value such as `Journal` can cover folders like `Journal/2026/daily`.

Leave the field blank only if you intentionally want the vault root to be the Journal folder. The recommended Daily Note filename is `YYYY-MM-DD.md`.

### 3. Choose how forms are discovered

The recommended **Form discovery** option is **Only unimported EH Form notes**. It lets you explicitly tell Examined Human which notes to inspect and avoids scanning unrelated Markdown.

The alternative, **Every note in Journal folder**, also considers unmarked notes in the Journal folder. It can be useful during migration, but it is broader and may be slower in a large vault.

### 4. Add `EH form` to note metadata

For the recommended discovery mode, put this YAML frontmatter at the very top of every note that contains a form:

```yaml
---
EH form: unimported
---
```

`EH form: true` is also accepted. Matching is case-insensitive.

The marker tells the plugin that the note is ready to be discovered:

- `unimported` or `true`: inspect this note.
- `imported`: its importable Daily, Weekly, and Medical Forms are complete.
- `false`: deliberately ignore this note.

After all eligible Daily Forms (past or today), Weekly Forms, and Medical Forms in a note have been imported, Examined Human normally changes the marker to `imported`. Budget imports and mutable planning updates do not change it because those plans remain editable.

### 5. Put the forms into your note workflow

The repository includes both explained and minimal versions:

- [Daily Form with explanations](<EH Forms/the daily form with explanations.md>)
- [Weekly Form with explanations](<EH Forms/the weekly form with explanations.md>)
- [Budget Form with explanations](<EH Forms/the budget form with explanantions.md>)
- [Minimal Daily Form](<EH Forms/the minimal daily form.md>)
- [Minimal Weekly Form](<EH Forms/the minimal weekly form.md>)
- [Minimal Budget Form](<EH Forms/the minimal budget form.md>)

Medical Forms are also available:

- [Medical Form with explanations](<EH Forms/the medical form with explanations.md>)
- [Minimal Medical Form](<EH Forms/the minimal medical form.md>)

The Daily templates group Medication and Symptoms under Medical, and Transactions and Valuation Rates under Financial. Existing databases need the confirmed **Settings → Examined Human → General → Tools and maintenance → Medical database migration** action before importing health entries. Read [Health records](#health-records) for catalog setup, Medical import/reimport, and the plain records dashboard.

Start with the explained forms. Use the minimal forms after the entry formats feel familiar.

Copy the forms into your Obsidian template system or paste them into notes manually. If you do not use the Templater community plugin, replace expressions such as `<% tp.file.title %>` with the real ISO date yourself.

Keep these structural elements unchanged:

- the `#### EH Daily Form`, `#### EH Weekly Form`, `#### EH Budget Form`, or `#### EH Medical Form` heading;
- the date fields inside the form;
- the section headings and required `ENTRIES:` markers;
- the closing `#### END` marker.

A note may contain one form of each kind. The form's internal dates determine what it represents; the filename alone does not.

The current Daily templates intentionally omit `sleep_hours`, `calories`, `protein_g`, `studied`, `worked`, and `exercised`. Those values are calculated during assessment and import, displayed in the report, and stored in the database without requiring duplicate manual entries.

### 6. Import the minimum personal vocabulary

An empty database knows the allowed general types, but it does not know the names from your life. Before logging sessions, create at least one engagement. Add the other kinds of records only when you intend to use their sections:

- an **engagement** is required for sessions, commitments, milestones, transactions, and budget targets;
- an **account** is required for transactions;
- a **food** is required for meal rows;
- an **exercise** is required for structured Exercise Details.

The quickest first seed is a Daily Form dated yesterday or earlier. Leave its ordinary sections blank and put your creation commands under **Admin Events → ENTRIES:**. For example, replacing these names and values with real ones:

```text
ENGAGEMENT_CREATE | Learning Examined Human | practice | active |
ACCOUNT_CREATE | Cash | cash | USD |
EXERCISE_CREATE | Walking | cardio
FOOD_CREATE | Oats | grain | 389 | 16.9 | 66.3 | 6.9 | 0.01 | 10.6 | 0 | plain oats | [oatmeal]
```

If you only want to begin tracking time, the engagement row is enough. Do not invent nutrition figures for real foods; use values you trust.

Open the seed note, run **Examined Human: Import Daily Form from Active File**, review the validation preview, and confirm the import. Creation rows are staged evidence until this import succeeds.

The full Daily validator stages Admin Events in a disposable copy before resolving the rest of the form. This means the same form may create an engagement, food, account, exercise, type, or alias and then use it in its sessions, meals, transactions, or exercise details. The real database is still changed only after confirmation.

You can later use the **Command Center** to prepare new records and aliases through forms instead of typing commands manually.

### 7. Optional: learn in a temporary database

After your minimum seed import succeeds, you may want to explore immediately without filling your real history with experiments.

1. Write down your real **Database path** exactly.
2. Change it to a clearly temporary vault-relative path, such as `sandbox/EH-demo.db`.
3. Select **Create Schema v1 database**, then **Test connection**.
4. Copy a Daily Form and use a past date that is only for the demo.
5. Repeat the minimum seed with obviously fictional names, such as `Demo Project`, `Demo Cash`, `Demo Meal`, and `Demo Exercise`.
6. Add several dummy sessions, a meal, a transaction, exercise sets, and a milestone.
7. Import the form and open every dashboard described below.
8. Try a Weekly Form and a Budget Form, then reimport them after changing something so you can see how editable plans behave.
9. When finished, restore the original Database path and select **Test connection** before returning to real notes.

The demo database is independent. Nothing seeded in your real database is automatically copied into it. You may keep the demo for later practice or delete it after switching back to the real database and verifying the connection.

### 8. Check the important preferences

Before regular use, review these settings:

- **Nutrition evaluation:** set meal calories, daily calories, and minimum protein to match the rules you actually want. A value of zero disables that automatic rule.
- **Backup retention:** `0` keeps every Examined Human backup; a positive whole number keeps that many newest backups.
- **Default dashboard period:** controls the initial date range in analytical dashboards.
- **Valuation:** choose the display label and reference asset class only if you want converted net-worth views.
- **Calendar:** choose the initial hour, desktop day width, mobile day width, and session colors.
- **Form cleanup after import:** the Daily, Weekly, and Budget switches are independent and disabled by default. When enabled, only the exact form block that was validated is removed after its database import succeeds; surrounding note text and other forms remain.

On Obsidian 1.13 and later, Examined Human preferences are organized into searchable General, Nutrition, Financial, Styling, and Exercise pages. Older supported Obsidian versions render the same preferences as a single categorized page.

## How information moves from a note into the plugin

Examined Human deliberately separates preparation from import:

1. **Discover:** the plugin finds a note through its `EH form` marker or the broader Journal-folder mode.
2. **Stage:** you write entries directly, or a dashboard/Command Center adds proposed rows to an unimported Daily Form.
3. **Review the note:** the Markdown remains the readable source you can inspect and correct.
4. **Preview and validate:** the plugin checks dates, formats, names, aliases, and references and shows what it found.
5. **Confirm:** only an explicit confirmation applies the validated change.
6. **Review the result:** refresh and inspect the relevant dashboard.

Dashboard buttons that say **Stage** do not finish an import. They add reviewable text to a chosen current or future Daily Form. The database changes only when the appropriate form import later succeeds.

### Daily Forms

A Daily Form can contain observed metrics, a general daily note, sessions, meals, medication, symptoms, transactions, valuation rates, exercise details, milestones, Stoicism notes, and Admin Events.

Session rows use either `interval | engagement | notes` for a typeless session or `interval | type | engagement | notes` when an explicit session type is needed. The four-field form may also leave the type field blank. Typeless sessions inherit their engagement type for calendar color. If the form contains Exercise Details, exactly one session must use type `exercise`; all of that form's exercises and sets attach to that session.

- For **today**, opening or refreshing the Calendar projects the eligible Daily Form's Sessions for display without finalizing the day. You may also validate and finalize today's complete form.
- For a **future date**, the assessment can be reviewed, but canonical Daily import is refused until that date arrives. Future Calendar sessions come only from an imported Weekly Form.
- For a **past date**, importing creates the canonical historical record after validation and confirmation.
- Once a Daily Form is finalized, further edits require an explicit full-day reimport with a replacement warning and acknowledgement.

Calories and protein are calculated from every structured food row, including snacks, and are displayed to two decimal places. The plugin also derives `studied`, `worked`, and `exercised` from session/engagement types: `study` or `course` counts as study, `work` counts as work, and `exercise` or `fitness` plus structured exercise rows count as exercise. Sleep is calculated from matching sleep sessions during a configurable 24-hour assessment window, defaulting to 21:00 on the previous date through 21:00 on the assessed date; a session type, engagement type, or canonical engagement name of `sleep` qualifies. Split an overnight sleep into one session ending at `23:59` and another beginning at `00:00` on the next date.

If a same-form Admin Event creates a food or food alias used by Meals, use the full Daily import. The separate Meals-only action cannot persist the new food definition by itself and will instead tell you to import the Daily Form first.

Use **Examined Human: Import Daily Form from Active File** while the note is open, or work from **Daily Assessment**.

### Correcting an imported day

Edit the **complete EH Daily Form** for the date, then run **Import Daily Form from Active File** again or select the imported date in **Daily Assessment** and choose **Reimport…**. Both routes show the same red warning, the counts of old rows to remove, and the new assessment. Check the acknowledgement and choose **Delete and reimport [date]** only when the complete form is ready.

> **Reimport deletes all old daily records for the selected date and fills them anew from the new form. This is a complete replacement, not a merge. Anything missing from the form will be removed, including records added through another tool. A database backup is created first.**

Replacement covers daily metrics, sessions and their exercise sets, transactions, meals and nutrition assessments, Stoicism entries, the day's milestones and measurements, valuation rates, Medication/Symptoms entries and recording states, and daily import/projection records. Separately imported Medical reports are retained. Old row IDs are discarded. Blank optional sections remove the corresponding old entries; the normal required form sections and validation rules still apply. Other dates are left alone.

Shared foods, engagements, accounts, exercises, aliases, and Weekly/Budget plans are retained. **The Admin Events section must be empty during reimport.** Remove previously executed commands before trying again: deleting those commands from the note does not undo their earlier shared changes. Apply new catalog changes through a separate, not-yet-imported Daily Form. If a milestone belonging to this day has measurements from another or unknown date, or another cross-date link is inconsistent, replacement is blocked until those links are resolved. Changing or removing a dated valuation rate can change financial displays for later dates that carry that rate forward.

The plugin validates the replacement in memory, creates a backup, and performs deletion and reinsertion together. Validation, stale-preview, WAL, or backup failures leave the old records intact. If the note or database changes after preview, review it again before confirming. Repeating a successful reimport replaces the day again rather than accumulating duplicate sessions, transactions, meals, or other entries.

If automatic cleanup removed the source form, restore it from your note history or write a complete replacement form before reimporting. Imported days remain available in Daily Assessment even when the note is marked `EH form: imported`; the active-file command also works without changing that marker. If the note has moved, mark its replacement `unimported` and use **Discover forms**, or use the active-file command directly.

### Weekly Forms

A Weekly Form covers exactly seven days. It holds a direction, commitments, and a planning grid. Import it with **Examined Human: Import Weekly Form from Active File** or from **Weekly Assessment**.

Importing records the weekly plan, and its current or future sessions appear directly in the Calendar dashboard even when no Daily Notes have been created yet. The latest imported version of that week is the one the calendar uses.

**Sync week** is a separate, optional action that can copy current and future planned sessions into empty Daily Form Sessions sections. Use it only when you want those rows materialized in the notes; existing occupied sections are not silently overwritten.

Importing the same starting date again updates that week. Planned sessions remain intentions; completed time comes from historical Daily Forms.

### Budget Forms

A Budget Form describes targets and expected movements for a non-overlapping period of at least four days. Import it with **Examined Human: Import Budget Form from Active File** or from the **Financial Dashboard**.

Negative targets represent expected spending or liabilities; positive targets represent expected income or assets. Expected movements are plans only. They do not create transactions, reminders, or notifications.

Importing the same start and end dates again updates that budget.

### Command Center and other staging actions

The Command Center manages your canonical foods, engagements, exercises, accounts, aliases, and valuation rates. Its actions are intentionally staged into a selected unimported Daily Form so you can read the exact change before importing it.

The Financial Dashboard uses the same pattern for opening balances and reconciliations: it stages a normal, clearly marked transaction in a Daily Form. The Daily Form import is the step that applies it.

## Health records

Medical Forms and Daily Medication/Symptoms are supported by the native guarded importer. For an existing official Schema v1 database, open **Settings → Examined Human → General → Tools and maintenance → Medical database migration**, review the upgrade, and confirm. The plugin creates a verified backup, preserves legacy numeric measurements and IDs, and adds typed observations, report provenance, procedures, and canonical health catalogs. New databases already include these tables. The official SQLite schema marker remains v1.

Run **Manage health catalogs** to create people, measurements, procedures, medications, symptoms, and aliases. A measurement has a `number`, `qualitative`, or `text` value type; numeric measurements and medications require a canonical unit. The importer resolves names and aliases; it does not infer units or convert quantities. Each save is previewed and confirmed with a backup. A Medical Form requires a defined person: if there is exactly one person, it is selected automatically; with multiple people, add `person: canonical name` to the header.

Open a source note and run **Import or reimport Medical Form from Active File**. The preview shows its person, dates, section states, measurements, units, notes, and procedures. Confirmation creates a durable import with a backup; the Markdown form is retained. Reimport from the same source note replaces that report after an explicit acknowledgement. Omitted measurements and procedures are deleted; other reports and shared catalogs are retained. The preview counts the old rows being replaced. Changed source text, a stale database snapshot, uncheckpointed WAL, or backup failure blocks persistence.

The source note path identifies an imported report. To move the note, obtain its ID from **Medical Dashboard** and add `report id: ID` to its header before reimporting from the new path. The ID must identify an existing native import, and its person cannot change. Reusing a source document already attached to another native report is refused; reports are never matched merely by title or date.

**Medical Dashboard** has an imported-record navigator on the right. Select a Medical report or a Daily medical log to see its entries in the main pane. Measurements, procedures, medication, and symptoms retain their imported order; there are no charts or laboratory-category groupings. The list is newest first and paginated at 50 entries. Selecting another record changes only the selected view. Refresh rebuilds the shared database boundary and preserves the selected record and scroll positions; background updates show a notice until you refresh.

Four fictional [manual-import examples and catalog setup instructions](<docs/examples/health/00 Start here.md>) cover a laboratory report, an imaging report, a Daily Form with medication/symptoms, and a Daily Form with explicit `none`. Use a disposable database for those examples.

The [Medical Dashboard review set](<docs/examples/medical-dashboard-review/00 Start here.md>) contains five unimported source notes dated October 20–25, 2026. Each note pairs a Daily Form with a Medical Form so both dashboards can be reviewed, including explicit `none`, unrecorded sections, repeated results, and imaging findings.

The collection workflow has two parts:

- **During an ordinary day**, a person or agent records doses actually taken and symptoms actually experienced in that day's Daily Form. Blank sections remain unrecorded; an explicit `none` records an absence.
- **When a medical report is available**, a person or agent retains the source document and transcribes it into one Medical Form, using compact Measurements and Procedures rows. A laboratory report with 34 results is one form. A hospital discharge summary describing several days of treatment is also one form. Each separate report has its own form; do not create a separate form per result or maintain one growing form for an entire medical episode.

The scope is high-quality collection: preserve identities, observations, context, dates, and source material. Report generation and interpretation are outside this collection design.

### Daily Medication and Symptoms

Current Daily Forms group their entries as follows. Older flat `##### Medication`, `##### Symptoms`, `##### Transactions`, and `##### Valuation Rates` headings remain readable, but do not duplicate a section in both formats.

```markdown
##### Medical
###### Medication
ENTRIES:

###### Symptoms
ENTRIES:

##### Financial
###### Transactions
ENTRIES:

###### Valuation Rates
ENTRIES:
```

The sections appear in both [Daily Form templates](<EH Forms/the daily form with explanations.md>):

| Section | Entry format | Meaning |
| --- | --- | --- |
| Medication | `time (hh:mm) \| medication \| amount \| notes` | One dose actually taken; its canonical record in the `medications` table supplies the amount's unit. |
| Symptoms | `time (hh:mm) \| symptom \| notes` | One symptom occurrence, with its context in the person's own words. |

Every field in these rows is required. Times use 24-hour `HH:mm`; names can be canonical names or aliases. Notes hold context such as route for medication, or onset, duration, severity, and interference with work for symptoms. There is no separate symptom severity field and no optional-column variant. Use `none` in a notes field when there is no additional context. Missing facts must not be filled with guessed times, identities, or amounts.

Medication must be defined in a **canonical `medications` table with units**. Each canonical record requires a name and one dose unit, such as `tablet`, `mL`, or `mg`, and identifies the product's strength and formulation where relevant. Aliases point to the same canonical medication record. A bare medication name without a defined unit is insufficient for recording an amount.

For a product named `Example medicine 10 mg tablet` with dose unit `tablet`, an amount of `1` means one tablet, not one mg. An alias must identify the same product, not silently combine different strengths or formulations. The entering person or agent checks the canonical unit, converts only when the conversion is established, and retains the original amount and unit in notes when converted. Resolve missing catalog records or units instead of guessing. The stored intake record retains the unit used at entry so a later catalog edit cannot relabel historical doses. Prescriptions, planned doses, and skipped doses do not belong in Medication.

The symptom catalog groups equivalent symptom names while retaining each entry's original notes. Headaches, runny nose, abdominal pain, drowsiness, brain fog, and everyday allergic symptoms or reactions belong here. A clinician's documented finding belongs in the Medical Form for that report. Repeated occurrences can have separate timestamped rows. Use **Manage health catalogs** for canonical health records and aliases; health catalog changes do not use Daily Admin Events.

For example, these are symptom rows:

```text
10:30 | Headache | Started while working; distracting, but I continued.
14:15 | Brain fog | Felt fuzzy and struggled to follow my reading.
```

To explicitly record a symptom-free day, write:

```markdown
##### Medical

###### Symptoms

ENTRIES:
none
```

The same standalone `none` in Medication means no medication was taken that day. It must be the only entry in that section. An empty or omitted section means **unrecorded**, never `none`, zero, or a negative observation. The two sections are independent. A `none` used inside a row's notes field means only that there are no additional notes.

### Medical Form: one source report

Use the [explained Medical Form](<EH Forms/the medical form with explanations.md>) or the [minimal Medical Form](<EH Forms/the minimal medical form.md>). It begins with `#### EH Medical Form`, has one Measurements section and one Procedures section, and ends with `#### END`. There are no separate sections for Vital Signs, Conditions, or Allergies.

The header records shared context once:

| Field | Definition |
| --- | --- |
| `report` | A descriptive title for this source report or consultation record. |
| `performed` | Sample collection, examination, or treatment date; use `YYYY-MM-DD`, optionally followed by `HH:mm`. A report covering several days can use `YYYY-MM-DD to YYYY-MM-DD`. |
| `reported` | Date the report was issued or the clinician documented the findings, optionally followed by `HH:mm`; distinct from when it was received or entered. |
| `person` | Canonical person name; required when the database contains more than one person. |
| `report id` | Blank on initial import; use the stored report ID when reimporting a moved source note. |
| `source` | Vault-relative path to the original report or consultation note. |

Unknown header dates or an unavailable source path stay blank. A filename is not evidence of when a sample was collected. When a hospital summary or another complex report contains entries from different dates, preserve each known date, time, page, or location in the relevant row's notes. Do not assign the report's issue or discharge date to every measurement or procedure. Keep the source document available for details that are not extracted.

### Measurements, values, and units

Measurements use `measurement | value | notes`. A measurement is the thing observed; its catalog definition supplies a canonical name, aliases, accepted value type, and a unit when applicable. A value is the result recorded for this observation. The word **value** includes qualitative and textual results as well as amounts.

| Example measurement | Example value | Intended value type |
| --- | --- | --- |
| Systolic blood pressure | `118` | Numeric, in the catalog unit. |
| Blood in urine | `no` | Qualitative. |
| Urine protein | `trace` | Qualitative. |
| A laboratory measurement | `<0.01` | Numeric with its comparison operator preserved. |
| Chest X-ray impression | Written conclusion from the report | Text. |
| Clinician assessment | The clinician's recorded assessment | Text. |

The examples describe entry shapes, not facts about a user. Accepted values depend on the measurement. `No`, `negative`, `trace`, `indeterminate`, and `not performed` must retain their distinct meanings where applicable; do not force them into numeric zero or infer them from a missing result.

For numeric measurements, the entering person or agent converts the source value into the catalog's unit when the conversion is established. Preserve the original value and unit in notes when converting, and retain the source report's reference range and flag when supplied. Resolve uncertain conversions instead of guessing. The database record snapshots the unit used at import so later catalog edits cannot relabel historical values. A bare number alone cannot prove that a conversion was correct.

Use separate rows for each component result of a panel such as a CBC. Preserve distinctions such as left/right or specimen when they identify different measurements; aliases must not collapse different measurements. Multiple observations of the same measurement in one report remain separate rows, with their dates and context in notes.

X-ray, ultrasound, endoscopy, and other narrative findings fit the same format: extract clearly identifiable measurements and preserve useful written findings or the report's impression as text-valued rows. Do not force every sentence into a number or yes/no answer. Long text may wrap visually in the editor; retain the original report for the full narrative. Keep each row on one physical line. Encode a literal pipe as `\|`, a line break inside a field as `\n`, and a literal backslash as `\\`. All row fields must be nonempty; `none` in a notes field means no additional context.

### Procedures

Procedures use `procedure | notes`. The canonical procedure name or alias identifies what was done; notes retain its known date, time, site, laterality, and other context. Examples include chest tube insertion, chest tube removal, endoscopy, and ultrasound. Findings from those procedures belong in Measurements in the same form. A recommendation or order must not be entered as though the procedure was performed.

Leave an unrecorded Medical section blank. A standalone `none` is an explicit assertion of no entries for that section and must not be mixed with rows. A negative value in one measurement row applies only to that measurement. Further sections and additional columns are unnecessary for the agreed collection workflow.

## Refreshing without losing your place

Examined Human checks for database changes in the background. These checks leave the page you are reading in place. If the database or the note being assessed changes, the tab shows **Updated data available** (or **Source note updated**) with a **Refresh** button. You can finish reading before loading the changes. Unchanged checks stay invisible.

Choosing **Refresh** reloads the database and all open EH tabs while preserving their scroll positions, including assessment timelines and sidebars. The Calendar also keeps its exact horizontal position. Your own confirmed import actions still refresh the open tabs when they finish. A source notice concerning a WAL checkpoint means you must first close or checkpoint the external database writer before refreshing.

## What to do with forms after importing

After an import succeeds, you have three valid choices:

- **Keep the note.** This is recommended when you want a permanent, human-readable record of what happened, what you planned, and what was submitted to the plugin.
- **Remove only the imported form automatically.** Enable the separate Daily, Weekly, or Budget cleanup switch in Settings. After a confirmed database import, Examined Human removes the exact validated form block while preserving surrounding journal text and other forms.
- **Delete or edit the source manually.** Imported information remains in the database, so the form is not required for ordinary dashboard display.

Remove source material only after confirming that the import succeeded and the information appears correctly. Deleting an unimported form also discards staged changes that have not yet been applied. If automatic cleanup notices that the form changed after validation or cannot identify one exact block, it safely leaves the note untouched; the completed database import is not falsely reported as failed.

## Dashboard guide

Select the **Stoic portico icon** in Obsidian's right sidebar to open the **Examined Human** dashboard navigator. It is added when the plugin loads; the matching ribbon icon and **Examined Human: Open dashboard navigator** command also reveal it.

Each dashboard has a colored icon. Select its name to replace the dashboard in the current EH tab. If the main tab contains a note, another plugin, or a pinned dashboard, EH opens a new tab instead. Selecting the dashboard already visible keeps its current display.

To open an additional tab, **Ctrl-click** on Windows/Linux or **Cmd-click** on macOS, middle-click, or use the **↗ button** beside the dashboard name. The same ↗ button is always available on mobile. The mobile sidebar closes after a selection so you can see the dashboard.

The small summary above the list shows recorded time as `hh:mm`, the number of sessions and participating engagements, and recorded days across all history through today. It counts canonical session records; planned sessions are excluded. Background changes show an update notice until you refresh. The refresh button rereads the selected database and refreshes all open EH views.

Dashboard commands remain available in the Obsidian command palette, prefixed with `Examined Human:`. Each dashboard-opening command opens a separate tab, even when that dashboard is already open.

### Calendar dashboard

The calendar shows sessions on a horizontally scrollable sequence of days and a vertical 24-hour timeline. Past days use canonical imported sessions. Future days use only sessions stored from the latest imported Weekly Form, so future Daily Notes cannot accidentally change the plan. Today combines the eligible Daily Form (or today's canonical import) with the Weekly Form: Daily intervals win conflicts, while non-overlapping Weekly sessions remain visible. Click a session for its exact time, duration, type, notes, exercise details, milestones, and any data-quality warning.

Use it to answer: **When did I spend time, and what did I spend it on?**

### Daily Assessment

On wider desktop panes, the day timeline uses the Calendar's configured desktop day width, with the time chart, foods, transactions, and remaining details in a column on the right. Narrow panes and phones retain the full-width stacked report.

The time chart can switch between **Time by engagement** and **Time by session type**, both here and in the active-file import preview. Session-type grouping uses the explicit session type, falling back to the engagement type when blank. Related types are combined: academic/course/certification/exam time becomes Study; career/startup time becomes Work; authorship/article/book/speech time becomes Writing; fitness becomes Exercise; relationship becomes Social; and Chore joins Maintenance. Reading, Research, Thinking, Practice, Meditation, and Leisure stay separate. An engagement named exactly Sleep always has its own Sleep category. This changes only the chart, not stored records or the inferred daily activity flags; totals use `hh:mm`.

Daily Assessment lists discovered forms and imported days, newest first. It previews and validates Daily Forms, imports past dates or today, offers explicit full-day reimport for imported dates, refuses future dates, and displays the same report used by the active-file import command. That report includes manual and inferred metrics, the session calendar, foods with nutrient totals, transactions with unit totals and valued net flow, exercise sets, and notes. Hard validation errors hide the report and expose the available resolution actions first.

When a form refers to an unknown engagement, food, exercise, or account, Daily Assessment can help stage the missing canonical record or alias into that unimported note. Revalidate after staging.

Use it to answer: **Is this day ready to import, and what exactly happened that day?**

### Weekly Assessment

Weekly Assessment shows the week's direction, commitments, planned sessions, actual time by engagement, and planned-versus-actual differences. For current and future weeks, it can preview and sync the planning grid into empty Daily Form Sessions sections.

Use it to answer: **What did I intend to do this week, and where did the week actually go?**

### Engagement Dashboard

The Engagement Dashboard brings everything about one engagement together. Search by its canonical name or an alias, choose a date range, and review its status, dates, session time, activity trend, session types, recent sessions, lifetime milestones, linked financial totals, and transaction ledger.

Use it to answer: **What is the complete story of this project, relationship, practice, course, or goal?**

### Financial Dashboard

The Financial Dashboard shows balances as of a selected date, account and net-worth history, period inflow and outflow, financial activity by engagement, recent transactions, active budget targets, and expected movements. You can inspect one account or all accounts and use native units or your configured valuation view when rates are available.

It can also stage an opening balance or reconciliation into a Daily Form. A period's net flow is activity during that period; it is not the same thing as an account balance.

Use it to answer: **What do my accounts show, how did money move, and how does that compare with the plan?**

### Nutrition Dashboard

The Nutrition Dashboard shows calorie and protein trends, meal and food breakdowns, diet adherence, data coverage, and leisure-meal debt for assessed days. Snacks contribute to daily calories but do not count directly as one of the three main meal opportunities.

Use it to answer: **What did I eat, how complete is the evidence, and am I following the rules I configured?**

### Exercise Dashboard

The Exercise Dashboard shows training days, workout time, detail coverage, exercise volume, performance maxima, distance, measured duration, muscle exposure, and recent workouts. Ordinary exercise sessions still appear even when you did not record structured sets.

Use it to answer: **How consistently am I training, and what does the recorded performance show?**

### Command Center

The Command Center is the maintenance workspace for engagements, foods, exercises, accounts, aliases, valuation rates, and batches of Admin Events. Search existing records, prepare changes, choose an unimported Daily Form, review the proposed rows, and stage them. Raw Admin Events can also maintain the type vocabularies with `SESSION_TYPE_ADD`, `SESSION_TYPE_REMOVE`, `ENGAGEMENT_TYPE_ADD`, and `ENGAGEMENT_TYPE_REMOVE`; removal deactivates a type for new input without deleting historical references.

Use it to answer: **What canonical names does my system know, and what correction should I stage next?**

## A practical daily and weekly routine

1. Create today's Daily Form with `EH form: unimported` in its frontmatter.
2. Add planned sessions if useful; opening or refreshing the Calendar synchronizes today's session plan automatically.
3. During or after the day, fill in what actually happened.
4. Validate the complete form and import it either today or later. Future-dated Daily Forms remain review-only.
5. Keep the form as part of the readable journal, remove it manually, or enable the matching post-import cleanup switch.
6. At the start of a week, create and import a Weekly Form.
7. During the week, update and reimport the plan when necessary.
8. At review time, compare Weekly Assessment with the canonical Daily Forms.
9. Create or update a Budget Form whenever you begin a new planning period.

Use **Examined Human: Reload EH.db and refresh all dashboards** whenever you want every open view to reread the selected database immediately.

## Troubleshooting the first setup

### The plugin does not appear

For a manual installation, confirm that `.obsidian/plugins/examined-human/` contains `main.js`, `manifest.json`, and `styles.css` directly—not inside another nested folder. Reload Obsidian and check that the plugin is enabled under Community plugins.

### Test connection fails

Confirm that the Database path ends in `.db`, is relative to the vault root, and points to the database you intended. For a new installation, create the database before testing it. For an existing database, make sure the file is actually inside this vault.

### A form is not discovered

Check all four boundaries:

1. the note has `EH form: unimported` or `EH form: true` at the top;
2. the selected discovery mode includes that note;
3. the form begins with the exact EH Form heading and contains a valid date;
4. the form ends with `#### END`.

If you chose Journal-folder discovery, also verify the configured Journal folder. If you chose the recommended marker-based mode, the form can be anywhere in the vault.

### Import reports an unknown name

Sessions and plans need a known engagement; transactions also need a known account; meals need a known food; structured exercise rows need a known exercise. Correct a misspelling, use an existing alias, or stage the missing canonical record through Daily Assessment or Command Center, then revalidate.

A full Daily Form may create the missing record or alias under Admin Events and use it elsewhere in that same form. If the Daily report accepts it but the separate Meals panel says **Import Daily first**, use the main Daily import so the canonical food and meal are committed together.

### A typeless session is rejected or missing from the Calendar

Use three fields for an ordinary session: `interval | engagement | notes`. Use four fields only when you need an explicit session type: `interval | type | engagement | notes`. Typeless sessions inherit the engagement type for calendar color. The older blank-type form, `interval | | engagement | notes`, is also accepted. Weekly planning-grid cells use semicolons and still reserve their first position for an optional type: `; engagement ; notes`.

### A future Daily Form will not import

That is expected. A Daily Form can be finalized only for today or a past date. Future Calendar sessions must come from an imported Weekly Form; wait until the Daily Form's date before importing it as canonical fact.

### The database reports unfinished external changes

Close or finish the write in the other SQLite application, then use **Examined Human: Reload EH.db and refresh all dashboards**. Do not replace the database file while another application still has unfinished changes.

## Data ownership and safety

- Your notes and database remain in your vault.
- Examined Human does not upload your data or fetch market prices.
- Imports and staged changes require review and confirmation.
- Finalized writes create backups according to your retention setting.
- The plugin refuses unsafe paths and avoids overwriting another program's unfinished database changes.
- Vault synchronization is your choice and is not provided by the plugin.

Keep independent vault backups, especially before connecting or upgrading an existing database.

## Current boundaries

Examined Human does not provide reminders, notifications, automatic exchange rates, market-price fetching, recurring transactions, recurrence rules, calendar synchronization, or automatic repair of ambiguous old data. Sessions that cross midnight must be split across two dates.

Medical import supports recorded findings and procedures; it does not provide clinical interpretation, automated unit conversion, OCR, or image analysis.

These limits keep the system focused on deliberate recording, reviewable plans, and evidence you control.

## For developers

Build instructions, validation commands, repository structure, database and import architecture, safety invariants, and release guidance are in [DEVELOPMENT.md](DEVELOPMENT.md). User-visible release history is in [CHANGELOG.md](CHANGELOG.md).

## Fork attribution and license

This project began as a fork of [seonggoos/obsidian-schedule-calendar](https://github.com/seonggoos/obsidian-schedule-calendar). Its Obsidian view scaffolding and overlap-layout foundation were adapted for a different data source and interaction model.

[MIT](LICENSE) — Copyright (c) 2026 seonggoos and Copyright (c) 2026 OssAhmad.
