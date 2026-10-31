import { constants } from 'node:fs';
import { access, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildMerge,
  checkBuildTarget,
  commitBuild,
  discardBuild,
  existingOutput,
  type Build,
  type BuildProgress,
  type ExistingOutput,
} from './build.js';
import { loadCalibration, type Calibration } from './calibration.js';
import {
  CHOICES,
  CHOICE_NAMES,
  assertNoPendingChoices,
  readGivenChoices,
  type ChoiceName,
  type GivenChoices,
  type RawChoices,
} from './choices.js';
import { DyadrrError, exitCodeFor, type Decision, type ErrorCode } from './codes.js';
import type { Warning } from './decision.js';
import { readInput, type InputFile } from './inputs.js';
import { parseOriginalLanguage } from './languages.js';
import { analyzePair, type MeasureProgress, type PairAnalysis } from './measure.js';
import { planPair, type ChoiceEffect, type Plan } from './plan.js';
import {
  REPORT_FORMAT,
  analysisSections,
  compareFingerprints,
  comparePlan,
  compareRolesAndOffset,
  defaultReportName,
  dyadrrVersion,
  planSection,
  readExpectedReport,
  reportDestination,
  writeReport,
  type ExpectedReport,
  type Mode,
  type ProgressPhase,
  type Report,
  type ReportArguments,
  type ReportInputs,
  type ReportReason,
  type ReportWarning,
} from './report.js';
import { DEFAULT_TOOLS, checkTools, type ToolPaths, type ToolVersions } from './tools.js';
import { VerifyFailedError, verifyBuild, type Verification } from './verify.js';

// Riga di comando (studio §10–11): `dyadrr analyze` e `dyadrr merge`. Su
// stdout solo il percorso del report, su stderr l'avanzamento; il codice di
// uscita viene dalla decisione (`exitCodeFor`). Il processo (segnali,
// terminale, codice di uscita) sta in `bin.ts`: qui tutto arriva da
// `CliEnvironment`, così i test lanciano la riga di comando senza un processo.

export const USAGE = `Usage:
  dyadrr analyze <a.mkv> <b.mkv> [options]
  dyadrr merge   <a.mkv> <b.mkv> --output <file> [options]

Options:
  --output <file>                  final file (merge)
  --report <file>                  JSON report (default: dyadrr-<mode>-<time>.json here)
  --original-language <code>       original language of the film (eng, jpn, fr…)
  --temp-dir <dir>                 temporary files (merge; default .dyadrr/ next to the output)
  --expect <report>                confirmed analysis that the merge must match (merge)
  --progress json                  progress on stderr, one JSON line per event
  --tail trim|keep                 Italian audio beyond the end of the reference video
  --italian all|main               Italian audio tracks to take
  --reference-italian-subs keep|drop
                                   Italian PGS already in the reference
  --edge-mismatch drop|keep        Italian audio over a different intro or ending
  --inputs keep|delete             the two inputs after a verified merge (merge; default: ask, else keep)
  --help, --version

stdout: the path of the report. Exit codes: 0 eligible or merged, 20 refused,
30 input or argument error, 40 internal, merge or verification error, 50 cancelled.
`;

export interface CliEnvironment {
  /** Variabili d'ambiente, per le scelte preimpostate (`DYADRR_*`). */
  env: Readonly<Record<string, string | undefined>>;
  /** Cartella da cui si risolvono i percorsi relativi. */
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Il segnale di stop: interrompe analisi e merge (`CANCELLED`). */
  signal?: AbortSignal;
  /**
   * Chiede una riga in un terminale interattivo; `null` alla fine
   * dell'ingresso. Assente se non c'è un terminale: una scelta in sospeso è
   * allora `CHOICE_REQUIRED`.
   */
  ask?: (question: string) => Promise<string | null>;
  /** Per i test: la taratura (altrimenti quella versionata), i programmi, lo spazio libero. */
  calibration?: Calibration;
  tools?: ToolPaths;
  freeSpace?: (dir: string) => Promise<number>;
}

