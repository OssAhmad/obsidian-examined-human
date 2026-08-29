# Examined Human architecture and maintainer notes

This document records how the first SQL.js-backed version works, why its boundaries exist, and where future features should be added. It is intended for both human maintainers and coding agents.

## Product invariants

Treat these as part of the plugin contract unless a deliberate product decision changes them:

1. The `ExaminedHumanDatabase` dashboard query layer is permanently read-only. Approved mutations belong only in `NativeLoggerWriteService`; never add write APIs to the reader.
2. `EH.db`, SQLite sidecar files, and Obsidian's local `data.json` must never be committed.
3. A card title is the engagement's canonical name. Session type is secondary metadata shown only when the rendered card has enough room, and remains available in the tooltip and details modal.
4. A card duration is shown as zero-padded `hh:mm`.
5. Event geometry comes from `start_time` and `end_time`; the displayed duration comes from `duration_minutes` when it is valid.
6. `chor` is not an alias for `chore`. It is an invalid source value that renders gray and prompts the user to repair the database.
7. Unknown session types render gray. Known types can be recolored in settings.
8. Past, current, and future sessions share one scrollable calendar dashboard; current/future projections remain explicitly noncanonical.
9. Database paths are always relative to the vault root so the same setting works on desktop and mobile.
10. Close-session visual packing may move a displayed start or end by at most ten minutes. It never changes stored data, tooltips, or modal details.
11. Exercise and milestone details are optional. Missing extension tables or columns must not prevent ordinary sessions from loading.
12. A date present in `imported_notes` uses canonical sessions. Otherwise, an active planning projection may supply mutable sessions for that date.
13. The plugin scans note filenames, EH Form presence, and weekly `week start` frontmatter for navigation, then natively parses every schema-v5 Daily and Weekly import component.
14. Runtime logger code uses only Obsidian APIs, Web Crypto, and SQL.js. Python and Node process/filesystem APIs are not plugin dependencies, so the complete workflow is mobile-compatible.
15. Canonical Daily Notes use `YYYY-MM-DD.md` filenames inside the recursively scanned, vault-relative Journal folder configured in Settings. The default folder remains `Oss Ahmad Journal`; legacy filename read compatibility is retained.
16. Native writes are serialized and confirmation-gated. They must verify schema v5, snapshot the source checksum, detect stale database bytes, use one transaction, run `quick_check` and `foreign_key_check`, and verify the persisted bytes. Durable/finalized writes create a pre-write backup; replaceable ephemeral Meals and planning projections deliberately do not. Optional retention cleanup runs only after a verified durable write, keeps the current backup, and targets only exact EH-created backup names.
17. Historical Meals components are immutable once finalized. Current/future Meals are `ephemeral` and replaceable; if the date becomes historical while the component is still ephemeral, one confirmed component or canonical full-note import may replace and finalize it from the completed note.
18. Snacks never directly increase the leisure-meal count. They do contribute to structured-food calories; the effective daily total is the higher of Daily Metrics calories and all structured food rows.
19. The third canonical transaction field is `engagement`, not a free-form category. It must resolve uniquely through engagement names or aliases. The native importer stores the engagement ID in the legacy `transactions.category` column; unresolved or empty values block import, while legacy free-text database rows remain readable.
20. Every native milestone has exactly one owning canonical session. The required owner interval must match one same-engagement Daily Note session; new schema-v5 databases enforce `engagement_milestones.session_id NOT NULL` with restricted owner deletion.
21. Engagement Dashboard analysis uses canonical sessions only. Its date range constrains sessions and engagement-linked transactions, while milestones remain lifetime facts. Financial amounts are grouped by recorded account currency and unlike currencies are never combined.
22. Financial Dashboard includes every transaction in currency-separated flow totals, but only numeric engagement references participate in engagement analysis. A period net is recorded flow, never an inferred account balance.
23. Nutrition Dashboard prefers schema-v5 assessment snapshots, uses legacy Daily Metrics only as a labeled fallback, and computes the 10% leisure-meal rate/debt only from assessed meal days.
24. Exercise Dashboard counts canonical sessions typed `exercise` plus canonical sessions carrying structured exercise rows. Session totals and set-detail coverage remain separate so incomplete detail never erases valid workout time.
25. Engagement search covers canonical names and every `engagement_aliases.alias`. Linked-money totals and the complete selected-period transaction ledger use the same strict numeric engagement ownership and currency-separation rules.
26. Non-blocking dashboard data-quality warnings may be closed for the current render or hidden persistently by stable warning key. Settings must restore hidden warnings. Import blockers, validation errors, and mutation confirmations are never hideable.

