# Examined Human

Examined Human is a local-first Obsidian plugin for planning, recording, and reviewing a life through one connected body of information.

You write ordinary Markdown forms. Examined Human validates them, asks for confirmation before importing them, and turns the resulting history into a calendar and a set of dashboards for time, commitments, money, food, exercise, and milestones.

The connecting idea is an **engagement**: anything you meaningfully engage with, such as a person, relationship, course, project, practice, responsibility, hobby, or long-term goal. Sessions, transactions, milestones, and plans can all point to the same engagement.

Examined Human runs on desktop and mobile. Your notes and database remain in your vault. It does not require an account, server, Python installation, or cloud service.

> Current release: **0.9.4**
> Requires Obsidian **1.8.7 or newer**

## What you can do with it

The usual rhythm is:

1. Plan a day, week, or budget in Markdown.
2. Record what actually happened in a Daily Form.
3. Preview and validate the form.
4. Confirm the import.
5. Review the result in the calendar and dashboards.
6. Improve your canonical lists of engagements, foods, exercises, accounts, and aliases as your life changes.

Daily history acts like a receipt: after a day is in the past and its Daily Form has been finalized, it cannot be silently rewritten. Current and future Daily Forms are plans and can still change. Weekly plans and budgets can be updated by importing the same period again.

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
- `imported`: its importable Daily and Weekly Forms are complete.
- `false`: deliberately ignore this note.

After all historical Daily Forms and Weekly Forms in a note have been imported, Examined Human normally changes the marker to `imported`. Budget imports and current/future planning updates do not change it because those plans remain editable.

### 5. Put the forms into your note workflow

The repository includes both explained and minimal versions:

- [Daily Form with explanations](<EH Forms/the daily form with explanations.md>)
- [Weekly Form with explanations](<EH Forms/the weekly form with explanations.md>)
- [Budget Form with explanations](<EH Forms/the budget form with explanantions.md>)
- [Minimal Daily Form](<EH Forms/the minimal daily form.md>)
- [Minimal Weekly Form](<EH Forms/the minimal weekly form.md>)
- [Minimal Budget Form](<EH Forms/the minimal budget form.md>)

Start with the explained forms. Use the minimal forms after the entry formats feel familiar.

Copy the forms into your Obsidian template system or paste them into notes manually. If you do not use the Templater community plugin, replace expressions such as `<% tp.file.title %>` with the real ISO date yourself.

Keep these structural elements unchanged:

- the `#### EH Daily Form`, `#### EH Weekly Form`, or `#### EH Budget Form` heading;
- the date fields inside the form;
- the section headings and required `ENTRIES:` markers;
- the closing `#### END` marker.

A note may contain one form of each kind. The form's internal dates determine what it represents; the filename alone does not.

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

A Daily Form can contain metrics, sessions, meals, transactions, valuation rates, exercise details, milestones, Stoicism notes, and Admin Events.

- For **today or a future date**, importing synchronizes a replaceable planning view. It does not finalize the day.
- For a **past date**, importing creates the canonical historical record after validation and confirmation.
- Once a historical Daily Form is finalized, changed historical facts are rejected rather than silently replacing the receipt.

Use **Examined Human: Import Daily Form from Active File** while the note is open, or work from **Daily Assessment**.

### Weekly Forms

A Weekly Form covers exactly seven days. It holds a direction, commitments, and a planning grid. Import it with **Examined Human: Import Weekly Form from Active File** or from **Weekly Assessment**.

Importing records the weekly plan. **Sync week** is a separate action that can copy current and future planned sessions into empty Daily Form Sessions sections. Existing occupied sections are not silently overwritten.

Importing the same starting date again updates that week. Planned sessions remain intentions; completed time comes from historical Daily Forms.

### Budget Forms

A Budget Form describes targets and expected movements for a non-overlapping period of at least four days. Import it with **Examined Human: Import Budget Form from Active File** or from the **Financial Dashboard**.

Negative targets represent expected spending or liabilities; positive targets represent expected income or assets. Expected movements are plans only. They do not create transactions, reminders, or notifications.

Importing the same start and end dates again updates that budget.

### Command Center and other staging actions

The Command Center manages your canonical foods, engagements, exercises, accounts, aliases, and valuation rates. Its actions are intentionally staged into a selected unimported Daily Form so you can read the exact change before importing it.

The Financial Dashboard uses the same pattern for opening balances and reconciliations: it stages a normal, clearly marked transaction in a Daily Form. The Daily Form import is the step that applies it.

## What to do with forms after importing

After an import succeeds, you have two valid choices:

- **Keep the note.** This is recommended when you want a permanent, human-readable record of what happened, what you planned, and what was submitted to the plugin.
- **Delete the note.** Imported historical information remains in the database, so the source form is not required for ordinary dashboard display.

Delete only after confirming that the import succeeded and the information appears correctly. Do not delete a current or future Daily Form if you still rely on it as the source of a planning projection. Deleting an unimported note also discards any staged changes that have not yet been applied.

## Dashboard guide

Open dashboards from the Obsidian command palette. Obsidian prefixes their commands with `Examined Human:`.

### Calendar dashboard

The calendar shows sessions on a horizontally scrollable sequence of days and a vertical 24-hour timeline. It combines canonical history with clearly identified current and future plans. Click a session for its exact time, duration, type, notes, exercise details, milestones, and any data-quality warning.

Use it to answer: **When did I spend time, and what did I spend it on?**

### Daily Assessment

Daily Assessment lists discovered forms and imported days, newest first. It previews and validates Daily Forms, synchronizes current/future plans, imports historical days, and displays the selected day's sessions, metrics, meals, transactions, exercises, and milestones.

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

The Command Center is the maintenance workspace for engagements, foods, exercises, accounts, aliases, valuation rates, and batches of Admin Events. Search existing records, prepare changes, choose an unimported Daily Form, review the proposed rows, and stage them.

Use it to answer: **What canonical names does my system know, and what correction should I stage next?**

## A practical daily and weekly routine

1. Create today's Daily Form with `EH form: unimported` in its frontmatter.
2. Add planned sessions if useful and synchronize the current plan.
3. During or after the day, fill in what actually happened.
4. On the next day, validate and import yesterday as historical fact.
5. Keep the note as your readable journal record, or delete it after verifying the import.
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

### Today's Daily Form is not becoming historical

That is expected. Today and future dates are treated as mutable plans. Import the completed day after it becomes historical to create its final record.

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

Examined Human does not provide reminders, notifications, automatic exchange rates, market-price fetching, recurring transactions, medical records, recurrence rules, calendar synchronization, or automatic repair of ambiguous old data. Sessions that cross midnight must be split across two dates.

These limits keep the system focused on deliberate recording, reviewable plans, and evidence you control.

## For developers

Build instructions, validation commands, repository structure, database and import architecture, safety invariants, and release guidance are in [DEVELOPMENT.md](DEVELOPMENT.md). User-visible release history is in [CHANGELOG.md](CHANGELOG.md).

## Fork attribution and license

This project began as a fork of [seonggoos/obsidian-schedule-calendar](https://github.com/seonggoos/obsidian-schedule-calendar). Its Obsidian view scaffolding and overlap-layout foundation were adapted for a different data source and interaction model.

[MIT](LICENSE) — Copyright (c) 2026 seonggoos and Copyright (c) 2026 OssAhmad.