// ---------------------------------------------------------------- argomenti

const STRING_OPTIONS = ['output', 'report', 'original-language', 'temp-dir', 'expect', 'progress', 'inputs'] as const;
/** Il nome di ogni scelta senza i due trattini (`edge-mismatch`). */
const choiceOption = (name: ChoiceName) => CHOICES[name].option.slice(2);
const MERGE_ONLY = ['output', 'temp-dir', 'expect', 'inputs'] as const;

/**
 * Cosa fare dei due ingressi dopo un merge riuscito e verificato (§10.2).
 * Non è una scelta di §10.1: non serve al piano e non dà mai
 * `CHOICE_REQUIRED`; senza opzione, variabile o risposta gli ingressi si tengono.
 */
export const INPUTS_OPTION = {
  option: '--inputs',
  env: 'DYADRR_INPUTS',
  values: ['keep', 'delete'],
} as const;
type InputsValue = (typeof INPUTS_OPTION)['values'][number];

interface Arguments {
  mode: Mode;
  files: [string, string];
  output: string | null;
  report: string | null;
  originalLanguage: string | null;
  tempDir: string | null;
  expect: string | null;
  progress: 'json' | null;
  choices: RawChoices;
  inputs: string | null;
}

const badArguments = (message: string) => new DyadrrError('BAD_ARGUMENTS', `${message} (see dyadrr --help)`);

/** Legge gli argomenti (§10). Ogni problema è `BAD_ARGUMENTS`. */
function parseArguments(argv: readonly string[]): Arguments {
  const options = Object.fromEntries([
    ...[...STRING_OPTIONS, ...CHOICE_NAMES.map(choiceOption)].map((o) => [o, { type: 'string' as const }]),
    ['help', { type: 'boolean' as const, short: 'h' }],
    ['version', { type: 'boolean' as const }],
  ]);
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true, tokens: true });
  } catch (e) {
    throw badArguments((e as Error).message);
  }
  const seen = new Set<string>();
  for (const t of parsed.tokens) {
    if (t.kind !== 'option') continue;
    if (seen.has(t.name)) throw badArguments(`--${t.name} is given more than once`);
    seen.add(t.name);
  }
  const values = parsed.values as Record<string, string | undefined>;
  const [command, ...files] = parsed.positionals;
  if (command !== 'analyze' && command !== 'merge') {
    throw badArguments(command === undefined ? 'no command: analyze or merge' : `unknown command "${command}": analyze or merge`);
  }
  if (files.length !== 2) throw badArguments(`${command} takes two MKV files, ${files.length} given`);
  if (command === 'analyze') {
    for (const o of MERGE_ONLY) if (values[o] !== undefined) throw badArguments(`--${o} is only for merge`);
  } else if (values.output === undefined) {
    throw badArguments('merge needs --output <file>');
  }
  if (values.progress !== undefined && values.progress !== 'json') {
    throw badArguments(`--progress "${values.progress}" is not valid (expected json)`);
  }
  return {
    mode: command,
    files: [files[0]!, files[1]!],
    output: values.output ?? null,
    report: values.report ?? null,
    originalLanguage: values['original-language'] ?? null,
    tempDir: values['temp-dir'] ?? null,
    expect: values.expect ?? null,
    progress: values.progress === 'json' ? 'json' : null,
    choices: Object.fromEntries(CHOICE_NAMES.flatMap((n) => {
      const v = values[choiceOption(n)];
      return v === undefined ? [] : [[n, v]];
    })),
    inputs: values.inputs ?? null,
  };
}

