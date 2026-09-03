# Examined Human

Examined Human is a local-first [Obsidian](https://obsidian.md) plugin for planning, recording, and reviewing a life through one connected body of data.

It turns ordinary Markdown forms and a user-owned SQLite database into a calendar and a set of personal dashboards. Time, projects, habits, relationships, money, food, exercise, milestones, and weekly plans are connected through **engagements**: the people, practices, responsibilities, interests, and goals with which a person engages.

The plugin runs on desktop and mobile, keeps the database inside the vault, and does not require Python, a server, an account, or a cloud service.

> Current release: **0.9.4**
>
> Obsidian: **1.8.7 or newer**
>
> Database: **Examined Human Data Schema v1**

## The basic workflow

Examined Human is designed around a simple loop:

1. **Plan** a day, a week, or a budget in Markdown.
2. **Record** sessions, meals, exercise, transactions, metrics, and milestones in a Daily Form.
3. **Validate and import** the form through a preview and explicit confirmation.
4. **Review** what happened in the calendar and analytical dashboards.
5. **Maintain** canonical engagements, foods, exercises, accounts, and aliases through the Command Center.

Daily records are treated as receipts: once a historical Daily Form is finalized, it is immutable. Weekly plans and budgets are promises, so importing the same period again updates the existing plan.

## What the plugin includes

### Calendar

The calendar lays sessions out across a continuous horizontal timeline and a 24-hour vertical axis. It supports overlapping sessions, compact visual packing for closely spaced events, configurable desktop and mobile day widths, session colors, and detailed session modals.

Canonical engagement names are the event titles. Session type, duration, notes, structured exercises, and milestones appear as supporting detail rather than replacing the thing the user actually engaged with.

### Daily Assessment

Daily Assessment brings imported history and discovered Daily Forms into one newest-first list. It can:

- preview and strictly validate a historical Daily Form before import;
- synchronize current and future sessions as mutable planning projections;
- show one-day sessions, metrics, food, transactions, exercise details, and milestones;
- identify unresolved foods, engagements, exercises, and accounts;
- stage a missing canonical record or alias into the same unimported note, then revalidate it.

### Weekly Assessment

Weekly Assessment combines discovered Weekly Forms with imported weekly plans. It shows weekly direction, commitments, planned sessions, and planned-versus-actual time by engagement.

A Weekly Form always spans exactly seven days. Reimporting the same starting date updates that week; overlapping weeks are rejected. A current or future plan can also be materialized into empty Daily Form `Sessions` sections, with previews and rollback protection around the multi-note edit.

### Command Center

The Command Center is the maintenance surface for the user's canonical dictionaries. It provides searchable tabs for:

- foods and food aliases;
- engagements and engagement aliases;
- exercises and exercise aliases;
- accounts and account aliases;
- valuation rates;
- batch Admin Events.

The dictionary and batch tools stage creates, edits, renames, deletions, lifecycle changes, alias moves, and other supported commands as Admin Events in a selected unimported current or future Daily Form. The Valuation tab stages rate rows into that form's existing Valuation Rates section. Nothing here silently edits SQLite; the normal Daily Form import applies the staged evidence.

### Engagement Dashboard

The Engagement Dashboard is the connective center of the system. Search works across canonical names and aliases. For one engagement it can show:

- status, type, dates, and descriptive metadata;
- canonical session time and activity trends;
- session-type distribution and recent sessions;
- lifetime milestones and measurements;
- linked financial inflow, outflow, and a complete transaction ledger.

The selected date range limits sessions and transactions. Milestones remain lifetime facts.

### Financial Dashboard

The Financial Dashboard treats the transaction ledger as the source of each account's balance. It includes:

- balances as of a selected date;
- an **All accounts** net-worth view or a single-account view;
- period inflow and outflow;
- financial activity grouped by engagement;
- account-balance and net-worth history;
- native-unit or reference-unit display;
- active budget targets and expected movements;
- recent transactions plus opening-balance and reconciliation staging actions.

The plugin conservatively recognizes only unambiguous same-day, same-unit, equal-and-opposite movements between different accounts as transfers. Those movements still affect the account balances and remain in the ledger, but they are excluded from personal income and spending totals.

Financial categories are engagements. Money spent on a home, a relationship, health, a project, a hobby, or a business remains connected to that part of the user's life instead of being maintained in a second category hierarchy.

### Nutrition Dashboard

The Nutrition Dashboard uses the canonical Food Dictionary and immutable nutrition snapshots recorded at import time. It shows calorie and protein trends, meal and food breakdowns, diet adherence, and a coverage-aware leisure-debt calculation.

Breakfast, Lunch, and Dinner are meal opportunities. Snacks contribute to effective daily calories but do not directly count as leisure meals. Evaluation thresholds for meal calories, daily calories, and minimum protein are configurable.

### Exercise Dashboard

The Exercise Dashboard combines canonical exercise sessions with structured exercise rows and sets. It can show training days, workout time, detail coverage, volume, performance maxima, distance, muscle exposure, and recent workouts.

Structured exercise details are optional. A session remains valid and visible even when it has no exercise or set rows.

## Forms and discovery

Daily, Weekly, and Budget Forms may live in any Markdown note, and several forms may coexist in one file. Filenames do not determine form type or date; the bounded form heading and its internal date fields do.

The recommended discovery mode scans only notes whose YAML frontmatter contains one of these markers, matched case-insensitively:

```yaml
---
EH form: true
---
```

```yaml
---
EH form: unimported
---
```

`EH form: imported` and `EH form: false` are skipped. After every historical Daily Form and every Weekly Form in a file has been imported, the plugin changes the marker to `imported`. Budget imports and current/future planning synchronization do not change it because those plans remain mutable.

For users who do not want YAML markers, Settings can instead scan unmarked notes in the configured Journal folder. That mode is intentionally broader and may take longer in a large vault.

Discovery caches form paths, dates, kinds, and file timestamps in the plugin's local `data.json`; it never caches note content. Subsequent dashboard loads can reuse the index and reread only the relevant notes. A malformed dated form stops discovery with the exact source path in the error so it can be corrected.

### Daily Form

A Daily Form starts with `#### EH Daily Form`, declares its ISO date, and ends at `#### END`. Supported sections include Daily Metrics, Sessions, Meals, Transactions, Exercise Details, Milestones, Stoicism, Admin Events, and Valuation Rates.

```markdown
#### EH Daily Form
date: 2026-09-03

##### Sessions
ENTRIES:
07:00-08:00 | exercise | Morning Training | strength work
09:00-10:30 | study | Probability | chapter review

##### Transactions
ENTRIES:
-12.50 | Cash | Nutrition and Dietary Practices | lunch

##### Exercise Details
ENTRIES:
Barbell Row | [50x8, 50x8] | controlled reps

##### Valuation Rates
ENTRIES:
EUR | 1.08
APARTMENT | 2300000

##### Admin Events
ENTRIES:

#### END
```

Transaction syntax is `amount | account | engagement | description`. The account and engagement must resolve by canonical name or alias.

Historical imports use strict validation and require a second confirmation. Current and future Daily Forms supply replaceable plans rather than canonical history.

### Weekly Form

A Weekly Form declares a start date and an end date exactly six days later. Commitments name an engagement and a target number of hours; scheduled cells use `session type ; engagement`.

```markdown
#### EH Weekly Form
start date: 2026-09-05
end date: 2026-09-11
- Main outcome: Finish the release
- Important deadline: Thursday
- Constraint or risk: Limited evening time

#### Commitments
8 | Examined Human | Complete release testing

| Day | 07-08 | 08-09 | 09-10 |
| --- | --- | --- | --- |
| Saturday | exercise ; Morning Training | | work ; Examined Human |
| Sunday | | study ; Probability | |

#### END
```

Weekly scheduled rows are intentions. They are never counted as completed work; actual time always comes from imported canonical sessions.

### Budget Form

A budget may cover any non-overlapping period of at least four days. Negative values represent expected spending and positive values represent expected income. Targets and expected movements are independently optional.

```markdown
#### EH Budget Form
period start: 2026-09-01
period end: 2026-09-30

##### Budget Targets
ENTRIES:
USD | -300 | Nutrition and Dietary Practices
USD | -120 | My Online Gear
USD | 1000 | Freelance Work

##### Expected Movements
ENTRIES:
2026-09-01 | USD | 1000 | Main Account | Freelance Work | monthly payment
2026-09-03 | USD | -700 | Main Account | Home | rent

#### END
```

Expected-movement syntax is `date | unit | amount | account | engagement | description`. Its date must fall inside the budget period and its unit must match the account's configured unit.

Budget periods cannot overlap. Reimporting the exact same start and end dates replaces that budget; no revision history is kept. Finance displays the budget that contains its selected as-of date. Budgets never create transactions, reminders, or notifications.

## Food Dictionary and meals

Schema v1 meals use compact `food | amount_g` rows. The food must resolve to a canonical name or alias:

```markdown
##### Meals

###### Breakfast
is_leisure: 0
ENTRIES:
Eggs | 150
Bread | 80 g

###### Lunch
is_leisure: 0
ENTRIES:
Chicken Breast | 180
Rice | 250

###### Dinner
is_leisure: 0
ENTRIES:

###### Snacks
is_leisure: 0
ENTRIES:
Dark Chocolate | 25
```

Each canonical food defines per-100 g calories, protein, carbohydrates, fat, and salt, with optional fiber and cholesterol. During import, Examined Human calculates and stores a nutrition snapshot on the meal row. Later edits to the Food Dictionary therefore improve future entries without rewriting history.

Legacy `food | calories | protein` meal rows are deliberately rejected rather than accepted as incomplete nutrition data.

## Valuation and net worth

An account's `currency` field is treated as a general asset unit. It may be `USD`, `BTC`, `NASDAQ SHARE`, `GOLD`, or `APARTMENT`. Unit matching ignores case and surrounding whitespace.

Settings define:

- a **valuation display label**, shown beside converted totals; the default is `EHM`;
- a **reference asset class**, which is always worth one valuation unit; the default is `USD`.

Rates for every other unit are user-entered dated observations. The Command Center stages only rate entries into an existing `##### Valuation Rates` section in an unimported Daily Form. It never invents the surrounding form or fetches market data.

Each imported rate remains effective until a newer rate for the same unit appears. Rate sets may be partial: an apartment valuation entered once can continue indefinitely while exchange rates for other units change more often. Rates never apply backward to earlier dates.

If a required rate is missing, native balances remain visible, but that asset is clearly excluded from converted totals. Examined Human never silently treats an unknown valuation as zero.

## Installation

### Community Plugins

When the listing is available:

1. Open **Settings → Community plugins → Browse**.
2. Search for **Examined Human**.
3. Install and enable it.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the matching [GitHub release](https://github.com/OssAhmad/obsidian-examined-human/releases), then:

1. Create `<vault>/.obsidian/plugins/examined-human/`.
2. Copy the three release artifacts into that directory.
3. Reload Obsidian.
4. Enable **Examined Human** under **Settings → Community plugins**.

Do not copy `data.json` from another vault. It contains vault-local settings and the form discovery cache.

## First-time setup

1. Open **Settings → Examined Human**.
2. Set a database path relative to the vault root, such as `EH.db` or `data/EH.db`.
3. Choose **Create Schema v1 database** for a new installation, or connect an existing compatible database.
4. Use **Test connection**.
5. Configure the Journal folder and form-discovery mode.
6. Adjust nutrition limits, backup retention, dashboard period, valuation settings, calendar widths, and session colors as desired.
7. Add the YAML marker and bounded forms to the user's templates.
8. Open Daily or Weekly Assessment and run form discovery.

The default analytical period is 14 inclusive days. Dashboards can also be switched to all-time history.

### Upgrading a legacy v5 database

Pre-1.0 builds include an explicit, one-time **Upgrade legacy database to Schema v1** action. The previewed and confirmed migration preserves existing historical meal rows while adding the current Food Dictionary, finance, budget, and valuation foundations and resetting retired migration metadata to the official Schema v1 identity.

The migration creates and verifies a backup. Even so, close other SQLite writers and make an independent copy before upgrading. If a nonempty SQLite WAL has uncheckpointed frames, Examined Human refuses to read or write stale main-file bytes until the external writer checkpoints them.

## Commands

Obsidian prefixes each command with `Examined Human:` in the command palette:

- `Daily Assessment`
- `Import Daily Form from Active File`
- `Import Weekly Form from Active File`
- `Import Budget Form from Active File`
- `Open Command Dashboard`
- `Weekly Assessment`
- `Engagement Dashboard`
- `Financial Dashboard`
- `Nutrition Dashboard`
- `Exercise Dashboard`
- `Open calendar dashboard`
- `Reload EH.db and refresh all dashboards`

The calendar is also available from the ribbon icon.

## Data safety and privacy

Dashboard access is permanently read-only. Approved mutations cross a separate `NativeLoggerWriteService` boundary and use preview, explicit confirmation, transaction staging, stale-file conflict detection, and post-write SQLite integrity checks.

Durable and finalized database writes create pre-write backups. Replaceable ephemeral Meals and planning projections do not. Backup retention defaults to `0`, which keeps every backup; a positive whole number keeps only that many newest EH-created backups. Cleanup never targets unrelated files.

Visible **Refresh** actions rebuild the database source boundary and refresh all open EH views. The plugin also checks the database and WAL fingerprint every ten seconds and performs an unconditional authoritative reload every ten minutes, allowing it to notice external changes even when Obsidian emits no useful vault event.

`EH.db`, SQLite journal files, `.examined-human-backups`, and local plugin `data.json` are ignored by this repository. Never commit a personal database.

All parsing, validation, imports, and dashboards run locally inside Obsidian. The plugin does not upload, synchronize, value, or notify on the user's behalf. Vault synchronization remains the user's choice.

## Deliberate boundaries

- No automatic exchange-rate or market-price fetching.
- No reminder, notification, email, calendar-sync, or recurring-transaction engine.
- No medical-record subsystem.
- No automatic repair of unresolved legacy transaction categories.
- No overnight session interval that crosses midnight; split it across two dates.
- Whole-file sql.js loading remains a long-horizon constraint, so large embedded content and unbounded queries are intentionally avoided.

These boundaries keep Examined Human focused on mindful recording, transparent plans, and inspectable personal evidence rather than becoming an automation platform.

## Development

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run check
npm run build
```

For a full release validation:

```bash
npm run release:check
```

To validate a database without printing private session content:

```bash
npm run validate:database -- /path/to/EH.db
```

The only release artifacts are `main.js`, `manifest.json`, and `styles.css`.

Read [Architecture and maintainer notes](docs/ARCHITECTURE.md) before changing data flow, import behavior, schema assumptions, or safety boundaries. The complete release procedure is in [Releasing](docs/RELEASING.md), and user-visible release history is in the [Changelog](CHANGELOG.md).

## Fork attribution

This project began as a fork of [seonggoos/obsidian-schedule-calendar](https://github.com/seonggoos/obsidian-schedule-calendar). Its Obsidian view scaffolding and overlap-layout foundation were adapted for a different data source and interaction model. The original and current work remain under the MIT license.

## License

[MIT](LICENSE) — Copyright (c) 2026 seonggoos and Copyright (c) 2026 OssAhmad.
