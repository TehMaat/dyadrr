import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCalibration, parseCalibration } from '../src/calibration.js';
import { runCli } from '../src/cli.js';
import { DyadrrError } from '../src/codes.js';
import {
  ANALYSIS_CHANGES,
  IMPORT_SINCE,
  PHASE1_CATEGORIES,
  SUMMARY_FIELDS,
  checkImport,
  compareVersions,
  defaultResults,
  pairArguments,
  parsePairList,
  reusable,
  runPairs,
  summarizePair,
  summarizeSeries,
  summaryMarkdown,
  type PairSpec,
  type PairSummary,
  type Summary,
} from '../src/pairs.js';
import { dyadrrVersion, type Report } from '../src/report.js';
import { runAsync, settle, tempDir } from './helpers/mkv.js';

// Le coppie reali della fase 1 (studio §15, punto 3). Il riassunto si prova
// sul report vero di un'analisi idonea: 60 s di rumore rosa in 5.1, il
// donatore con l'italiano e l'inglese 1,5 s dopo (S = +1500 ms), analizzati
// con una taratura che accorcia finestre e intervallo di ricerca, come in
// test/cli.test.ts. La serie si prova con un Dyadrr finto che scrive quel
// report; l'ultimo test lancia il processo vero con il Dyadrr vero.

const SECONDS = 60;
const S = 1500;

const base = loadCalibration();
const cal = parseCalibration({
  version: base.version,
  provisional: base.provisional,
  values: {
    ...base.values,
    maxOffsetMs: 5000,
    searchMarginMs: 2000,
    anchorWindowMs: 10_000,
    checkpointWindowMs: 3000,
    checkpointCount: 10,
    maxCheckpointCount: 20,
    minConsistentCheckpoints: 10,
    maxCheckpointGapMs: 60_000,
    minCoverage: 0.75,
  },
});

let dir: string;
const p = (name: string) => join(dir, name);
/** Il report dell'analisi idonea, da cui si ricavano gli altri. */
let eligible: Report;

const surround = (name: string, seeds: readonly number[]) => runAsync('ffmpeg', [
  '-v', 'error', '-y', '-filter_complex',
  [
    ...seeds.map((s, i) => `anoisesrc=d=${SECONDS}:c=pink:r=48000:a=0.2:s=${s}[c${i}]`),
    `${seeds.map((_, i) => `[c${i}]`).join('')}join=inputs=6:channel_layout=5.1:map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-BL|5.0-BR[o]`,
  ].join(';'),
  '-map', '[o]', '-c:a', 'ac3', p(name),
]);

const video = (name: string, size: string) => runAsync('ffmpeg', [
  '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24000/1001`, '-t', String(SECONDS),
  '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', p(name),
]);

