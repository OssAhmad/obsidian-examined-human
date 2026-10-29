# Examined Human development guide

This document is for maintainers and contributors. The end-user installation and operating manual is in [README.md](README.md). Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing data flow, form grammar, schema assumptions, or safety boundaries.

## Requirements

- Node.js 22 or newer
- npm
- Obsidian 1.8.7 or newer for manual plugin testing

Install dependencies:

```bash
npm install
```

## Repository map

- `src/examined-human-database.ts` owns read-only database access and sql.js lifetime.
- `src/read-models/` owns feature query contracts, shared SQL/schema helpers, and the extracted command, inspection, weekly, nutrition, and exercise implementations.
- `src/examined-human-query.ts` remains the compatibility export surface and houses the still-coupled calendar, daily, engagement, and finance implementations.
- `src/forms/` contains shared bounded-form, section, `ENTRIES`, labeled-field, and row primitives, including the shared three-/four-field Daily session grammar.
- `src/logger/` contains pure parsing/import logic and the isolated guarded writer.
- `src/logger/persistence/` owns reusable transaction and integrity verification infrastructure.
- `src/native-logger/` contains deprecated compatibility reexports; new code must not import from it.
- `src/plugin-services.ts` is the stable capability interface supplied to views and note-staging workflows.
- `src/form-discovery.ts` discovers bounded Daily, Weekly, Budget, and Medical Forms in Markdown notes.
- `src/dashboard-navigation.ts` and `src/DashboardSidebarView.ts` own the dashboard registry, Stoic icon, shared-tab navigation, and compact activity summary.
- `src/HealthCommandForms.ts` generates health catalog commands; `src/command-staging.ts` stages them through the same picker and confirmation as other Admin Events.
- `src/logger/medical.ts`, `src/logger/daily-health.ts`, and `src/logger/admin/health-commands.ts` own report imports, Daily health rows, and health catalog Admin Events.
- `src/read-models/medical.ts` owns medical catalog/report queries; `src/MedicalDashboardView.ts` renders them without SQL in the view.
- `src/events.ts` owns the session domain model plus shared formatting and color policy.
- `src/TimelineView.ts` renders the calendar viewport.
- `src/*DashboardView.ts` and the assessment views render the analytical and import interfaces.
- `src/settings.ts` defines vault-local configuration and database creation/testing actions.
- `migrations/000_create_schema_v1.sql` creates an empty official Data Schema v1 database and public taxonomy seeds.
- `migrations/` also contains the explicit supported legacy upgrade SQL.
- `EH Forms/` contains explained and minimal user-facing Markdown templates.
- `scripts/` contains release and privacy-preserving validation tools.
- `docs/ARCHITECTURE.md` is the durable design record.
- `docs/RELEASING.md` is the release checklist.

## Architecture and non-negotiable invariants

The plugin uses sql.js to read a SQLite database stored inside the Obsidian vault. The runtime is mobile-compatible and must not import Node filesystem or process modules.

The read boundary and write boundary are intentionally separate:

- `ExaminedHumanDatabase` and dashboard queries are permanently read-only.
- Approved mutations belong only in `LoggerService`.
- Durable writes use preview, explicit confirmation, transaction staging, stale-file conflict checks, backup creation, integrity checks, and verified replacement.
- Current/future planning projections and replaceable Meals components follow their documented ephemeral mutation policy. Calendar open/refresh performs one narrow, idempotent, backup-free reconciliation for today's Daily Form; broad current/future synchronization remains previewed and confirmed.

Do not add direct SQLite writes to a view or to the reader. Do not place raw SQL or row mapping in DOM-rendering code.

Database paths must remain vault-relative. Never read or replace main-database bytes while a nonempty SQLite WAL contains uncheckpointed frames. The database source boundary is rebuilt by visible Refresh actions, database/WAL fingerprint changes, and the unconditional periodic reload described in the architecture document.

Canonical sessions win for dates represented by imported notes. Today's eligible Daily Form projection is refreshed automatically when the Calendar opens or refreshes; its intervals take precedence over conflicts while non-overlapping sessions from the imported Weekly Form remain visible. Future dates read only from the latest imported Weekly Form, and past dates remain canonical. Imported Daily Forms are stable receipts until a separately confirmed full-day reimport replaces their date; editing Markdown alone does not change them. Weekly plans and budgets are replaceable by their period identity.

