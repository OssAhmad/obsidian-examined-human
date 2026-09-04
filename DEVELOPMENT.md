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
- `src/examined-human-query.ts` contains schema validation, SQL, and row-to-domain mapping.
- `src/native-logger/` contains pure parsing/import logic and the isolated guarded writer.
- `src/form-discovery.ts` discovers bounded Daily, Weekly, and Budget Forms in Markdown notes.
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
- Approved mutations belong only in `NativeLoggerWriteService`.
- Durable writes use preview, explicit confirmation, transaction staging, stale-file conflict checks, backup creation, integrity checks, and verified replacement.
- Current/future planning projections and replaceable Meals components follow their documented ephemeral mutation policy.

Do not add direct SQLite writes to a view or to the reader. Do not place raw SQL or row mapping in DOM-rendering code.

Database paths must remain vault-relative. Never read or replace main-database bytes while a nonempty SQLite WAL contains uncheckpointed frames. The database source boundary is rebuilt by visible Refresh actions, database/WAL fingerprint changes, and the unconditional periodic reload described in the architecture document.

Canonical sessions win for dates represented by imported notes. Otherwise an active Daily or Weekly projection may supply mutable planned sessions. Historical Daily Forms are immutable receipts. Weekly plans and budgets are replaceable by their period identity.

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

Schema and parser changes must preserve compatibility rules documented in `docs/ARCHITECTURE.md`. Add or update in-memory SQLite fixtures and parser tests for every changed contract. Never use a personal database or note as a committed fixture.

Pre-1.0 legacy conversion remains an explicit, previewed, confirmed operation. It must preserve historical rows, create and verify a backup, and fail safely when the source is incompatible.

## Form processing

Form discovery recognizes bounded Markdown blocks beginning with one of:

- `#### EH Daily Form`
- `#### EH Weekly Form`
- `#### EH Budget Form`

Each block ends at its matching `#### END`. A file may contain one form of each kind. Discovery normally scans opted-in notes whose YAML marker is `EH form: true` or `EH form: unimported`; the broader Journal-folder mode also considers unmarked notes.

Keep discovery, parsing, validation, and persistence separate:

1. discovery identifies form descriptors and dates;
2. pure parsers turn bounded text into typed data and validation findings;
3. inspection runs against an in-memory database clone;
4. the UI presents a dry-run confirmation;
5. the guarded writer repeats conflict checks and applies the approved mutation;
6. post-write integrity and replacement checks verify the result.

Admin Events are applied to the in-memory transaction before dependent session, meal, exercise, transaction, milestone, or valuation references are validated. This lets one historical Daily Form introduce canonical records and use them in the same confirmed import.

The forms in `EH Forms/` are part of the user-facing grammar. Update explained and minimal variants together when a field, command, or format changes.

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
- unknown or ambiguous references;
- historical immutability and current/future replacement;
- Admin Events and Command Center staging;
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

- Add read models in `src/examined-human-query.ts`.
- Add approved writes through `NativeLoggerWriteService` and pure native-logger modules.
- Add future event sources behind a provider that returns the shared session/event domain model.
- Keep filters as view state over mapped domain records.
- Keep formatting and color policy centralized in `src/events.ts`.
- Preserve bounded date queries and avoid large embedded content because sql.js loads the complete database file.

The detailed rationale, limitations, refresh model, query semantics, visual packing, and long-horizon constraints remain authoritative in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Attribution and license

Examined Human originated as a fork of `seonggoos/obsidian-schedule-calendar`. Preserve the upstream attribution in `README.md` and both copyright lines in `LICENSE`.
