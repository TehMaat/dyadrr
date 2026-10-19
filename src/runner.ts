import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CHOICES, CHOICE_NAMES } from './choices.js';
import { INPUTS_OPTION, writeOutcomeReport, type Outcome } from './cli.js';
import { DyadrrError, exitCodeFor, type ErrorCode } from './codes.js';
import type { Mode, Report } from './report.js';

// Il runner dei file job (studio §14.1): nel container prende i lavori che
// Wayfinderr scrive nella cartella dei job, uno alla volta, e lancia la riga
// di comando. `<id>.job` → `<id>.run` (preso) → `<id>.log` (stderr di Dyadrr)
// → `<id>.json` (report) → `<id>.exit` (codice di uscita, sempre per ultimo);
// `<id>.cancel` lo ferma; `dyadrr.alive` dice che il container è attivo. Il
// processo (segnali, argomenti) sta in `runner-bin.ts`.

/** Costanti del metodo (§14.1): cartelle nel container e intervalli. */
export const RUNNER = {
  /** Le cartelle condivise con Wayfinderr, montate per nome. */
  dataDir: '/data',
  /** La cartella sorvegliata, rispetto a `dataDir`. */
  watch: 'watch',
  /** La cartella dei job, rispetto a `dataDir`. */
  jobs: 'watch/.wayfinderr/dyadrr/jobs',
  alive: 'dyadrr.alive',
  /** Ogni quanto si guardano la cartella dei job e `<id>.cancel`. */
  pollMs: 1000,
  /** Ogni quanto si riscrive `dyadrr.alive`. */
  aliveMs: 5000,
} as const;

/** L'id di un lavoro: il nome di `<id>.job`. */
export const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Le chiavi del job: le opzioni senza i due trattini, più `command` e `input`. */
export const JOB_KEYS = [
  'command',
  'input',
  'output',
  'original-language',
  'temp-dir',
  'expect',
  ...CHOICE_NAMES.map((n) => CHOICES[n].option.slice(2)),
  INPUTS_OPTION.option.slice(2),
] as const;

/** Le chiavi con un percorso relativo a `dataDir`. */
const PATH_KEYS: readonly string[] = ['input', 'output', 'temp-dir', 'expect'];

export interface Job {
  command: Mode;
  /** I percorsi degli ingressi come nel job. */
  inputs: string[];
  /** Le altre chiavi, in ordine, con il valore com'è nel job. */
  options: Array<[string, string]>;
}

const badJob = (message: string) => new DyadrrError('BAD_ARGUMENTS', `job: ${message}`);

/**
 * Legge un file job (§14.1). Sono `BAD_ARGUMENTS` le righe senza `=`, le
 * chiavi sconosciute o ripetute (salvo `input`) e un comando mancante o
 * sconosciuto; il resto lo controlla la riga di comando.
 */
export function parseJob(text: string): Job {
  let command: string | undefined;
  const inputs: string[] = [];
  const options: Array<[string, string]> = [];
  const seen = new Set<string>();
  text.split('\n').forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') return;
    const eq = line.indexOf('=');
    if (eq <= 0) throw badJob(`line ${i + 1} is not key=value`);
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (!(JOB_KEYS as readonly string[]).includes(key)) throw badJob(`unknown key "${key}" on line ${i + 1}`);
    if (key !== 'input' && seen.has(key)) throw badJob(`"${key}" is given more than once`);
    seen.add(key);
    if (key === 'command') command = value;
    else if (key === 'input') inputs.push(value);
    else options.push([key, value]);
  });
  if (command === undefined) throw badJob('command is missing');
  if (command !== 'analyze' && command !== 'merge') throw badJob(`unknown command "${command}": analyze or merge`);
  return { command, inputs, options };
}

/**
 * Un percorso del job nel container: relativo a `dataDir`, con `/`, senza
 * elementi vuoti, `.` o `..`; altrimenti `BAD_ARGUMENTS`.
 */
export function dataPath(dataDir: string, path: string): string {
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw badJob(`"${path}" is not a path relative to the mounted folders (${RUNNER.watch}/…)`);
  }
  return join(dataDir, ...parts);
}

/** Gli argomenti della riga di comando per un job, con il report e `--progress json` del runner. */
export function jobArguments(job: Job, dataDir: string, reportPath: string): string[] {
  const value = (key: string, v: string) => (PATH_KEYS.includes(key) ? dataPath(dataDir, v) : v);
  return [
    job.command,
    ...job.inputs.map((p) => dataPath(dataDir, p)),
    ...job.options.map(([key, v]) => `--${key}=${value(key, v)}`),
    `--report=${reportPath}`,
    '--progress=json',
  ];
}