Keep session titles engagement-first, duration formatted as `hh:mm`, `chor` distinct from `chore`, and optional exercise/milestone tables backward-compatible.

## Data Schema v1

`migrations/000_create_schema_v1.sql` is the complete empty-database definition. It includes structural tables and public taxonomy values but no user data. The creation SQL is embedded into the production bundle.

The primary domains are:

- engagements, aliases, statuses, and types;
- sessions and imported-note provenance;
- metrics, meals, food definitions, and nutrition assessment snapshots;
- accounts, transactions, budgets, expected movements, and valuation rates;
- exercises, sets, muscles, milestones, and measurements;
- weekly plans, commitments, and planned sessions;
- note-source and import-component provenance.
- source medical reports, typed measurements, procedures, health aliases, Daily medication intakes, and symptom occurrences.

Schema and parser changes must preserve compatibility rules documented in `docs/ARCHITECTURE.md`. Add or update in-memory SQLite fixtures and parser tests for every changed contract. Never use a personal database or note as a committed fixture.

Pre-1.0 legacy conversion remains an explicit, previewed, confirmed operation. It must preserve historical rows, create and verify a backup, and fail safely when the source is incompatible.

### Medical schema and single-owner upgrade

The current creation SQL includes medical extension 006 and the single-owner layout recorded as migration 007. `PRAGMA user_version` remains the official base value `1`; feature readiness is checked by schema capability, not that value alone. A newly created database has no `people` table or `reports.person_id`. Each vault represents one owner, with no owner selector, owner form field, or People Admin Events.

`hasMedicalFoundation` checks the typed medical tables/columns introduced by 006. `hasMedicalSchema` additionally requires the old report owner column to be absent. `LoggerService.inspectMedicalUpgrade` returns readiness and the reviewed database checksum without writing. The Settings-only `upgradeMedical` action runs 006 when the foundation is missing, then 007 when `reports.person_id` still exists. Migration 007 drops the obsolete column and People table. No split-record or multi-owner routing is implemented.

The upgrade uses the normal serialized durable transaction, reviewed checksum, verified original-byte backup, WAL refusal, foreign-key/integrity checks, concurrent-write checks, and post-write verification/restoration. It is never automatic on plugin load. Do not run it against a user's vault as part of a code or documentation update; the user reviews and confirms it in Settings. A base-database connection test is not proof of optional medical readiness.

`measurements` stores raw `value_text`, nullable numeric `value`, optional comparison operator, `unit_at_time`, `value_type_at_time`, and source ordinal. Numeric results require a catalog unit; qualitative/text results have no numeric unit. `medication_intakes` stores the actual amount and `unit_at_time`. These snapshots are not relabeled by later catalog unit/type edits. Display names remain shared canonical names, so a rename can affect older displays. This is collection, not clinical interpretation, OCR, or automatic unit conversion.

## Form processing

Form discovery recognizes bounded Markdown blocks beginning with one of:

- `#### EH Daily Form`
- `#### EH Weekly Form`
- `#### EH Budget Form`
- `#### EH Medical Form`

Each block ends at its matching `#### END`. A file may contain one form of each kind. Discovery normally scans opted-in notes whose YAML marker is `EH form: true` or `EH form: unimported`; the broader Journal-folder mode also considers unmarked notes.

Keep discovery, parsing, validation, and persistence separate:

1. discovery identifies form descriptors and dates;
2. pure parsers turn bounded text into typed data and validation findings;
3. inspection runs against an in-memory database clone;
4. the UI presents a dry-run confirmation;
5. the guarded writer repeats conflict checks and applies the approved mutation;
6. post-write integrity and replacement checks verify the result.

Admin Events are applied to the disposable in-memory inspection database before dependent session, meal, exercise, transaction, milestone, valuation, medication, or symptom references are validated. In particular, `prepareDaily` resolves `inspectDailyHealth` after `applyAdminEvents`, not during initial parsing. This lets one Daily Form introduce canonical records or aliases and use them in the same preview and confirmed import. `DailyAssessmentView` must render the Meals result embedded in this full inspection rather than treating a separate Meals-only inspection as authoritative. If standalone Meals validation fails while the staged full Daily inspection succeeds, the separate Meals action remains disabled because a Meals-only write cannot persist the Admin Event that owns the new food reference.

Daily session rows use one shared parser in `src/forms/session-row.ts` and accept exactly two shapes:

- typeless: `interval | engagement | notes`;
- explicitly typed: `interval | type | engagement | notes`.