## Runtime data flow

```text
Obsidian command/ribbon
        |
        v
TimelineView
        |
        | visible YYYY-MM-DD range
        v
ExaminedHumanDatabase
        |
        | read vault-relative bytes through the vault adapter
        v
sql.js in-memory Database -- PRAGMA query_only = ON
        |
        v
examined-human-query schema validation + JOIN + row mapping
        |
        v
CalendarEvent[] + DataIssue[]
        |
        +--> overlap layout --> positioned cards
        +--> warning banner / Obsidian Notice
        +--> read-only details modal, including source state, exercise sets, and milestones

Weekly Assessment command
        |
        +--> weekly-note scan + read-only weekly-plan index
        |        |
        |        +--> one newest-first pending/imported list
        |
        +--> WeeklyAssessmentView --> ExaminedHumanDatabase --> queryWeeklyAssessment
        |        |
        |        +--> weekly direction and totals
        |        +--> separate target/actual bars by committed engagement
        |
        +--> native weekly parser + guarded writer
                 |
                 +--> pending-week preview + confirmed import
                 +--> checksum-guarded current/future Daily Note write
                 +--> automatic future-projection preview + sync

Daily Assessment command
        |
        +--> vault note index + read-only daily SQL query
        |        |
        |        +--> timeline, engagement bars, metrics, transactions, exercises
        |
        +--> native full-note parser --> preview + confirmation
                 |
                 +--> historical guarded writer --> backup + transaction + verification
                 +--> current/future planning projection replacement
                 +--> separate Meals component lifecycle controls

Engagement Dashboard command
        |
        +--> canonical-name/alias search + engagement navigator + date range
        |
        +--> ExaminedHumanDatabase --> queryEngagementDashboard
                 |
                 +--> canonical time, activity trend, and session-type mix
                 +--> lifetime milestones and owner sessions
                 +--> engagement-linked totals and complete transaction ledger by currency
                 +--> dismissible unresolved legacy-transaction coverage warning

Finance / Nutrition / Exercise Dashboard commands
        |
        +--> shared range controls + read-only refresh/fingerprint lifecycle
        |
        +--> ExaminedHumanDatabase --> domain query in examined-human-query.ts
                 |
                 +--> Finance: currency-safe flow, linkage, accounts, engagements, detail
                 +--> Nutrition: effective daily values, adherence, meals, foods, leisure debt
                 +--> Exercise: canonical workout time, sets, performance, muscles, detail coverage
```

The source database is read into memory for each inspection or range query. sql.js operates on that in-memory copy and the database instance is always closed in a `finally` block. `PRAGMA query_only = ON` is defense in depth, and the reader exposes no mutation API. Approved writes cross the separate `NativeLoggerWriteService` boundary. Because SQL.js exports a whole replacement file, that service uses checksums, a serialized queue, transactions, and post-write verification for every write. It creates backups only for durable/finalized mutations; unlimited current/future Meals replacements and planning-projection refreshes are intentionally backup-free because they are explicitly ephemeral. Hidden `.examined-human-backups` storage is probed and written through the vault adapter because Obsidian may omit dot-prefixed folders from its indexed `TFolder` tree; this also makes repeated durable writes and external folder-creation races safe on desktop and mobile. After a verified durable write, a positive `backupRetentionLimit` lists that exact database's EH-named backups, protects the current backup, and deletes excess files oldest-first. Zero keeps all. Cleanup failures are reported separately and never misrepresent the already verified database write as failed. Preview operations mutate only an in-memory clone, which allows admin commands and dependent facts to be assessed together without touching the vault database.