/** `--inputs` o `DYADRR_INPUTS`, con le regole delle scelte (§10.1): l'opzione vince, un valore non valido è `BAD_ARGUMENTS`. */
function readInputsChoice(
  option: string | null,
  env: Readonly<Record<string, string | undefined>>,
): { value: InputsValue; origin: 'option' | 'env' } | null {
  const valid = (value: string, source: string): InputsValue => {
    if (!(INPUTS_OPTION.values as readonly string[]).includes(value)) {
      throw new DyadrrError('BAD_ARGUMENTS', `${source}: "${value}" is not valid (expected ${INPUTS_OPTION.values.join(' or ')})`);
    }
    return value as InputsValue;
  };
  const fromEnv = env[INPUTS_OPTION.env]?.trim();
  const envValue = fromEnv ? valid(fromEnv, INPUTS_OPTION.env) : null;
  if (option !== null) return { value: valid(option, INPUTS_OPTION.option), origin: 'option' };
  return envValue === null ? null : { value: envValue, origin: 'env' };
}

/**
 * Comando, file e `--report` da argomenti che non si leggono: il report si
 * scrive comunque. Ogni opzione ha un valore, salvo `--help` e `--version`
 * che non arrivano fin qui.
 */
function salvage(argv: readonly string[]): { mode: Mode | null; files: string[]; report: string | null } {
  const positionals = argv.filter((a, i) => !a.startsWith('-') && !(argv[i - 1]?.startsWith('--') && !argv[i - 1]!.includes('=')));
  let report: string | null = null;
  argv.forEach((a, i) => {
    if (a === '--report' && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) report = argv[i + 1]!;
    else if (a.startsWith('--report=')) report = a.slice('--report='.length);
  });
  const mode = positionals[0];
  return { mode: mode === 'analyze' || mode === 'merge' ? mode : null, files: positionals.slice(1), report };
}

// ---------------------------------------------------------------- scelte

/** Ordine in cui si chiedono (§10): `--edge-mismatch` può rendere `--tail` non necessaria. */
const PROMPT_ORDER: readonly ChoiceName[] = ['edgeMismatch', 'tail', 'italian', 'referenceItalianSubs'];

const CHOICE_TITLES: Readonly<Record<ChoiceName, string>> = {
  tail: 'Italian audio beyond the end of the reference video',
  italian: 'Italian audio tracks to take',
  referenceItalianSubs: 'Italian PGS subtitles already in the reference',
  edgeMismatch: 'Italian audio over a different intro or ending',
};

/** "1:02:03.456" */
function clock(ms: number | null): string {
  if (ms === null) return '?';
  const total = Math.round(ms);
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = ((abs % 60_000) / 1000).toFixed(3).padStart(6, '0');
  return `${sign}${h}:${String(m).padStart(2, '0')}:${s}`;
}

function describeEffect(e: ChoiceEffect): string {
  const pending = 'depends on another choice';
  const ids = (list: number[] | null) => (list === null ? pending : list.length === 0 ? 'none' : list.join(', '));
  const interval = e.italianStartMs === null || e.italianEndMs === null
    ? pending
    : `${clock(e.italianStartMs)} – ${clock(e.italianEndMs)}`;
  return `Italian ${interval}; audio tracks ${ids(e.audioTrackIds)}; reference Italian subtitles kept ${ids(e.referenceSubtitleTrackIds)}; ` +
    `warnings ${e.warnings.length === 0 ? 'none' : e.warnings.join(', ')}`;
}

// ---------------------------------------------------------------- esecuzione

/** Quello che si sa finora, per il report: si riempie man mano. */
interface State {
  tools: ToolVersions | null;
  calibration: Calibration | null;
  choices: GivenChoices;
  files: [InputFile | null, InputFile | null];
  analysis: PairAnalysis | null;
  plan: Plan | null;
  expect: { path: string; differences: string[] } | null;
  build: Build | null;
  verification: Verification | null;
  delivered: boolean;
  sizeBytes: number | null;
  inputs: ReportInputs | null;
  inputWarnings: Warning[];
}

const emptyState = (): State => ({
  tools: null,
  calibration: null,
  choices: {},
  files: [null, null],
  analysis: null,
  plan: null,
  expect: null,
  build: null,
  verification: null,
  delivered: false,
  sizeBytes: null,
  inputs: null,
  inputWarnings: [],
});

const inputChanged = (differences: string[]) =>
  new DyadrrError('INPUT_CHANGED', `the inputs or the plan differ from the confirmed analysis: ${differences.join('; ')}`);

