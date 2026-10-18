// Controlli di versioning per una PR (CONTRIBUTING.md, "Versioning").
// Uso: node scripts/check-version.mjs [ref-di-base]   (per esempio origin/main)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { changelogSection } from './changelog.mjs';

const readJson = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  return m ? m.slice(1).map(Number) : null;
};
const greater = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

const errors = [];
const version = readJson('package.json').version;
const current = parse(version);
if (!current) errors.push(`package.json: version "${version}" is not x.y.z`);

const lock = readJson('package-lock.json');
if (lock.version !== version || lock.packages?.['']?.version !== version) {
  errors.push(`package-lock.json: version does not match package.json (${version}); run npm install`);
}

if (!changelogSection(version)) {
  errors.push(`docs/CHANGELOG.md: no "## [${version}]" section`);
}

const baseRef = process.argv[2];
if (baseRef && current) {
  let baseVersion = null;
  try {
    baseVersion = JSON.parse(execFileSync('git', ['show', `${baseRef}:package.json`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })).version;
  } catch {
    // Nessun package.json sulla base: è la prima versione.
  }
  const base = parse(baseVersion);
  if (base && !greater(current, base)) {
    errors.push(`package.json: version ${version} must be higher than ${baseVersion} on ${baseRef}`);
  }
  console.log(`version ${version} (base ${baseRef}: ${baseVersion ?? 'none'})`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log('✓ versioning ok');
