# Releasing

Before starting, read `docs/ARCHITECTURE.md`, confirm the working tree contains no database or `data.json`, and validate a representative database without printing private content.

1. Update the same semantic version (`x.y.z`) in `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`.
2. Add release notes to `CHANGELOG.md`.
3. Run `npm run validate:database -- C:\path\to\representative\EH.db`.
4. Run `npm run release:check`.
5. Install `main.js`, `manifest.json`, and `styles.css` into a development vault and smoke-test settings, connection, scrolling, zoom, overlaps, details, colors, and warnings.
6. Commit and push the reviewed changes to the default branch.
7. Create a GitHub Release whose tag exactly matches `manifest.json` (no `v` prefix).
8. Attach `main.js`, `manifest.json`, and `styles.css` to the release. Never attach `data.json` or a database.

For the owner's test vault, deploy only `main.js`, `manifest.json`, and `styles.css` from this checkout to `C:\Users\Azimi\ossaFiles\vaults\ossaWaxVault\.obsidian\plugins\examined-human`. Verify artifact hashes after copying and verify that the existing plugin `data.json` is unchanged. Python is a maintenance-tool dependency only; the plugin runtime has no Python dependency.

For the initial Community directory submission, sign in at `community.obsidian.md`, link GitHub, choose **Plugins → New plugin**, and submit this repository URL. Later updates are distributed from GitHub Releases automatically.
