import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { USAGE } from '../src/cli.js';
import { DyadrrError } from '../src/codes.js';
import type { Report } from '../src/report.js';
import { JOB_KEYS, RUNNER, exitLine, jobArguments, jobLine, logLine, mountedFolders, mountedLine, parseJob, runRunner, type RunnerLogEntry } from '../src/runner.js';
import { dyadrrVersion } from '../src/report.js';
import { ffmpegSource, mkvmerge, settle, tempDir } from './helpers/mkv.js';

// Il runner dei file job (studio §14.1) su una cartella di prova con la stessa
// forma di /data nel container: `watch/` e la cartella dei job dentro. Il
// Dyadrr vero lavora su due MKV di 60 s con toni sinusoidali (il riferimento
// con l'inglese, il donatore con italiano e inglese) e la taratura
// versionata: basta che arrivi alle ancore. Crash e processi uccisi si
// provano con un Dyadrr finto.

let dir: string;

before(() => {
  dir = tempDir();
  const src = (name: string, size: string, tracks: number) =>
    ffmpegSource(join(dir, name), { size, seconds: 60 }, Array.from({ length: tracks }, (_, i) => ({ frequency: 440 + 110 * i, channels: 2 })));
  src('ref-src.mkv', '320x180', 1);
  src('donor-src.mkv', '160x90', 2);
  const watch = join(dir, 'data', 'watch');
  mkdirSync(watch, { recursive: true });
  mkvmerge(join(watch, 'reference.mkv'), ['--language', '1:eng', join(dir, 'ref-src.mkv')]);
  mkvmerge(join(watch, 'donor.mkv'), ['--language', '1:ita', '--language', '2:eng', join(dir, 'donor-src.mkv')]);
  settle(join(watch, 'reference.mkv'));
  settle(join(watch, 'donor.mkv'));
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ---------------------------------------------------------------- aiuti

/** Una cartella /data nuova, con `watch/` e la cartella dei job. */
function dataDir(name: string): { data: string; jobs: string; file: (id: string, ext: string) => string } {
  const data = join(dir, name);
  const jobs = join(data, RUNNER.jobs);
  mkdirSync(jobs, { recursive: true });
  return { data, jobs, file: (id, ext) => join(jobs, `${id}.${ext}`) };
}

/** Aspetta che una condizione diventi vera. */
async function until(what: string, condition: () => boolean, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const read = (path: string) => readFileSync(path, 'utf8');
const report = (path: string) => JSON.parse(read(path)) as Report;

/** Le righe di `dyadrr.runner.jsonl` (o di un altro file JSON Lines). */
function logEntries(path: string): Array<Record<string, unknown>> {
  const text = read(path);
  assert.ok(text === '' || text.endsWith('\n'), 'whole lines only');
  return text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Una riga del file senza `time` e `version`, dopo averli controllati. */
function withoutTime(line: Record<string, unknown>): Record<string, unknown> {
  const { time, version, ...rest } = line;
  assert.match(String(time), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(version, dyadrrVersion());
  return rest;
}

/** Scrive un job come Wayfinderr, con una data di modifica che ne fissa l'ordine. */
function writeJob(path: string, lines: string[], secondsAgo = 0): void {
  writeFileSync(path, `${lines.join('\n')}\n`);
  const at = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(path, at, at);
}

// ---------------------------------------------------------------- test

test('file job: chiavi e percorsi relativi alle cartelle montate; BAD_ARGUMENTS per un job sbagliato', () => {
  const job = parseJob([
    'command=merge',
    'input=watch/Film (2).mkv\r',
    '',
    'input=downloads/Film/Film.mkv',
    'output=watch/Film = Il film.mkv',
    'tail=trim',
    'inputs=keep',
    'original-language=eng',
  ].join('\n'));
  assert.deepEqual(job, {
    command: 'merge',
    inputs: ['watch/Film (2).mkv', 'downloads/Film/Film.mkv'],
    options: [['output', 'watch/Film = Il film.mkv'], ['tail', 'trim'], ['inputs', 'keep'], ['original-language', 'eng']],
  });
  assert.deepEqual(jobArguments(job, '/data', '/data/watch/.wayfinderr/dyadrr/jobs/a.json'), [
    'merge',
    '/data/watch/Film (2).mkv',
    '/data/downloads/Film/Film.mkv',
    '--output=/data/watch/Film = Il film.mkv',
    '--tail=trim',
    '--inputs=keep',
    '--original-language=eng',
    '--report=/data/watch/.wayfinderr/dyadrr/jobs/a.json',
    '--progress=json',
  ]);

  // Le chiavi sono le opzioni della riga di comando, salvo quelle del runner.
  const options = [...USAGE.matchAll(/--([a-z-]+)/g)].map((m) => m[1]!)
    .filter((o) => !['report', 'progress', 'help', 'version'].includes(o));
  assert.deepEqual([...new Set(options)].sort(), JOB_KEYS.filter((k) => k !== 'command' && k !== 'input').sort());

  const bad = (lines: string[], message: RegExp) => assert.throws(
    () => jobArguments(parseJob(lines.join('\n')), '/data', '/r.json'),
    (e: unknown) => e instanceof DyadrrError && e.code === 'BAD_ARGUMENTS' && message.test(e.message),
    lines.join(' | '),
  );
  bad(['command=analyze', 'input'], /line 2 is not key=value/);
  bad(['command=analyze', '=watch/a.mkv'], /line 2 is not key=value/);
  bad(['command=analyze', 'report=watch/r.json'], /unknown key "report"/);
  bad(['command=analyze', 'Tail=trim'], /unknown key "Tail"/);
  bad(['command=analyze', 'command=merge'], /"command" is given more than once/);
  bad(['input=watch/a.mkv'], /command is missing/);
  bad(['command=analyse'], /unknown command "analyse"/);
  for (const path of ['/data/watch/a.mkv', 'watch/../a.mkv', 'watch//a.mkv', './watch/a.mkv', 'watch/', '']) {
    bad(['command=merge', `input=${path}`], /is not a path relative to the mounted folders/);
  }
  bad(['command=merge', 'input=watch/a.mkv', 'input=watch/b.mkv', 'expect=../a.json'], /"\.\.\/a\.json" is not a path/);
});

test('runner: un job alla volta dal più vecchio, .log, .json e .exit; .cancel; BAD_ARGUMENTS; id riusati; dyadrr.runner.jsonl', async () => {
  const { data, jobs, file } = dataDir('data');
  const pair = ['input=watch/reference.mkv', 'input=watch/donor.mkv'];
  writeJob(file('dyadrr', 'job'), ['command=analyse', ...pair], 50);
  writeJob(file('a-parse', 'job'), ['command=analyse', ...pair], 40);
  writeJob(file('b-value', 'job'), ['command=analyze', ...pair, 'tail=cut'], 30);
  writeJob(file('c-cancel', 'job'), ['command=analyze', ...pair], 20);
  writeFileSync(file('d-early', 'cancel'), '');
  writeJob(file('d-early', 'job'), ['command=analyze', ...pair], 10);
  writeFileSync(join(jobs, '.e-temp.job'), 'command=analyze\n');
  writeFileSync(join(jobs, 'not an id.job'), 'command=analyze\n');

  const lines: RunnerLogEntry[] = [];
  const stop = new AbortController();
  const running = runRunner({ dataDir: data, signal: stop.signal, log: (l) => lines.push(l), pollMs: 50, aliveMs: 100 });

  // L'id `dyadrr` si prende anche con il log del runner nella cartella.
  await until('dyadrr.exit', () => existsSync(file('dyadrr', 'exit')));
  assert.equal(read(file('dyadrr', 'exit')), '30\n');
  assert.ok(existsSync(join(jobs, RUNNER.logFile)));

  // Un job sbagliato: il report lo scrive il runner, Dyadrr non parte.
  await until('a-parse.exit', () => existsSync(file('a-parse', 'exit')));
  assert.equal(read(file('a-parse', 'exit')), '30\n');
  assert.ok(!existsSync(file('a-parse', 'job')) && existsSync(file('a-parse', 'run')));
  assert.equal(read(file('a-parse', 'log')), '');
  const a = report(file('a-parse', 'json'));
  assert.equal(a.decision, 'error');
  assert.deepEqual(a.reasons, [{ code: 'BAD_ARGUMENTS', message: 'job: unknown command "analyse": analyze or merge' }]);
  assert.equal(a.mode, null);
  assert.deepEqual(a.arguments.files, [join(data, 'watch/reference.mkv'), join(data, 'watch/donor.mkv')]);

  // Un valore sbagliato lo trova la riga di comando, con il suo report.
  await until('b-value.exit', () => existsSync(file('b-value', 'exit')));
  assert.equal(read(file('b-value', 'exit')), '30\n');
  const b = report(file('b-value', 'json'));
  assert.deepEqual(b.reasons.map((r) => r.code), ['BAD_ARGUMENTS']);
  assert.match(b.reasons[0]!.message, /--tail: "cut" is not valid/);
  assert.equal(b.arguments.report, file('b-value', 'json'));
  assert.equal(b.arguments.progress, 'json');
  const end = JSON.parse(read(file('b-value', 'log'))) as Record<string, unknown>;
  assert.deepEqual(end, { event: 'end', decision: 'error', exitCode: 30, elapsedMs: end.elapsedMs });

  // Il Dyadrr vero, fermato con .cancel appena cominciano le ancore; il job
  // dopo aspetta.
  await until('c-cancel anchors', () => existsSync(file('c-cancel', 'log')) && read(file('c-cancel', 'log')).includes('"phase":"anchors"'));
  assert.ok(existsSync(file('d-early', 'job')), 'one job at a time');
  writeFileSync(file('c-cancel', 'cancel'), '');
  await until('c-cancel.exit', () => existsSync(file('c-cancel', 'exit')));
  assert.equal(read(file('c-cancel', 'exit')), '50\n');
  const c = report(file('c-cancel', 'json'));
  assert.equal(c.decision, 'cancelled');
  assert.deepEqual(c.reasons, [{ code: 'CANCELLED', message: 'cancelled: received SIGTERM' }]);
  assert.ok(c.inputs.every((i) => i !== null), 'the inputs were read');
  const events = read(file('c-cancel', 'log')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(events[0], { event: 'phase', phase: 'read', elapsedMs: events[0]!.elapsedMs });
  assert.deepEqual(events.at(-1), { event: 'end', decision: 'cancelled', exitCode: 50, elapsedMs: events.at(-1)!.elapsedMs });

  // Annullato prima di cominciare.
  await until('d-early.exit', () => existsSync(file('d-early', 'exit')));
  assert.equal(read(file('d-early', 'exit')), '50\n');
  assert.deepEqual(report(file('d-early', 'json')).reasons, [{ code: 'CANCELLED', message: 'cancelled: cancelled before it started' }]);
  assert.equal(report(file('d-early', 'json')).mode, 'analyze');
  assert.equal(read(file('d-early', 'log')), '');

  // Un id già usato non si prende e non si sovrascrive niente; i nomi che non
  // sono un id si ignorano.
  writeJob(file('a-parse', 'job'), ['command=analyze', ...pair]);
  await until('the reused id in the log', () => lines.some((l) => logLine(l) === 'a-parse: not taken: the id was already used'));
  assert.ok(existsSync(file('a-parse', 'job')));
  assert.equal(read(file('a-parse', 'exit')), '30\n');
  assert.ok(existsSync(join(jobs, '.e-temp.job')) && existsSync(join(jobs, 'not an id.job')));

  const alive = read(join(jobs, RUNNER.alive));
  assert.match(alive, /^\d+\n$/);
  assert.ok(Math.abs(Number(alive) - Date.now() / 1000) < 10);
  stop.abort('SIGTERM');
  await running;
  // Il runner non cancella niente.
  for (const id of ['dyadrr', 'a-parse', 'b-value', 'c-cancel', 'd-early']) {
    for (const ext of ['run', 'log', 'json', 'exit']) assert.ok(existsSync(file(id, ext)), `${id}.${ext}`);
  }

  // Il log del runner: le stesse righe di stderr, con livello, lavoro e codice.
  const entries = logEntries(join(jobs, RUNNER.logFile)).map(withoutTime);
  assert.deepEqual(entries, lines.map((l) => JSON.parse(JSON.stringify(l)) as Record<string, unknown>));
  const analyze = 'analyze "watch/reference.mkv" "watch/donor.mkv"';
  const unknown = 'exit code 30: job: unknown command "analyse": analyze or merge';
  assert.deepEqual(entries, [
    { level: 'info', msg: `dyadrr ${dyadrrVersion()}, jobs in ${jobs}` },
    { level: 'info', msg: 'mounted: watch (rw)' },
    { level: 'warn', msg: unknown, job: 'dyadrr', code: 'BAD_ARGUMENTS' },
    { level: 'warn', msg: unknown, job: 'a-parse', code: 'BAD_ARGUMENTS' },
    { level: 'info', msg: analyze, job: 'b-value' },
    { level: 'warn', msg: `exit code 30: ${b.reasons[0]!.message}`, job: 'b-value', code: 'BAD_ARGUMENTS' },
    { level: 'info', msg: analyze, job: 'c-cancel' },
    { level: 'warn', msg: 'exit code 50', job: 'c-cancel', code: 'CANCELLED' },
    { level: 'info', msg: analyze, job: 'd-early' },
    { level: 'warn', msg: 'exit code 50', job: 'd-early', code: 'CANCELLED' },
    { level: 'warn', msg: 'not taken: the id was already used', job: 'a-parse' },
    { level: 'info', msg: 'SIGTERM: stopping' },
    { level: 'info', msg: 'stopped' },
  ]);
  assert.equal(logLine(lines.find((l) => l.job === 'c-cancel' && l.code)!), 'c-cancel: exit code 50');
  assert.ok(!existsSync(join(jobs, RUNNER.logPrevious)), 'no rotation under the limit');
});

test('cartelle montate: riga mounted all\'avvio, ingressi nella riga del lavoro, INPUT_UNREADABLE per una cartella non montata', async () => {
  const { data, jobs, file } = dataDir('data-mounts');
  mkdirSync(join(data, 'downloads'));
  writeFileSync(join(data, 'notes.txt'), '');
  const launched = join(data, 'launched');
  const fake = join(data, 'fake-dyadrr.cjs');
  writeFileSync(fake, `
const fs = require('fs');
const report = process.argv.find((a) => a.startsWith('--report=')).slice('--report='.length);
fs.appendFileSync(${JSON.stringify(launched)}, process.argv.slice(3, 5).join(' ') + '\\n');
fs.writeFileSync(report, JSON.stringify({ decision: 'error', reasons: [{ code: 'INPUT_UNREADABLE', message: process.argv[4] + ': cannot be read (ENOENT)\\nmore' }] }));
process.exit(30);
`);
  const seeding = ['command=merge', 'input=watch/Film (2).mkv', 'input=seeding/Film/Film.mkv', 'output=watch/out.mkv'];
  writeJob(file('a-seeding', 'job'), seeding, 30);
  writeJob(file('b-missing', 'job'), ['command=analyze', 'input=watch/Film (2).mkv', 'input=downloads/Film/Film.mkv'], 20);
  writeFileSync(file('c-cancel', 'cancel'), '');
  writeJob(file('c-cancel', 'job'), seeding, 10);

  const lines: RunnerLogEntry[] = [];
  const stop = new AbortController();
  const running = runRunner({ dataDir: data, signal: stop.signal, dyadrr: [process.execPath, fake], log: (l) => lines.push(l), pollMs: 20, aliveMs: 100 });
  // La riga `exit code` viene dopo `.exit`: si aspetta lei prima di fermare il runner.
  await until('the c-cancel exit line', () => lines.some((l) => l.job === 'c-cancel' && l.code !== undefined));
  stop.abort();
  await running;

  // La cartella non montata la trova il runner: Dyadrr non parte.
  const why = `${join(data, 'seeding/Film/Film.mkv')}: seeding is not mounted in this container (${join(data, 'seeding')})`;
  assert.equal(read(file('a-seeding', 'exit')), '30\n');
  const a = report(file('a-seeding', 'json'));
  assert.equal(a.decision, 'error');
  assert.deepEqual(a.reasons, [{ code: 'INPUT_UNREADABLE', message: why }]);
  assert.equal(a.mode, 'merge');
  assert.deepEqual(a.arguments.files, [join(data, 'watch/Film (2).mkv'), join(data, 'seeding/Film/Film.mkv')]);
  assert.equal(read(file('a-seeding', 'log')), '');
  // Con la cartella montata decide Dyadrr; nel log la prima riga del suo messaggio.
  assert.equal(read(launched), `${join(data, 'watch/Film (2).mkv')} ${join(data, 'downloads/Film/Film.mkv')}\n`);
  // Annullato prima di cominciare: l'annullamento vince.
  assert.equal(read(file('c-cancel', 'exit')), '50\n');

  assert.deepEqual(logEntries(join(jobs, RUNNER.logFile)).map(withoutTime), [
    { level: 'info', msg: `dyadrr ${dyadrrVersion()}, jobs in ${jobs}` },
    { level: 'info', msg: 'mounted: watch (rw), downloads (rw)' },
    { level: 'info', msg: 'merge "watch/Film (2).mkv" "seeding/Film/Film.mkv"', job: 'a-seeding' },
    { level: 'warn', msg: `exit code 30: ${why}`, job: 'a-seeding', code: 'INPUT_UNREADABLE' },
    { level: 'info', msg: 'analyze "watch/Film (2).mkv" "downloads/Film/Film.mkv"', job: 'b-missing' },
    { level: 'warn', msg: `exit code 30: ${join(data, 'downloads/Film/Film.mkv')}: cannot be read (ENOENT)`, job: 'b-missing', code: 'INPUT_UNREADABLE' },
    { level: 'info', msg: 'merge "watch/Film (2).mkv" "seeding/Film/Film.mkv"', job: 'c-cancel' },
    { level: 'warn', msg: 'exit code 50', job: 'c-cancel', code: 'CANCELLED' },
    { level: 'info', msg: 'stopping' },
    { level: 'info', msg: 'stopped' },
  ]);
  assert.equal(logLine(lines[3]!), `a-seeding: exit code 30: ${why}`);

  // Le righe da sole: sola lettura, nessuna cartella, i rifiuti senza messaggio.
  assert.equal(mountedLine([{ name: 'watch', writable: true }, { name: 'downloads', writable: false }, { name: 'seeding', writable: false }]),
    'mounted: watch (rw), downloads (ro), seeding (ro)');
  assert.equal(mountedLine(await mountedFolders(join(dir, 'nowhere'))), 'mounted: none');
  assert.equal(jobLine({ command: 'analyze', inputs: [] }), 'analyze');
  assert.equal(exitLine(20, { decision: 'refused', reasons: [{ code: 'NO_MATCH', message: 'no match' }] }), 'exit code 20');
  assert.equal(exitLine(40, null), 'exit code 40');
});

test('cartelle montate: una in sola lettura si dice ro; la cartella sorvegliata non scrivibile ferma il runner', { skip: process.getuid?.() === 0 && 'root writes everywhere' }, async () => {
  const { data } = dataDir('data-ro');
  const downloads = join(data, 'downloads');
  const watch = join(data, 'watch');
  mkdirSync(downloads);
  chmodSync(downloads, 0o555);
  try {
    assert.deepEqual(await mountedFolders(data), [{ name: 'watch', writable: true }, { name: 'downloads', writable: false }]);
    chmodSync(watch, 0o555);
    const lines: RunnerLogEntry[] = [];
    await assert.rejects(
      runRunner({ dataDir: data, signal: new AbortController().signal, log: (l) => lines.push(l) }),
      { message: `${watch} is not writable: mount the watched folder read-write` },
    );
    assert.deepEqual(lines.map((l) => l.msg).slice(1), ['mounted: watch (ro), downloads (ro)', `error: ${watch} is not writable: mount the watched folder read-write`]);
  } finally {
    chmodSync(downloads, 0o755);
    chmodSync(watch, 0o755);
  }
});

test('INTERRUPTED: .run rimasti all\'avvio e Dyadrr ucciso; INTERNAL senza report; lo stop del runner annulla con un solo SIGTERM', async () => {
  const { data, file } = dataDir('data-2');
  const fake = join(data, 'fake-dyadrr.cjs');
  writeFileSync(fake, `
const fs = require('fs');
const args = process.argv.slice(2);
const report = args.find((a) => a.startsWith('--report=')).slice('--report='.length);
process.stderr.write(JSON.stringify({ event: 'phase', phase: 'read', elapsedMs: 0 }) + '\\n');
if (args[1].endsWith('kill.mkv')) process.kill(process.pid, 'SIGKILL');
if (args[1].endsWith('exit.mkv')) process.exit(3);
let signals = 0;
process.on('SIGTERM', () => {
  if (++signals > 1) return;
  setTimeout(() => {
    fs.writeFileSync(process.env.SIGNALS, String(signals));
    fs.writeFileSync(report, JSON.stringify({ decision: 'cancelled', reasons: [{ code: 'CANCELLED', message: 'cancelled' }] }));
    process.exit(50);
  }, 500);
});
fs.writeFileSync(process.env.READY, '');
setInterval(() => {}, 1000);
`);
  const job = (name: string) => ['command=merge', `input=watch/${name}.mkv`, `input=watch/${name}.mkv`, 'output=watch/out.mkv'];

  // Lasciati da un container fermato di colpo: uno senza report, uno con.
  writeJob(file('old', 'run'), job('old'));
  writeJob(file('done', 'run'), job('done'));
  writeFileSync(file('done', 'json'), JSON.stringify({ decision: 'refused', reasons: [{ code: 'NO_MATCH', message: 'no match' }] }));
  writeJob(file('e-kill', 'job'), job('kill'), 30);
  writeJob(file('f-exit', 'job'), job('exit'), 20);
  writeJob(file('g-wait', 'job'), job('wait'), 10);

  const stop = new AbortController();
  const running = runRunner({
    dataDir: data,
    signal: stop.signal,
    dyadrr: [process.execPath, fake],
    env: { ...process.env, SIGNALS: join(data, 'signals'), READY: join(data, 'ready') },
    pollMs: 50,
    aliveMs: 100,
  });

  await until('g-wait ready', () => existsSync(join(data, 'ready')));
  assert.equal(read(file('old', 'exit')), '40\n');
  const old = report(file('old', 'json'));
  assert.equal(old.decision, 'error');
  assert.deepEqual(old.reasons.map((r) => r.code), ['INTERRUPTED']);
  assert.equal(old.mode, 'merge');
  assert.deepEqual(old.arguments.files, [join(data, 'watch/old.mkv'), join(data, 'watch/old.mkv')]);
  assert.equal(read(file('old', 'log')), '');
  assert.equal(read(file('done', 'exit')), '20\n', 'the exit code comes from the report');
  const recovered = logEntries(join(data, RUNNER.jobs, RUNNER.logFile)).map(withoutTime).filter((l) => /^interrupted/.test(String(l.msg)));
  assert.deepEqual(recovered, [
    { level: 'warn', msg: 'interrupted, closed with exit code 20', job: 'done', code: 'NO_MATCH' },
    { level: 'warn', msg: 'interrupted, closed with exit code 40', job: 'old', code: 'INTERRUPTED' },
  ]);
  assert.equal(report(file('done', 'json')).reasons[0]!.code, 'NO_MATCH', 'the report stays');

  assert.equal(read(file('e-kill', 'exit')), '40\n');
  assert.deepEqual(report(file('e-kill', 'json')).reasons, [
    { code: 'INTERRUPTED', message: 'the job was interrupted: dyadrr was killed by SIGKILL' },
  ]);
  assert.match(read(file('e-kill', 'log')), /^\{"event":"phase","phase":"read","elapsedMs":0\}\n$/);
  assert.equal(read(file('f-exit', 'exit')), '40\n');
  assert.deepEqual(report(file('f-exit', 'json')).reasons, [{ code: 'INTERNAL', message: 'dyadrr exited with code 3 without a report' }]);

  // .cancel e stop del runner insieme: un solo SIGTERM, e il lavoro si chiude.
  writeFileSync(file('g-wait', 'cancel'), '');
  stop.abort();
  await running;
  assert.equal(read(join(data, 'signals')), '1');
  assert.equal(read(file('g-wait', 'exit')), '50\n');
  assert.ok(statSync(file('g-wait', 'exit')).mtimeMs >= statSync(file('g-wait', 'json')).mtimeMs, '.exit comes last');
});

test('processo: dyadrr-runner senza la cartella sorvegliata non parte; con SIGTERM si ferma', async () => {
  const bin = resolve(__dirname, '..', 'src', 'runner-bin.js');
  const start = (args: string[]) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    return { child, out: () => out, code: new Promise<number | null>((res) => child.on('close', res)) };
  };

  const version = start(['--version']);
  assert.equal(await version.code, 0);
  assert.match(version.out(), /^dyadrr-runner \d+\.\d+\.\d+\n$/);

  const missing = start(['--data', join(dir, 'nowhere')]);
  assert.equal(await missing.code, 1);
  assert.match(missing.out(), /watch is missing: mount the watched folder there/);

  const { data, jobs } = dataDir('data-3');
  const runner = start(['--data', data]);
  await until('dyadrr.alive', () => existsSync(join(jobs, RUNNER.alive)), 10_000);
  runner.child.kill('SIGTERM');
  assert.equal(await runner.code, 0, runner.out());
  assert.match(runner.out(), /^dyadrr-runner: dyadrr \d+\.\d+\.\d+, jobs in .*\ndyadrr-runner: mounted: watch \(rw\)\ndyadrr-runner: SIGTERM: stopping\ndyadrr-runner: stopped\n$/s);
  assert.deepEqual(logEntries(join(jobs, RUNNER.logFile)).map(withoutTime).map((l) => l.msg).slice(-2), ['SIGTERM: stopping', 'stopped']);
});

test('dyadrr.runner.jsonl: rotazione oltre il limite; un file che non si scrive non ferma il runner e si dice una volta', async () => {
  const unknownCommand = 'exit code 30: job: unknown command "analyse": analyze or merge';
  const bad = (file: (id: string, ext: string) => string, ids: string[]) =>
    ids.forEach((id, i) => writeJob(file(id, 'job'), ['command=analyse'], 60 - i));

  // Rotazione: con un limite di 400 byte il file passa a dyadrr.runner.1.jsonl.
  const small = dataDir('data-log-1');
  bad(small.file, ['j1', 'j2', 'j3', 'j4', 'j5', 'j6']);
  let stop = new AbortController();
  const smallLines: RunnerLogEntry[] = [];
  let running = runRunner({ dataDir: small.data, signal: stop.signal, log: (l) => smallLines.push(l), pollMs: 20, aliveMs: 100, logMaxBytes: 400 });
  // La riga `exit code` viene dopo `.exit`: si aspetta lei prima di fermare il runner.
  await until('the j6 exit line', () => smallLines.some((l) => l.job === 'j6' && l.code !== undefined));
  stop.abort();
  await running;
  const previous = logEntries(join(small.jobs, RUNNER.logPrevious));
  const current = logEntries(join(small.jobs, RUNNER.logFile));
  assert.ok(previous.length > 0 && current.length > 0);
  assert.ok(statSync(join(small.jobs, RUNNER.logPrevious)).size <= 400);
  assert.equal(current.at(-1)!.msg, 'stopped');
  const msgs = [...previous, ...current].map((l) => `${String(l.job ?? '')} ${String(l.msg)}`);
  assert.deepEqual(msgs.slice(-3), [`j6 ${unknownCommand}`, ' stopping', ' stopped'], 'in order, nothing repeated');

  // Un file che non si scrive (qui è una cartella): i lavori vanno avanti, e
  // l'errore arriva una volta sola, solo a stderr.
  const broken = dataDir('data-log-2');
  mkdirSync(join(broken.jobs, RUNNER.logFile));
  bad(broken.file, ['k1', 'k2', 'k3']);
  const lines: RunnerLogEntry[] = [];
  stop = new AbortController();
  running = runRunner({ dataDir: broken.data, signal: stop.signal, log: (l) => lines.push(l), pollMs: 20, aliveMs: 100 });
  await until('k3.exit', () => existsSync(broken.file('k3', 'exit')));
  stop.abort();
  await running;
  const errors = lines.filter((l) => l.msg.startsWith(`${RUNNER.logFile} cannot be written`));
  assert.equal(errors.length, 1, JSON.stringify(lines));
  assert.deepEqual(errors[0], { level: 'error', msg: `${RUNNER.logFile} cannot be written: EISDIR` });
  assert.ok(lines.some((l) => l.job === 'k3' && l.msg === unknownCommand));
  assert.equal(lines.at(-1)!.msg, 'stopped');
});