## Repository map

### Runtime

- `src/main.ts` — plugin lifecycle, settings load/save, view registration, ribbon icon, commands, and refreshing all open dashboard views.
- `src/examined-human-database.ts` — resolves configured paths, reads database bytes, initializes SQL.js, creates short-lived read-only database instances, and computes file fingerprints.
- `src/sql-runtime.ts` — shared, embedded SQL.js initialization used by the isolated reader and writer services.
- `src/examined-human-query.ts` — validates the required schema, performs SQL queries, maps rows into domain events, sorts events, and emits data-quality issues.
- `src/events.ts` — shared event model, known session types, default colors, time parsing, duration/time formatting, card-label policy, and the hard-coded gray `chor` rule.
- `src/TimelineView.ts` — calendar range management, SQL queries, toolbar, sticky grid, scrolling, zoom, event rendering, warnings, and automatic refresh.
- `src/WeeklyAssessmentView.ts` — unified weekly-note navigation, direction and total cards, commitment goals, target/actual bars, and native confirmation-gated actions.
- `src/weekly-note-index.ts` — weekly Markdown discovery, imported-plan reconciliation, newest-first ordering, and overdue/current/future classification.
- `src/DailyAssessmentView.ts` — daily-note navigation, assessment panels, full native preview/import, planning sync, and Meals component controls.
- `src/EngagementDashboardView.ts` — engagement navigation and filters, lifecycle summary, activity and session-type charts, milestones, currency-separated financial summaries, and recent sessions.
- `src/DashboardViewBase.ts` — shared range, fingerprint refresh, toolbar, formatting, metric-card, bar, and trend primitives for analytical domain dashboards.
- `src/dismissible-warning.ts` and `src/warning-preferences.ts` — shared non-blocking warning UI, stable dismissal keys, persistent preference sanitization, and Settings recovery contract.
- `src/engagement-search.ts` — pure canonical-name and alias matching used by the Engagement navigator.
- `src/FinancialDashboardView.ts` — currency filter, recorded flow, transaction linkage, account/engagement breakdowns, and recent transactions.
- `src/NutritionDashboardView.ts` — effective nutrition trends, adherence, meal/food mix, leisure debt, and assessment-coverage warnings.
- `src/ExerciseDashboardView.ts` — workout time/frequency, structured detail coverage, exercise performance, muscle exposure, and recent workouts.
- `src/daily-note-index.ts` — standard Daily Note discovery, imported/pending reconciliation, newest-first ordering, and overdue/current/future classification.
- `src/native-logger/meals.ts` — pure new-schema Meals and supporting Daily Metrics parser/evaluator.
- `src/native-logger/meal-import.ts` — pure schema-v5 capability checks, lifecycle policy, and normalized Meals SQL writes.
- `src/native-logger/daily-note.ts` — strict full Daily Note parser, validators, admin command application, canonical import, and milestone reconciliation.
- `src/native-logger/planning.ts` — tolerant current/future parser and replaceable `note_sources`/`planned_sessions` projection.
- `src/native-logger/weekly.ts` — strict weekly parser/import and weekly-to-Daily-Note write preparation.
- `src/native-logger/database-utils.ts` — shared schema, taxonomy, alias, date, and query helpers.
- `src/native-logger/write-service.ts` — serialized vault writer, SHA-256 conflict detection, backup creation, transaction staging, database creation, multi-note rollback, and post-write verification.
- `src/native-logger/checksum.ts` — mobile-safe Web Crypto checksum helpers.
- `src/NativeMealImportConfirmationModal.ts` — native Meals preview and explicit write confirmation boundary.
- `src/DailyImportConfirmationModal.ts` — completeness review and the Daily Assessment confirmation boundary.
- `src/WeeklyActionConfirmationModal.ts` — weekly dry-run review and confirmation boundary.
- `src/session-element.ts` — shared calendar/Daily Assessment session-card renderer.
- `src/overlap.ts` — deterministic side-by-side column assignment for overlapping timed sessions.
- `src/visual-stack.ts` — bounded compact positioning for close, non-overlapping short sessions.
- `src/SessionDetailsModal.ts` — read-only display of all mapped session fields.
- `src/settings.ts` — database path/testing/creation, nutrition thresholds, layout, and colors.
- `styles.css` — layout, sticky headers/gutter, past/today/future styling, cards, warnings, and modal presentation.

