# Examined Human Dashboard

**Examined Human Dashboard** is an [Obsidian](https://obsidian.md) plugin for turning a user-owned EQH SQLite database into local, privacy-preserving personal dashboards.

It helps you examine how you spend your time, pursue engagements, manage money, eat, exercise, and follow through on your plans—all from data stored inside your own Obsidian vault.

The plugin supports both desktop and mobile Obsidian.

## Features

* Calendar view with sessions positioned on a 24-hour timeline
* Continuous horizontal navigation across days
* Support for overlapping sessions
* Configurable colors for session types
* Read-only session details
* Exercise details, including sets, weight, repetitions, distance, duration, and notes
* Session-linked milestones and measurements
* Daily Assessment dashboard
* Weekly Assessment dashboard
* Engagement Dashboard
* Financial Dashboard
* Nutrition Dashboard
* Exercise Dashboard
* Canonical engagement names and aliases
* Session timelines and activity trends
* Planned-versus-actual engagement analysis
* Financial inflow, outflow, and net-flow analysis by currency
* Nutrition trends, calorie and protein analysis, and leisure-meal tracking
* Exercise volume, performance, distance, muscle exposure, and workout history
* Native parsing and validation of Daily Notes
* Weekly-plan validation and guarded Daily Note synchronization
* Safe creation of a new EQH database from Settings
* Mobile-compatible database access and writing
* Confirmation-gated imports and modifications
* Database validation with copyable error messages
* Automatic refresh after external database changes
* Optional backups for durable database writes

The dashboards are read-only by default. Any operation that changes the database or Daily Notes requires an explicit preview and confirmation.

## Privacy

Examined Human Dashboard is designed to operate locally.

* Your EQH database remains inside your vault.
* Dashboard queries and validation run locally in Obsidian.
* The plugin does not upload your data to a server.
* The plugin does not provide its own synchronization service.
* Personal databases, journal files, backups, and local plugin settings are excluded from Git.

Your existing vault synchronization system may be used separately to synchronize the vault between devices.

Do not commit a personal EQH database to this repository.

## Requirements

* Obsidian for desktop or mobile
* An EQH SQLite database located inside the Obsidian vault
* A vault-relative path to that database

The plugin can connect to an existing database or create a new empty EQH database from its Settings tab.

## Installation

Examined Human Dashboard is not currently available in Obsidian’s Community Plugins directory. To install it manually:

1. Download or build the plugin files.

2. Create the following directory inside your vault:

   ```text
   <vault>/.obsidian/plugins/eqh-calendar/
   ```

3. Copy these files into the directory:

   ```text
   main.js
   manifest.json
   styles.css
   ```

4. Reload Obsidian.

5. Enable **Examined Human Dashboard** under **Settings → Community plugins**.

6. Configure the vault-relative path to your EQH database.

7. Use **Test connection**, or create a new database from Settings.

8. Open a dashboard from the ribbon, command palette, or available plugin commands.

## Database and Daily Note format

The plugin expects an EQH SQLite database containing canonical engagements, sessions, session types, engagement types, milestones, measurements, accounts, transactions, nutrition data, and exercise data.

Sessions are linked to engagements through canonical engagement IDs. Engagement names and aliases are resolved strictly during imports to prevent ambiguous or unlinked records.

The plugin supports structured Daily Note sections for:

* Daily Metrics
* Sessions
* Transactions
* Exercise Details
* Milestones
* Meals
* Administrative events

For the complete database contract and supported Daily Note syntax, see the project documentation.

## Development

Requirements:

* Node.js 22 or newer
* npm

Install dependencies and run the checks:

```bash
npm install
npm run check
npm run build
```

To validate an EQH database without printing private session content:

```bash
npm run validate:database -- /path/to/EQH.db
```

The build produces the following plugin files:

```text
main.js
manifest.json
styles.css
```

Additional development documentation is available in:

* [Architecture and maintainer notes](docs/ARCHITECTURE.md)
* [Release process](docs/RELEASING.md)

## Fork attribution

Examined Human Dashboard began as a fork of [seonggoos/obsidian-schedule-calendar](https://github.com/seonggoos/obsidian-schedule-calendar).

The project retains and adapts parts of its Obsidian view scaffolding and calendar overlap-layout foundation for a different data source and interaction model.

Both the original work and this project are distributed under the MIT License.

## License

This project is licensed under the [MIT License](LICENSE).
