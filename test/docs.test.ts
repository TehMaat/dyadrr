// Tiene la documentazione allineata al codice (CONTRIBUTING.md, "Documentazione").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ERROR_CODES, REFUSAL_CODES, WARNING_CODES, exitCodeFor } from '../src/codes.js';
import { CHOICES, CHOICE_NAMES } from '../src/choices.js';
import { CALIBRATION_LIMITS, CALIBRATION_NAMES, loadCalibration } from '../src/calibration.js';
import { PROGRESS_PHASES, REPORT_FIELDS, REPORT_FORMAT } from '../src/report.js';
import { INPUTS_OPTION } from '../src/cli.js';
import { PAIR_CATEGORIES, PAIR_KEYS, PHASE1_CATEGORIES, SUMMARY_FIELDS, VERDICTS } from '../src/pairs.js';

// I test girano da build/test/.
const ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Le variabili d'ambiente lette dal codice. */
const PROGRAM_ENVS = [...CHOICE_NAMES.map((n) => CHOICES[n].env), INPUTS_OPTION.env];

/** Tutti i file sotto una cartella, ricorsivamente. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]);
}

/** I documenti Markdown: README, CONTRIBUTING, CLAUDE e docs/. */
function markdownFiles(): string[] {
  const docs = listFiles(join(ROOT, 'docs')).filter((f) => f.endsWith('.md') && statSync(f).isFile()).map((f) => relative(ROOT, f));
  return ['README.md', 'CONTRIBUTING.md', 'CLAUDE.md', ...docs.sort()];
}

/** Il testo senza blocchi di codice e codice in linea: lì non ci sono link. */
const withoutCode = (markdown: string) => markdown.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');

/** Le ancore dei titoli di un documento, come le calcola GitHub. */
function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of markdown.replace(/^```[\s\S]*?^```/gm, '').split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = m[1]!.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

/** Righe delle tabelle di una sezione `## titolo`, come celle senza bordi. */
function tableRows(markdown: string, heading: string): string[][] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `section "## ${heading}" missing`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|') || /^\|[-| ]+\|$/.test(line)) continue;
    rows.push(line.slice(1, -1).split('|').map((c) => c.trim()));
  }
  return rows;
}

/** Le righe della prima tabella di una sezione, senza l'intestazione. */
function firstTable(markdown: string, heading: string): string[][] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `section "## ${heading}" missing`);
  const from = lines.findIndex((l, i) => i > start && l.startsWith('|'));
  const end = lines.findIndex((l, i) => i > from && !l.startsWith('|'));
  return lines.slice(from + 2, end === -1 ? undefined : end).map((l) => l.slice(1, -1).split('|').map((c) => c.trim()));
}

/** Codici nella prima colonna delle righe di una sezione, con le righe. */
function codeRows(markdown: string, heading: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of tableRows(markdown, heading)) {
    const m = /^`([A-Z_]+)`$/.exec(row[0] ?? '');
    if (m?.[1]) {
      assert.ok(!map.has(m[1]), `${m[1]} listed twice`);
      map.set(m[1], row);
    }
  }
  return map;
}

test('CODICI.md elenca esattamente i codici di src/codes.ts', () => {
  const doc = read('docs/CODICI.md');
  assert.deepEqual([...codeRows(doc, 'Rifiuti').keys()].sort(), [...REFUSAL_CODES].sort());
  assert.deepEqual([...codeRows(doc, 'Avvisi').keys()].sort(), [...WARNING_CODES].sort());
  assert.deepEqual([...codeRows(doc, 'Annullamento').keys()], ['CANCELLED']);

  const errors = codeRows(doc, 'Errori');
  assert.deepEqual([...errors.keys()].sort(), [...ERROR_CODES].sort());
  for (const code of ERROR_CODES) {
    assert.equal(errors.get(code)?.[1], String(exitCodeFor('error', code)), `exit code of ${code}`);
  }
  assert.equal(codeRows(doc, 'Annullamento').get('CANCELLED')?.[1], String(exitCodeFor('cancelled')));
});