The legacy four-field row with an empty type remains valid. Ordinary rows store a null `session_type_id`, retain the engagement's required type, and use that engagement type for calendar color. Current-day planning projection uses the same row parser, preventing preview/import/calendar grammar drift. A form with Exercise Details must resolve exactly one `exercise`-typed owner session. Session and engagement type removal commands set `is_active = 0` so existing foreign-key references remain valid, and their add counterparts create or reactivate codes.

Weekly planning-grid cells deliberately retain the separate semicolon grammar `optional type ; engagement ; optional notes`. The first position must exist even when blank. Imported Weekly rows drive future Calendar dates directly; the optional Sync week workflow materializes current/future rows only into empty Daily Sessions sections.

Daily metrics separate observation from inference. `mood`, `energy`, `stress`, `weight_kg`, `fasted`, optional `dieted`, and free-text `notes` may come from the form. Full Daily inspection always calculates `calories` and `protein_g` from structured foods, `studied`/`worked`/`exercised` from session and engagement signals, and `sleep_hours` from the configured whole-hour assessment boundary. A manual legacy value for a calculated field is accepted for compatibility but replaced by the inferred value and warned when different. Sleep evidence may be identified by session type `sleep`, engagement type `sleep`, or canonical engagement name `sleep`; overnight sleep must be split across dates because session intervals cannot cross midnight.

The forms in `EH Forms/` are part of the user-facing grammar. Update explained and minimal variants together when a field, command, or format changes.

The explained templates describe lifecycle and interpretation rules. Minimal templates intentionally contain only the required structure, accepted formats, type lists, and empty entry areas. Do not reintroduce calculated Daily metric inputs into the minimal form merely to mirror database columns.

`EH Forms/fa/` mirrors all eight templates in Persian, with the same filenames and a language-specific README. Translate human-facing prose and sample values, not parser tokens: preserve bounded headings, section names, labeled keys, `ENTRIES:`, metadata states, command/type codes, weekday grid labels, and ASCII numeric/date/time delimiters. Do not add RTL control characters or translated suffixes to parser headings. Keep the localized templates aligned with the English grammar and exercise both empty templates and Persian data through the actual import functions; no runtime locale branch is needed for Unicode names or notes.

### Grouped Daily health and finance

`dailyFormSections` maps `##### Medical` with `###### Medication` and `###### Symptoms`, and `##### Financial` with `###### Transactions` and `###### Valuation Rates`, onto the same leaf contracts as the legacy flat headings. Reject duplicate flat/grouped leaves, duplicate groups, unknown children, and group-level `ENTRIES:` markers. Preserve absolute source offsets for bounded staging. Do not change stored taxonomy just to group the presentation.

Medication rows are `time | medication | amount | notes` (strict 24-hour `HH:mm`, positive amount, required dose unit resolved from the catalog). Symptom rows are `time | symptom | notes`. All row fields are nonempty. Each collection stores an independent state: `unrecorded` for missing/empty entries, `none` for one exclusive standalone `none`, or `recorded` for rows. A `none` notes field does not change collection state. Full Daily replacement deletes health children before their daily owner and retains separately imported Medical reports and shared catalogs. Reimport requires empty Admin Events; it does not replay catalog writes.

### Health catalog commands and staging

`queryCommandCatalog` exposes four catalogs with units, value types, and aliases behind `health.available`. Missing optional health schema yields unavailable/empty health lists without breaking Foods, Engagements, Exercises, or Accounts. Command Center displays persisted catalog state only; staged note text is not a pending catalog overlay.

`HealthCommandForms.ts` builds `MEASUREMENT_CREATE/UPDATE`, `MEDICATION_CREATE/UPDATE`, `SYMPTOM_CREATE/UPDATE`, and `PROCEDURE_CREATE/UPDATE`. `command-registry.ts` defines exact arities. Measurement CREATE takes name/type/unit and optional aliases; UPDATE adds the existing name and requires the alias field. Medication CREATE takes name/unit and optional aliases; UPDATE adds the existing name and requires aliases. Symptom/procedure CREATE takes name and optional aliases; UPDATE takes existing name/new name/aliases. UPDATE resolves one canonical record by name or alias and replaces its complete alias list, including clearing it when empty. The writer checks case-insensitive canonical/alias collisions within the selected catalog.

