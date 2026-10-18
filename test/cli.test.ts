import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCalibration, parseCalibration } from '../src/calibration.js';
import { runCli, type CliEnvironment } from '../src/cli.js';
import { CancelledError } from '../src/codes.js';
import { readInput } from '../src/inputs.js';
import { PROGRESS_PHASES, REPORT_FIELDS, REPORT_FORMAT, type Report } from '../src/report.js';
import { runAsync, settle, tempDir } from './helpers/mkv.js';

// Riga di comando e report (studio §10–11) su MKV veri, generati al volo. Il
// "film" sono 60 s di rumore rosa in 5.1, un rumore diverso per canale. Il
// riferimento ha il video 320x180 e l'inglese; il donatore il video 160x90,
// l'italiano principale, un commento italiano e l'inglese, che cominciano
// 1,5 s dopo nel film: S = +1500 ms. Con due tracce italiane serve
// `--italian`. La taratura dei test accorcia finestre e intervallo di
// ricerca, perché i file durano un minuto; la riga di comando vera usa quella
// versionata (l'ultimo test lancia il processo).

const SECONDS = 60;
const S = 1500;
const ENGLISH = [1, 2, 3, 4, 5, 6];
const ITALIAN = [1, 2, 7, 4, 5, 6];
const COMMENTARY = [1, 2, 8, 4, 5, 6];

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

/** 5.1 di rumori rosa (FL, FR, FC, LFE, BL, BR), uno per seed, in AC3. */
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
    surround('eng.mka', ENGLISH),
    surround('ita.mka', ITALIAN),
    surround('comm.mka', COMMENTARY),
  ]);
  await Promise.all([
    runAsync('mkvmerge', ['-q', '-o', p('reference.mkv'), p('ref-video.mkv'), '--language', '0:eng', p('eng.mka')]),
    runAsync('mkvmerge', [
      '-q', '-o', p('donor.mkv'), p('donor-video.mkv'),
      '--language', '0:ita', '--track-name', '0:Italiano', '--sync', `0:-${S}`, p('ita.mka'),
      '--language', '0:ita', '--track-name', '0:Commento', '--default-track-flag', '0:0', '--sync', `0:-${S}`, p('comm.mka'),
      '--language', '0:eng', '--default-track-flag', '0:0', '--sync', `0:-${S}`, p('eng.mka'),
    ]),
  ]);
  settle(p('reference.mkv'));
  settle(p('donor.mkv'));
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ---------------------------------------------------------------- aiuti

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** Righe JSON di `--progress json`. */
  events: Record<string, unknown>[];
  report: Report | null;
}

async function cli(argv: string[], io: Partial<CliEnvironment> & { onEvent?: (e: Record<string, unknown>) => void } = {}): Promise<Run> {
  let stdout = '';
  let stderr = '';
  const events: Record<string, unknown>[] = [];
  const code = await runCli(argv, {
    env: {},
    cwd: dir,
    calibration: cal,
    ...io,
    stdout: (t) => (stdout += t),
    stderr: (t) => {
      stderr += t;
      if (!argv.includes('json')) return;
      for (const line of t.split('\n').filter((l) => l !== '')) {
        const e = JSON.parse(line) as Record<string, unknown>;
        events.push(e);
        io.onEvent?.(e);
      }
    },
  });
  const path = stdout.trim();
  const report = path !== '' && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Report : null;
  return { code, stdout, stderr, events, report };
}

const reasons = (r: Run) => r.report!.reasons.map((x) => x.code);
const warnings = (r: Run) => r.report!.warnings.map((w) => `${w.source}:${w.code}`);

let outputs = 0;
/** Una cartella nuova per un file finale. */
function outDir(): string {
  const d = p(`out-${++outputs}`);
  mkdirSync(d);
  return d;
}

/** L'analisi della coppia, con i file passati prima il donatore: la si fa una volta. */
let analysis: Promise<Run> | null = null;
const analyzed = () => (analysis ??= cli(['analyze', 'donor.mkv', 'reference.mkv', '--report', 'analysis.json', '--progress', 'json']));

/** Il report dell'analisi, modificato, in un altro file. */
async function altered(name: string, change: (r: Report) => void): Promise<string> {
  const r = structuredClone((await analyzed()).report!);
  change(r);
  writeFileSync(p(name), JSON.stringify(r));
  return name;
}