### Build and validation

- `esbuild.config.mjs` — bundles the plugin as CommonJS and embeds the SQL.js WASM binary and schema-creation SQL into `main.js`.
- `src/assets.d.ts` — TypeScript declarations for imported WASM bytes and SQL text.
- `migrations/000_create_schema_v5.sql` — complete empty schema-v5 creation script with public taxonomy seeds and no user data.
- `migrations/005_meal_events.sql` — auditable v4-to-v5 migration contract.
- `src/*.test.mjs` — Node tests for mapping, time formatting, `chor`, and overlap behavior.
- `scripts/validate-database.mjs` — validates a real database without printing engagement names or notes.
- `scripts/check-release.mjs` — checks version agreement and required release assets.
- `docs/RELEASING.md` — release procedure.

### Local-only and generated files

- `main.js` is generated by `npm run build` and intentionally ignored.
- `data.json` is generated by Obsidian and intentionally ignored because it contains local settings.
- `EH.db`, `*.db-journal`, `*.db-wal`, and `*.db-shm` are intentionally ignored.

## Database contract

The required schema is deliberately checked before querying:

```text
sessions:
  id
  engagement_id
  date
  start_time
  end_time
  duration_minutes
  session_type_id -> session_types.code
  notes

engagements:
  id
  name
  type_id -> engagement_types.code

session_types:
  id
  code

engagement_types:
  id
  code
```

The current query is an inner join from `sessions.engagement_id` to `engagements.id`. Therefore, an orphaned session is not rendered. The real-database validator compares the number of mapped rows with the session count, which helps expose this condition. A future data-quality pass should report orphaned rows explicitly rather than silently omitting them.

Exercise metadata is an optional extension of this base contract. When all documented columns are available in `exercises`, `session_exercises`, and `exercise_sets`, the range query attaches ordered exercise definitions and their sets to exercise events. Weight, reps, distance, duration, and set notes remain nullable because different exercise categories record different measurements. If the optional schema is absent or incomplete, the calendar still loads and the exercise modal reports that details are unavailable.

Milestone metadata is an optional schema-version-2 display extension. When `engagement_milestones.session_id` and the documented measurement columns are available, the query attaches every linked milestone and its measurements to the canonical session. The card footer adds a singular/plural milestone count, while the modal shows names, dates, values, and notes. Native input now requires `engagement | milestone | metric | value | owner session interval`, and resolution must find exactly one same-engagement session. New schema-v5 databases enforce a non-null owner with restricted deletion. Legacy unlinked milestones and databases without the optional column remain readable and do not affect ordinary session rendering, but native import and reconciliation will not create another ownerless milestone. Planned milestone projections are deliberately deferred.

Planning is another optional extension. If `note_sources` and `planned_sessions` contain all version-1 columns, the query determines source precedence per date. An `imported_notes.note_date` selects canonical sessions. Without that marker, an active note projection selects planned sessions and suppresses stale canonical rows for that date. Databases without the planning tables retain the previous canonical-only behavior.