test('CLI.md riporta ogni scelta con opzione, variabile d\'ambiente e valori', () => {
  const doc = read('docs/CLI.md');
  const rows = tableRows(doc, 'Scelte');
  for (const name of CHOICE_NAMES) {
    const { option, env, values } = CHOICES[name];
    const row = rows.find((r) => r[1] === `\`${option}\``);
    assert.ok(row, `${option} missing from the choices table`);
    assert.equal(row[2], `\`${env}\``, `environment variable of ${option}`);
    for (const value of values) {
      assert.ok(row[3]?.includes(`\`${value}\``), `value ${value} of ${option}`);
    }
  }
  assert.equal(rows.length - 1, CHOICE_NAMES.length, 'one row per choice (plus the header)');

  // `--inputs` non è una scelta di §10.1, ma ha la sua variabile (studio §10.2).
  const inputs = tableRows(doc, 'Ingressi dopo il merge').find((r) => r[0] === `\`${INPUTS_OPTION.option}\``);
  assert.ok(inputs, `${INPUTS_OPTION.option} missing from CLI.md`);
  assert.equal(inputs[1], `\`${INPUTS_OPTION.env}\``, `environment variable of ${INPUTS_OPTION.option}`);
  for (const value of INPUTS_OPTION.values) assert.ok(inputs[2]?.includes(`\`${value}\``), `value ${value} of ${INPUTS_OPTION.option}`);

  // Le variabili del codice, più quelle del Compose di CONTAINER.md (`${DYADRR_TAG:-latest}`).
  const compose = [...read('docs/CONTAINER.md').matchAll(/\$\{(DYADRR_[A-Z_]+):-/g)].map((m) => m[1]!);
  const envs = new Set<string>([...PROGRAM_ENVS, ...compose]);
  for (const doc of markdownFiles().filter((f) => f !== 'docs/CHANGELOG.md')) {
    for (const [, name] of read(doc).matchAll(/\b(DYADRR_[A-Z_]+)\b/g)) {
      assert.ok(envs.has(name!), `${doc} mentions ${name}, which does not exist`);
    }
  }
});

test('README: la tabella delle variabili elenca esattamente le variabili DYADRR_* del codice', () => {
  const rows = firstTable(read('README.md'), "Variabili d'ambiente");
  const options = new Map<string, { option: string; values: readonly string[] }>([
    ...CHOICE_NAMES.map((n) => [CHOICES[n].env, CHOICES[n]] as const),
    [INPUTS_OPTION.env, INPUTS_OPTION],
  ]);
  const listed = rows.map((r) => /^`(DYADRR_[A-Z_]+)`$/.exec(r[0] ?? '')?.[1]);
  assert.deepEqual([...listed].sort(), [...PROGRAM_ENVS].sort());
  for (const row of rows) {
    const env = /^`(DYADRR_[A-Z_]+)`$/.exec(row[0] ?? '')![1]!;
    const o = options.get(env)!;
    assert.equal(row[1], `\`${o.option}\``, `option of ${env}`);
    for (const value of o.values) assert.ok(row[2]?.includes(`\`${value}\``), `value ${value} of ${env}`);
  }
  // INSTALLAZIONE.md ha la stessa tabella.
  const install = firstTable(read('docs/INSTALLAZIONE.md'), 'Variabili della riga di comando');
  assert.deepEqual(install.map((r) => r[0]).sort(), rows.map((r) => r[0]).sort());
});

test('Full Vibe Coded: la dicitura è nel README, nell\'indice dei documenti e in CONTRIBUTING.md', () => {
  for (const doc of ['README.md', 'docs/README.md', 'CONTRIBUTING.md']) {
    assert.ok(read(doc).includes('Full Vibe Coded'), `${doc} does not say Full Vibe Coded`);
  }
  assert.ok(read('README.md').includes('## Full Vibe Coded'), 'README section');
});

test('documenti: link relativi, ancore e immagini esistono; ogni immagine di docs/img è usata', () => {
  const used = new Set<string>();
  for (const doc of markdownFiles()) {
    const text = withoutCode(read(doc));
    const targets = [
      ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!),
      ...[...text.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]!),
    ];
    for (const target of targets) {
      if (/^[a-z]+:/i.test(target)) continue;
      const [path, anchor] = target.split('#') as [string, string | undefined];
      const file = path === '' ? doc : relative(ROOT, resolve(ROOT, dirname(doc), decodeURI(path)));
      assert.ok(existsSync(join(ROOT, file)), `${doc}: link to ${target}, which does not exist`);
      if (file.startsWith('docs/img/')) used.add(file);
      if (anchor !== undefined && anchor !== '' && file.endsWith('.md')) {
        assert.ok(headingSlugs(read(file)).has(decodeURI(anchor)), `${doc}: link to ${target}, which has no such heading`);
      }
    }
  }
  const images = listFiles(join(ROOT, 'docs', 'img')).map((f) => relative(ROOT, f)).sort();
  assert.ok(images.length > 0, 'docs/img is empty');
  assert.deepEqual(images.filter((f) => !used.has(f)), [], 'images not used in any document');
});