// ---------------------------------------------------------------- test

test('analyze: report con la forma del formato 1, ruoli, S, scelte in sospeso; su stdout solo il percorso', async () => {
  const r = await analyzed();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `${p('analysis.json')}\n`);
  const report = r.report!;
  assert.deepEqual(Object.keys(report), [...REPORT_FIELDS]);
  assert.equal(report.format, REPORT_FORMAT);
  assert.equal(report.mode, 'analyze');
  assert.equal(report.decision, 'eligible');
  assert.deepEqual(report.reasons, []);
  assert.match(report.tools!.mkvmerge, /^\d+\.\d+\.\d+$/);
  assert.equal(report.calibration!.values.checkpointCount, 10);
  assert.deepEqual(report.arguments.files, ['donor.mkv', 'reference.mkv']);

  // I file passati senza ruoli: il donatore è il primo.
  assert.equal(report.inputs[0]!.path, p('donor.mkv'));
  assert.deepEqual([report.roles!.reference, report.roles!.donor], [1, 0]);
  assert.equal(report.roles!.measureLanguage!.language, 'eng');
  assert.ok(report.roles!.pairs.length > 0);
  const m = report.measurement!;
  assert.equal(m.offset!.offsetMs, S);
  assert.ok(m.checkpoints.every((c) => c.outcome === 'consistent' && typeof c.requestedMs === 'number'));
  assert.ok(m.bytesRead.reference > 0 && m.bytesRead.donor > 0);
  assert.ok(report.checks.every((c) => c.result === 'pass'), JSON.stringify(report.checks));

  // Due tracce italiane: --italian è in sospeso, con l'effetto di ogni valore.
  assert.deepEqual(report.plan!.pending, ['italian']);
  const italian = report.choices!.find((c) => c.name === 'italian')!;
  assert.equal(italian.status, 'pending');
  assert.deepEqual(italian.effects.map((e) => [e.value, e.audioTrackIds]), [['all', [1, 2]], ['main', [1]]]);
  assert.equal(report.output, null);
  assert.equal(report.expect, null);

  // Avanzamento: le fasi dell'analisi in ordine, i punti di conferma con i totali, la fine.
  const phases = r.events.filter((e) => e.event === 'phase').map((e) => e.phase);
  assert.deepEqual(phases, ['read', 'anchors', 'edges', 'checkpoints', 'edge-probes', 'transfer', 'plan']);
  assert.ok(phases.every((x) => (PROGRESS_PHASES as readonly unknown[]).includes(x)));
  const last = r.events.filter((e) => e.event === 'progress' && e.phase === 'checkpoints').at(-1)!;
  assert.deepEqual([last.done, last.total, (last.outcomes as Record<string, number>).consistent], [10, 10, 10]);
  assert.deepEqual(r.events.at(-1), { event: 'end', decision: 'eligible', exitCode: 0, elapsedMs: r.events.at(-1)!.elapsedMs });
  assert.ok(r.events.every((e) => typeof e.elapsedMs === 'number'));
});