before(async () => {
  dir = tempDir();
  await Promise.all([
    video('ref-video.mkv', '320x180'),
    video('donor-video.mkv', '160x90'),
    surround('eng.mka', [1, 2, 3, 4, 5, 6]),
    surround('ita.mka', [1, 2, 7, 4, 5, 6]),
  ]);
  await Promise.all([
    runAsync('mkvmerge', ['-q', '-o', p('reference.mkv'), p('ref-video.mkv'), '--language', '0:eng', p('eng.mka')]),
    runAsync('mkvmerge', [
      '-q', '-o', p('donor.mkv'), p('donor-video.mkv'),
      '--language', '0:ita', '--sync', `0:-${S}`, p('ita.mka'),
      '--language', '0:eng', '--default-track-flag', '0:0', '--sync', `0:-${S}`, p('eng.mka'),
    ]),
  ]);
  settle(p('reference.mkv'));
  settle(p('donor.mkv'));
  const code = await runCli(['analyze', p('reference.mkv'), p('donor.mkv'), '--report', p('eligible.json')], {
    env: {},
    cwd: dir,
    calibration: cal,
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 0);
  eligible = JSON.parse(readFileSync(p('eligible.json'), 'utf8')) as Report;
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ---------------------------------------------------------------- aiuti

const bad = (message: RegExp) => (e: unknown) => e instanceof DyadrrError && e.code === 'BAD_ARGUMENTS' && message.test(e.message);

const spec = (over: Partial<PairSpec> = {}): PairSpec => ({
  id: 'film',
  inputs: [p('reference.mkv'), p('donor.mkv')],
  expected: 'eligible',
  originalLanguage: null,
  categories: [],
  offsetMs: null,
  cause: null,
  note: null,
  report: null,
  ...over,
});

/** Una copia del report idoneo con qualche campo cambiato. */
const variant = (change: (r: Report) => void): Report => {
  const r = structuredClone(eligible);
  change(r);
  return r;
};

/** Un rifiuto per salti, di `frames` fotogrammi ciascuno. */
const jumps = (...frames: number[]) => variant((r) => {
  r.decision = 'refused';
  r.reasons = [{ code: 'CHECKPOINT_CONTRADICTION', message: 'a jump' }];
  r.measurement!.contradiction = {
    kind: frames.length === 1 ? 'single-jump' : 'multiple-jumps',
    jumps: frames.map((f, i) => ({ afterMs: i * 1000, beforeMs: i * 1000 + 500, fromOffsetMs: S, toOffsetMs: S + f * 41.7, amountMs: f * 41.7, frames: f })),
  };
});

const errorReport = (code: string) => ({ ...variant(() => {}), decision: 'error', reasons: [{ code, message: code }] }) as Report;

const read = (path: string) => readFileSync(path, 'utf8');
const json = <T>(path: string) => JSON.parse(read(path)) as T;

/**
 * Un Dyadrr finto: scrive il report idoneo con gli ingressi e la lingua
 * originale ricevuti e annota la coppia in CALLS. Con `hang.mkv` aspetta
 * SIGTERM e scrive un report `cancelled`; `crash.mkv` esce senza report,
 * `kill.mkv` si uccide con SIGKILL.
 */
function fakeDyadrr(): { command: string[]; env: NodeJS.ProcessEnv; calls: () => string[]; signals: string } {
  const fake = p('fake-dyadrr.cjs');
  const calls = p(`calls-${Math.random().toString(36).slice(2)}`);
  const signals = `${calls}-signals`;
  writeFileSync(fake, `
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const option = (name) => { const a = args.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const out = option('report');
fs.appendFileSync(process.env.CALLS, path.basename(out, '.json') + '\\n');
process.stderr.write(JSON.stringify({ event: 'phase', phase: 'read', elapsedMs: 0 }) + '\\n');
if (args[1].endsWith('crash.mkv')) process.exit(3);
if (args[1].endsWith('kill.mkv')) process.kill(process.pid, 'SIGKILL');
const report = JSON.parse(fs.readFileSync(process.env.TEMPLATE, 'utf8'));
report.arguments.files = [args[1], args[2]];
report.arguments.originalLanguage = option('original-language');
if (args[1].endsWith('hang.mkv')) {
  let n = 0;
  process.on('SIGTERM', () => {
    if (++n > 1) return;
    fs.writeFileSync(process.env.SIGNALS, String(n));
    setTimeout(() => {
      report.decision = 'cancelled';
      report.reasons = [{ code: 'CANCELLED', message: 'cancelled: received SIGTERM' }];
      fs.writeFileSync(out, JSON.stringify(report));
      process.exit(50);
    }, 300);
  });
  fs.writeFileSync(process.env.READY, '');
  setInterval(() => {}, 1000);
} else {
  fs.writeFileSync(out, JSON.stringify(report));
}
`);
  return {
    command: [process.execPath, fake],
    env: { ...process.env, TEMPLATE: p('eligible.json'), CALLS: calls, SIGNALS: signals, READY: `${calls}-ready` },
    calls: () => (existsSync(calls) ? read(calls).split('\n').filter((l) => l !== '') : []),
    signals,
  };
}

/** Un elenco di coppie in una cartella nuova. */
function list(name: string, text: string): { path: string; results: string } {
  const d = p(name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'coppie.txt'), text);
  return { path: join(d, 'coppie.txt'), results: join(d, 'coppie-results') };
}

// ---------------------------------------------------------------- test

test('elenco delle coppie: sezioni, chiavi e commenti; BAD_ARGUMENTS per un elenco sbagliato', () => {
  const pairs = parsePairList([
    '# Coppie per la taratura',
    '[blade-runner]',
    'input=film/Blade Runner (UHD).mkv\r',
    'input=film/Blade Runner = BD.mkv',
    'expected=eligible',
    'original-language=eng',
    'category=uhd-bd',
    'category=dubbing-card',
    'category=uhd-bd',
    'offset-ms=-1234.5',
    'note=S controllato a mano a 1:02:00',
    '',
    '[cut_2]',
    'input=a.mkv',
    'input=b.mkv',
    'expected=refused',
    'category=different-cut',
    'cause=',
    'report=taratura/importati/cut.analyze.json',
  ].join('\n'));
  assert.deepEqual(pairs, [
    {
      id: 'blade-runner',
      inputs: ['film/Blade Runner (UHD).mkv', 'film/Blade Runner = BD.mkv'],
      expected: 'eligible',
      originalLanguage: 'eng',
      categories: ['uhd-bd', 'dubbing-card'],
      offsetMs: -1234.5,
      cause: null,
      note: 'S controllato a mano a 1:02:00',
      report: null,
    },
    {
      id: 'cut_2',
      inputs: ['a.mkv', 'b.mkv'],
      expected: 'refused',
      originalLanguage: null,
      categories: ['different-cut'],
      offsetMs: null,
      cause: '',
      note: null,
      report: 'taratura/importati/cut.analyze.json',
    },
  ]);

  const pair = (...lines: string[]) => ['[x]', 'input=a.mkv', 'input=b.mkv', 'expected=eligible', ...lines].join('\n');
  assert.throws(() => parsePairList(''), bad(/no pairs/));
  assert.throws(() => parsePairList('# solo commenti\n'), bad(/no pairs/));
  assert.throws(() => parsePairList('input=a.mkv\n[x]'), bad(/line 1: a key before the first \[id\]/));
  assert.throws(() => parsePairList(pair('una riga')), bad(/line 5 is not \[id\], key=value or a # comment/));
  assert.throws(() => parsePairList(pair(' note=x')), bad(/unknown key " note"/));
  assert.throws(() => parsePairList(pair('tail=trim')), bad(/unknown key "tail"/));
  assert.throws(() => parsePairList(pair('expected=refused')), bad(/"expected" is given more than once in \[x\]/));
  assert.throws(() => parsePairList(`${pair()}\n[x]`), bad(/the id "x" is used twice/));
  assert.throws(() => parsePairList('[-x]'), bad(/"-x" is not a valid id/));
  assert.throws(() => parsePairList('[x]\ninput=a.mkv\nexpected=eligible'), bad(/\[x\]: expected two input lines, found 1/));
  assert.throws(() => parsePairList('[x]\ninput=a.mkv\ninput=\nexpected=eligible'), bad(/an input is empty/));
  assert.throws(() => parsePairList('[x]\ninput=a.mkv\ninput=b.mkv'), bad(/expected is missing/));
  assert.throws(() => parsePairList('[x]\ninput=a.mkv\ninput=b.mkv\nexpected=yes'), bad(/expected "yes": eligible or refused/));
  assert.throws(() => parsePairList(pair('category=anime')), bad(/unknown category "anime"/));
  assert.throws(() => parsePairList(pair('offset-ms=1,5')), bad(/offset-ms "1,5" is not a number/));
  assert.throws(() => parsePairList(pair('original-language=xx1')), bad(/--original-language: "xx1"/));
  assert.throws(() => parsePairList(pair('report=')), bad(/\[x\]: report is empty/));
  assert.throws(() => parsePairList(pair('report=a.json', 'report=b.json')), bad(/"report" is given more than once/));
});

test('argomenti di analyze, cartella dei risultati per default e report riusabili', () => {
  const s = spec({ inputs: ['film/a.mkv', '/film/b.mkv'], originalLanguage: 'jpn' });
  assert.deepEqual(pairArguments(s, '/data', '/data/r/film.json'), [
    'analyze', '/data/film/a.mkv', '/film/b.mkv', '--original-language=jpn', '--report=/data/r/film.json', '--progress=json',
  ]);
  assert.deepEqual(pairArguments(spec(), dir, 'x.json').slice(3), ['--report=x.json', '--progress=json']);
  assert.equal(defaultResults('/data/taratura/coppie.txt'), '/data/taratura/coppie-results');
  assert.equal(defaultResults('/data/coppie'), '/data/coppie-results');

  const current = { dyadrr: eligible.dyadrr, calibration: eligible.calibration!.version };
  assert.ok(reusable(eligible, spec(), dir, current));
  assert.ok(reusable(eligible, spec({ inputs: ['reference.mkv', 'donor.mkv'] }), dir, current), 'relative to the folder');
  assert.ok(!reusable(eligible, spec({ inputs: [p('donor.mkv'), p('reference.mkv')] }), dir, current), 'another order');
  assert.ok(!reusable(eligible, spec({ originalLanguage: 'eng' }), dir, current), 'another original language');
  assert.ok(!reusable(eligible, spec(), dir, { ...current, dyadrr: '0.0.1' }), 'another Dyadrr');
  assert.ok(!reusable(eligible, spec(), dir, { ...current, calibration: current.calibration + 1 }), 'another calibration');
  assert.ok(reusable(jumps(1), spec(), dir, current), 'a refusal');
  assert.ok(!reusable(errorReport('INPUT_BUSY'), spec(), dir, current), 'an error');
  assert.ok(!reusable(variant((r) => (r.decision = 'cancelled')), spec(), dir, current), 'cancelled');
  assert.ok(!reusable(variant((r) => (r.format = 0)), spec(), dir, current), 'another format');
  assert.ok(!reusable(null, spec(), dir, current));
});

test('riassunto di una coppia: verdetto dalla decisione e da expected, S, punti e margini dei picchi', () => {
  const s = summarizePair(spec({ offsetMs: S + 3, categories: ['uhd-bd'] }), eligible, 'film.json', false);
  assert.deepEqual([s.verdict, s.detail, s.decision, s.code, s.report, s.reused], ['ok', null, 'eligible', null, 'film.json', false]);
  assert.deepEqual([s.dyadrr, s.calibration, s.tools], [eligible.dyadrr, cal.version, eligible.tools]);
  assert.equal(s.offset!.offsetMs, S);
  assert.equal(s.offset!.manualDifferenceMs, -3);
  assert.equal(s.measureLanguage, 'eng');
  assert.deepEqual(s.checkpoints, { total: 10, added: 0, consistent: 10, inconclusive: 0, contradictory: 0, unmatched: 0 });
  assert.ok(s.anchors.length > 0 && s.anchors[0]!.outcome === 'accepted');
  assert.ok(s.bytesRead! > 0 && s.coverage! > 0.75);
  assert.equal(s.transfer!.probes, 5);

  // Margini: tutti i picchi dei punti sono sicuri e a S, nessun punto muto.
  const m = s.margins!;
  assert.equal(m.secureAtS.count, 10);
  assert.ok(m.secureAtS.ncc! >= cal.values.nccMin && m.secureAtS.ratio! >= cal.values.peakRatioMin, JSON.stringify(m));
  assert.equal(m.secureAtS.ncc, Math.round(Math.min(...eligible.measurement!.checkpoints.map((c) => c.ncc!)) * 1000) / 1000);
  assert.ok(m.secureAtS.energyDbfs! > cal.values.silenceDbfs);
  for (const g of [m.unsureAtS, m.secureElsewhere, m.unsureElsewhere]) assert.deepEqual(g, { count: 0, ncc: null, ratio: null });
  assert.deepEqual(m.silent, { count: 0, secureAtS: 0 });
  assert.ok(m.integrityGapMs !== null && m.integrityGapMs <= cal.values.integrityToleranceMs);
  assert.equal(m.startGapMs, eligible.plan!.start.gapMs);

  // Un punto muto con un picco sicuro a S, un picco debole a S e uno altrove.
  const changed = summarizePair(spec(), variant((r) => {
    const [a, b] = r.measurement!.checkpoints;
    a!.energyDbfs = -80;
    b!.local = { offsetMs: S + 2, ncc: 0.4, ratio: 2 };
    b!.wide = { offsetMs: S + 900, ncc: 0.3, ratio: 1.1 };
  }), 'film.json', true).margins!;
  assert.deepEqual(changed.silent, { count: 1, secureAtS: 1 });
  assert.equal(changed.secureAtS.count, 8);
  assert.deepEqual(changed.unsureAtS, { count: 1, ncc: 0.4, ratio: 2 });
  assert.deepEqual(changed.unsureElsewhere, { count: 1, ncc: 0.3, ratio: 1.1 });

  const verdict = (x: Partial<PairSpec>, r: Report | null) => {
    const v = summarizePair(spec(x), r, 'film.json', false);
    return [v.verdict, v.detail];
  };
  assert.deepEqual(verdict({ offsetMs: S + 40 }, eligible), ['wrong-merge', `S = ${S} ms, ${S + 40} ms by hand`]);
  assert.deepEqual(verdict({ expected: 'refused' }, eligible), ['wrong-merge', 'eligible, but expected refused']);
  assert.deepEqual(verdict({}, jumps(1)), ['good-refused', 'no cause given']);
  assert.deepEqual(verdict({ cause: 'master diverso' }, jumps(1)), ['good-refused', null]);
  assert.deepEqual(verdict({ expected: 'refused' }, jumps(1)), ['ok', null]);
  assert.deepEqual(verdict({}, errorReport('INPUT_UNREADABLE')), ['error', 'INPUT_UNREADABLE']);
  assert.deepEqual(verdict({}, variant((r) => (r.decision = 'cancelled'))), ['cancelled', null]);
  assert.deepEqual(verdict({}, null), ['missing', null]);
  const missing = summarizePair(spec(), null, 'film.json', true);
  assert.deepEqual([missing.report, missing.reused, missing.margins, missing.checkpoints], [null, false, null, null]);
});

test('riassunto della serie: criterio di uscita, coppie uhd-bd rifiutate per salti piccoli, margini delle soglie', () => {
  const pairs: PairSummary[] = PHASE1_CATEGORIES.map((c, i) => summarizePair(spec({ id: `p${i}`, categories: [c] }), eligible, `p${i}.json`, false));
  for (let i = pairs.length; i < 13; i++) pairs.push(summarizePair(spec({ id: `p${i}`, categories: ['other'] }), eligible, `p${i}.json`, false));
  pairs.push(summarizePair(spec({ id: 'jump-1', categories: ['uhd-bd'], cause: 'master | diverso' }), jumps(1, -2.4), 'jump-1.json', false));
  pairs.push(summarizePair(spec({ id: 'jump-3', categories: ['uhd-bd'], cause: 'un salto vero' }), jumps(3), 'jump-3.json', false));
  pairs.push(summarizePair(spec({ id: 'cut', expected: 'refused', categories: ['different-cut'] }), jumps(500), 'cut.json', false));
  pairs.push(summarizePair(spec({ id: 'busy' }), errorReport('INPUT_BUSY'), 'busy.json', false));
  pairs.push(summarizePair(spec({ id: 'later' }), null, 'later.json', true));
  // Un picco debole altrove, in una coppia da rifiutare: conta per il minimo di θ.
  pairs.push(summarizePair(spec({ id: 'noise', expected: 'refused' }), variant((r) => {
    r.decision = 'refused';
    r.reasons = [{ code: 'CHECKPOINT_UNMATCHED', message: 'unmatched' }];
    r.measurement!.checkpoints[0]!.local = { offsetMs: S + 700, ncc: 0.45, ratio: 1.2 };
  }), 'noise.json', false));

  const s = summarizeSeries(pairs, { list: '/data/coppie.txt', results: '/data/coppie-results', calibration: base, at: new Date(0) });
  assert.equal(s.dyadrr, dyadrrVersion());
  assert.equal(s.writtenAt, '1970-01-01T00:00:00.000Z');
  assert.deepEqual(s.criterion.measured, { value: 17, required: 15 });
  assert.deepEqual(s.criterion.categories.missing, []);
  assert.equal(s.criterion.categories.covered['uhd-bd'], 3);
  assert.deepEqual(s.criterion.wrongMerges, []);
  assert.deepEqual(s.criterion.goodRefused, { withCause: ['jump-1', 'jump-3'], withoutCause: [] });
  assert.deepEqual(s.criterion.uhdBdSmallJumps, { pairs: 3, refused: 1, fraction: 0.333 });
  assert.equal(s.criterion.met, true);
  assert.deepEqual(s.verdicts, { ok: 15, 'good-refused': 2, 'wrong-merge': 0, stale: 0, error: 1, cancelled: 0, missing: 1 });
  assert.deepEqual(s.versions, { dyadrr: [eligible.dyadrr], calibration: [cal.version], tools: [eligible.tools], mixed: false });

  const t = s.thresholds;
  assert.deepEqual([t.nccMin!.value, t.nccMin!.provisional], [base.values.nccMin, true]);
  assert.equal(t.nccMin!.margins.secureAtSMin!.value, pairs[0]!.margins!.secureAtS.ncc);
  assert.equal(t.nccMin!.margins.unsureAtSMax, null);
  assert.deepEqual(t.nccMin!.margins.unsureElsewhereMax, { value: 0.45, pair: 'noise' });
  assert.deepEqual(t.peakRatioMin!.margins.unsureElsewhereMax, { value: 1.2, pair: 'noise' });
  assert.equal(t.integrityToleranceMs!.margins.gapMax!.pair, 'p0');
  assert.deepEqual(Object.keys(t), ['nccMin', 'peakRatioMin', 'silenceDbfs', 'integrityToleranceMs', 'longGapWithoutItalianMs', 'abruptStartDbfs']);

  const md = summaryMarkdown(s);
  assert.match(md, /^# Dyadrr pairs\n/);
  assert.match(md, /\| Pairs measured \| 17 \| at least 15 \| yes \|/);
  assert.match(md, /\| Good uhd-bd pairs refused for jumps of 1–2 frames \| 1 of 3 \(33%\) \| measured \| yes \|/);
  assert.match(md, /Criterion met: \*\*yes\*\*/);
  assert.match(md, new RegExp(`\\| p0 \\| uhd-bd \\| eligible \\| eligible \\| ok \\| ${S} \\|`));
  assert.match(md, /\| jump-1 \| good-refused \| CHECKPOINT_CONTRADICTION \| a jump \| master \\\| diverso \|/);
  assert.match(md, /\| busy \| error \| INPUT_BUSY \|/);
  assert.match(md, /\| later \| — \| eligible \| — \| missing \|/);
  assert.match(md, /\| `nccMin` \| 0\.5 \| yes \| secureAtSMin [\d.]+ \(p\d+\); unsureAtSMax —; unsureElsewhereMax 0\.45 \(noise\) \|/);
  assert.ok(!md.includes(dir), 'no paths in summary.md');

  // Meno coppie, una categoria scoperta, un merge sbagliato, un rifiuto senza causa.
  const fewer = summarizeSeries([
    ...pairs.slice(1, 5),
    summarizePair(spec({ id: 'wrong', expected: 'refused' }), eligible, 'wrong.json', false),
    summarizePair(spec({ id: 'why', categories: ['uhd-bd'] }), jumps(2), 'why.json', false),
  ], { list: 'l', results: 'r', calibration: base });
  assert.deepEqual(fewer.criterion.measured.value, 6);
  assert.deepEqual(fewer.criterion.categories.missing, ['non-english', 'two-discs']);
  assert.deepEqual(fewer.criterion.wrongMerges, ['wrong']);
  assert.deepEqual(fewer.criterion.goodRefused.withoutCause, ['why']);
  assert.equal(fewer.criterion.met, false);
  assert.match(summaryMarkdown(fewer), /\| Wrong merges \| 1 \(wrong\) \| 0 \| no \|/);

  const mixed = summarizeSeries([pairs[0]!, { ...pairs[1]!, dyadrr: '0.0.1' }], { list: 'l', results: 'r', calibration: base });
  assert.equal(mixed.versions.mixed, true);
  assert.match(summaryMarkdown(mixed), /\*\*Warning:\*\* the pairs were not all measured with the same versions/);
});

test('la serie: una coppia alla volta, report riusati, --only e --again, riassunto scritto', async () => {
  const fake = fakeDyadrr();
  const { path, results } = list('series', [
    '[first]', `input=${p('reference.mkv')}`, `input=${p('donor.mkv')}`, 'expected=eligible', 'category=uhd-bd', '',
    '[second]', 'input=reference.mkv', 'input=donor.mkv', 'expected=refused', 'original-language=eng',
  ].join('\n'));
  const run = async (o: { only?: string[]; again?: boolean } = {}) => {
    const lines: string[] = [];
    let stdout = '';
    const code = await runPairs({ list: path, cwd: dir, dyadrr: fake.command, env: fake.env, log: (l) => lines.push(l), stdout: (t) => (stdout += t), ...o });
    return { code, lines, stdout };
  };

  const r = await run();
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.deepEqual(fake.calls(), ['first', 'second']);
  assert.equal(r.stdout, `${join(results, 'summary.json')}\n${join(results, 'summary.md')}\n`);
  assert.equal(r.lines.length, 5);
  assert.equal(r.lines[0], '[1/2] first: analyze');
  assert.match(r.lines[1]!, /^\[1\/2\] first: eligible \(\d+ s\)$/);
  assert.equal(r.lines[2], '[2/2] second: analyze');
  assert.equal(r.lines.at(-1), '2 of 2 pairs measured; exit criterion met: no');

  const first = json<Report>(join(results, 'first.json'));
  assert.deepEqual(first.arguments.files, [p('reference.mkv'), p('donor.mkv')]);
  assert.equal(json<Report>(join(results, 'second.json')).arguments.originalLanguage, 'eng');
  assert.match(read(join(results, 'first.log')), /^\{"event":"phase","phase":"read","elapsedMs":0\}\n$/);

  const summary = json<Summary>(join(results, 'summary.json'));
  assert.deepEqual(Object.keys(summary), [...SUMMARY_FIELDS]);
  assert.deepEqual([summary.list, summary.results], [path, results]);
  assert.deepEqual(summary.pairs.map((x) => [x.id, x.verdict, x.reused, x.report]), [
    ['first', 'ok', false, 'first.json'],
    ['second', 'wrong-merge', false, 'second.json'],
  ]);
  assert.deepEqual(summary.criterion.wrongMerges, ['second']);
  assert.match(read(join(results, 'summary.md')), /\| second \| — \| refused \| eligible \| wrong-merge \(eligible, but expected refused\) \|/);

  // Di nuovo: i report si riusano e Dyadrr non si lancia.
  const again = await run();
  assert.equal(again.code, 0);
  assert.deepEqual(fake.calls(), ['first', 'second']);
  assert.deepEqual(again.lines.slice(0, 2), ['[1/2] first: report reused (eligible)', '[2/2] second: report reused (eligible)']);
  assert.deepEqual(json<Summary>(join(results, 'summary.json')).pairs.map((x) => x.reused), [true, true]);

  // --only con --again: solo quella coppia, l'altra resta nel riassunto.
  assert.equal((await run({ only: ['second'], again: true })).code, 0);
  assert.deepEqual(fake.calls(), ['first', 'second', 'second']);
  assert.deepEqual(json<Summary>(join(results, 'summary.json')).pairs.map((x) => [x.id, x.reused]), [['first', true], ['second', false]]);

  // Un report di un'altra versione non si riusa: si rimisura, e senza --only non resta.
  const stale = json<Report>(join(results, 'first.json'));
  writeFileSync(join(results, 'first.json'), JSON.stringify({ ...stale, dyadrr: '0.0.1' }));
  assert.equal((await run({ only: ['second'] })).code, 0);
  assert.deepEqual(fake.calls(), ['first', 'second', 'second'], '--only second: first is not measured');
  assert.deepEqual(json<Summary>(join(results, 'summary.json')).pairs.map((x) => x.verdict), ['missing', 'wrong-merge']);
  assert.equal((await run()).code, 0);
  assert.deepEqual(fake.calls(), ['first', 'second', 'second', 'first']);
  assert.equal(json<Report>(join(results, 'first.json')).dyadrr, eligible.dyadrr);

  // Un elenco sbagliato o un --only sconosciuto: niente si misura, nessun riassunto.
  const broken = list('broken', '[x]\ninput=a.mkv\nexpected=eligible\n');
  const lines: string[] = [];
  assert.equal(await runPairs({ list: broken.path, dyadrr: fake.command, env: fake.env, log: (l) => lines.push(l) }), 30);
  assert.deepEqual(lines, ['BAD_ARGUMENTS: pair list: [x]: expected two input lines, found 1']);
  assert.ok(!existsSync(broken.results));
  assert.equal((await run({ only: ['third'] })).code, 30);
  assert.equal(await runPairs({ list: p('nothing.txt'), log: (l) => lines.push(l) }), 30);
  assert.match(lines.at(-1)!, /^BAD_ARGUMENTS: pair list: .*nothing\.txt cannot be read \(ENOENT\)$/);
  assert.deepEqual(fake.calls(), ['first', 'second', 'second', 'first']);

  // --results altrove, relativo alla cartella corrente.
  assert.equal(await runPairs({ list: path, results: 'altrove', cwd: dir, dyadrr: fake.command, env: fake.env }), 0);
  assert.ok(existsSync(p('altrove/summary.md')) && existsSync(p('altrove/first.json')));
});

test('report importati: controlli, versioni superate da ANALYSIS_CHANGES, riassunto senza misurare', async () => {
  assert.ok(compareVersions('0.13.1', '0.14.0') < 0 && compareVersions('0.14.0', '0.13.1') > 0);
  assert.equal(compareVersions('0.14.0', '0.14.0'), 0);
  assert.ok(compareVersions('0.9.0', '0.13.0') < 0, 'numeri, non testo');
  assert.ok(ANALYSIS_CHANGES.every((c) => compareVersions(c.version, IMPORT_SINCE) > 0 && compareVersions(c.version, dyadrrVersion()) <= 0));

  // Gli ingressi si confrontano per nome, in qualsiasi ordine: il rip può essere stato spostato o cancellato.
  const current = { dyadrr: dyadrrVersion(), calibration: cal.version };
  const moved = spec({ inputs: ['c/Watcher/donor.mkv', 'c/Watcher/reference.mkv'], report: 'r.json' });
  assert.deepEqual(checkImport(eligible, moved, current), { from: eligible.dyadrr, differences: [], stale: null });
  const old = variant((r) => (r.dyadrr = '0.13.1'));
  assert.deepEqual(checkImport(old, moved, current), {
    from: '0.13.1',
    differences: ANALYSIS_CHANGES.filter((c) => c.version === '0.14.0' && !c.stale(old)).map((c) => `${c.version}: ${c.what}`),
    stale: null,
  });
  assert.equal(checkImport(old, moved, current).differences.length, 3);
  const oldJumps = jumps(1);
  oldJumps.dyadrr = '0.13.1';
  assert.match(checkImport(oldJumps, moved, current).stale!, /^Dyadrr 0\.13\.1, changed in 0\.14\.0: contradiction shape/);
  assert.equal(checkImport(variant((r) => (r.dyadrr = '0.12.0')), moved, current).stale, `Dyadrr 0.12.0, imports start from ${IMPORT_SINCE}`);
  assert.match(checkImport(eligible, moved, { ...current, calibration: cal.version + 1 }).stale!, /^calibration \d+, now \d+$/);
  assert.match(checkImport(variant((r) => (r.format = 0)), moved, current).stale!, /^report format 0/);

  // Un report che non è di questa coppia è un errore dell'elenco.
  assert.throws(() => checkImport(null, moved, current), bad(/\[film\]: report r\.json: cannot be read/));
  assert.throws(() => checkImport(variant((r) => (r.mode = 'merge')), moved, current), bad(/is not an analysis \(mode merge\)/));
  assert.throws(() => checkImport(errorReport('INPUT_BUSY'), moved, current), bad(/has decision error/));
  assert.throws(() => checkImport(eligible, spec({ inputs: ['a.mkv', 'donor.mkv'], report: 'r.json' }), current), bad(/is about other files \(donor\.mkv, reference\.mkv\)/));
  assert.throws(() => checkImport(eligible, { ...moved, originalLanguage: 'eng' }, current), bad(/has original language none, the list eng/));

  // Nel riassunto di una coppia: importato vale come misurato; superato no.
  const ok = summarizePair(moved, old, '/data/r.json', false, checkImport(old, moved, current));
  assert.deepEqual([ok.verdict, ok.decision, ok.report, ok.reused, ok.imported!.from], ['ok', 'eligible', '/data/r.json', false, '0.13.1']);
  assert.ok(ok.margins !== null);
  const stale = summarizePair(moved, oldJumps, '/data/r.json', false, checkImport(oldJumps, moved, current));
  assert.deepEqual([stale.verdict, stale.decision, stale.report, stale.dyadrr, stale.margins], ['stale', null, '/data/r.json', '0.13.1', null]);
  assert.match(stale.detail!, /changed in 0\.14\.0/);
  assert.equal(summarizePair(spec(), eligible, 'film.json', false).imported, null);

  // La serie: le coppie con report non si misurano, nemmeno con --again; una superata non conta tra le misurate.
  const fake = fakeDyadrr();
  const d = p('imports');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'old.json'), JSON.stringify(old));
  writeFileSync(join(d, 'jumps.json'), JSON.stringify(oldJumps));
  const pairs = (third: string) => [
    '[measured]', 'input=reference.mkv', 'input=donor.mkv', 'expected=eligible', '',
    '[imported]', 'input=gone/reference.mkv', 'input=gone/donor.mkv', 'report=imports/old.json', 'expected=eligible', 'category=uhd-bd', '',
    '[outdated]', 'input=gone/reference.mkv', 'input=gone/donor.mkv', `report=${third}`, 'expected=eligible',
  ].join('\n');
  const { path, results } = list('imported-series', pairs('imports/jumps.json'));
  const lines: string[] = [];
  assert.equal(await runPairs({ list: path, cwd: dir, dyadrr: fake.command, env: fake.env, log: (l) => lines.push(l), again: true }), 0);
  assert.deepEqual(fake.calls(), ['measured']);
  assert.equal(lines[2], '[2/3] imported: report imported (eligible, Dyadrr 0.13.1)');
  assert.match(lines[3]!, /^\[3\/3\] outdated: report imported \(stale: Dyadrr 0\.13\.1, changed in 0\.14\.0: /);
  assert.equal(lines.at(-1), '2 of 3 pairs measured; exit criterion met: no');
  const summary = json<Summary>(join(results, 'summary.json'));
  assert.deepEqual(summary.pairs.map((x) => [x.id, x.verdict, x.imported?.from ?? null]), [
    ['measured', 'ok', null],
    ['imported', 'ok', '0.13.1'],
    ['outdated', 'stale', '0.13.1'],
  ]);
  assert.equal(summary.pairs[1]!.report, join(d, 'old.json'));
  assert.ok(!existsSync(join(results, 'imported.json')), 'an imported report is not copied');
  assert.deepEqual(summary.versions.dyadrr, [dyadrrVersion(), '0.13.1']);
  assert.equal(summary.versions.mixed, true);
  const md = read(join(results, 'summary.md'));
  assert.match(md, /Imported reports \(not measured by this run\):/);
  assert.match(md, /- imported: Dyadrr 0\.13\.1; differences: 0\.14\.0: contradiction shape.*; 0\.14\.0: warning MAIN_TRACKS_DISAGREE; /);
  assert.match(md, /- outdated: Dyadrr 0\.13\.1, stale \(Dyadrr 0\.13\.1, changed in 0\.14\.0: /);
  assert.match(md, /\| imported \| uhd-bd \| eligible \| eligible \| ok \(imported, 0\.13\.1\) \|/);
  assert.match(md, /\| outdated \| stale \| — \| Dyadrr 0\.13\.1, changed in 0\.14\.0/);

  // Un report sbagliato o che non c'è ferma la serie prima di misurare.
  const broken = list('imported-broken', pairs('imports/nothing.json'));
  const errors: string[] = [];
  assert.equal(await runPairs({ list: broken.path, cwd: dir, dyadrr: fake.command, env: fake.env, log: (l) => errors.push(l) }), 30);
  assert.deepEqual(errors, ['BAD_ARGUMENTS: pair list: [outdated]: report imports/nothing.json: cannot be read as a Dyadrr report']);
  assert.ok(!existsSync(broken.results));
  assert.deepEqual(fake.calls(), ['measured']);
});

test('annullamento, crash e Dyadrr ucciso: un solo SIGTERM, report scritto da dyadrr-pairs, riassunto con le coppie fatte', async () => {
  const fake = fakeDyadrr();
  const pair = (id: string, input: string) => [`[${id}]`, `input=${input}`, 'input=donor.mkv', 'expected=eligible'];
  const { path, results } = list('cancel', [
    ...pair('a-crash', 'crash.mkv'), ...pair('b-kill', 'kill.mkv'), ...pair('c-hang', 'hang.mkv'), ...pair('d-after', 'reference.mkv'),
  ].join('\n'));
  const stop = new AbortController();
  const running = runPairs({ list: path, cwd: dir, dyadrr: fake.command, env: fake.env, signal: stop.signal });
  const ready = fake.env.READY!;
  const end = Date.now() + 30_000;
  while (!existsSync(ready)) {
    assert.ok(Date.now() < end, 'c-hang never started');
    await new Promise((r) => setTimeout(r, 20));
  }
  stop.abort();
  assert.equal(await running, 50);
  assert.equal(read(fake.signals), '1', 'Dyadrr receives SIGTERM once');
  assert.deepEqual(fake.calls(), ['a-crash', 'b-kill', 'c-hang']);

  assert.deepEqual(json<Report>(join(results, 'a-crash.json')).reasons, [{ code: 'INTERNAL', message: 'dyadrr exited with code 3 without a report' }]);
  const killed = json<Report>(join(results, 'b-kill.json'));
  assert.deepEqual(killed.reasons, [{ code: 'INTERRUPTED', message: 'the analysis was interrupted: dyadrr was killed by SIGKILL' }]);
  assert.equal(killed.mode, 'analyze');
  assert.deepEqual(killed.arguments.files, [p('kill.mkv'), p('donor.mkv')]);
  assert.ok(!existsSync(join(results, 'd-after.json')));

  const summary = json<Summary>(join(results, 'summary.json'));
  assert.deepEqual(summary.pairs.map((x) => [x.id, x.verdict, x.detail]), [
    ['a-crash', 'error', 'INTERNAL'],
    ['b-kill', 'error', 'INTERRUPTED'],
    ['c-hang', 'cancelled', null],
    ['d-after', 'missing', null],
  ]);
  assert.equal(summary.criterion.measured.value, 0);
});

test('il processo dyadrr-pairs con il Dyadrr vero: ingressi che non ci sono, argomenti, --version', async () => {
  const bin = resolve(__dirname, '../src/pairs-bin.js');
  const exec = (args: string[]) => new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });

  const { path, results } = list('real', '[missing]\ninput=nothing-a.mkv\ninput=nothing-b.mkv\nexpected=eligible\ncategory=other\n');
  const r = await exec([path]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `${join(results, 'summary.json')}\n${join(results, 'summary.md')}\n`);
  assert.match(r.stderr, /^dyadrr-pairs: \[1\/1\] missing: analyze\ndyadrr-pairs: \[1\/1\] missing: error INPUT_UNREADABLE \(\d+ s\)\n/);
  const report = json<Report>(join(results, 'missing.json'));
  assert.deepEqual(report.arguments.files, [p('nothing-a.mkv'), p('nothing-b.mkv')]);
  assert.equal(report.arguments.progress, 'json');
  assert.match(read(join(results, 'missing.log')), /"event":"end","decision":"error","exitCode":30/);
  assert.deepEqual(json<Summary>(join(results, 'summary.json')).pairs.map((x) => [x.verdict, x.detail]), [['error', 'INPUT_UNREADABLE']]);

  assert.deepEqual(await exec(['--version']), { code: 0, stdout: `dyadrr-pairs ${dyadrrVersion()}\n`, stderr: '' });
  const usage = await exec([]);
  assert.equal(usage.code, 30);
  assert.match(usage.stderr, /^dyadrr-pairs: BAD_ARGUMENTS: expected one list of pairs, got 0\nUsage: dyadrr-pairs/);
  assert.equal((await exec([path, '--bogus'])).code, 30);
  assert.equal((await exec([p('nothing.txt')])).code, 30);
});
