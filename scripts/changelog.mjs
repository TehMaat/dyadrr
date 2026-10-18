// Legge le sezioni di docs/CHANGELOG.md.
// Uso: node scripts/changelog.mjs <versione>  → stampa le note di quella versione.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CHANGELOG = new URL('../docs/CHANGELOG.md', import.meta.url);

/** Testo della sezione `## [versione]`, senza il titolo; `null` se manca. */
export function changelogSection(version, text = readFileSync(CHANGELOG, 'utf8')) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## ['));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const section = version ? changelogSection(version) : null;
  if (!section) {
    console.error(`docs/CHANGELOG.md: no section for version ${version ?? '(missing)'}`);
    process.exit(1);
  }
  console.log(section);
}