test('merge --expect: il piano confermato, la scelta da variabile d\'ambiente, file verificato e consegnato', async () => {
  await analyzed();
  const out = join(outDir(), 'Film.mkv');
  const r = await cli(['merge', 'reference.mkv', 'donor.mkv', '--output', out, '--expect', 'analysis.json', '--report', 'merge.json'], {
    env: { DYADRR_ITALIAN: 'main' },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /^dyadrr: eligible\n$/);
  const report = r.report!;
  assert.equal(report.decision, 'eligible');
  assert.deepEqual(report.expect, { path: p('analysis.json'), result: 'pass', differences: [] });
  const italian = report.choices!.find((c) => c.name === 'italian')!;
  assert.deepEqual([italian.status, 'value' in italian && italian.value, 'origin' in italian && italian.origin], ['decided', 'main', 'env']);
  assert.ok(warnings(r).includes('plan:ITALIAN_TRACKS_SKIPPED'), JSON.stringify(warnings(r)));
  // L'italiano e l'inglese condividono i canali non centrali: il trasferimento sul file finale torna.
  assert.ok(warnings(r).every((w) => !w.startsWith('verify:')), JSON.stringify(warnings(r)));

  const output = report.output!;
  assert.equal(output.path, out);
  assert.equal(output.delivered, true);
  assert.ok(output.sizeBytes! > 0);
  assert.ok(Math.abs(output.durationMs! - SECONDS * 1000) < 100, String(output.durationMs));
  // L'audio italiano viene subito dopo il video (§6.2).
  assert.deepEqual(output.build!.tracks.map((t) => `${t.source}:${t.sourceTrackId}`), ['reference:0', 'donor:1', 'reference:1']);
  assert.equal(output.verification!.result, 'pass');
  assert.equal(output.verification!.checks.find((c) => c.name === 'transfer')?.result, 'pass');
  assert.ok(existsSync(out));
  // Senza terminale e senza --inputs gli ingressi si tengono.
  assert.deepEqual(output.inputs, { value: 'keep', origin: 'default', deleted: [] });
  assert.ok(existsSync(p('donor.mkv')) && existsSync(p('reference.mkv')));
  // I temporanei predefiniti non restano.
  assert.deepEqual(readdirSync(resolve(out, '..')), ['Film.mkv']);
});

test('CHOICE_REQUIRED senza terminale; in un terminale la scelta si chiede, finché la risposta è valida', async () => {
  const out = join(outDir(), 'Film.mkv');
  const r = await cli(['merge', 'reference.mkv', 'donor.mkv', '--output', out]);
  assert.equal(r.code, 30);
  assert.deepEqual(reasons(r), ['CHOICE_REQUIRED']);
  assert.match(r.report!.reasons[0]!.message, /--italian all\|main/);
  assert.deepEqual(r.report!.plan!.pending, ['italian']);
  assert.equal(r.report!.output, null);
  assert.ok(!existsSync(out));

  const asked: string[] = [];
  const answers = ['maybe', ' all '];
  const merged = await cli(['merge', 'reference.mkv', 'donor.mkv', '--output', out], {
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? null;
    },
  });
  assert.equal(merged.code, 0, merged.stderr);
  // Dopo la consegna si chiede anche degli ingressi: la fine dell'ingresso li tiene.
  assert.equal(asked.length, 3);
  assert.match(asked[2]!, /^The merge is complete: /);
  assert.deepEqual(merged.report!.output!.inputs, { value: 'keep', origin: 'default', deleted: [] });
  assert.match(asked[0]!, /^A choice is needed: --italian \(Italian audio tracks to take\)\n  all: Italian 0:00:01\.5\d\d – 0:0\d:\d\d\.\d{3}; audio tracks 1, 2;/);
  assert.match(asked[0]!, /\n  main: .*audio tracks 1;.*ITALIAN_TRACKS_SKIPPED\nChoose all or main: $/);
  const italian = merged.report!.choices!.find((c) => c.name === 'italian')!;
  assert.deepEqual(['value' in italian && italian.value, 'origin' in italian && italian.origin], ['all', 'prompt']);
  assert.deepEqual(merged.report!.output!.build!.tracks.map((t) => `${t.source}:${t.sourceTrackId}`), ['reference:0', 'donor:1', 'donor:2', 'reference:1']);

  // La fine dell'ingresso è CHOICE_REQUIRED; con --progress json non si chiede.
  const eof = await cli(['merge', 'reference.mkv', 'donor.mkv', '--output', join(outDir(), 'Film.mkv')], { ask: async () => null });
  assert.deepEqual(reasons(eof), ['CHOICE_REQUIRED']);
  const json = await cli(['merge', 'reference.mkv', 'donor.mkv', '--output', join(outDir(), 'Film.mkv'), '--progress', 'json'], {
    ask: () => assert.fail('asked with --progress json'),
  });
  assert.deepEqual(reasons(json), ['CHOICE_REQUIRED']);
});

