# Changelog

## [Unreleased]

## [0.9.4] - 2026-09-02

### Added

- Added the official Examined Human Data Schema v1 Food Dictionary: canonical foods, compact list-based food aliases, required calories/protein/carbs/fat/salt profiles, and optional fiber/cholesterol profiles
- Added strict canonical Daily Note meal rows: `food | amount_g`, with an optional `g` suffix and calculated immutable food/nutrition snapshots
- Added complete Food Admin Events for creation, full updates, rename, delete, and list-based alias add/remove/move actions
- Added the explicit confirmation-gated one-time legacy database conversion to Schema v1, with a durable backup, transaction, integrity checks, and persisted-byte verification
- Added the Command Center Food Library with canonical-food search, alias audit, staged create/update/rename/delete/alias actions, usage visibility, and a per-gram nutrition calculator
- Added Daily Assessment’s grouped unresolved-reference panel for contextual Food, Engagement, Exercise, and Account corrections staged into the active unimported Daily Note
- Expanded the Command Dashboard with Engagement, Exercise, Account, and Batch tabs; lifecycle, canonical metadata, aliases, and bulk Admin Event lines are all staged through Daily Notes
- Added `EXERCISE_UPDATE` and `EXERCISE_RENAME` Admin Events for canonical exercise maintenance
- Added mutable, non-overlapping Budget Forms with signed engagement targets, dated expected movements, active-budget selection by date, and exact-period reimport
- Added user-entered historical Valuation Rates with case-insensitive asset units, independently carried-forward partial rate histories, a configurable reference asset class, and as-of-date net-worth valuation
- Added Finance account selection, native-unit/reference-unit display modes, per-account and all-account balance histories, period inflow/outflow, and engagement flow analysis
- Added `Examined Human: Import Daily Form from Active File`, `Examined Human: Import Weekly Form from Active File`, and `Examined Human: Import Budget Form from Active File` commands
- Added cached vault form discovery for `EH form: true` and `EH form: unimported`, with an opt-in Journal-folder fallback for unmarked notes
- Added Command Dashboard staging for Valuation Rate rows, opening balances, and balance reconciliation into an existing Daily Form

### Changed

- Replaced retired database naming and migration history with official Data Schema v1; new databases start at SQLite user version 1 with one Schema v1 migration record
- Rejected legacy hand-entered `food | calories | protein` note rows instead of accepting unlinked nutrition data
- Removed the Engagement Dashboard’s direct completion shortcut; engagement lifecycle commands now live in the Command Dashboard
- Made Weekly Forms and Budget Forms mutable plans: matching weeks and exact matching budget periods replace their stored rows, while finalized historical Daily Forms remain immutable receipts
- Reworked Finance around current balances and selected-period inflow/outflow instead of opening-balance decomposition and static currency panels
- Marked fully imported Daily/Weekly form files as `EH form: imported`; Budget import and future-note synchronization leave the marker unchanged
- Made one discovered Markdown file capable of contributing any combination of Daily, Weekly, and Budget Forms, ordered by each form's declared date

### Fixed

- Guaranteed a line break after every plugin-staged Admin Event so a following `#### END` marker cannot become part of the command line
- Kept Valuation Rate staging inside the template's existing `##### Valuation Rates` `ENTRIES:` block and guaranteed a trailing line break
- Prevented duplicate Daily dates, duplicate Weekly starts, overlapping Weekly ranges, and overlapping Budget periods from being silently accepted
- Preserved complete account and engagement labels in the redesigned Finance and Command Dashboard layouts

## [0.9.2] - 2026-08-30

### Added

- Added a vault-relative Journal folder setting for recursive Daily Note discovery and weekly-plan materialization; the canonical supported filename format remains `YYYY-MM-DD.md`
- Added a configurable mobile calendar day width, defaulting to 160 pixels
- Made recent Exercise Dashboard workouts open the shared session-details modal with their structured exercises and sets

### Changed

- Simplified Finance by removing transaction/linkage/currency summary metrics and the visible linkage warning, while preserving unresolved legacy-row query semantics
- Reframed the Finance account panel around most-used accounts, ranked by transaction count with currency and period net flow shown as context

### Fixed

- Allowed a still-ephemeral Meals component to be replaced and finalized after its date becomes historical, while preserving immutability for genuinely finalized historical Meals
- Kept historical ephemeral Meals visible as replaceable in Daily Assessment instead of incorrectly labeling them finalized
- Stopped unlimited current/future Meals replacements and planning-projection refreshes from creating database backups; durable and finalized writes remain backed up
- Made every dashboard Refresh action rebuild the database source boundary and reload all open views, with an unconditional ten-minute reload for unannounced external changes
- Added SQLite WAL fingerprinting and guards so dashboards never display stale main-file bytes and native imports cannot overwrite another plugin's uncheckpointed changes

