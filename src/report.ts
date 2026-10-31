import { readFileSync } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Build } from './build.js';
import type { Calibration } from './calibration.js';
import { CHOICES, type ChoiceName, type GivenChoices } from './choices.js';
import { DyadrrError, type Decision, type ErrorCode, type RefusalCode } from './codes.js';
import type { Check, DecisionReport, Match, Warning } from './decision.js';
import type { Fingerprint, InputFile } from './inputs.js';
import type { MeasuredTransferProbe, Measurement, TransferCandidate, PairAnalysis, PairTrial, TrackPair } from './measure.js';
import type { Plan, PlanChoice } from './plan.js';
import type { ToolVersions } from './tools.js';
import type { Verification } from './verify.js';

// Il report (studio §11): il contratto con chi lancia Dyadrr. Un file JSON
// scritto con un nome temporaneo e poi rinominato; chi chiama decide solo dal
// campo `decision`. Qui la forma (§11.3), la scrittura e il confronto con il
// report di un'analisi confermata (`--expect`, §10).

/**
 * Versione del formato del report (§11.3), separata da quella di Dyadrr: si
 * alza solo con una modifica incompatibile, un campo tolto o cambiato di
 * significato. Vale anche per le righe di `--progress json`.
 */
export const REPORT_FORMAT = 1;

/** I campi del report, nell'ordine in cui si scrivono (§11.3). */
export const REPORT_FIELDS = [
  'format',
  'dyadrr',
  'mode',
  'startedAt',
  'finishedAt',
  'durationMs',
  'tools',
  'arguments',
  'calibration',
  'decision',
  'reasons',
  'inputs',
  'roles',
  'measurement',
  'checks',
  'choices',
  'plan',
  'expect',
  'output',
  'warnings',
] as const;

/** Fasi dell'avanzamento (§11.3), nell'ordine in cui arrivano. */
export const PROGRESS_PHASES = [
  'read',
  'anchors',
  'edges',
  'checkpoints',
  'edge-probes',
  'transfer',
  'plan',
  'intermediate',
  'merge',
  'verify',
] as const;
export type ProgressPhase = (typeof PROGRESS_PHASES)[number];

export type Mode = 'analyze' | 'merge';

// ---------------------------------------------------------------- tipi

export interface ReportArguments {
  files: string[];
  output: string | null;
  report: string;
  originalLanguage: string | null;
  tempDir: string | null;
  expect: string | null;
  progress: 'json' | null;
  /** Scelte da opzione e da variabile d'ambiente; quelle chieste in un terminale stanno in `choices`. */
  choices: GivenChoices;
}

export interface ReportReason {
  code: RefusalCode | ErrorCode | 'CANCELLED';
  message: string;
}

export interface ReportRoles {
  /** Indici in `inputs`. */
  reference: 0 | 1;
  donor: 0 | 1;
  reason: string | null;
  /** Il confronto dei video (§3.2); `null` se non si è arrivati a farlo. */
  video: Check | null;
  measureLanguage: DecisionReport['measureLanguage'];
  /** Le coppie di tracce provate, con la loro confidenza (§4.2). */
  pairs: PairTrial[];
}

export interface ReportMeasurement {
  language: string;
  pair: TrackPair;
  anchors: DecisionReport['anchors'];
  speedRatio: number | null;
  offset: DecisionReport['offset'];
  drift: DecisionReport['drift'];
  contradiction: DecisionReport['contradiction'];
  /** Con i picchi misurati prima della decisione (`local`, `wide`), per la taratura (§15, fase 1). */
  checkpoints: (DecisionReport['checkpoints'][number] & { requestedMs: number; local: Match | null; wide: Match | null })[];
  commonMaterial: DecisionReport['commonMaterial'];
  edgeProbes: Measurement['edgeProbes'];
  transfer: {
    measureTrackId: number;
    italianTrackId: number;
    offsetMs: number | null;
    confident: number;
    probes: MeasuredTransferProbe[];
    candidates: TransferCandidate[];
  } | null;
  bytesRead: Measurement['bytesRead'];
}

export type ReportPlan = Omit<Plan, 'choices' | 'warnings'>;

export interface ReportExpect {
  path: string;
  result: 'pass' | 'fail';
  differences: string[];
}

export interface ReportOutput {
  path: string;
  /** Il file finale è stato rinominato al suo nome: se è falso non c'è. */
  delivered: boolean;
  sizeBytes: number | null;
  durationMs: number | null;
  build: Build | null;
  verification: Verification | null;
  /** Cosa si è fatto degli ingressi dopo la consegna (§10.2); `null` se il file non è stato consegnato. */
  inputs: ReportInputs | null;
}