test('INPUT_CHANGED: impronte, S, piano o scelta diversi dall\'analisi confermata', async () => {
  await analyzed();
  const merge = (expect: string, extra: string[] = []) =>
    cli(['merge', 'reference.mkv', 'donor.mkv', '--output', join(outDir(), 'Film.mkv'), '--expect', expect, '--italian', 'main', ...extra]);

  // Uno S diverso.
  const offset = await merge(await altered('offset.json', (r) => {
    r.measurement!.offset!.offsetMs += 1;
  }));
  assert.equal(offset.code, 30);
  assert.deepEqual(reasons(offset), ['INPUT_CHANGED']);
  assert.deepEqual(offset.report!.expect!.differences, [`offset ${S} ms, confirmed ${S + 1} ms`]);
  assert.equal(offset.report!.output, null);

  // Una scelta decisa nell'analisi, diversa nel merge.
  const decided = await merge(await altered('decided.json', (r) => {
    const c = r.choices!.find((x) => x.name === 'italian')!;
    Object.assign(c, { status: 'decided', value: 'all', origin: 'option' });
    r.plan!.pending = [];
  }));
  assert.deepEqual(reasons(decided), ['INPUT_CHANGED']);
  assert.ok(decided.report!.expect!.differences.includes('choice italian: "main", confirmed "all"'), JSON.stringify(decided.report!.expect));

  // Un piano diverso: la fine dell'italiano.
  const plan = await merge(await altered('plan.json', (r) => {
    r.plan!.end.amountMs += 1000;
  }));
  assert.deepEqual(reasons(plan), ['INPUT_CHANGED']);
  assert.match(plan.report!.expect!.differences.join(';'), /plan end\.amountMs/);

  // Un ingresso cambiato: si ferma prima di misurare. I percorsi invece non contano.
  copyFileSync(p('donor.mkv'), p('donor-copy.mkv'));
  settle(p('donor-copy.mkv'));
  const copy = await cli(['merge', 'reference.mkv', 'donor-copy.mkv', '--output', join(outDir(), 'Film.mkv'), '--expect', 'analysis.json', '--italian', 'main']);
  assert.deepEqual(reasons(copy), ['INPUT_CHANGED']);
  assert.match(copy.report!.expect!.differences[0]!, /donor-copy\.mkv: not one of the confirmed inputs/);
  assert.equal(copy.report!.measurement, null);
  assert.ok(copy.report!.inputs.every((i) => i !== null));

  // Un report di un altro formato, o non idoneo, non è un'analisi confermata.
  const format = await merge(await altered('format.json', (r) => {
    r.format = REPORT_FORMAT + 1;
  }));
  assert.deepEqual(reasons(format), ['BAD_ARGUMENTS']);
});

test('CANCELLED: un segnale di stop durante il merge o durante l\'analisi; temporanei eliminati', async () => {
  const d = outDir();
  const out = join(d, 'Film.mkv');
  const stop = new AbortController();
  const r = await cli(['merge', 'reference.mkv', 'donor.mkv', '--output', out, '--italian', 'all', '--progress', 'json'], {
    signal: stop.signal,
    onEvent: (e) => {
      if (e.event === 'phase' && e.phase === 'merge') stop.abort(new CancelledError('received SIGTERM'));
    },
  });
  assert.equal(r.code, 50, r.stderr);
  assert.equal(r.report!.decision, 'cancelled');
  assert.deepEqual(r.report!.reasons, [{ code: 'CANCELLED', message: 'cancelled: received SIGTERM' }]);
  assert.deepEqual(r.events.at(-1)?.decision, 'cancelled');
  assert.ok(!existsSync(out));
  assert.deepEqual(readdirSync(d), [], 'the temporary folder is removed');

  const early = new AbortController();
  const a = await cli(['analyze', 'reference.mkv', 'donor.mkv', '--progress', 'json'], {
    signal: early.signal,
    onEvent: (e) => {
      if (e.event === 'phase' && e.phase === 'anchors') early.abort(new CancelledError('received SIGINT'));
    },
  });
  assert.equal(a.code, 50);
  assert.deepEqual(reasons(a), ['CANCELLED']);
  assert.equal(a.report!.measurement, null);
  // Senza --report il nome viene da modalità e ora.
  assert.match(a.stdout, /\/dyadrr-analyze-\d{8}T\d{6}Z\.json\n$/);
});