test('diagrammi: immagini e non ASCII; ogni SVG rigenerato dal suo sorgente Mermaid', async () => {
  for (const doc of markdownFiles()) {
    const box = /[─-╿]/.exec(read(doc));
    assert.equal(box, null, `${doc} contains box-drawing characters: draw diagrams in docs/diagrams/`);
  }
  const diagrams = await import(pathToFileURL(join(ROOT, 'scripts', 'docs-diagrams.mjs')).href) as {
    diagramNames: (dir: string) => string[];
    stale: (root: string) => string[];
  };
  assert.ok(diagrams.diagramNames(join(ROOT, 'docs', 'diagrams')).length > 0);
  assert.deepEqual(diagrams.stale(ROOT), [], 'diagrams out of date: run npm run docs:diagrams');
});

// I titoli veri dei film delle prove, come SHA-256 (i primi 16 caratteri) delle
// parole in minuscolo: l'elenco non li rivela, il test li riconosce. Per
// aggiungerne uno: sha256 di "parola parola" in minuscolo, senza punteggiatura.
const REAL_TITLES = new Set([
  '7d445240c97cb8b3', 'ac3160b0a933ac03', '166597eb357f6280', '9c195fecd40c7522', '8a88c3240eb64ff7',
  '6455f18775732b32', '4cf465fe2a25f794', '1dd31cd072fdd30f', '2d32d516dffba016', '68bb98e1f0a9191e',
  'e5139ade5ef31c37', '0500f31a80abe431', '15aafd7c8f5ad23c', 'eb5a94c02b629734', '0b14b8bdf574ff15',
  'd2b8c1c0fdea9b1d', 'fee6cad068a1d83b', '2e45a036ce5d7594', 'a76792a4c64af0b0', 'c63c9f498f727242',
  'e7a61ba423f6be8e', '0075870f97c892ba', '7cbb8c9525a8cf84', '1f87857ddc18452f', '7ca071b989380f2a',
  '59eec9b5b7c840f7', 'ed1712d8189adcea', 'ed43467213ec5222',
]);

test('nomi inventati: niente titoli veri dei film delle prove né percorsi personali', () => {
  const files = [
    ...markdownFiles(),
    ...['src', 'test', 'scripts', join('docs', 'diagrams'), '.github']
      .flatMap((d) => listFiles(join(ROOT, d)))
      .map((f) => relative(ROOT, f))
      .filter((f) => /\.(ts|mjs|mmd|json|yml)$/.test(f)),
  ];
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  for (const file of files) {
    const text = read(file);
    assert.equal(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)\w/.exec(text), null, `${file} contains a personal path`);
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (let i = 0; i < words.length; i++) {
      for (let n = 1; n <= 3 && i + n <= words.length; n++) {
        const term = words.slice(i, i + n).join(' ');
        assert.ok(!REAL_TITLES.has(hash(term)), `${file} contains a real film title ("${term}"): use an invented one`);
      }
    }
  }
});