/** `--inputs` dopo un merge consegnato (§10.2). */
export interface ReportInputs {
  value: 'keep' | 'delete';
  /** `default`: né opzione né variabile, e nessuna risposta in un terminale: si tengono. */
  origin: 'option' | 'env' | 'prompt' | 'default';
  /** Percorsi degli ingressi cancellati. */
  deleted: string[];
}

export type WarningSource = 'analysis' | 'plan' | 'build' | 'verify' | 'inputs';
export type ReportWarning = Warning & { source: WarningSource };

export interface Report {
  format: number;
  dyadrr: string;
  mode: Mode | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  tools: ToolVersions | null;
  arguments: ReportArguments;
  calibration: Calibration | null;
  decision: Decision;
  reasons: ReportReason[];
  inputs: (InputFile | null)[];
  roles: ReportRoles | null;
  measurement: ReportMeasurement | null;
  checks: Check[];
  choices: PlanChoice[] | null;
  plan: ReportPlan | null;
  expect: ReportExpect | null;
  output: ReportOutput | null;
  warnings: ReportWarning[];
}

// ---------------------------------------------------------------- sezioni

/** Ruoli, misura e controlli di un'analisi, nella forma del report. */
export function analysisSections(analysis: PairAnalysis): Pick<Report, 'roles' | 'measurement' | 'checks'> {
  const { report: d, measurement: m } = analysis;
  const roles: ReportRoles | null = d.roles && {
    ...d.roles,
    reason: d.checks.find((c) => c.name === 'roles')?.detail ?? null,
    video: d.checks.find((c) => c.name === 'video' && c.result !== 'skipped') ?? null,
    measureLanguage: d.measureLanguage,
    pairs: m?.pairs ?? [],
  };
  const measurement: ReportMeasurement | null = m && {
    language: m.measureLanguage,
    pair: m.pair,
    anchors: d.anchors,
    speedRatio: m.speedRatio,
    offset: d.offset,
    drift: d.drift,
    contradiction: d.contradiction,
    checkpoints: d.checkpoints.map((c, i) => {
      const { requestedMs, local, wide } = m.checkpoints![i]!;
      return { requestedMs, ...c, local, wide };
    }),
    commonMaterial: d.commonMaterial,
    edgeProbes: m.edgeProbes,
    transfer: m.transfer && d.transfer && {
      measureTrackId: m.transfer.measureTrackId,
      italianTrackId: m.transfer.italianTrackId,
      offsetMs: d.transfer.offsetMs,
      confident: d.transfer.confident,
      probes: m.transfer.probes,
      candidates: m.transfer.candidates,
    },
    bytesRead: m.bytesRead,
  };
  return { roles, measurement, checks: d.checks };
}

export function planSection(plan: Plan): ReportPlan {
  const { choices: _choices, warnings: _warnings, ...rest } = plan;
  return rest;
}

// ---------------------------------------------------------------- scrittura

/** Nome del report senza `--report` (§10): modalità e ora UTC, nella cartella corrente. */
export function defaultReportName(mode: Mode | null, at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `dyadrr-${mode ?? 'report'}-${stamp}.json`;
}

/** Le decisioni di un'esecuzione che è arrivata in fondo: il report vale qualcosa. */
const CONCLUDED: readonly Decision[] = ['eligible', 'refused'];

/**
 * Dove si scrive il report (§10). Di norma `path`, anche se c'è già un file.
 * Un report che non conclude (`cancelled` o `error`) però non prende mai il
 * posto di un report che conclude (`eligible` o `refused`, di qualsiasi
 * formato): va accanto, `<nome>-<decisione>-<ora UTC>.json`, con `-2`, `-3`…
 * se anche quello c'è. Un file che non è un report si sostituisce, come prima.
 */
export async function reportDestination(path: string, decision: Decision, at: Date): Promise<string> {
  if (CONCLUDED.includes(decision) || !CONCLUDED.includes((await existingReport(path))?.decision as Decision)) return path;
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const stem = join(dirname(path), basename(path).replace(/\.json$/i, ''));
  for (let n = 1; ; n++) {
    const candidate = `${stem}-${decision}-${stamp}${n === 1 ? '' : `-${n}`}.json`;
    if (!(await exists(candidate))) return candidate;
  }
}

/** Il report che c'è già in `path`, se è un report di Dyadrr. */
async function existingReport(path: string): Promise<{ decision?: unknown } | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { format?: unknown }).format !== 'number') return null;
    return parsed as { decision?: unknown };
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scrive il report con un nome temporaneo che inizia con un punto, ignorato
 * dal watcher di Wayfinderr, e poi lo rinomina: non si legge mai a metà
 * (§11.1). Un report che c'è già si sostituisce: se si può, lo decide
 * `reportDestination`.
 */
