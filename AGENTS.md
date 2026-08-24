# AGENTS.md — EH Dashboards

Read `docs/ARCHITECTURE.md` before structural changes. It is the durable design record for data flow, invariants, limitations, and extension seams.

## Product contract

- Desktop and mobile Obsidian plugin reading an EQH SQLite database through sql.js.
- `EqhDatabase` access is permanently read-only. Approved mutations belong only in `NativeLoggerWriteService`, with backups, transaction staging, conflict checks, and explicit confirmation.
- Durable/finalized writes create backups; ephemeral Meals and planning-projection replacements do not. Backup retention is user-configurable: `0` keeps all, and a positive whole number keeps that many newest backups. Prune only exact EH-created backup names after verified durable writes; never remove unrelated files or turn a cleanup failure into a false database-write failure.
- The database path must be relative to the vault root. Node filesystem/process modules are forbidden in runtime plugin code; every import workflow must remain mobile-safe.
- A session title is the engagement's canonical name. Show session type only as secondary metadata on sufficiently tall, non-stacked cards and in accessible/details text.
- Duration is always displayed as `hh:mm`.
- Exercise details are optional read-only metadata from `exercises`, `session_exercises`, and `exercise_sets`; databases without those tables must still render sessions normally.
- Milestone details are optional read-only metadata linked by `engagement_milestones.session_id`; databases without schema version 2 must still render sessions normally.
- Canonical sessions win for dates present in `imported_notes`; otherwise an active `note_sources`/`planned_sessions` projection may supply mutable sessions.
- The plugin natively parses, validates, previews, and imports schema-v5 Daily Notes, current/future planning projections, Meals, admin events, milestones, and weekly plans. It also materializes weekly sessions into guarded Daily Note edits. Python is not a plugin runtime dependency.
- Historical Meals are immutable once finalized. Current/future Meals are replaceable ephemeral components, and a still-ephemeral component remains replaceable once the date becomes historical so the completed note can finalize it. Snacks never count directly as leisure but must contribute to the effective daily calorie total.
- Engagement Dashboard ranges constrain canonical sessions and linked transactions; milestones remain lifetime facts. Search covers canonical names and `engagement_aliases`. Keep totals separated by `accounts.currency`, and keep the complete selected-period transaction ledger available without conversion.
- Non-blocking dashboard data-quality warnings may be closed temporarily or hidden persistently per warning type. Preserve Settings recovery and never make import blockers, validation errors, or write confirmations dismissible.
- Financial Dashboard includes unresolved legacy rows in currency-separated flow totals but excludes them from engagement analysis; period net flow is not an account balance. Nutrition leisure debt uses only assessed meal days and the fixed 10% target. Exercise totals use canonical exercise sessions plus canonical sessions with structured exercise rows.
- Treat whole-file sql.js loading as a long-horizon constraint: avoid unbounded history or large embedded content and preserve date indexes.
- Every visible Refresh action must rebuild the database source boundary and refresh all open EH views. Keep the low-cost file/WAL fingerprint poll, plus an unconditional authoritative reload every ten minutes for external writers that emit no usable vault event. Never read or overwrite main-file bytes while a nonempty SQLite WAL contains uncheckpointed frames.
- Keep `chor` distinct from `chore`: render it gray and tell the user to correct the source data.
- Build artifacts are `main.js`, `manifest.json`, and `styles.css`.
- Keep SQL and row mapping out of the view. Keep formatting and color policy centralized in `events.ts`.
- Close-session visual packing may move displayed endpoints by at most ten minutes. Dense or truly overlapping groups must retain the exact-position fallback.
- Preserve upstream attribution and both copyright lines in `LICENSE`.

## Architecture

- `src/eqh-database.ts`: file access, sql.js initialization, read-only database lifetime.
- `src/eqh-query.ts`: schema validation and SQL-to-domain mapping.
- `src/native-logger/`: pure parsing/import logic plus the isolated guarded writer.
- `src/events.ts`: session domain model and formatting/color rules.
- `src/TimelineView.ts`: calendar viewport and rendering.
- `src/overlap.ts`: side-by-side placement for concurrent sessions.
- `src/visual-stack.ts`: bounded compact layout for close, non-overlapping sessions.
- `src/settings.ts`: database path and session colors.

Keep SQL/data mapping separate from DOM rendering so it remains testable with an in-memory SQLite fixture.

## Verification

Run before handoff:

```bash
npm run check
npm run build
```

Never commit `EQH.db`, SQLite journal files, `data.json`, or another user's private session data.