/**
 * Lancia la riga di comando e restituisce il codice di uscita. Scrive sempre
 * il report, salvo che per `--help` e `--version`, se `--report` è un altro
 * file degli argomenti o se la sua cartella non è scrivibile (§10).
 */
export async function runCli(argv: readonly string[], io: CliEnvironment): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.stdout(USAGE);
    return 0;
  }
  if (argv.includes('--version')) {
    io.stdout(`dyadrr ${dyadrrVersion()}\n`);
    return 0;
  }

  const startedAt = new Date();
  const t0 = Date.now();
  let args: Arguments | null = null;
  let argumentsError: unknown = null;
  try {
    args = parseArguments(argv);
  } catch (e) {
    argumentsError = e;
  }
  const fallback = salvage(argv);
  const mode = args?.mode ?? fallback.mode;
  const at = (p: string) => resolve(io.cwd, p);
  const reportPath = at(args?.report ?? fallback.report ?? defaultReportName(mode, startedAt));

  // Il report non si scrive mai al posto di un ingresso, del file finale o
  // del report di --expect: niente report, e il file resta com'è.
  const others = argv.flatMap((a, i) => {
    if (a.startsWith('--report=') || argv[i - 1] === '--report') return [];
    return [a.startsWith('--') && a.includes('=') ? a.slice(a.indexOf('=') + 1) : a];
  });
  if (others.some((a) => !a.startsWith('-') && at(a) === reportPath)) {
    io.stderr(`dyadrr: BAD_ARGUMENTS: --report ${reportPath} is also an input, the output or the --expect report: it is not overwritten\n`);
    return exitCodeFor('error', 'BAD_ARGUMENTS');
  }

  // Senza una cartella scrivibile per il report non si comincia nemmeno.
  try {
    if (!(await stat(dirname(reportPath))).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    await access(dirname(reportPath), constants.W_OK);
  } catch (e) {
    io.stderr(`dyadrr: OUTPUT_NOT_WRITABLE: the report cannot be written in ${dirname(reportPath)} (${(e as NodeJS.ErrnoException).code ?? String(e)})\n`);
    return exitCodeFor('error', 'OUTPUT_NOT_WRITABLE');
  }

  const progressJson = args?.progress === 'json';
  let lastPhase: ProgressPhase | null = null;
  const emit = (event: Record<string, unknown>) => {
    if (progressJson) io.stderr(`${JSON.stringify({ ...event, elapsedMs: Date.now() - t0 })}\n`);
  };
  const phase = (p: ProgressPhase) => {
    if (p === lastPhase) return;
    lastPhase = p;
    emit({ event: 'phase', phase: p });
  };
  const onMeasure = (m: MeasureProgress) => {
    phase(m.phase);
    emit({ event: 'progress', phase: m.phase, done: m.done, total: m.total, ...(m.outcomes ? { outcomes: m.outcomes } : {}) });
  };
  const onBuild = (b: BuildProgress) => {
    phase(b.phase);
    emit({ event: 'progress', phase: b.phase, step: b.step, steps: b.steps, percent: b.percent });
  };

  const state = emptyState();
  let decision: Decision = 'eligible';
  let reasons: ReportReason[] = [];
  let errorCode: ErrorCode | undefined;

  try {
    if (argumentsError) throw argumentsError;
    const a = args!;
    const files = a.files.map(at) as [string, string];
    const output = a.output === null ? null : at(a.output);
    const expectPath = a.expect === null ? null : at(a.expect);
    state.calibration = io.calibration ?? loadCalibration();
    const cal = state.calibration;
    const originalLanguage = a.originalLanguage === null ? null : parseOriginalLanguage(a.originalLanguage);
    state.choices = readGivenChoices(a.choices, io.env);
    const inputsChoice = a.mode === 'merge' ? readInputsChoice(a.inputs, io.env) : null;
    const tools = io.tools ?? DEFAULT_TOOLS;
    state.tools = await checkTools(tools);
    const signal = io.signal;
    signal?.throwIfAborted();

    // Il file finale si controlla prima di leggere gigabyte (§9.4). Se c'è
    // già, in un terminale si chiede se cancellarlo: si cancella solo dopo le
    // verifiche, e mai se è un ingresso o un report (§10).
    let replace: ExistingOutput | undefined;
    const ask = progressJson ? undefined : io.ask;
    if (a.mode === 'merge') {
      const existing = await existingOutput(output!);
      const others = await Promise.all([...files, expectPath, reportPath].map((f) => (f === null ? null : existingOutput(f))));
      const protectedFile = others.some((o) => o !== null && existing !== null && o.dev === existing.dev && o.ino === existing.ino);
      if (existing && !protectedFile && ask) {
        const question = [
          `${output} already exists.`,
          'Delete it and continue? It is deleted only after the new file is built and verified.',
          'Choose yes or no: ',
        ].join('\n');
        let answer: string | null;
        do answer = (await ask(question))?.trim() ?? null;
        while (answer !== null && answer !== 'yes' && answer !== 'no');
        signal?.throwIfAborted();
        if (answer === 'yes') replace = existing;
      }
      await checkBuildTarget(output!, a.tempDir === null ? undefined : at(a.tempDir), replace);
    }
    let expected: ExpectedReport | null = null;
    if (expectPath !== null) {
      expected = await readExpectedReport(expectPath);
      state.expect = { path: expectPath, differences: [] };
    }
    const differ = (differences: string[]) => {
      if (differences.length === 0) return;
      state.expect!.differences.push(...differences);
      throw inputChanged(differences);
    };

    phase('read');
    for (const [i, file] of files.entries()) state.files[i] = await readInput(file, { calibration: cal, tools, signal });
    const inputs = state.files as [InputFile, InputFile];
    if (expected) differ(compareFingerprints(expected, inputs));

    const analysis = await analyzePair(inputs, originalLanguage, cal, { tools, choices: state.choices, signal, onProgress: onMeasure });
    state.analysis = analysis;
    state.plan = analysis.plan;
    const d = analysis.report;
    if (d.decision !== 'eligible') {
      decision = d.decision;
      reasons = d.reasons;
      errorCode = d.decision === 'error' ? (d.reasons[0]?.code as ErrorCode) : undefined;
    } else if (a.mode === 'merge') {
      const roles = d.roles!;
      const reference = inputs[roles.reference];
      const donor = inputs[roles.donor];
      const offsetMs = d.offset!.offsetMs;
      if (expected) differ(compareRolesAndOffset(expected, inputs, roles, offsetMs));

      // Le scelte in sospeso: in un terminale si chiedono, una alla volta,
      // ricalcolando il piano dopo ogni risposta (§10).
      let plan = analysis.plan!;
      const given: GivenChoices = { ...state.choices };
      while (ask) {
        const name = PROMPT_ORDER.find((n) => plan.pending.includes(n));
        if (name === undefined) break;
        const choice = plan.choices.find((c) => c.name === name)!;
        const values: readonly string[] = CHOICES[name].values;
        const question = [
          `A choice is needed: ${CHOICES[name].option} (${CHOICE_TITLES[name]})`,
          ...choice.effects.map((e) => `  ${e.value}: ${describeEffect(e)}`),
          `Choose ${values.join(' or ')}: `,
        ].join('\n');
        let answer: string | null;
        do {
          answer = await ask(question);
          signal?.throwIfAborted();
          answer = answer?.trim() ?? null;
        } while (answer !== null && !values.includes(answer));
        if (answer === null) break;
        (given as Record<string, unknown>)[name] = { value: answer, origin: 'prompt' };
        plan = await planPair(reference, donor, offsetMs, analysis.measurement!.boundaries!, given, cal, { tools, signal });
        state.plan = plan;
      }
      assertNoPendingChoices(plan.choices);
      if (expected) differ(comparePlan(expected, plan));

      const build = await buildMerge(
        {
          reference,
          donor,
          plan,
          output: output!,
          ...(a.tempDir === null ? {} : { tempDir: at(a.tempDir) }),
          ...(replace ? { replace } : {}),
        },
        { tools, signal, onProgress: onBuild, ...(io.freeSpace ? { freeSpace: io.freeSpace } : {}) },
      );
      state.build = build;
      phase('verify');
      try {
        state.verification = await verifyBuild(
          { reference, plan, measureTrackId: analysis.measurement!.pair.referenceTrackId },
          build,
          cal,
          { tools, signal },
        );
      } catch (e) {
        if (e instanceof VerifyFailedError) state.verification = e.verification;
        throw e;
      }
      if (signal?.aborted) {
        await discardBuild(build);
        signal.throwIfAborted();
      }
      await commitBuild(build);
      state.delivered = true;
      state.sizeBytes = (await stat(build.output)).size;

      // Gli ingressi dopo la consegna (§10.2): si cancellano solo con un consenso esplicito.
      let choice: Pick<ReportInputs, 'value' | 'origin'> | null = inputsChoice;
      if (choice === null && ask) {
        const values: readonly string[] = INPUTS_OPTION.values;
        const question = [
          `The merge is complete: ${build.output}`,
          `Delete the two inputs (${INPUTS_OPTION.option})?`,
          ...inputs.map((f) => `  ${f.path}`),
          `Choose ${values.join(' or ')}: `,
        ].join('\n');
        let answer: string | null;
        do answer = (await ask(question))?.trim() ?? null;
        while (answer !== null && !signal?.aborted && !values.includes(answer));
        if (answer !== null && !signal?.aborted) choice = { value: answer as InputsValue, origin: 'prompt' };
      }
      choice ??= { value: 'keep', origin: 'default' };
      const deleted: string[] = [];
      if (choice.value === 'delete' && !signal?.aborted) {
        for (const f of inputs) {
          const notDeleted = (why: string) =>
            state.inputWarnings.push({ code: 'INPUT_NOT_DELETED', message: `${f.path}: not deleted: ${why}` });
          try {
            const st = await stat(f.path);
            if (st.size !== f.fingerprint.size || st.mtime.toISOString() !== f.fingerprint.modifiedAt) {
              notDeleted('it changed since it was read');
              continue;
            }
            await rm(f.path);
            deleted.push(f.path);
          } catch (e) {
            notDeleted((e as NodeJS.ErrnoException).code ?? String(e));
          }
        }
      }
      state.inputs = { ...choice, deleted };
    }
  } catch (e) {
    if (io.signal?.aborted) {
      decision = 'cancelled';
      const why = io.signal.reason instanceof Error ? io.signal.reason.message : 'stopped by a signal';
      reasons = [{ code: 'CANCELLED', message: `cancelled: ${why}` }];
      errorCode = undefined;
    } else {
      decision = 'error';
      errorCode = e instanceof DyadrrError ? e.code : 'INTERNAL';
      const message = e instanceof Error ? e.message : String(e);
      reasons = [{ code: errorCode, message: e instanceof DyadrrError ? message : `unexpected error: ${message}` }];
    }
  }

  const exitCode = decision === 'cancelled' ? exitCodeFor('cancelled') : exitCodeFor(decision, errorCode);
  // Un annullamento o un errore non cancellano il report di un'esecuzione
  // finita con lo stesso nome: il loro va accanto (§10).
  const written = await reportDestination(reportPath, decision, startedAt);
  if (written !== reportPath && !progressJson) {
    io.stderr(`dyadrr: the report ${reportPath} is of a finished run and is not overwritten: this report is ${written}\n`);
  }
  const report = assemble({ args, mode, files: fallback.files, reportPath: written, startedAt, state, decision, reasons, at });
  try {
    await writeReport(written, report);
  } catch (e) {
    io.stderr(`dyadrr: INTERNAL: the report ${written} cannot be written (${(e as NodeJS.ErrnoException).code ?? String(e)})\n`);
    return exitCodeFor('error', 'INTERNAL');
  }
  io.stdout(`${written}\n`);
  if (progressJson) emit({ event: 'end', decision, exitCode });
  else io.stderr(`dyadrr: ${decision}${reasons[0] ? `: ${reasons[0].code}: ${reasons[0].message}` : ''}\n`);
  return exitCode;
}