/** Il codice di uscita che corrisponde a un report (per un lavoro di cui manca `.exit`). */
export function exitCodeOfReport(report: Pick<Report, 'decision' | 'reasons'>): number {
  return report.decision === 'cancelled'
    ? exitCodeFor('cancelled')
    : exitCodeFor(report.decision, report.reasons[0]?.code as ErrorCode | undefined);
}

/** Scrive con un nome temporaneo che inizia con un punto e rinomina: non si legge mai a metà. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    await writeFile(temp, text);
    await rename(temp, path);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

const exists = (path: string) => stat(path).then(() => true, () => false);

async function readReport(path: string): Promise<Report | null> {
  try {
    const report = JSON.parse(await readFile(path, 'utf8')) as Report;
    return typeof report.decision === 'string' && Array.isArray(report.reasons) ? report : null;
  } catch {
    return null;
  }
}

export interface RunnerOptions {
  /** Le cartelle montate (`/data`). */
  dataDir: string;
  /** Il segnale di stop: con un lavoro in corso, Dyadrr riceve SIGTERM e il lavoro si chiude. */
  signal: AbortSignal;
  /** Come si lancia Dyadrr; per default `bin.js` di questo pacchetto con questo Node. */
  dyadrr?: readonly string[];
  /** L'ambiente di Dyadrr; per default quello del runner. */
  env?: NodeJS.ProcessEnv;
  /** Le righe del log del runner (non dei lavori). */
  log?: (line: string) => void;
  /** Per i test: intervalli più brevi. */
  pollMs?: number;
  aliveMs?: number;
}

/**
 * Il runner: scrive `dyadrr.alive`, chiude i lavori interrotti e poi prende
 * i job uno alla volta, finché il segnale di stop non arriva. Si ferma con un
 * errore se manca la cartella sorvegliata.
 */
export async function runRunner(o: RunnerOptions): Promise<void> {
  const log = o.log ?? (() => {});
  const watch = join(o.dataDir, RUNNER.watch);
  if (!(await stat(watch).catch(() => null))?.isDirectory()) {
    throw new Error(`${watch} is missing: mount the watched folder there`);
  }
  const jobs = join(o.dataDir, RUNNER.jobs);
  await mkdir(jobs, { recursive: true });

  const alive = () =>
    writeAtomic(join(jobs, RUNNER.alive), `${Math.floor(Date.now() / 1000)}\n`).catch((e: unknown) =>
      log(`${RUNNER.alive} cannot be written: ${(e as NodeJS.ErrnoException).code ?? String(e)}`));
  await alive();
  const timer = setInterval(() => void alive(), o.aliveMs ?? RUNNER.aliveMs);
  try {
    await recover(jobs, o.dataDir, log);
    const reported = new Set<string>();
    while (!o.signal.aborted) {
      const id = await nextJob(jobs, reported, log);
      if (id !== null) await runJob(id, jobs, o, log);
      else await sleep(o.pollMs ?? RUNNER.pollMs, undefined, { signal: o.signal }).catch(() => {});
    }
  } finally {
    clearInterval(timer);
  }
}

/** Mode e file di un job che forse non si legge, per un report scritto dal runner. */
function salvageJob(text: string, dataDir: string): { mode: Mode | null; files: string[] } {
  const values = (key: string) => text.split('\n').flatMap((l) => {
    const line = l.endsWith('\r') ? l.slice(0, -1) : l;
    return line.startsWith(`${key}=`) ? [line.slice(key.length + 1)] : [];
  });
  const command = values('command')[0];
  const files = values('input').map((p) => {
    try {
      return dataPath(dataDir, p);
    } catch {
      return p;
    }
  });
  return { mode: command === 'analyze' || command === 'merge' ? command : null, files };
}

/**
 * All'avvio, i `.run` senza `.exit`: lavori interrotti di colpo. Non si
 * rilanciano: `.exit` dal report se Dyadrr l'aveva scritto, altrimenti un
 * report `INTERRUPTED` (§14.1).
 */
async function recover(jobs: string, dataDir: string, log: (line: string) => void): Promise<void> {
  const names = new Set(await readdir(jobs));
  for (const name of [...names].sort()) {
    const id = name.slice(0, -'.run'.length);
    if (!name.endsWith('.run') || !JOB_ID.test(id) || names.has(`${id}.exit`)) continue;
    const file = (ext: string) => join(jobs, `${id}.${ext}`);
    await (await open(file('log'), 'a')).close();
    const report = await readReport(file('json'));
    let code: number;
    if (report) {
      code = exitCodeOfReport(report);
    } else {
      const text = await readFile(file('run'), 'utf8').catch(() => '');
      code = await writeOutcomeReport(file('json'), { ...salvageJob(text, dataDir), startedAt: new Date() }, {
        decision: 'error',
        code: 'INTERRUPTED',
        message: 'the job was interrupted: the container stopped while Dyadrr was running',
      });
    }
    await writeAtomic(file('exit'), `${code}\n`);
    log(`${id}: interrupted, closed with exit code ${code}`);
  }
}