## [0.9.0] - 2026-08-22

### Added

- Read-only Engagement Dashboard with search, status/type filters, and all-time, 30-day, 90-day, and one-year ranges
- Per-engagement logged time, session counts, lifecycle dates, notes, activity trend, session-type mix, lifetime milestones, and recent sessions
- Engagement-linked financial summaries kept separate by account currency, with explicit warnings for legacy or unresolved transaction rows
- Synthetic query coverage for range filtering, lifetime milestones, owner sessions, multi-currency totals, and unresolved transaction exclusion
- Financial Dashboard with currency-safe flow summaries, date/currency filters, trends, accounts, engagement spending, linkage coverage, and transaction detail
- Nutrition Dashboard with calorie/protein trends, adherence evidence, meal and food breakdowns, and coverage-aware 10% leisure debt
- Exercise Dashboard with workout time, training frequency, structured-detail coverage, set volume, exercise performance, muscle exposure, and recent workout detail
- Synthetic reconciliation tests for all three domain dashboards
- Configurable numeric database-backup retention, where `0` keeps all and a positive whole number keeps that many newest EH-created backups
- Persistent per-warning dismissal preferences for non-blocking dashboard warnings, with a temporary close button and a Settings reset

### Changed

- Registered the Engagement Dashboard as a first-class command and included it in global dashboard refreshes
- Registered Finance, Nutrition, and Exercise as first-class native commands sharing the same read-only, mobile-safe refresh path
- Completed the v0.9.0 analytical dashboard package for consolidated pre-v1.0 testing
- Made Engagement search match canonical names and engagement aliases
- Expanded Engagement linked money from currency totals to totals plus every linked transaction in the selected period
- Reflowed Engagement recent sessions and transaction details into readable mobile cards with full-width notes and descriptions

### Fixed

- Allowed a full historical Daily Note import to adopt an identical earlier Meals component after unrelated note sections changed the whole-note checksum; genuinely changed finalized Meals remain immutable
- Pruned eligible backups oldest-first only after a successful verified database write, while preserving the current backup and ignoring unrelated files

## [0.8.5] - 2026-08-21

### Added

- Native strict parsing, validation, preview, and canonical import for complete schema-v5 historical Daily Notes
- Native Daily Metrics expressions, sessions, transactions, exercise details and sets, milestones, stoicism, and every documented admin command
- Native tolerant current/future planning projections with estimated-time warnings, alias resolution, replacement, and missing-note detection
- Native weekly-plan parsing/import, commitment conversion, adjacent-grid-cell collapse, and guarded weekly-to-Daily-Note materialization
- Native milestone reconciliation and synthetic end-to-end tests for Daily, planning, and weekly workflows
- Database backups and integrity verification for every native mutation, plus checksum guards and rollback for multi-note weekly writes

### Changed

- Removed the Python interpreter setting, process bridge, and bundled Python runtime from the plugin deployment
- Enabled full Daily and Weekly logger actions on both desktop and mobile
- Kept dashboard SQL reads isolated from the native writer and retained immutable historical Meals/component provenance rules
- Renamed the third transaction input field from `category` to `engagement`, required name-or-alias resolution, stored the resolved engagement ID, and mapped it back to the canonical name in dashboards
- Required every native milestone to identify exactly one same-engagement owner session and made `session_id` non-null with restricted deletion in newly created schema-v5 databases

### Fixed

- Reused hidden `.examined-human-backups` directories through the vault adapter instead of attempting to recreate an unindexed folder and failing with `Folder already exists.`

## [0.8.0] - 2026-08-21

### Added

- Obsidian-native schema-v5 Meals parsing, validation, preview, confirmation, and import on desktop and mobile
- Breakfast, Lunch, Dinner, and Snacks grouping with manual and per-meal calorie-limit leisure evaluation
- Daily calorie and minimum-protein settings for objective `dieted` evaluation, with zero disabling each rule
- Snack-safe effective daily calories using the higher of Daily Metrics calories and all structured food rows
- Component-level import provenance, immutable historical Meals, and replaceable current/future Meals
- Guarded SQL.js writer with serialization, SHA-256 stale-file detection, pre-write backups, transactions, and post-write integrity verification
- Creation of a complete empty Examined Human schema-v5 database from the settings page
- Synthetic tests for the new grammar, nutrition rules, component lifecycle, schema creation, and native row replacement

### Changed

- Kept the dashboard query service permanently read-only while isolating approved writes in a separate native writer
- Updated the plugin and database contract from schema v4 to schema v5

## [0.7.0] - 2026-08-11

### Added