export async function writeReport(path: string, report: Report): Promise<void> {
  const ordered = Object.fromEntries(REPORT_FIELDS.map((f) => [f, report[f]]));
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(ordered, null, 2)}\n`);
    await rename(temp, path);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

/** La versione di Dyadrr, dal `package.json` del pacchetto. */
export function dyadrrVersion(): string {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'dyadrr' && pkg.version) return pkg.version;
    } catch {
      // Nessun package.json qui: si sale.
    }
    if (dirname(dir) === dir) return 'unknown';
  }
}

// ---------------------------------------------------------------- --expect

/** Il report di un'analisi confermata, con quello che `--expect` confronta. */
export type ExpectedReport = Omit<Report, 'inputs' | 'roles' | 'measurement' | 'choices' | 'plan'> & {
  inputs: [InputFile, InputFile];
  roles: ReportRoles;
  measurement: ReportMeasurement & { offset: NonNullable<DecisionReport['offset']> };
  choices: PlanChoice[];
  plan: ReportPlan;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Legge il report di `--expect` (§10): stessa versione del formato, idoneo,
 * con ingressi, ruoli, S e piano. Altrimenti `BAD_ARGUMENTS`.
 */
export async function readExpectedReport(path: string): Promise<ExpectedReport> {
  const bad = (why: string) => new DyadrrError('BAD_ARGUMENTS', `--expect ${path}: ${why}`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    throw bad(`cannot be read as JSON (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
  }
  if (!isObject(raw)) throw bad('not a Dyadrr report');
  if (raw.format !== REPORT_FORMAT) throw bad(`report format ${String(raw.format)}, this Dyadrr reads format ${REPORT_FORMAT}`);
  if (raw.decision !== 'eligible') throw bad(`the report is not of an eligible pair (decision ${String(raw.decision)})`);
  const r = raw as Partial<Report>;
  const inputs = Array.isArray(r.inputs) && r.inputs.length === 2 && r.inputs.every((i) => isObject(i) && isObject(i?.fingerprint));
  if (!inputs || !isObject(r.roles) || !isObject(r.measurement) || !isObject(r.measurement.offset) ||
    !isObject(r.plan) || !Array.isArray(r.choices)) {
    throw bad('the report has no inputs, roles, offset or plan');
  }
  return raw as unknown as ExpectedReport;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const show = (x: unknown) => (x === null || x === undefined ? 'none' : JSON.stringify(x));
const printKey = (f: Fingerprint) => JSON.stringify([f.size, f.modifiedAt, f.firstMiBSha256, f.lastMiBSha256]);

/** Impronte dei due ingressi, in qualsiasi ordine e senza i percorsi (§10). */
export function compareFingerprints(expected: ExpectedReport, files: readonly InputFile[]): string[] {
  const wanted = expected.inputs.map((i) => printKey(i.fingerprint)).sort();
  const found = files.map((f) => printKey(f.fingerprint)).sort();
  if (same(wanted, found)) return [];
  return files
    .filter((f) => !wanted.includes(printKey(f.fingerprint)))
    .map((f) => `${f.path}: not one of the confirmed inputs (size ${f.fingerprint.size}, modified ${f.fingerprint.modifiedAt})`);
}

/** Ruoli e S definitivo (§10). */
export function compareRolesAndOffset(
  expected: ExpectedReport,
  files: readonly InputFile[],
  roles: { reference: 0 | 1 },
  offsetMs: number,
): string[] {
  const differences: string[] = [];
  const wantedReference = expected.inputs[expected.roles.reference].fingerprint;
  if (printKey(files[roles.reference]!.fingerprint) !== printKey(wantedReference)) {
    differences.push(`the reference is now ${files[roles.reference]!.path}: roles changed`);
  }
  if (offsetMs !== expected.measurement.offset.offsetMs) {
    differences.push(`offset ${offsetMs} ms, confirmed ${expected.measurement.offset.offsetMs} ms`);
  }
  return differences;
}

/**
 * Il piano del merge contro quello confermato (§10): stesse scelte
 * necessarie, salvo una in sospeso che il valore dato ora a un'altra in
 * sospeso rende inutile; una scelta decisa nel report con lo stesso valore; ogni valore
 * che nel report non era in sospeso uguale; quello che lo era uguale
 * all'effetto, nel report, del valore scelto ora.
 */
