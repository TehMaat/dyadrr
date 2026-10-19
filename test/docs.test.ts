// Tiene la documentazione allineata al codice (CONTRIBUTING.md, "Documentazione").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ERROR_CODES, REFUSAL_CODES, WARNING_CODES, exitCodeFor } from '../src/codes.js';
import { CHOICES, CHOICE_NAMES } from '../src/choices.js';
import { CALIBRATION_LIMITS, CALIBRATION_NAMES, loadCalibration } from '../src/calibration.js';
import { PROGRESS_PHASES, REPORT_FIELDS, REPORT_FORMAT } from '../src/report.js';
import { INPUTS_OPTION } from '../src/cli.js';
import { PAIR_CATEGORIES, PAIR_KEYS, PHASE1_CATEGORIES, SUMMARY_FIELDS, VERDICTS } from '../src/pairs.js';

// I test girano da build/test/.
const ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

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

  const envs = new Set<string>([...CHOICE_NAMES.map((n) => CHOICES[n].env), INPUTS_OPTION.env]);
  for (const doc of ['docs/CLI.md', 'README.md', 'docs/STUDIO-DI-FATTIBILITA.md']) {
    for (const [, name] of read(doc).matchAll(/\b(DYADRR_[A-Z_]+)\b/g)) {
      assert.ok(envs.has(name!), `${doc} mentions ${name}, which does not exist`);
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