Schema version 4 normalizes canonical session and engagement classifications. `sessions.session_type_id` joins `session_types.id`, while `engagements.type_id` joins `engagement_types.id`; the query layer exposes the resulting canonical codes to the existing event model. Planned sessions retain `session_type_raw` for provenance and optionally resolve through `resolved_session_type_id`.

The same version adds `weekly_plans`, `weekly_plan_sessions`, and `weekly_commitments`. `queryWeeklyPlanIndex` exposes imported-week identity for reconciliation with scanned `YYYY-WNN.md` files. `queryWeeklyPlan` exposes one normalized imported plan. `queryWeeklyAssessment` joins each weekly commitment to canonical sessions for the same engagement within the seven-day window and sums `duration_minutes` across every session type. It intentionally does not count `weekly_plan_sessions`, because scheduled rows are not evidence of completed work. These assessment SQL boundaries remain read-only; native writes cross the guarded writer only after preview and confirmation.

Schema version 5 adds normalized `meal_events`, food-item links on `daily_meals`, daily nutrition/leisure assessment snapshots, component provenance, and summary views. The native parser accepts only the new four-heading Meals grammar. The importer writes four meal events even when headings are missing (missing headings produce warnings and empty non-leisure opportunities), preserves unrelated legacy `daily_meals` rows whose `meal_event_id` is null, and deletes/replaces only linked native rows for current/future dates. `note_import_components` records lifecycle, source path/checksum, plugin version, row count, and timestamps.

When a Meals-only import precedes the canonical full-note import, the whole-note checksum may legitimately change because Sessions, Transactions, or another unrelated section was edited. If the stored component is already finalized, the historical importer therefore compares the persisted meal events, foods, thresholds, and assessment snapshot with the newly parsed Meals inspection: an exact semantic match is adopted under the full-note provenance, while a changed finalized component remains rejected. An ephemeral component is not silently promoted at midnight; the first confirmed historical Meals or full-note import may replace it with the completed note and finalize it.

The historical `transactions.category` column remains `TEXT` for schema-v5 compatibility, but the Daily Note grammar names its third transaction field `engagement`: `amount | account | engagement | description`. The native importer resolves that field through canonical engagement names and `engagement_aliases`, rejects empty or unresolved values, and writes the numeric engagement ID. The read model joins numeric stored values back to `engagements.name`; unmatched legacy free text is displayed unchanged.

`queryEngagementDashboard` treats that numeric transaction reference as the only valid cross-domain financial ownership link. Legacy free-text categories are counted as unresolved and excluded from engagement totals and detail. Selected-period inflow, outflow, and net values are grouped by `accounts.currency`; no exchange-rate assumption or cross-currency total is introduced. The same query returns every linked transaction for the selected engagement and period, newest first, so the UI can place the ledger beneath the totals. Engagement summaries also expose ordered aliases for search. Session totals and trends honor the selected period and include only canonical `sessions`, while milestone totals and details intentionally describe the engagement's full lifetime.

`queryFinancialDashboard` uses the same strict numeric engagement link but applies it only to engagement attribution. Every transaction remains present in currency-separated inflow, outflow, net-flow, account, trend, and detail records. Because accounts have no opening-balance contract, the dashboard never labels a net-flow total as a balance. Currency conversion and internal-transfer classification are deliberately absent.

`queryNutritionDashboard` builds one daily grain across `daily_metrics` and `daily_meal_assessments`. An assessment snapshot controls effective calories, protein, and evaluated diet adherence when available; otherwise the older Daily Metrics value remains visible as recorded evidence. Leisure meals, the 10% rate, excess-meal debt, and the number of additional fully dieted three-meal days are calculated only from `daily_leisure_meal_summary` rows. The balance-day formula is `ceil(((leisure_meals / 0.10) - counted_meals) / 3)`, clamped at zero. Structured snacks contribute calories through the stored assessment but never direct leisure meals.