test('BAD_ARGUMENTS: argomenti sbagliati, con il report comunque scritto; --help e --version senza report', async () => {
  const bad = async (argv: string[], message: RegExp) => {
    const r = await cli([...argv, '--report', 'bad.json']);
    assert.equal(r.code, 30, `${argv.join(' ')}: ${r.stderr}`);
    assert.deepEqual(reasons(r), ['BAD_ARGUMENTS']);
    assert.match(r.report!.reasons[0]!.message, message);
    assert.ok(r.report!.inputs.every((i) => i === null), 'no input is read');
  };
  await bad(['analyze', 'reference.mkv'], /two MKV files, 1 given/);
  await bad(['convert', 'reference.mkv', 'donor.mkv'], /unknown command "convert"/);
  await bad(['analyze', 'reference.mkv', 'donor.mkv', '--force'], /Unknown option '--force'/);
  const unknown = await cli(['analyze', 'reference.mkv', '--original-language', 'eng', 'donor.mkv', '--force', '--report', 'bad.json']);
  assert.deepEqual(unknown.report!.arguments.files, ['reference.mkv', 'donor.mkv']);
  await bad(['analyze', 'reference.mkv', 'donor.mkv', '--output', 'x.mkv'], /--output is only for merge/);
  await bad(['analyze', 'reference.mkv', 'donor.mkv', '--inputs', 'delete'], /--inputs is only for merge/);
  await bad(['merge', 'reference.mkv', 'donor.mkv', '--output', 'x.mkv', '--inputs', 'erase'], /--inputs: "erase" is not valid/);
  await bad(['merge', 'reference.mkv', 'donor.mkv'], /merge needs --output/);
  await bad(['analyze', 'reference.mkv', 'donor.mkv', '--tail', 'trim', '--tail', 'keep'], /--tail is given more than once/);
  await bad(['analyze', 'reference.mkv', 'donor.mkv', '--progress', 'text'], /--progress "text"/);
  await bad(['analyze', 'reference.mkv', 'donor.mkv', '--tail', 'cut'], /--tail: "cut" is not valid/);
  await bad(['analyze', 'reference.mkv', 'donor.mkv', '--original-language', '123'], /--original-language/);

  const env = await cli(['analyze', 'reference.mkv', 'donor.mkv', '--report', 'bad.json'], { env: { DYADRR_TAIL: 'cut' } });
  assert.deepEqual(reasons(env), ['BAD_ARGUMENTS']);
  assert.match(env.report!.reasons[0]!.message, /DYADRR_TAIL/);

  // Il report non va mai al posto di un ingresso: niente report, il file resta com'è.
  const onInput = await cli(['analyze', 'reference.mkv', 'donor.mkv', '--report', 'donor.mkv']);
  assert.equal(onInput.code, 30);
  assert.equal(onInput.stdout, '');
  assert.match(onInput.stderr, /BAD_ARGUMENTS: --report .*donor\.mkv is also an input/);
  assert.equal(readFileSync(p('donor.mkv')).subarray(0, 4).toString('hex'), '1a45dfa3', 'the input is untouched');

  // Una cartella del report che non c'è: nessun report, uscita 30.
  const nowhere = await cli(['analyze', 'reference.mkv', 'donor.mkv', '--report', 'missing/report.json']);
  assert.equal(nowhere.code, 30);
  assert.equal(nowhere.stdout, '');
  assert.match(nowhere.stderr, /OUTPUT_NOT_WRITABLE/);

  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage:\n {2}dyadrr analyze/);
  const version = await cli(['analyze', '--version']);
  assert.match(version.stdout, /^dyadrr \d+\.\d+\.\d+\n$/);
});