The editor validates delimiters, required names/units, measurement type, and one-alias-per-line input, then calls the shared `stageAdminCommands`. That path chooses a discovered unimported Daily Form, previews the exact commands, asks for staging confirmation, and writes only the bounded Admin Events note edit. It does not save the database or turn the editor's review into an import confirmation. A target may be past, today, or future, but a future Daily Form cannot yet finalize its commands. Final application uses the ordinary full Daily import, not Meals-only, Medical import, or Calendar planning synchronization. The legacy command ID `manage-health-catalogs` now opens Command Center → Health; no direct-save catalog modal remains.

### Medical source imports and dashboard

Keep exactly one Medical Form per source note, representing one source report with many compact observations/procedures. Header fields are `report`, `performed`, `reported`, `source`, and optional `report id`; no person field is parsed. `report` is required. Unknown dates/source paths may remain blank; known paths are vault-relative. Numeric comparisons are preserved, repeated measurements remain separate rows, and source order is retained. Compact report fields support `\\|`, `\\n`, and `\\\\` escapes. Context such as observation dates and specimen belongs in notes rather than new inferred fields.

`medical_report_imports` links a native receipt to its report and source note path. The optional explicit report ID supports a moved source note, but must refer to an existing native import. A source document cannot be silently attached to another native report. Preview reports old row counts; confirmed reimport replaces only that report's measurements/procedures, not unrelated reports, Daily logs, or catalogs. Verify both source and reviewed database before persistence. Medical source forms are always retained, and native receipts participate in mixed-file completion; Daily and Medical forms in one note still require separate imports.

The saved view type remains `examined-human-records` for existing workspaces; `RecordsView.ts` remains a compatibility reexport. Medical Dashboard lists only native report receipts and canonical Daily medical logs with a recorded or explicit-none collection. Paging is deterministic and bounded to 50 items, newest first. Details retain source ordinal order, expose source links, preserve selection/scroll on shared refresh, and move the navigator above details on narrow screens. No charts, laboratory grouping, or interpretation are implemented.

## Dashboard navigation and presentation

The shared registry has nine dashboards: Calendar, Daily/Weekly Assessment, Engagements, Finance, Nutrition, Exercise, Medical, and Command Center. A custom Stoic portico icon opens the right-sidebar navigator; dashboard rows use built-in Lucide icons and colored active accents. Register icons once rather than rendering emoji or requiring an icon plugin.

Normal selection reuses the most recent unpinned EH dashboard leaf. Preserve notes, other plugins, and pinned dashboards by opening a fresh main leaf instead. Selecting the current dashboard preserves it. Ctrl/Cmd-click, middle-click, the visible ↗ action, and dashboard commands request a fresh tab. Navigation is serialized; the mobile right drawer collapses after navigation. Do not replace the sidebar leaf itself with a dashboard.

The compact sidebar read model counts canonical time, sessions, participating engagements, and session dates across all history through today, excluding projections. Format duration as `hh:mm`. All visible Refresh buttons call the shared refresh boundary; background changes show a per-view notice without redrawing the reader. Preserve nested and outer scroll and selection. The ten-minute authoritative source check remains necessary even when metadata is unchanged.

Daily Assessment and active-file previews share the same time-chart selector: engagement or presentation-only session-type grouping. Use the explicit type, falling back to engagement type; keep exact canonical Sleep separate. Do not rewrite persisted taxonomy to implement grouped chart labels. The release-notes modal and Health editor use scoped responsive widths and scrollable content with visible actions; other plugins' modal styling must remain untouched.

## Build and verification

Run the checks separately when diagnosing failures so a stalled step is not mistaken for success:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The aggregate source check is:

```bash
npm run check
```

Full release validation is:

```bash
npm run release:check
```

The scripts currently mean:

- `npm run lint` checks source conventions with Obsidian-aware ESLint rules.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm test` runs the Node test suite, including in-memory SQLite fixtures.
- `npm run build` typechecks and creates the production bundle.
- `npm run release:check` runs checks, builds, and validates release artifacts and metadata.

On restricted Windows hosts, an esbuild `Access is denied` result may be environmental. Rerun the identical build in a permitted environment before treating it as a source defect.

## Database and note validators

Validate a database without printing private session content:

```bash
npm run validate:database -- C:\path\to\EH.db
```

Rehearse one historical Daily Form against an in-memory clone without writing the source database or note:

```bash
npm run validate:historical-import -- C:\path\to\EH.db C:\path\to\YYYY-MM-DD.md 0 1850 0
```

Validate native notes with the dedicated notes script where appropriate:

```bash
npm run validate:notes -- <arguments>
```

Do not print note bodies, private session names, database rows, secrets, or `.env` values in routine validation output.

## Build output and local deployment

SQL.js, the SQLite WebAssembly runtime, and the required SQL assets are bundled into `main.js`. Obsidian/Electron APIs remain external. A normal installation therefore contains only:

- `main.js`
- `manifest.json`
- `styles.css`

`main.js` is tracked as a generated release artifact. Always regenerate it through the production build and never edit it by hand.

After a plugin-facing change, manually test those current artifacts in a disposable or development vault. A Wax Vault deployment contains only the same three files under `.obsidian/plugins/examined-human/`.

Never deploy or copy:

- `data.json`;
- `EH.db` or another personal database;
- SQLite `-wal`, `-shm`, or journal files;
- backup directories;
- another user's private notes or sessions.

Preserve the destination vault's settings and database. Do not commit, tag, push, publish, or create a release unless the user explicitly authorizes that action.

## Testing expectations

Use synthetic notes and in-memory databases. Tests should cover both accepted input and intentional rejection, including:

- form bounds, YAML discovery status, date handling, and Journal-folder safety;
- canonical-name and alias resolution;
- same-form Admin Event resolution in full Daily preview without persistent inspection writes;
- both accepted Daily session row shapes and engagement-type fallback in canonical and planned calendar events;
- inferred nutrition, activity, and configured-boundary sleep metrics;
- unknown or ambiguous references;
- stable imported receipts, confirmed full-day/report replacement, and current/future projections;
- Admin Events and Command Center staging;
- same-form medication/symptom creation and use, catalog alias replacement/collisions, unit/type snapshots, empty/unrecorded/none distinctions, and rejected People commands;
- Medical source identity, moved-note IDs, report-scoped replacement, retained source forms, and bounded imported-order dashboard paging;
- fresh single-owner schema, migration 006/007 readiness, and checksum-confirmed upgrade without automatic writes;
- dashboard sidebar reuse/new-tab/mobile actions, canonical-only summaries, and responsive notice/editor layouts;
- Meals thresholds, snack contribution, nutrition snapshots, and unresolved foods;
- weekly commitments, grids, overlap rules, and Daily Note materialization;
- budgets, transactions, transfers, balances, reconciliation, and valuation coverage;
- optional exercise and milestone extensions;
- WAL refusal, backups, retention, conflicts, and integrity verification;
- query mapping, dashboard semantics, and bounded calendar layout.

When behavior or an invariant changes, update tests, the appropriate user forms, `README.md`, `docs/ARCHITECTURE.md`, and `CHANGELOG.md` in proportion to the change.

## Release process

Follow [docs/RELEASING.md](docs/RELEASING.md). At minimum, a release candidate should have:

- matching versions in `package.json`, `manifest.json`, and the release metadata;
- passing lint, typecheck, tests, build, and release checks;
- only the three supported release artifacts in the installation payload;
- user-visible behavior documented in `README.md` and `CHANGELOG.md`;
- no personal data, local settings, or SQLite sidecars in Git.

Release instructions never imply authorization to commit, push, tag, or publish. Those actions require an explicit request.

## Privacy and repository hygiene

Never commit `EH.db`, personal SQLite databases, SQLite sidecars, `.examined-human-backups`, vault-local `data.json`, or private Daily Notes. Keep validation output aggregate and content-free.

Before handoff, inspect:

```bash
git status --short
git diff --check
```

Preserve unrelated user changes in a dirty worktree.

## Extension seams

- Add read models in the appropriate feature module under `src/read-models/`; preserve compatibility exports when existing imports depend on them.
- Add approved writes through `LoggerService` and pure logger modules.
- Reuse `src/forms/` for EH Form boundaries, sections, `ENTRIES`, labeled fields, and delimited rows instead of adding parser-local variants.
- Add future event sources behind a provider that returns the shared session/event domain model.
- Keep filters as view state over mapped domain records.
- Keep formatting and color policy centralized in `src/events.ts`.
- Preserve bounded date queries and avoid large embedded content because sql.js loads the complete database file.

The detailed rationale, limitations, refresh model, query semantics, visual packing, and long-horizon constraints remain authoritative in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Attribution and license

Examined Human originated as a fork of `seonggoos/obsidian-schedule-calendar`. Preserve the upstream attribution in `README.md` and both copyright lines in `LICENSE`.