`queryExerciseDashboard` counts canonical sessions whose taxonomy is `exercise` or which own at least one `session_exercises` row. Duration comes from canonical session totals. Exercises, sets, load × reps, distance, measured duration, pain coverage, and muscle exposure are optional detail measures and are reported separately from workout count. Muscle exposure can count one set against multiple mapped muscles and is labeled accordingly; the dashboard does not invent measurement units.

Planned rows preserve raw session types and engagement text. A nullable engagement reference supplies the canonical name when the native resolver finds exactly one name or alias. The tolerant parser normalizes valid intervals and assigns estimated hourly display slots from 07:00 when time is missing or invalid, preserving warnings and provenance.

Dates are compared lexically and must use ISO `YYYY-MM-DD`. Times accept `H:mm`, `HH:mm`, and optional seconds. A session is skipped with a warning when either time is invalid or when the end is not later than the start. Overnight sessions are not currently supported.

The calendar uses these two notions of duration on purpose:

- Visual height: `end_time - start_time`
- Displayed duration: `duration_minutes`, rounded to a whole minute when it is finite and non-negative; otherwise the visual duration is used

This preserves the recorded Examined Human duration while keeping card placement faithful to the recorded endpoints. If those values disagree, the plugin currently does not warn.

## Paths and privacy

`databasePath` accepts only a path relative to the vault root and uses Obsidian's vault APIs. Windows, POSIX, UNC, URI, and parent-traversal paths are rejected with a clear settings error. Runtime code avoids Node modules entirely, keeping the same implementation available on desktop and mobile.

The database must be synchronized as part of the vault by the user's chosen system, such as Syncthing or Obsidian Sync. Examined Human does not provide synchronization or send database content anywhere.

The plugin does not send database content over the network. It does not log session titles or notes during normal operation. The validation script outputs only integrity, counts, date bounds, mapping issue counts, and the number of `chor` rows.

## Calendar window and scrolling

The view initially loads 45 days before today, today, and 45 days after today: 91 columns total. When horizontal scrolling approaches either edge, the date window shifts by 28 days and rerenders around the captured center date. This gives the experience of continuous scrolling while bounding DOM and query size.

Important constants are near the top of `TimelineView.ts`:

- `INITIAL_DAYS_EACH_SIDE = 45`
- `WINDOW_SHIFT_DAYS = 28`
- `FINGERPRINT_INTERVAL_MS = 10_000`
- `ZOOM_LEVELS` and `BASE_PX_PER_MINUTE`

The viewport capture stores the date at the horizontal center and the minute at the top of the vertical viewport. Renders restore both values. The Today button deliberately resets the window around today and returns to the configured initial hour.

The top date row and left time gutter are CSS-sticky. Grid position and sizing values that vary at runtime are passed through CSS custom properties or dynamic styles; theme-dependent appearance remains in `styles.css`.

Mobile and desktop day widths are stored separately in Settings. Mobile defaults to a compact 160-pixel column and accepts 120–280 pixels; desktop retains its configurable fixed column width. A debounced resize refresh preserves the visible viewport after rotation.

Past dates backed by an active, unimported note projection receive a red-tinted header and column and are described as awaiting finalization. Their session cards otherwise use the same renderer as canonical and future sessions. Planned provenance and estimated-time state remain available in the tooltip and details modal.

## Close-session visual stacking

The normal card minimum height makes very short back-to-back sessions readable but can also make them appear to overlap. `visual-stack.ts` detects those visual collisions among sessions that do not actually overlap.

For each collision cluster it attempts a compact one-line layout using a 13-pixel minimum height and one-pixel gaps. The layout centers expanded cards around their real intervals, packs them in order, and translates the cluster to minimize displacement. Every visual start and end must remain within ten minutes of the stored endpoint, remain within the 24-hour day, and avoid neighboring cards.

If any constraint cannot be satisfied, the entire cluster uses the previous exact-top/minimum-height behavior. Truly overlapping temporal groups also retain the existing horizontal-column layout and exact vertical fallback. Tooltips and details always show stored times, never visual positions.