- Newest-first weekly-note navigator combining pending Markdown notes and imported weekly plans
- Confirmation-gated weekly imports through `-import-week`
- Current/future week synchronization through `-write-week-plan`, followed automatically by dry-run and live `-import-future`
- Copyable weekly logger output and explicit partial-stage failure reporting

### Changed

- Daily Assessment now uses one newest-first note list instead of separate status groups
- Pending overdue notes use a faint red tint, current notes/weeks use blue, and future notes/weeks use green; imported records remain neutral
- Weekly and Daily Assessment logger actions remain desktop-only while both lists and read models remain available on mobile

## [0.6.0] - 2026-08-10

### Added

- Daily Assessment dashboard with a 50-day imported history, overdue backlog, and current/future notes
- Read-only daily timeline, time-by-engagement chart, daily metrics, foods, transactions, and exercise details
- Desktop Python interpreter setting and connection test
- Structured, non-mutating logger inspection for unimported notes
- Copyable validation errors, completeness warnings, and confirmation-gated historical imports
- Confirmation-gated current/future planning synchronization through `-import-future`

### Changed

- Extracted the calendar session-card renderer for reuse by Daily Assessment
- Kept Daily Assessment read-only on mobile while restricting Python logger actions to desktop

## [0.5.0] - 2026-08-10

### Added

- Weekly Assessment dashboard opened with the `Examined Human: Weekly Assessment` command
- Date-jump navigation across imported weekly plans
- Separate committed-target and actual-logged bars, weekly totals, remaining time, and commitment goals

### Changed

- Weekly actual time aggregates all canonical logged session types for each committed engagement
- Weekly assessment deliberately excludes scheduled weekly-grid rows

## [0.4.0] - 2026-08-10

### Added

- Read-only weekly-plan and weekly-commitment query support for the forthcoming planning dashboard

### Changed

- Updated the database contract to Examined Human schema version 4 numeric taxonomy foreign keys
- Resolved session and engagement display codes through canonical taxonomy tables

## [0.3.0] - 2026-07-21

### Added

- Read-only exercise-session breakdowns showing ordered exercises and recorded sets, including weight, reps, distance, duration, and notes
- Graceful compatibility with databases that do not include the optional exercise-detail tables
- Read-only planned sessions sourced from the optional `note_sources` and `planned_sessions` schema
- Estimated display slots for planned sessions without a usable time
- Awaiting-finalization day highlighting and planned-source details in tooltips and modals
- Optional session-linked milestone details from schema version 2
- Singular/plural milestone counts in sufficiently tall session-card footers
- Milestone names, dates, measurements, and notes in the session details modal

### Changed

- Renamed the visible product from EH Calendar to Examined Human to support multiple present and future dashboard views
- Kept the compatibility plugin ID `examined-human`, repository/package name, CSS namespace, command IDs, settings schema, and Examined Human database terminology unchanged

## [0.2.0] - 2026-07-21

### Added

- Bounded compact stacking for visually colliding short sessions
- A strict ten-minute endpoint tolerance and exact-position fallback for clusters that cannot fit safely
- Android/mobile activation and touch-friendly responsive calendar styling
- Approximately one full day per phone viewport, recalculated after orientation changes
- Vault-relative database path validation with traversal and absolute-path rejection
- Regression tests for stack feasibility, dense-cluster fallback, and mobile-safe database paths

### Changed

- Renamed the visible product from Examined Human Calendar to EH Calendar (Examined Human Calendar)
- Kept the compatibility ID `examined-human`, repository name, CSS namespace, and Examined Human database terminology unchanged
- Restricted database access to files inside the vault on both desktop and mobile
- Removed runtime Node filesystem/path dependencies
- Replaced `type: Engagement` card titles with canonical engagement names and moved session type to a footer on sufficiently tall cards

---

## [0.1.0] - 2026-07-20

### Added

- Read-only SQL.js access to an Examined Human SQLite database using an absolute or vault-relative path
- Schema validation, integrity checks, and a privacy-safe real-database validation command
- A 24-hour calendar grid with continuous horizontal day navigation and vertical time scrolling
- Past, current, and future day styling with a live current-time indicator
- Side-by-side layout for overlapping sessions
- Session cards titled `type: Engagement` with `hh:mm` duration badges
- Configurable colors for known session types
- Gray rendering and explicit database-correction prompts for invalid `chor` rows
- Read-only session details modal
- Manual refresh, automatic vault-relative refresh, and file-fingerprint polling
- Unit tests for SQL mapping, formatting, `chor`, and overlap behavior
- Architecture, privacy, development, validation, and release documentation

### Changed from the upstream fork