test('CODICI.md collega ogni codice al test che lo produce', () => {
  const all = [...REFUSAL_CODES, ...ERROR_CODES, ...WARNING_CODES, 'CANCELLED'];
  const rows = codeRows(read('docs/CODICI.md'), 'Test');
  assert.deepEqual([...rows.keys()].sort(), [...all].sort());

  for (const [code, row] of rows) {
    const cell = row[1] ?? '';
    if (cell.startsWith('previsto: ')) continue;
    for (const ref of cell.split('<br>')) {
      const m = /^`(test\/[\w.-]+\.test\.ts)` › (.+)$/.exec(ref);
      assert.ok(m?.[1] && m[2], `${code}: "${ref}" is neither a test nor "previsto: <modulo>"`);
      const source = read(m[1]);
      const start = source.indexOf(`test('${m[2].replace(/'/g, "\\'")}',`);
      assert.notEqual(start, -1, `${code}: test "${m[2]}" not found in ${m[1]}`);
      const next = source.indexOf('\ntest(', start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      assert.ok(body.includes(`'${code}'`), `${code}: test "${m[2]}" does not use ${code}`);
    }
  }
});

test('TARATURA.md riporta ogni parametro con valore, limiti e stato', () => {
  const cal = loadCalibration();
  const rows = tableRows(read('docs/TARATURA.md'), 'Parametri');
  for (const name of CALIBRATION_NAMES) {
    const row = rows.find((r) => r[1] === `\`${name}\``);
    assert.ok(row, `${name} missing from TARATURA.md`);
    const { min, max } = CALIBRATION_LIMITS[name];
    assert.equal(row[2], `\`${cal.values[name]}\``, `value of ${name}`);
    assert.equal(row[3], `\`${min}\` – \`${max}\``, `limits of ${name}`);
    assert.equal(row[4], cal.provisional.includes(name) ? 'sì' : 'no', `provisional flag of ${name}`);
  }
  assert.equal(rows.length - 1, CALIBRATION_NAMES.length, 'one row per parameter (plus the header)');
});

test('REPORT.md riporta la versione del formato, i campi e le fasi dell\'avanzamento, in ordine', () => {
  const doc = read('docs/REPORT.md');
  assert.ok(doc.includes(`Versione del formato: **${REPORT_FORMAT}**`), 'format version');
  const first = (rows: string[][]) => rows.map((r) => /^`([\w-]+)`$/.exec(r[0] ?? '')?.[1]).filter((c): c is string => c !== undefined);
  assert.deepEqual(first(tableRows(doc, 'Campi')), [...REPORT_FIELDS]);
  const progress = tableRows(doc, 'Avanzamento');
  const phases = progress.slice(progress.findIndex((r) => r[0] === 'Fase') + 1);
  assert.deepEqual(first(phases), [...PROGRESS_PHASES]);
});

test('ARCHITETTURA.md elenca esattamente i file di src/', () => {
  const listFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? listFiles(join(dir, e.name)) : [relative(ROOT, join(dir, e.name))]);
  const files = listFiles(join(ROOT, 'src')).filter((f) => /\.(ts|json)$/.test(f)).sort();

  const doc = read('docs/ARCHITETTURA.md');
  const documented = tableRows(doc, 'Moduli')
    .map((r) => /^`(src\/[^`]+)`$/.exec(r[0] ?? '')?.[1])
    .filter((f): f is string => f !== undefined)
    .sort();
  assert.deepEqual(documented, files);
});

test('CHANGELOG.md ha la sezione della versione di package.json, in cima', () => {
  const { version } = JSON.parse(read('package.json')) as { version: string };
  const first = read('docs/CHANGELOG.md').split('\n').find((l) => l.startsWith('## ['));
  assert.match(first ?? '', new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`));
});

test('COPPIE.md riporta chiavi dell\'elenco, categorie, verdetti e campi del riassunto, in ordine', () => {
  const doc = read('docs/COPPIE.md');
  const first = (rows: string[][]) => rows.map((r) => /^`([\w-]+)`$/.exec(r[0] ?? '')?.[1] ?? r[0]);
  assert.deepEqual(first(firstTable(doc, 'Elenco delle coppie')), [...PAIR_KEYS]);
  const categories = firstTable(doc, 'Categorie');
  assert.deepEqual(first(categories), Object.keys(PAIR_CATEGORIES));
  assert.deepEqual(first(categories.filter((r) => r[2] === '§15, punto 3')), [...PHASE1_CATEGORIES]);
  assert.deepEqual(first(firstTable(doc, 'Verdetti')), [...VERDICTS]);
  assert.deepEqual(first(firstTable(doc, 'Riassunto')), [...SUMMARY_FIELDS]);
});