## Overlap algorithm

Events for one day are sorted by start time, then longer end time, then ID. Connected overlap groups are identified, and each event is assigned the first column whose previous event has ended. Every event in a group receives the group's maximum column count.

Events that meet exactly at an endpoint do not overlap. The algorithm is deterministic and isolated from Obsidian, so it should remain covered by unit tests as future event sources are added.

## Refresh behavior

There are four refresh paths:

1. Every toolbar Refresh button and the refresh command rebuild the `ExaminedHumanDatabase` source boundary, then refresh every open Examined Human view from physical vault bytes.
2. A vault `modify` event refreshes immediately when the configured database changes.
3. A ten-second main-file/WAL size/mtime fingerprint poll detects ordinary changes that do not produce a usable vault event.
4. A plugin-level ten-minute timer performs an unconditional authoritative reload even when another app preserves the same file metadata or Obsidian misses the external change entirely.

Engagement, Finance, Nutrition, and Exercise dashboards participate in all four paths. Engagement preserves its selected item, canonical-name/alias search, and taxonomy filters; the shared analytical views preserve date range and Finance also preserves its currency filter.

The fingerprint mechanism does not continuously hold the database open. Every query constructs a new sql.js database from freshly read bytes and closes it in `finally`; no SQLite database image is intentionally retained between renders. Failed polls are ignored so a transient replacement or lock can recover on the next interval. Query failures render an in-view error with the configured path and recovery instructions.

An external SQLite plugin may use write-ahead logging and keep committed frames in `EH.db-wal` while the main file remains stale. The reader fingerprints that sidecar and refuses to present stale main-file bytes when the WAL contains frames. The guarded writer applies the same check before inspection and immediately before replacement so it cannot erase another writer's uncheckpointed changes. The user must close or checkpoint the external writer, then press Refresh; an empty or header-only WAL does not block access.

## Data-quality behavior

`querySessions` returns events and issues separately. Invalid time ranges are omitted because they cannot be positioned. A `chor` event is retained, marked with `dataWarning`, colored gray regardless of settings, and included in the issue list.

The view shows aggregated issues in a banner. It also shows a longer-lived Obsidian Notice once per view lifetime when `chor` exists. Opening the card repeats the correction message in the details modal.

Do not normalize invalid source values in the UI. The database is the source of truth, and silent correction would conceal data quality problems.

## Settings persistence

Settings are merged with defaults during plugin load so newly added settings remain backward-compatible with an older `data.json`. Session colors are merged separately to preserve defaults for newly introduced known types. Journal folders are normalized as vault-relative paths, with an empty value meaning the vault root; invalid stored paths fall back to `Oss Ahmad Journal`. Desktop and mobile day widths are bounded to 120–280 pixels. `backupRetentionLimit` accepts only a non-negative safe integer; missing or invalid values become `0`, preserving the historical keep-all behavior. `dismissedWarningKeys` is sanitized to unique known keys, preventing arbitrary persisted values from suppressing future warnings. The Settings reset clears all warning keys and refreshes open views.

Adding a new known type requires updating `SESSION_TYPES` and `DEFAULT_SESSION_COLORS` in `events.ts`. Unknown types need no migration and will remain gray until promoted to a known type.

## Testing strategy

`npm run check` performs:

1. Obsidian-aware ESLint checks
2. TypeScript typechecking
3. Node's built-in test runner

The SQL mapping tests create in-memory databases with the required base schema and optional extensions. Native logger tests use synthetic notes and in-memory databases to lock down grammar rejection, thresholds, snack accountability, objective diet evaluation, historical immutability, ephemeral replacement, preservation of unlinked legacy rows, provenance, and full schema creation. No personal note or database fixture is committed.

Use the real database validator without exposing private content:

```bash
npm run validate:database -- C:\path\to\EH.db
```

Rehearse one historical Daily Note import against an in-memory database clone without writing the source file:

```bash
npm run validate:historical-import -- C:\path\to\EH.db C:\path\to\YYYY-MM-DD.md 0 1850 0
```

Before publishing, also run `npm run build` and manually test the generated `main.js`, `manifest.json`, and `styles.css` in a disposable or development vault.

## Build details

SQL.js ships SQLite as WebAssembly. The esbuild `.wasm` and `.sql` loaders embed the runtime and empty schema-v5 creation SQL in `main.js`, so installation requires only the normal three Obsidian plugin files. No separate runtime asset or network request is required. The resulting JavaScript file is expected to be substantially larger than a typical Obsidian plugin.

Obsidian/Electron APIs are externalized from the bundle. Node imports are confined to development tooling. The build uses an absolute entry path because restricted Windows development environments can otherwise make esbuild resolve the entry as a package path.

## Long-horizon database size

sql.js imports the complete SQLite file into memory, and the current database service reopens it for each range query. The development database is only about 291 KB, but a pessimistic extrapolation across 18,500 Daily Notes is roughly 125 MB before accounting for future text-heavy domains.

This is not a current blocker, but future work must avoid unbounded revision history and binary payloads, preserve date indexes, and periodically measure mobile loading behavior. Before the database reaches tens of megabytes, profile a cached read-only sql.js instance or worker-backed queries. Food logs, daily summaries, and other large text fields require explicit size review.

## Known limitations

- Schema migrations from older databases are not performed by the plugin; native import requires schema v5
- The dashboard presents validation feedback in Obsidian instead of writing managed feedback blocks into Markdown notes
- Python chart/report generation remains outside the plugin runtime; the four native analytical dashboards replace static images for current engagement, finance, nutrition, and exercise testing
- Planning projections refresh when the user confirms a Daily or Weekly dashboard sync; arbitrary note edits are not silently written to EH.db
- SQL.js still replaces the whole database file for a native write; the safety service mitigates but does not remove the memory/large-file limitation
- Planned exercise prescriptions are not mapped yet
- No overnight sessions
- No explicit orphaned-engagement warning yet
- No warning when `duration_minutes` disagrees with start/end geometry
- The calendar has no recurrence, all-day events, filters, search, or export
- Engagement-linked finance excludes legacy free-text transaction categories; currency conversion and budgets are not yet modeled
- Financial flow does not infer opening balances or internal transfers; Nutrition leisure history is limited to schema-v5 assessed days
- The grid rerenders the bounded window instead of virtualizing individual columns
- Dense short-session clusters can still use the old visually overlapping fallback when compact packing would exceed the ten-minute fidelity limit

These are boundaries, not accidental promises. Add future behavior behind a clear data-source/service boundary rather than placing SQL or mutations directly in the view.

## Recommended extension seams

- Add new read models in `examined-human-query.ts`; keep raw SQL out of `TimelineView.ts`.
- Add future-event sources behind a provider interface that returns `CalendarEvent`-compatible objects.
- Extend `NativeLoggerWriteService` and pure component import modules for future mutations. Preserve backups, transactions, conflict handling, explicit confirmation, and the read-only reader invariant.
- Add filters as view state operating on mapped events, not as ad hoc DOM hiding.
- Add schema/version adaptation before changing the required column contract.
- Keep format and color policy in `events.ts` so cards, modals, exports, and future views agree.

## Fork history

The repository originated from `seonggoos/obsidian-schedule-calendar`. The fork retained useful Obsidian plugin/view scaffolding and adapted the overlap-layout idea. Daily Notes parsing, note creation, write-back, drag/edit behavior, localization, daily/weekly/monthly modes, and their tests were removed. The compatibility identity remains `examined-human`; the visible product became EH Calendar in `0.2.0` and Examined Human in `0.3.0` as the product expanded beyond a single view.

Preserve both copyright lines in `LICENSE` and keep the upstream attribution in `README.md`.