- Renamed the plugin from Schedule Calendar to Examined Human Calendar and restarted versioning at `0.1.0`
- Replaced Daily Notes parsing and write-back with an Examined Human SQLite read model
- Replaced daily/weekly/monthly modes with one continuously scrollable calendar surface
- Removed event creation, editing, deletion, drag/drop, undo, checkboxes, tag colors, and localization
- Embedded the SQL.js WASM runtime into the normal Obsidian `main.js` artifact

### Attribution

This version began as a fork of `seonggoos/obsidian-schedule-calendar`. The Obsidian view scaffolding and overlap-layout foundation were adapted for the Examined Human database product; the original MIT attribution is preserved.

---

The entries below are the inherited Schedule Calendar history from before the Examined Human Calendar fork.

## [1.3.0] - 2026-07-13

### Added
- Automatic integration with the core Daily Notes folder, date format, and template
- Manual daily-note folder and Moment.js date-format fallback
- Template-aware creation of missing daily notes with automatic schedule-section insertion
- Side-by-side layout for overlapping timed events in daily and weekly views
- Markdown checkbox completion controls for timed events
- All-day events using checkbox entries without a time range
- Horizontal drag between dates in weekly view, including creation of a missing target daily note
- Conflict-safe multi-file undo for cross-day moves
- Parser and overlap-layout regression tests for the new behavior

### Changed
- Newly created events use checkbox syntax while existing non-checkbox timed entries retain their format
- Daily mutations refresh all event regions, including all-day events

---

## [1.2.2] - 2026-07-13

### Fixed
- Updated `minAppVersion` to `1.8.7` to match the Obsidian APIs used by the plugin
- Added the official `eslint-plugin-obsidianmd` rules and resolved all submission errors and warnings
- Replaced global document access with `activeDocument` for popout window compatibility
- Replaced direct visibility styles with CSS classes
- Made every asynchronous UI callback explicitly handled
- Shortened the command ID so Obsidian can namespace it automatically
- Updated TypeScript, esbuild, and Obsidian API type dependencies

---

## [1.2.1] - 2026-07-13

### Added
- Full Korean and English UI localization based on the current Obsidian language
- English fallback for every other Obsidian language
- Locale-aware navigation, settings, notices, statistics, dates, and accessibility labels

---

## [1.2.0] - 2026-07-13

### Added
- Mobile-friendly **Add event** button with the next 15-minute slot preselected
- One-click daily note creation when the selected date has no note
- Strict time validation with clear feedback for invalid or reversed ranges
- Parser and write-back regression tests, including duplicate events and CRLF notes

### Changed
- All note edits now use Obsidian's atomic `Vault.process()` API
- Undo restores a change only when the note has not been modified elsewhere
- Time fields use native time inputs with 15-minute steps
- The default schedule heading is consistently `### Schedule`

### Fixed
- Editing or deleting one of two identical events no longer affects both entries
- External note edits are no longer overwritten by a stale undo snapshot
- Popup outside-click listeners are cleaned up immediately
- Empty daily note folder settings correctly target the vault root
- Existing CRLF line endings are preserved during write-back

---

## [1.1.0] - 2026-05-19

### Added
- **Drag tooltip** — floating `HH:MM – HH:MM` label follows the cursor during any drag or resize
- **Undo** (`Cmd/Ctrl+Z`) — reverts the last change (drag, resize, edit, delete, add), up to 20 steps
- **Tag colors** — events with `#tag` in their title get a unique accent color on the left border; monthly chips reflect the same colors
- **Daily stats bar** — shows total scheduled time and per-tag time breakdown below the daily timeline
- **Zoom** — `−` / `+` buttons in the header scale the timeline density (0.75× / 1× / 1.5× / 2×)
- **Top resize** — drag the top edge of an event to adjust its start time (daily view)
- **Note link** (`↗`) — edit popup shows an open button when the event title contains a `[[wiki link]]`

### Changed
- `PX_PER_MIN` is now a dynamic getter driven by zoom level; CSS uses `--dtl-row-h` custom property

---

## [1.0.1] - 2026-05-19

### Fixed
- Plugin ID mismatch (`note-calendar` → `schedule-calendar`) corrected in all files
- Replaced deprecated `builtin-modules` npm package with native `module.builtinModules`
- Removed `detachLeavesOfType` from `onunload` (violates Obsidian plugin guidelines)
- Settings heading now uses `Setting.setHeading()` instead of raw `createEl`

---

## [1.0.0] - 2026-05-19

### Initial release
- Daily, weekly, and monthly views
- 24-hour timeline with drag-to-move and bottom-edge resize (15-minute snaps)
- Double-click empty area to add an event (ghost preview + configurable default duration)
- Click event to edit title and time in a popup; delete from the same popup
- Auto-sync — all changes written back to the daily note file immediately
- Now-line showing current time
- Configurable schedule section name, daily note folder, and default event duration
