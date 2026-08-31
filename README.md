# Examined Human

Examined Human is an [Obsidian](https://obsidian.md) plugin for desktop and mobile that turns a user-owned SQLite database into personal dashboards and guarded native data workflows. Its calendar, Daily Assessment, Weekly Assessment, Command Center, Engagement, Finance, Nutrition, and Exercise views make canonical engagements the common analytical root for time, milestones, money, food, and training facts.

Dashboard queries remain deliberately read-only. The confirmation-gated [sql.js](https://sql.js.org/) logger creates and maintains the official **Examined Human Data Schema v1** inside Obsidian on desktop and mobile: complete historical Daily Note imports, mutable current/future projections, weekly plans, Meals, Food Dictionary, Admin Events, and milestone reconciliation. Every database write is serialized, transactionally staged, protected by a SHA-256 stale-file check, and verified after write. Durable/finalized mutations create backups; unlimited ephemeral Meals and planning replacements do not.

## Current features

- Continuous horizontal navigation across days and vertical navigation across 24 hours
- Session blocks positioned from `sessions.start_time` and `sessions.end_time`
- Overlapping sessions laid out side by side
- Close short sessions packed into readable stacks when every displayed endpoint can remain within ten minutes of its recorded time
- Canonical engagement names as titles, with session type shown as a footer on sufficiently tall cards
- Duration displayed as `hh:mm`
- Past, current, and future days styled distinctly
- Configurable colors for known session types
- Mobile-friendly touch scrolling with a configurable day-column width
- Database path setting accepting any path relative to the vault root
- Journal folder setting for recursively scanning a custom vault-relative Daily Note folder; the canonical supported filename format is `YYYY-MM-DD.md`
- Immediate refresh when the configured database changes, authoritative reload from vault bytes on every Refresh action, and an unconditional ten-minute external-change reload
- WAL-aware protection that refuses stale reads or writes until another SQLite plugin checkpoints its pending database changes
- Read-only session details on click
- Exercise session details with ordered exercises and set-level weight, reps, distance, duration, and notes
- Session-linked milestones, including footer counts and measurement details in the session modal
- Current and future sessions from the logger-generated planning projection
- Estimated hourly display slots beginning at 07:00 for plans without usable times
- Friendly red highlighting for past journal notes awaiting strict historical finalization
- Invalid `chor` values rendered in gray with a prompt to correct the database
- Weekly Assessment dashboard with a weekly-note navigator, pending imports, guarded week-to-Daily-Note synchronization, weekly direction, commitment totals, goals, and separate planned-versus-actual bars
- Direct `YYYY-MM-DD` navigation to the imported week containing a date, plus previous/next imported-week controls
- Daily Assessment dashboard with a unified newest-first list of overdue, current, future, and latest-50 imported notes
- One-day timeline, time-by-engagement bars, daily metrics, foods, transactions, and exercise details
- Engagement Dashboard with canonical-name and alias search, status/type filters, lifecycle metadata, canonical session totals, activity trends, session-type mix, lifetime milestones, and responsive recent-session detail
- Engagement-linked inflow, outflow, and net totals kept separate by account currency, plus a complete newest-first transaction ledger for the selected engagement and period
- Financial Dashboard with range and currency filters, currency-separated inflow/outflow/net cards, cash-flow trends, account activity, engagement outflow, linkage coverage, and recent transactions
- Nutrition Dashboard with effective calorie/protein trends, recorded and objectively evaluated diet adherence, structured meal/food breakdowns, and a coverage-aware 10% leisure-debt calculation
- Exercise Dashboard with canonical workout time, training days, structured-detail coverage, exercise set volume, performance maxima, load × reps, distance, muscle exposure, and recent workouts that open the shared session/exercise details modal
- Native new-schema Meals parsing and validation on desktop and mobile
- Configurable per-meal calorie limit, daily calorie limit (default 1850 kcal), and minimum daily protein
- Leisure-meal preview with snacks excluded from direct leisure count but included in the effective daily total
- Immutable finalized historical Meals, low-friction current/future replacement, and one confirmed final replacement when an ephemeral component rolls into history
- Component provenance recording the source checksum, plugin version, lifecycle, path, row count, and timestamps
- Safe creation of a complete empty Examined Human Data Schema v1 database from Settings
- Native full-note inspection with copyable validation errors and empty-metric warnings
- Confirmation-gated historical imports and current/future planning synchronization on desktop and mobile
- Native weekly-plan validation/import, guarded Daily Note materialization, and automatic projection refresh
- Daily Metrics arithmetic, canonical sessions, transactions, exercise sets, milestones, stoicism, and every supported admin command
- Strict transaction engagement resolution: the third field is an engagement name or alias, stored as its resolved ID
- Mandatory milestone ownership: every new milestone must resolve to exactly one same-engagement session interval
- Python-free plugin runtime; the only release artifacts are `main.js`, `manifest.json`, and `styles.css`
- Numeric backup retention setting for durable writes: `0` keeps all backups; a positive whole number keeps only that many newest plugin-created backups, while ephemeral Meals and planning replacements create none
- Dismissible non-blocking dashboard warnings with a temporary close action, persistent per-warning “Don't show again,” and a Settings reset; import blockers and write confirmations always remain visible

The general dashboard reader remains read-only. All approved mutations cross the isolated native writer and require an explicit preview/confirmation in the relevant dashboard. Weekly Assessment reads commitment targets from imported weekly plans and compares them with canonical logged sessions; it does not treat scheduled weekly-grid rows as completed work.

## Database contract

The plugin currently expects these tables and columns:

```text
sessions
  id, engagement_id, date, start_time, end_time,
  duration_minutes, session_type_id, notes

session_types
  id, code

engagements
  id, name, type_id

engagement_types
  id, code
```

`sessions.engagement_id` is joined to `engagements.id`. Numeric taxonomy IDs are joined to their canonical `code` values for display and colors. Dates are expected as `YYYY-MM-DD`; times may use `H:mm`, `HH:mm`, or include seconds. Invalid time ranges are skipped and reported.

Native Daily Note transaction rows use `amount | account | engagement | description`. The third field must be an engagement name or alias. Resolution is strict, just like canonical sessions: the import is blocked if the field is empty or no engagement matches. The resolved `engagements.id` is stored in the legacy `transactions.category` database column, and dashboard reads translate numeric stored values back to the canonical engagement name. Legacy free-text database categories remain readable but are not produced by the native importer.

Official Data Schema v1 includes normalized taxonomy, `meal_events`, linked `daily_meals`, `daily_meal_assessments`, `note_import_components`, `meal_event_totals`, and `daily_leisure_meal_summary`. It introduces the Food Dictionary: canonical `foods`, list-based `food_aliases`, and immutable per-row food/nutrition snapshots in `daily_meals`. Deleting a food clears only its optional `daily_meals.food_id` links; each historical row keeps its food label and nutrient snapshot. New Schema v1 databases define `engagement_milestones.session_id` as `NOT NULL ... ON DELETE RESTRICT`. Native milestone rows use `engagement | milestone | metric | value | owner session interval`; the interval must resolve to exactly one same-engagement session. Legacy databases and ownerless rows remain readable but the native importer never creates another ownerless milestone. Exercise and milestone detail tables remain optional display extensions.

Only canonical Food Dictionary meals are accepted. Breakfast, Lunch, Dinner, and Snacks use `food | amount_g` rows (for example, `Eggs | 150` or `Eggs | 150 g`). Food may be a canonical name or a declared food alias. The importer derives immutable calories, protein, carbs, fat, salt, and optional fiber/cholesterol snapshots from the food’s per-100 g profile. Breakfast/Lunch/Dinner count as three meal opportunities; Snacks never count directly as leisure. The effective daily calories are the higher of Daily Metrics calories and the sum of all structured foods, so snack calories remain accountable. If that total exceeds a positive daily limit, the day counts at least two leisure meals.

Weekly Assessment combines scanned `YYYY-WNN.md` notes with imported `weekly_plans` rows in one newest-first list. Pending overdue weeks are faint red, the current pending week is blue, future pending weeks are green, and imported weeks remain neutral. Pending weeks are natively previewed and imported. An imported current/future week can preview and materialize planned rows into empty Daily Note Sessions sections; occupied days are skipped, source checksums are rechecked, failed multi-note writes are restored, and planning projections are then refreshed. For each commitment, actual time is still the sum of canonical `sessions.duration_minutes` for the same engagement across the seven-day window. Scheduled weekly rows are never counted as completed work.

Daily Assessment reads imported daily facts from canonical tables and recursively scans the configured Journal folder, which defaults to `Oss Ahmad Journal`. Canonical Daily Note filenames use `YYYY-MM-DD.md`; legacy `MMM D, YYYY.md` names remain readable during transition. Its single newest-first list uses faint red for overdue notes, blue for today, green for future notes, and neutral styling for imported notes. An **Unresolved references** panel groups missing foods, engagements, exercises, and accounts. Each correction lets the user create a canonical record or attach the entered wording as an alias; when the selected note is unimported, the correction stages into that same note and it is immediately revalidated. The native parser performs structured, non-mutating inspection in an in-memory database clone so staged admin commands can be validated together with their dependent facts. Historical imports are blocked when inspection fails and always require a second confirmation. Today/future actions replace planning projections but never create canonical sessions.

The **Command Dashboard** is the deliberate audit and maintenance surface. Its Food Library searches canonical foods and aliases, shows per-100 g nutrition and usage, includes a per-gram nutrition calculator, and stages create/update/rename/delete/alias commands. Engagement, Exercise, and Account libraries provide the same canonical-name/alias audit flow, with engagement lifecycle actions and account metadata editing; Batch staging accepts one Admin Event per line for AI-assisted or other bulk work. It never writes directly to SQLite; every change is staged into a chosen unimported current or future Daily Note and normal Daily Note import remains the only way to apply it.

Engagement Dashboard reads only canonical `engagements`, `engagement_aliases`, `sessions`, session/engagement taxonomies, milestones and measurements, accounts, and transactions. Search matches canonical names and aliases. Its date range constrains session and transaction facts while milestone counts and details remain lifetime facts. Transaction rows participate only when the legacy `transactions.category` value contains a valid engagement ID produced by the native importer. Amounts are grouped by the account's recorded currency; the dashboard never converts or combines unlike currencies. Each selected engagement also shows every linked transaction in the selected period. Planned sessions are excluded because they are intentions rather than completed engagement evidence.

Financial Dashboard includes every recorded transaction in its per-currency flow totals, including legacy rows, but only resolved numeric engagement links participate in engagement analysis. It never treats period net flow as an account balance and never combines unlike currencies. Nutrition Dashboard prefers Schema v1 assessment snapshots over Daily Metrics when both exist, falls back to the recorded `dieted` value for legacy days, and calculates leisure debt only across days with `daily_leisure_meal_summary` evidence. Exercise Dashboard counts canonical `exercise` sessions plus any canonical session with structured exercise rows; session time remains valid even when detailed exercises or sets are absent. Load, distance, and duration retain the source database's recorded units.

## Privacy

`EH.db`, SQLite journal files, generated `.examined-human-backups`, and local plugin settings are ignored by Git. Do not commit a personal database. Hidden backup folders and files are checked through Obsidian's mobile-safe storage adapter, so an existing `.examined-human-backups` directory remains reusable even when it is absent from the indexed vault tree. Backup retention defaults to `0` (keep all); a positive setting removes only older files matching EH's exact backup naming contract after a successful verified write. Unrelated or manually named files are never pruned. The configured database path, retention limit, and per-warning dismissal preferences are stored by Obsidian in the plugin's local `data.json`, which is also ignored by this repository.

The database must live inside the vault. This makes the same relative path portable between desktop and mobile and lets the user's existing vault synchronization system carry the database. The plugin does not upload or synchronize anything. Validation, import output, and every dashboard query remain local to Obsidian.

## Development

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run check
npm run build
```

To validate an Examined Human database without printing private session content:

```bash
npm run validate:database -- /path/to/EH.db
```

The release artifacts are `main.js`, `manifest.json`, and `styles.css`.

Maintainers should read [Architecture and maintainer notes](docs/ARCHITECTURE.md) for the data flow, file map, invariants, privacy boundaries, refresh model, known limitations, and recommended extension points. Release steps live in [Releasing](docs/RELEASING.md).

For local testing, deploy the three plugin artifacts into `<vault>/.obsidian/plugins/examined-human/`, reload Obsidian, enable **Examined Human**, and configure a vault-relative database path under the plugin settings. Use **Test connection**, or use **Create Schema v1 database** when starting fresh. Version 0.9.3 alone also contains the explicit one-time converter for retired v5 databases. All logger actions are native and work on desktop and mobile; no Python interpreter or bundled runtime is required.

## Installation

This early version is not yet in Obsidian's Community Plugins directory. Install it manually from a build or a GitHub release:

1. Create `<vault>/.obsidian/plugins/examined-human/`.
2. Copy `main.js`, `manifest.json`, and `styles.css` into that directory.
3. Reload Obsidian.
4. Enable **Examined Human** under **Settings → Community plugins**.
5. Set the vault-relative Examined Human database path and test the connection.
6. Open the calendar from the ribbon or command palette, or run the Daily Assessment, Weekly Assessment, **Examined Human: Open Command Dashboard**, Engagement Dashboard, Financial Dashboard, Nutrition Dashboard, or Exercise Dashboard command.

## Fork attribution

This project began as a fork of [seonggoos/obsidian-schedule-calendar](https://github.com/seonggoos/obsidian-schedule-calendar). Its useful Obsidian view scaffolding and overlap-layout foundation were adapted for a different data source and interaction model. The original and current work remain under the MIT license.

## License

[MIT](LICENSE)