test('INPUT_NOT_DELETED: --inputs delete cancella gli ingressi solo dopo un merge consegnato; chiesto in un terminale', async () => {
  /** Copie degli ingressi in una cartella nuova: i file dei test restano. */
  const copies = () => {
    const d = outDir();
    for (const name of ['reference.mkv', 'donor.mkv']) {
      copyFileSync(p(name), join(d, name));
      settle(join(d, name));
    }
    return { d, reference: join(d, 'reference.mkv'), donor: join(d, 'donor.mkv') };
  };

  // Da opzione: cancellati tutti e due, dopo la consegna.
  const a = copies();
  const byOption = await cli(['merge', a.reference, a.donor, '--output', join(a.d, 'Film.mkv'), '--italian', 'main', '--inputs', 'delete']);
  assert.equal(byOption.code, 0, byOption.stderr);
  assert.deepEqual(byOption.report!.output!.inputs, { value: 'delete', origin: 'option', deleted: [a.reference, a.donor] });
  assert.deepEqual(readdirSync(a.d), ['Film.mkv']);

  // Un rifiuto non tocca gli ingressi, nemmeno con --inputs delete.
  const refused = await cli(['merge', 'reference.mkv', 'reference.mkv', '--output', join(outDir(), 'Film.mkv'), '--inputs', 'delete']);
  assert.equal(refused.code, 20);
  assert.ok(existsSync(p('reference.mkv')));

  // Chiesto in un terminale: un ingresso sparito nel frattempo resta un avviso, il merge è consegnato.
  const b = copies();
  const asked: string[] = [];
  const byPrompt = await cli(['merge', b.reference, b.donor, '--output', join(b.d, 'Film.mkv'), '--italian', 'all'], {
    ask: async (q) => {
      asked.push(q);
      rmSync(b.reference);
      return 'delete';
    },
  });
  assert.equal(byPrompt.code, 0, byPrompt.stderr);
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /^The merge is complete: .*Film\.mkv\nDelete the two inputs \(--inputs\)\?\n {2}.*reference\.mkv\n {2}.*donor\.mkv\nChoose keep or delete: $/);
  assert.equal(byPrompt.report!.decision, 'eligible');
  assert.deepEqual(byPrompt.report!.output!.inputs, { value: 'delete', origin: 'prompt', deleted: [b.donor] });
  assert.deepEqual(warnings(byPrompt).filter((w) => w.startsWith('inputs:')), ['inputs:INPUT_NOT_DELETED']);
  assert.match(byPrompt.report!.warnings.find((w) => w.code === 'INPUT_NOT_DELETED')!.message, /reference\.mkv: not deleted: ENOENT/);
  assert.deepEqual(readdirSync(b.d), ['Film.mkv']);
});

test('riga di comando: rifiuto con uscita 20, OUTPUT_EXISTS prima di leggere gli ingressi', async () => {
  const refused = await cli(['analyze', 'reference.mkv', 'reference.mkv', '--report', 'refused.json']);
  assert.equal(refused.code, 20);
  assert.equal(refused.report!.decision, 'refused');
  assert.deepEqual(reasons(refused), ['NO_ITALIAN_AUDIO']);
  assert.equal(refused.report!.measurement, null);
  assert.equal(refused.report!.checks.find((c) => c.name === 'roles')?.result, 'fail');

  const exists = await cli(['merge', 'reference.mkv', 'donor.mkv', '--output', 'donor.mkv', '--report', 'exists.json']);
  assert.equal(exists.code, 30);
  assert.deepEqual(reasons(exists), ['OUTPUT_EXISTS']);
  assert.deepEqual(exists.report!.inputs, [null, null]);
});

test('processo: SIGTERM durante l\'analisi dà il report "cancelled" e l\'uscita 50; --version', async () => {
  const bin = resolve(__dirname, '..', 'src', 'bin.js');
  const node = (args: string[]) => spawn(process.execPath, [bin, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });

  const version = node(['--version']);
  let versionOut = '';
  version.stdout.on('data', (d: Buffer) => (versionOut += d.toString()));
  assert.equal(await new Promise((res) => version.on('close', res)), 0);
  assert.match(versionOut, /^dyadrr \d+\.\d+\.\d+\n$/);

  // La taratura versionata: si interrompe appena cominciano le ancore.
  const child = node(['analyze', 'reference.mkv', 'donor.mkv', '--report', 'process.json', '--progress', 'json']);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
    if (stderr.includes('"phase":"anchors"') && child.signalCode === null && !child.killed) child.kill('SIGTERM');
  });
  const code = await new Promise((res) => child.on('close', res));
  assert.equal(code, 50, stderr);
  assert.equal(stdout, `${p('process.json')}\n`);
  const report = JSON.parse(readFileSync(p('process.json'), 'utf8')) as Report;
  assert.equal(report.decision, 'cancelled');
  assert.deepEqual(report.reasons, [{ code: 'CANCELLED', message: 'cancelled: received SIGTERM' }]);
  assert.equal(report.calibration!.values.anchorWindowMs, base.values.anchorWindowMs);
  // Gli ingressi sono stati letti, con l'impronta.
  assert.deepEqual(report.inputs[0]!.fingerprint, (await readInput(p('reference.mkv'), { calibration: cal })).fingerprint);
});