export function comparePlan(expected: ExpectedReport, plan: Plan): string[] {
  const differences: string[] = [];
  // Il piano si confronta come lo legge chi lo ha confermato: −∞ diventa null.
  const now = JSON.parse(JSON.stringify(plan)) as Plan;
  const e = expected.plan;
  const anyPending = e.pending.length > 0;
  const field = (name: string, wanted: unknown, actual: unknown, pendable = false) => {
    if (pendable && anyPending && wanted === null) return;
    if (!same(wanted, actual)) differences.push(`plan ${name}: ${show(actual)}, confirmed ${show(wanted)}`);
  };

  // Scelte.
  const value = (name: ChoiceName) => {
    const c = now.choices.find((x) => x.name === name);
    return c && (c.status === 'decided' || c.status === 'ignored') ? c.value : null;
  };
  // Una scelta in sospeso nel report può non servire più per il valore dato
  // ora a un'altra scelta in sospeso: con code diverse e `--edge-mismatch
  // drop` il taglio cade sul confine e `--tail` non serve (§5).
  const decidedNow = (name: ChoiceName) => now.choices.find((x) => x.name === name)?.status === 'decided';
  const unblocked = (c: PlanChoice, current: PlanChoice) => c.status === 'pending' && !current.needed
    && expected.choices.some((d) => d.name !== c.name && d.status === 'pending' && decidedNow(d.name));
  for (const c of expected.choices) {
    const current = now.choices.find((x) => x.name === c.name);
    if (current && current.needed !== c.needed && unblocked(c, current)) continue;
    if (!current || current.needed !== c.needed) {
      differences.push(`choice ${c.name}: ${current?.needed ? 'needed' : 'not needed'}, confirmed ${c.needed ? 'needed' : 'not needed'}`);
      continue;
    }
    if (c.status === 'decided' && value(c.name) !== c.value) {
      differences.push(`choice ${c.name}: ${show(value(c.name))}, confirmed ${show(c.value)}`);
    }
  }

  // Quello che non dipende dalle scelte.
  field('offset', e.offsetMs, now.offsetMs);
  field('film', e.film, now.film);
  field('common material', e.commonMaterial, now.commonMaterial);
  for (const edge of ['start', 'end'] as const) {
    for (const key of ['case', 'amountMs', 'mismatchMs'] as const) field(`${edge}.${key}`, e[edge][key], now[edge][key]);
    for (const key of ['cutMs', 'gapMs'] as const) field(`${edge}.${key}`, e[edge][key], now[edge][key], true);
  }
  field('start.cutLevelDbfs', e.start.cutLevelDbfs, now.start.cutLevelDbfs, true);
  field('end.excessMs', e.end.excessMs, now.end.excessMs);
  field('end.excess', e.end.excess, now.end.excess, true);
  field('italian.startMs', e.italian.startMs, now.italian.startMs, true);
  field('italian.endMs', e.italian.endMs, now.italian.endMs, true);
  field('audio tracks', e.audio.map((a) => [a.id, a.role]), now.audio.map((a) => [a.id, a.role]));
  e.audio.forEach((a, i) => {
    const b = now.audio[i];
    if (!b || b.id !== a.id) return;
    for (const key of ['taken', 'startMs', 'endMs'] as const) field(`audio track ${a.id} ${key}`, a[key], b[key], true);
  });
  field('subtitles', e.subtitles.map((s) => [s.id, s.taken, s.forced]), now.subtitles.map((s) => [s.id, s.taken, s.forced]));
  field('reference Italian subtitles', e.referenceItalianSubtitles.map((s) => s.id), now.referenceItalianSubtitles.map((s) => s.id));
  e.referenceItalianSubtitles.forEach((s, i) => {
    const b = now.referenceItalianSubtitles[i];
    if (b?.id === s.id) field(`reference subtitle ${s.id} kept`, s.kept, b.kept, true);
  });

  // Quello che era in sospeso: l'effetto del valore scelto ora.
  for (const name of e.pending) {
    const chosen = value(name);
    const effect = expected.choices.find((c) => c.name === name)?.effects.find((x) => x.value === chosen);
    if (!effect) continue;
    const check = (what: string, wanted: unknown, actual: unknown) => {
      if (wanted !== null && !same(wanted, actual)) differences.push(`${what} with ${CHOICES[name].option} ${chosen}: ${show(actual)}, confirmed ${show(wanted)}`);
    };
    check('Italian start', effect.italianStartMs, now.italian.startMs);
    check('Italian end', effect.italianEndMs, now.italian.endMs);
    check('Italian audio tracks', effect.audioTrackIds, now.audio.filter((a) => a.taken).map((a) => a.id));
    check('reference Italian subtitles kept', effect.referenceSubtitleTrackIds,
      now.referenceItalianSubtitles.filter((s) => s.kept).map((s) => s.id));
  }
  return differences;
}