/**
 * Il prossimo job: il più vecchio, poi per nome. Un id già usato (c'è un suo
 * `.run`, `.log`, `.json` o `.exit`) non si prende e si segnala una volta.
 */
async function nextJob(jobs: string, reported: Set<string>, log: (line: string) => void): Promise<string | null> {
  const names = await readdir(jobs);
  const present = new Set(names);
  const candidates: Array<{ id: string; mtimeMs: number }> = [];
  for (const name of names) {
    const id = name.slice(0, -'.job'.length);
    if (!name.endsWith('.job') || !JOB_ID.test(id)) continue;
    if (['run', 'log', 'json', 'exit'].some((ext) => present.has(`${id}.${ext}`))) {
      if (!reported.has(id)) log(`${id}: not taken: the id was already used`);
      reported.add(id);
      continue;
    }
    const st = await stat(join(jobs, name)).catch(() => null);
    if (st) candidates.push({ id, mtimeMs: st.mtimeMs });
  }
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates[0]?.id ?? null;
}

/** Un lavoro, da `.job` a `.exit`. */
async function runJob(id: string, jobs: string, o: RunnerOptions, log: (line: string) => void): Promise<void> {
  const file = (ext: string) => join(jobs, `${id}.${ext}`);
  try {
    await rename(file('job'), file('run'));
  } catch {
    return; // Wayfinderr l'ha tolto nel frattempo.
  }
  const startedAt = new Date();
  await (await open(file('log'), 'w')).close();
  const report = file('json');
  const text = await readFile(file('run'), 'utf8');
  const salvaged = salvageJob(text, o.dataDir);
  const outcome = (x: Outcome) => writeOutcomeReport(report, { ...salvaged, startedAt }, x);

  let code: number;
  let argv: string[] | null = null;
  try {
    const job = parseJob(text);
    argv = jobArguments(job, o.dataDir, report);
    log(`${id}: ${job.command}`);
  } catch (e) {
    if (!(e instanceof DyadrrError)) throw e;
    code = await outcome({ decision: 'error', code: e.code, message: e.message });
  }
  if (argv !== null) {
    if (await exists(file('cancel'))) {
      code = await outcome({ decision: 'cancelled', message: 'cancelled: cancelled before it started' });
    } else if (o.signal.aborted) {
      code = await outcome({ decision: 'cancelled', message: 'cancelled: the runner was stopped' });
    } else {
      code = await launch(argv, file, o);
    }
  }
  await writeAtomic(file('exit'), `${code!}\n`);
  log(`${id}: exit code ${code!}`);
}

/** Lancia Dyadrr e aspetta la fine; un solo SIGTERM per `.cancel` o per lo stop del runner. */
async function launch(argv: string[], file: (ext: string) => string, o: RunnerOptions): Promise<number> {
  const [command, ...args] = o.dyadrr ?? [process.execPath, join(__dirname, 'bin.js')];
  const child = spawn(command!, [...args, ...argv], {
    cwd: o.dataDir,
    env: o.env ?? process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const logStream = createWriteStream(file('log'), { flags: 'a' });
  const logged = new Promise<void>((resolve) => logStream.on('close', () => resolve()));
  child.stderr.pipe(logStream);

  let stopped = false;
  const stop = () => {
    if (stopped || child.exitCode !== null || child.signalCode !== null) return;
    stopped = true;
    child.kill('SIGTERM');
  };
  o.signal.addEventListener('abort', stop);
  const poll = setInterval(() => {
    void exists(file('cancel')).then((c) => c && stop());
  }, o.pollMs ?? RUNNER.pollMs);

  const end = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
    child.on('error', (error) => resolve({ code: null, signal: null, error }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearInterval(poll);
  o.signal.removeEventListener('abort', stop);
  if (!logStream.writableEnded) logStream.end();
  await logged;

  const report = await readReport(file('json'));
  if (report) return end.code ?? exitCodeOfReport(report);
  const startedAt = new Date();
  const { mode, files } = salvageJob(await readFile(file('run'), 'utf8'), o.dataDir);
  return writeOutcomeReport(file('json'), { mode, files, startedAt }, end.error
    ? { decision: 'error', code: 'INTERNAL', message: `dyadrr cannot be launched: ${end.error.message}` }
    : end.signal !== null
      ? { decision: 'error', code: 'INTERRUPTED', message: `the job was interrupted: dyadrr was killed by ${end.signal}` }
      : { decision: 'error', code: 'INTERNAL', message: `dyadrr exited with code ${end.code} without a report` });
}