/** Un esito senza analisi: un errore con il suo codice, o un annullamento. */
export type Outcome =
  | { decision: 'error'; code: ErrorCode; message: string }
  | { decision: 'cancelled'; message: string };

/**
 * Il report di un lavoro che la riga di comando non ha scritto (runner, studio
 * §14.1): un job sbagliato o annullato prima di cominciare, o Dyadrr finito
 * senza report. Solo l'esito, con il comando e i file se si conoscono; il
 * resto è `null`. Restituisce il codice di uscita.
 */
export async function writeOutcomeReport(
  reportPath: string,
  job: { mode: Mode | null; files: string[]; startedAt: Date },
  outcome: Outcome,
): Promise<number> {
  const code = outcome.decision === 'error' ? outcome.code : 'CANCELLED';
  await writeReport(reportPath, assemble({
    args: null,
    mode: job.mode,
    files: job.files,
    reportPath,
    startedAt: job.startedAt,
    state: emptyState(),
    decision: outcome.decision,
    reasons: [{ code, message: outcome.message }],
    at: (p) => p,
  }));
  return outcome.decision === 'error' ? exitCodeFor('error', outcome.code) : exitCodeFor('cancelled');
}

function assemble(x: {
  args: Arguments | null;
  mode: Mode | null;
  /** I file, se gli argomenti non si leggono. */
  files: string[];
  reportPath: string;
  startedAt: Date;
  state: State;
  decision: Decision;
  reasons: ReportReason[];
  at: (p: string) => string;
}): Report {
  const { args, state } = x;
  const finishedAt = new Date();
  const argumentsSection: ReportArguments = {
    files: args?.files ?? x.files,
    output: args?.output == null ? null : x.at(args.output),
    report: x.reportPath,
    originalLanguage: args?.originalLanguage ?? null,
    tempDir: args?.tempDir == null ? null : x.at(args.tempDir),
    expect: args?.expect == null ? null : x.at(args.expect),
    progress: args?.progress ?? null,
    choices: state.choices,
  };
  const sections = state.analysis ? analysisSections(state.analysis) : { roles: null, measurement: null, checks: [] };
  const warnings: ReportWarning[] = [
    ...(state.analysis?.report.warnings ?? []).map((w) => ({ ...w, source: 'analysis' as const })),
    ...(state.plan?.warnings ?? []).map((w) => ({ ...w, source: 'plan' as const })),
    ...(state.build?.warnings ?? []).map((w) => ({ ...w, source: 'build' as const })),
    ...(state.verification?.warnings ?? []).map((w) => ({ ...w, source: 'verify' as const })),
    ...state.inputWarnings.map((w) => ({ ...w, source: 'inputs' as const })),
  ];
  const output = state.build
    ? {
      path: state.build.output,
      delivered: state.delivered,
      sizeBytes: state.sizeBytes,
      durationMs: state.verification?.duration?.declaredMs ?? state.verification?.duration?.endMs ?? null,
      build: state.build,
      verification: state.verification,
      inputs: state.inputs,
    }
    : null;
  return {
    format: REPORT_FORMAT,
    dyadrr: dyadrrVersion(),
    mode: x.mode,
    startedAt: x.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - x.startedAt.getTime(),
    tools: state.tools,
    arguments: argumentsSection,
    calibration: state.calibration,
    decision: x.decision,
    reasons: x.reasons,
    inputs: state.files,
    ...sections,
    choices: state.plan?.choices ?? null,
    plan: state.plan && planSection(state.plan),
    expect: state.expect && {
      path: state.expect.path,
      result: state.expect.differences.length === 0 ? 'pass' : 'fail',
      differences: state.expect.differences,
    },
    output,
    warnings,
  };
}
