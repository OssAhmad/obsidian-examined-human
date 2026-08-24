import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
const bundle = await readFile('main.js', 'utf8');

assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version, 'package.json version must match manifest.json');
assert.ok(versions[manifest.version], 'versions.json must include the release version');
for (const asset of ['main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE']) {
  await access(asset);
}
assert.doesNotMatch(
  bundle,
  /import\(["']node:/,
  'main.js must not contain dynamic node: imports; Obsidian treats them as browser module fetches',
);
console.log(`Release ${manifest.version} is ready.`);
