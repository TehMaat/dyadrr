import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { loadCalibration, type Calibration, type CalibrationName } from './calibration.js';
import { writeOutcomeReport } from './cli.js';
import { DyadrrError, EXIT_CODES, exitCodeFor, type Decision } from './codes.js';
import { isConfident, type AnchorOutcome, type ContradictionShape, type Match } from './decision.js';
import { parseOriginalLanguage } from './languages.js';
import type { TrackPair } from './measure.js';
import { REPORT_FORMAT, dyadrrVersion, type Report } from './report.js';
import { JOB_ID } from './runner.js';
import type { ToolVersions } from './tools.js';

// Le coppie reali della fase 1 (studio §15, punto 3): `dyadrr-pairs` lancia
// `dyadrr analyze` su un elenco di coppie, una alla volta e ognuna nel suo
// processo, e ne riassume i report per la taratura (decisione 12). Nella
// cartella dei risultati `<id>.json` (il report) e `<id>.log` (lo stderr di
// Dyadrr) per ogni coppia, `summary.json` e `summary.md` per la serie. Il
// processo (segnali, argomenti) sta in `pairs-bin.ts`.

/** Le categorie di una coppia: le sette del punto 3, tre del punto 2 e `other` (§15). */
export const PAIR_CATEGORIES = {
  'uhd-bd': 'UHD Atmos against an old 5.1 BD',
  'long-silences': 'film with long silences',
  'disney-pixar': 'a Disney or Pixar film',
  'distributor-logos': 'different distributor logos',
  'dubbing-card': 'dubbing card at the end of the film',
  'non-english': 'a film not in English',
  'two-discs': 'a film on two discs',
  'different-cut': 'theatrical against extended',
  'different-speed': 'different framerate or speed',
  'different-film': 'two different films',
  other: 'other',
} as const;
export type PairCategory = keyof typeof PAIR_CATEGORIES;

/** Le categorie che il criterio di uscita della fase 1 chiede di coprire (§15, punto 3). */
export const PHASE1_CATEGORIES: readonly PairCategory[] = [
  'uhd-bd',
  'long-silences',
  'disney-pixar',
  'distributor-logos',
  'dubbing-card',
  'non-english',
  'two-discs',
];

/** Il criterio di uscita della fase 1 (§15): coppie minime, salti "di 1–2 fotogrammi". */
export const PHASE1 = { minPairs: 15, smallJumpFrames: 2 } as const;

/** Le chiavi di una coppia nell'elenco. */
export const PAIR_KEYS = ['input', 'expected', 'original-language', 'category', 'offset-ms', 'cause', 'note'] as const;

/** I verdetti di una coppia (§15). */
export const VERDICTS = ['ok', 'good-refused', 'wrong-merge', 'error', 'cancelled', 'missing'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** I campi di `summary.json`, nell'ordine in cui si scrivono. */
export const SUMMARY_FIELDS = [
  'dyadrr',
  'writtenAt',
  'list',
  'results',
  'versions',
  'criterion',
  'thresholds',
  'verdicts',
  'pairs',
] as const;

// ---------------------------------------------------------------- elenco

export interface PairSpec {
  id: string;
  /** I percorsi come nell'elenco. */
  inputs: [string, string];
  /** `eligible`: lo stesso film nella stessa versione; `refused`: una coppia da rifiutare. */
  expected: 'eligible' | 'refused';
  originalLanguage: string | null;
  categories: PairCategory[];
  /** S controllato a mano. */
  offsetMs: number | null;
  /** Per una coppia buona rifiutata, la causa trovata guardandola. */
  cause: string | null;
  note: string | null;
}

const badList = (message: string) => new DyadrrError('BAD_ARGUMENTS', `pair list: ${message}`);

/**
 * Legge l'elenco delle coppie (§15): sezioni `[<id>]` con righe
 * `chiave=valore` come nel job, righe vuote e commenti `#`. Ogni problema è
 * `BAD_ARGUMENTS`, e si controlla tutto prima di misurare.
 */
export function parsePairList(text: string): PairSpec[] {
  const sections: Array<{ id: string; line: number; values: Map<string, string[]> }> = [];
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '' || line.startsWith('#')) return;
    const header = /^\[(.*)\]$/.exec(line);
    if (header) {
      const id = header[1]!;
      if (!JOB_ID.test(id)) throw badList(`line ${n}: "${id}" is not a valid id (1 to 64 letters, digits, - and _)`);
      if (sections.some((s) => s.id === id)) throw badList(`line ${n}: the id "${id}" is used twice`);
      sections.push({ id, line: n, values: new Map() });
      return;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) throw badList(`line ${n} is not [id], key=value or a # comment`);
    const section = sections.at(-1);
    if (!section) throw badList(`line ${n}: a key before the first [id]`);
    const key = line.slice(0, eq);
    if (!(PAIR_KEYS as readonly string[]).includes(key)) throw badList(`line ${n}: unknown key "${key}"`);
    const values = section.values.get(key) ?? [];
    if (values.length > 0 && key !== 'input' && key !== 'category') {
      throw badList(`line ${n}: "${key}" is given more than once in [${section.id}]`);
    }
    values.push(line.slice(eq + 1));
    section.values.set(key, values);
  });
  if (sections.length === 0) throw badList('no pairs: each pair starts with [id]');

  return sections.map(({ id, values }): PairSpec => {
    const bad = (message: string) => badList(`[${id}]: ${message}`);
    const one = (key: string) => values.get(key)?.[0] ?? null;
    const inputs = values.get('input') ?? [];
    if (inputs.length !== 2) throw bad(`expected two input lines, found ${inputs.length}`);
    if (inputs.some((p) => p === '')) throw bad('an input is empty');
    const expected = one('expected');
    if (expected === null) throw bad('expected is missing: eligible or refused');
    if (expected !== 'eligible' && expected !== 'refused') throw bad(`expected "${expected}": eligible or refused`);
    const categories = [...new Set(values.get('category') ?? [])];
    for (const c of categories) {
      if (!(c in PAIR_CATEGORIES)) throw bad(`unknown category "${c}" (${Object.keys(PAIR_CATEGORIES).join(', ')})`);
    }
    const offset = one('offset-ms');
    if (offset !== null && !/^-?\d+(\.\d+)?$/.test(offset)) throw bad(`offset-ms "${offset}" is not a number of ms`);
    const originalLanguage = one('original-language');
    if (originalLanguage !== null) {
      try {
        parseOriginalLanguage(originalLanguage);
      } catch (e) {
        throw bad((e as Error).message);
      }
    }
    return {
      id,
      inputs: [inputs[0]!, inputs[1]!],
      expected,
      originalLanguage,
      categories: categories as PairCategory[],
      offsetMs: offset === null ? null : Number(offset),
      cause: one('cause'),
      note: one('note'),
    };
  });
}

/** Gli argomenti di `dyadrr analyze` per una coppia, con i percorsi assoluti. */
export function pairArguments(spec: PairSpec, cwd: string, reportPath: string): string[] {
  return [
    'analyze',
    ...spec.inputs.map((p) => resolve(cwd, p)),
    ...(spec.originalLanguage === null ? [] : [`--original-language=${spec.originalLanguage}`]),
    `--report=${reportPath}`,
    '--progress=json',
  ];
}

/** La cartella dei risultati per default: `<nome dell'elenco senza estensione>-results`, accanto all'elenco. */
export function defaultResults(listPath: string): string {
  return join(dirname(listPath), `${basename(listPath, extname(listPath))}-results`);
}

/**
 * Un report che c'è già si riusa (§15) se ha la stessa versione del formato,
 * di Dyadrr e della taratura, gli stessi ingressi e la stessa lingua
 * originale, e una decisione `eligible` o `refused`.
 */
export function reusable(
  report: Report | null,
  spec: PairSpec,
  cwd: string,
  current: { dyadrr: string; calibration: number },
): boolean {
  if (report === null || report.format !== REPORT_FORMAT || report.mode !== 'analyze') return false;
  if (report.decision !== 'eligible' && report.decision !== 'refused') return false;
  if (report.dyadrr !== current.dyadrr || report.calibration?.version !== current.calibration) return false;
  const files = report.arguments?.files ?? [];
  const inputs = spec.inputs.map((p) => resolve(cwd, p));
  return files.length === 2 && files.every((f, i) => f === inputs[i])
    && (report.arguments.originalLanguage ?? null) === spec.originalLanguage;
}

// ---------------------------------------------------------------- riassunto di una coppia

/** Un gruppo di picchi: quanti, e il minimo (sicuri a S) o il massimo (gli altri) di NCC e rapporto. */
export interface PeakGroup {
  count: number;
  ncc: number | null;
  ratio: number | null;
}

/** I margini di una coppia rispetto alle soglie provvisorie (§15). */
export interface PairMargins {
  /** Picchi dei punti con energia almeno E_min. */
  secureAtS: PeakGroup & { energyDbfs: number | null };
  unsureAtS: PeakGroup;
  secureElsewhere: PeakGroup;
  unsureElsewhere: PeakGroup;
  /** Punti sotto E_min, e quanti avevano comunque un picco sicuro a S. */
  silent: { count: number; secureAtS: number };
  /** Differenza più grande nel controllo di integrità dei due ingressi. */
  integrityGapMs: number | null;
  /** Dal piano: buchi senza italiano e livello dopo il taglio iniziale. */
  startGapMs: number | null;
  endGapMs: number | null;
  cutLevelDbfs: number | null;
}

export interface PairSummary {
  id: string;
  categories: PairCategory[];
  expected: PairSpec['expected'];
  manualOffsetMs: number | null;
  cause: string | null;
  note: string | null;
  /** Il report, nella cartella dei risultati; `null` senza report. */
  report: string | null;
  /** Il report c'era già ed è stato riusato. */
  reused: boolean;
  verdict: Verdict;
  detail: string | null;
  decision: Decision | null;
  code: string | null;
  message: string | null;
  dyadrr: string | null;
  tools: ToolVersions | null;
  calibration: number | null;
  durationMs: number | null;
  /** Byte letti dai due file. */
  bytesRead: number | null;
  measureLanguage: string | null;
  pair: TrackPair | null;
  offset: { anchorMs: number; offsetMs: number; dispersionMs: number; manualDifferenceMs: number | null } | null;
  anchors: Array<{ positionMs: number; offsetMs: number; ncc: number; ratio: number; outcome: AnchorOutcome }>;
  checkpoints: { total: number; added: number; consistent: number; inconclusive: number; contradictory: number; unmatched: number } | null;
  drift: { msPerHour: number; totalMs: number; spanMs: number } | null;
  contradiction: ContradictionShape | null;
  coverage: number | null;
  transfer: { offsetMs: number | null; confident: number; probes: number } | null;
  warnings: string[];
  margins: PairMargins | null;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round1 = (x: number) => Math.round(x * 10) / 10;
const minOf = (xs: readonly number[]) => (xs.length > 0 ? Math.min(...xs) : null);
const maxOf = (xs: readonly number[]) => (xs.length > 0 ? Math.max(...xs) : null);

function verdictOf(spec: PairSpec, report: Report | null, tolerance: number | null): { verdict: Verdict; detail: string | null } {
  if (report === null) return { verdict: 'missing', detail: null };
  switch (report.decision) {
    case 'cancelled':
      return { verdict: 'cancelled', detail: null };
    case 'error':
      return { verdict: 'error', detail: report.reasons[0]?.code ?? null };
    case 'refused':
      return spec.expected === 'refused'
        ? { verdict: 'ok', detail: null }
        : { verdict: 'good-refused', detail: spec.cause === null ? 'no cause given' : null };
    case 'eligible': {
      if (spec.expected === 'refused') return { verdict: 'wrong-merge', detail: 'eligible, but expected refused' };
      const offset = report.measurement?.offset?.offsetMs;
      if (spec.offsetMs !== null && offset != null && tolerance !== null && Math.abs(offset - spec.offsetMs) > tolerance) {
        return { verdict: 'wrong-merge', detail: `S = ${offset} ms, ${spec.offsetMs} ms by hand` };
      }
      return { verdict: 'ok', detail: null };
    }
  }
}

function group(peaks: readonly Match[], pick: (xs: readonly number[]) => number | null): PeakGroup {
  const ncc = pick(peaks.map((p) => p.ncc));
  const ratio = pick(peaks.map((p) => p.ratio));
  return { count: peaks.length, ncc: ncc === null ? null : round3(ncc), ratio: ratio === null ? null : round3(ratio) };
}

/** I margini dai picchi misurati, dall'integrità degli ingressi e dal piano. */
function marginsOf(report: Report, cal: Calibration): PairMargins | null {
  const m = report.measurement;
  const anchorMs = m?.anchors.find((a) => a.outcome === 'accepted')?.offsetMs ?? null;
  const gaps = report.inputs.flatMap((f) => {
    if (!f) return [];
    const i = f.integrity;
    const tracks = i.tracks.flatMap((t) => (t.endMs !== null && t.expectedEndMs !== null ? [Math.abs(t.endMs - t.expectedEndMs)] : []));
    const declared = i.declaredDurationMs !== null && i.lastTimestampMs !== null
      ? [Math.min(Math.abs(i.lastTimestampMs - i.declaredDurationMs), Math.abs(i.lastTimestampMs - (f.startTimeMs ?? 0) - i.declaredDurationMs))]
      : [];
    return [...tracks, ...declared];
  });
  const integrityGapMs = maxOf(gaps);
  if (!m && integrityGapMs === null) return null;

  const secureAtS: Array<Match & { energyDbfs: number }> = [];
  const unsureAtS: Match[] = [];
  const secureElsewhere: Match[] = [];
  const unsureElsewhere: Match[] = [];
  const silent = { count: 0, secureAtS: 0 };
  const atS = (p: Match) => anchorMs !== null && Math.abs(p.offsetMs - anchorMs) <= cal.values.toleranceMs;
  for (const c of m?.checkpoints ?? []) {
    const peaks = [c.local, c.wide].filter((p): p is Match => p != null);
    if (c.energyDbfs === null || c.energyDbfs < cal.values.silenceDbfs) {
      silent.count++;
      if (peaks.some((p) => isConfident(p, cal) && atS(p))) silent.secureAtS++;
      continue;
    }
    for (const p of peaks) {
      if (isConfident(p, cal)) (atS(p) ? secureAtS.push({ ...p, energyDbfs: c.energyDbfs }) : secureElsewhere.push(p));
      else (atS(p) ? unsureAtS : unsureElsewhere).push(p);
    }
  }
  const energy = minOf(secureAtS.map((p) => p.energyDbfs));
  const plan = report.plan;
  return {
    secureAtS: { ...group(secureAtS, minOf), energyDbfs: energy === null ? null : round1(energy) },
    unsureAtS: group(unsureAtS, maxOf),
    secureElsewhere: group(secureElsewhere, maxOf),
    unsureElsewhere: group(unsureElsewhere, maxOf),
    silent,
    integrityGapMs: integrityGapMs === null ? null : round1(integrityGapMs),
    startGapMs: plan?.start.gapMs ?? null,
    endGapMs: plan?.end.gapMs ?? null,
    cutLevelDbfs: plan?.start.cutLevelDbfs ?? null,
  };
}

/** Il riassunto di una coppia dal suo report (§15); `report` è `null` se manca. */
export function summarizePair(spec: PairSpec, report: Report | null, file: string | null, reused: boolean): PairSummary {
  const cal = report?.calibration ?? null;
  const m = report?.measurement ?? null;
  const offset = m?.offset ?? null;
  const count = (o: string) => m?.checkpoints.filter((c) => c.outcome === o).length ?? 0;
  return {
    id: spec.id,
    categories: spec.categories,
    expected: spec.expected,
    manualOffsetMs: spec.offsetMs,
    cause: spec.cause,
    note: spec.note,
    report: report === null ? null : file,
    reused: report !== null && reused,
    ...verdictOf(spec, report, cal?.values.toleranceMs ?? null),
    decision: report?.decision ?? null,
    code: report?.reasons[0]?.code ?? null,
    message: report?.reasons[0]?.message ?? null,
    dyadrr: report?.dyadrr ?? null,
    tools: report?.tools ?? null,
    calibration: cal?.version ?? null,
    durationMs: report?.durationMs ?? null,
    bytesRead: m ? m.bytesRead.reference + m.bytesRead.donor : null,
    measureLanguage: m?.language ?? null,
    pair: m?.pair ?? null,
    offset: offset && {
      anchorMs: offset.anchorMs,
      offsetMs: offset.offsetMs,
      dispersionMs: offset.dispersionMs,
      manualDifferenceMs: spec.offsetMs === null ? null : round1(offset.offsetMs - spec.offsetMs),
    },
    anchors: (m?.anchors ?? []).map((a) => ({
      positionMs: a.positionMs,
      offsetMs: a.offsetMs,
      ncc: round3(a.ncc),
      ratio: round3(a.ratio),
      outcome: a.outcome,
    })),
    checkpoints: m && {
      total: m.checkpoints.length,
      added: m.checkpoints.filter((c) => c.added).length,
      consistent: count('consistent'),
      inconclusive: count('inconclusive'),
      contradictory: count('contradictory'),
      unmatched: count('unmatched'),
    },
    drift: m?.drift ?? null,
    contradiction: m?.contradiction ?? null,
    coverage: m?.commonMaterial?.coverage ?? null,
    transfer: m?.transfer ? { offsetMs: m.transfer.offsetMs, confident: m.transfer.confident, probes: m.transfer.probes.length } : null,
    warnings: (report?.warnings ?? []).map((w) => w.code),
    margins: report && cal ? marginsOf(report, cal) : null,
  };
}

// ---------------------------------------------------------------- riassunto della serie

/** Un margine della serie, con la coppia che lo dà. */
export interface SeriesMargin {
  value: number;
  pair: string;
}

export interface Threshold {
  /** Il valore nella taratura versionata. */
  value: number;
  provisional: boolean;
  margins: Record<string, SeriesMargin | null>;
}

export interface Summary {
  dyadrr: string;
  writtenAt: string;
  list: string;
  results: string;
  /** Le versioni delle coppie con un report; `mixed` se non sono tutte uguali. */
  versions: { dyadrr: string[]; calibration: number[]; tools: ToolVersions[]; mixed: boolean };
  criterion: {
    measured: { value: number; required: number };
    categories: { covered: Partial<Record<PairCategory, number>>; missing: PairCategory[] };
    wrongMerges: string[];
    goodRefused: { withCause: string[]; withoutCause: string[] };
    /** Coppie `uhd-bd` buone con un report, e quante sono rifiutate per salti di 1–2 fotogrammi. */
    uhdBdSmallJumps: { pairs: number; refused: number; fraction: number | null };
    met: boolean;
  };
  thresholds: Partial<Record<CalibrationName, Threshold>>;
  verdicts: Record<Verdict, number>;
  pairs: PairSummary[];
}

/** La coppia con il valore più basso (`min`) o più alto di un margine. */
function extreme(pairs: readonly PairSummary[], get: (p: PairSummary) => number | null | undefined, way: 'min' | 'max'): SeriesMargin | null {
  let best: SeriesMargin | null = null;
  for (const p of pairs) {
    const value = get(p);
    if (value == null) continue;
    if (best === null || (way === 'min' ? value < best.value : value > best.value)) best = { value, pair: p.id };
  }
  return best;
}

/** Salti tutti di al più 2 fotogrammi, arrotondati (§15, criterio di uscita). */
const smallJumps = (p: PairSummary) =>
  p.code === 'CHECKPOINT_CONTRADICTION' && p.contradiction !== null && p.contradiction.kind !== 'noise'
  && p.contradiction.jumps.length > 0
  && p.contradiction.jumps.every((j) => Math.round(Math.abs(j.frames)) <= PHASE1.smallJumpFrames);

/** Il riassunto della serie (§15): criterio di uscita della fase 1, margini delle soglie, verdetti. */
export function summarizeSeries(
  pairs: PairSummary[],
  x: { list: string; results: string; calibration: Calibration; at?: Date },
): Summary {
  const measured = pairs.filter((p) => p.decision === 'eligible' || p.decision === 'refused');
  const good = pairs.filter((p) => p.expected === 'eligible');
  const covered: Partial<Record<PairCategory, number>> = {};
  for (const p of measured) for (const c of p.categories) covered[c] = (covered[c] ?? 0) + 1;
  const missing = PHASE1_CATEGORIES.filter((c) => covered[c] === undefined);
  const wrongMerges = pairs.filter((p) => p.verdict === 'wrong-merge').map((p) => p.id);
  const goodRefused = pairs.filter((p) => p.verdict === 'good-refused');
  const uhdBd = measured.filter((p) => p.expected === 'eligible' && p.categories.includes('uhd-bd'));
  const uhdBdRefused = uhdBd.filter(smallJumps).length;
  const withoutCause = goodRefused.filter((p) => p.cause === null).map((p) => p.id);

  const v = x.calibration.values;
  const threshold = (name: CalibrationName, margins: Threshold['margins']): Threshold => ({
    value: v[name],
    provisional: x.calibration.provisional.includes(name),
    margins,
  });
  const distinct = <T>(values: T[]) => [...new Map(values.map((t) => [JSON.stringify(t), t])).values()];
  const versions = {
    dyadrr: distinct(measured.flatMap((p) => (p.dyadrr === null ? [] : [p.dyadrr]))),
    calibration: distinct(measured.flatMap((p) => (p.calibration === null ? [] : [p.calibration]))),
    tools: distinct(measured.flatMap((p) => (p.tools === null ? [] : [p.tools]))),
  };
  const verdicts = Object.fromEntries(VERDICTS.map((k) => [k, pairs.filter((p) => p.verdict === k).length])) as Record<Verdict, number>;

  return {
    dyadrr: dyadrrVersion(),
    writtenAt: (x.at ?? new Date()).toISOString(),
    list: x.list,
    results: x.results,
    versions: { ...versions, mixed: Object.values(versions).some((list) => list.length > 1) },
    criterion: {
      measured: { value: measured.length, required: PHASE1.minPairs },
      categories: { covered, missing },
      wrongMerges,
      goodRefused: { withCause: goodRefused.filter((p) => p.cause !== null).map((p) => p.id), withoutCause },
      uhdBdSmallJumps: {
        pairs: uhdBd.length,
        refused: uhdBdRefused,
        fraction: uhdBd.length === 0 ? null : round3(uhdBdRefused / uhdBd.length),
      },
      met: measured.length >= PHASE1.minPairs && missing.length === 0 && wrongMerges.length === 0
        && withoutCause.length === 0 && uhdBd.length > 0,
    },
    thresholds: {
      nccMin: threshold('nccMin', {
        secureAtSMin: extreme(good, (p) => p.margins?.secureAtS.ncc, 'min'),
        unsureAtSMax: extreme(good, (p) => p.margins?.unsureAtS.ncc, 'max'),
        unsureElsewhereMax: extreme(pairs, (p) => p.margins?.unsureElsewhere.ncc, 'max'),
      }),
      peakRatioMin: threshold('peakRatioMin', {
        secureAtSMin: extreme(good, (p) => p.margins?.secureAtS.ratio, 'min'),
        unsureAtSMax: extreme(good, (p) => p.margins?.unsureAtS.ratio, 'max'),
        unsureElsewhereMax: extreme(pairs, (p) => p.margins?.unsureElsewhere.ratio, 'max'),
      }),
      silenceDbfs: threshold('silenceDbfs', {
        secureAtSEnergyMin: extreme(pairs, (p) => p.margins?.secureAtS.energyDbfs, 'min'),
      }),
      integrityToleranceMs: threshold('integrityToleranceMs', {
        gapMax: extreme(pairs, (p) => p.margins?.integrityGapMs, 'max'),
      }),
      longGapWithoutItalianMs: threshold('longGapWithoutItalianMs', {
        gapMax: extreme(pairs, (p) => maxOf([p.margins?.startGapMs, p.margins?.endGapMs].filter((g): g is number => g != null)), 'max'),
      }),
      abruptStartDbfs: threshold('abruptStartDbfs', {
        cutLevelMax: extreme(pairs, (p) => p.margins?.cutLevelDbfs, 'max'),
      }),
    },
    verdicts,
    pairs,
  };
}

// ---------------------------------------------------------------- summary.md

const cell = (text: string | number | null | undefined) =>
  text === null || text === undefined || text === '' ? '—' : String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const yes = (ok: boolean) => (ok ? 'yes' : 'no');
const margin = (m: SeriesMargin | null | undefined) => (m ? `${m.value} (${m.pair})` : '—');

/** `summary.md`: il riassunto da leggere e da portare nella PR della decisione 12. Nomina le coppie solo con l'id. */
export function summaryMarkdown(s: Summary): string {
  const c = s.criterion;
  const tools = s.versions.tools.map((t) => `mkvmerge ${t.mkvmerge}, ffmpeg ${t.ffmpeg}`).join('; ') || '—';
  const lines = [
    '# Dyadrr pairs',
    '',
    `Written by dyadrr-pairs ${s.dyadrr} on ${s.writtenAt}. Reports: Dyadrr ${s.versions.dyadrr.join(', ') || '—'}, `
      + `calibration ${s.versions.calibration.join(', ') || '—'}, ${tools}.`,
    ...(s.versions.mixed ? ['', '**Warning:** the pairs were not all measured with the same versions.'] : []),
    '',
    '## Phase 1 exit criterion',
    '',
    '| Criterion | Value | Required | Met |',
    '|---|---|---|---|',
    `| Pairs measured | ${c.measured.value} | at least ${c.measured.required} | ${yes(c.measured.value >= c.measured.required)} |`,
    `| Categories of point 3 | ${PHASE1_CATEGORIES.length - c.categories.missing.length} of ${PHASE1_CATEGORIES.length}`
      + `${c.categories.missing.length > 0 ? ` (missing: ${c.categories.missing.join(', ')})` : ''} | all | ${yes(c.categories.missing.length === 0)} |`,
    `| Wrong merges | ${c.wrongMerges.length}${c.wrongMerges.length > 0 ? ` (${c.wrongMerges.join(', ')})` : ''} | 0 | ${yes(c.wrongMerges.length === 0)} |`,
    `| Good pairs refused without a cause | ${c.goodRefused.withoutCause.length}`
      + `${c.goodRefused.withoutCause.length > 0 ? ` (${c.goodRefused.withoutCause.join(', ')})` : ''} | 0 | ${yes(c.goodRefused.withoutCause.length === 0)} |`,
    `| Good uhd-bd pairs refused for jumps of 1–2 frames | ${c.uhdBdSmallJumps.refused} of ${c.uhdBdSmallJumps.pairs}`
      + `${c.uhdBdSmallJumps.fraction === null ? '' : ` (${Math.round(c.uhdBdSmallJumps.fraction * 100)}%)`} | measured | ${yes(c.uhdBdSmallJumps.pairs > 0)} |`,
    '',
    `Criterion met: **${yes(c.met)}**.`,
    '',
    '## Pairs',
    '',
    '| Pair | Categories | Expected | Decision | Verdict | S (ms) | Dispersion (ms) | Anchors (secure) | Checkpoints c/i/x/u | Coverage | Lowest secure NCC / ratio | Warnings |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...s.pairs.map((p) => {
      const k = p.checkpoints;
      const secure = p.anchors.filter((a) => a.outcome === 'accepted' || a.outcome === 'agrees' || a.outcome === 'disagrees').length;
      const m = p.margins?.secureAtS;
      return `| ${cell(p.id)} | ${cell(p.categories.join(', '))} | ${p.expected} | ${cell(p.decision === null ? null : `${p.decision}${p.code ? ` ${p.code}` : ''}`)} `
        + `| ${p.verdict}${p.detail ? ` (${cell(p.detail)})` : ''} | ${cell(p.offset?.offsetMs)} | ${cell(p.offset?.dispersionMs)} `
        + `| ${p.anchors.length === 0 ? '—' : `${secure} of ${p.anchors.length}`} `
        + `| ${k ? `${k.consistent}/${k.inconclusive}/${k.contradictory}/${k.unmatched}` : '—'} | ${cell(p.coverage === null ? null : round3(p.coverage))} `
        + `| ${m && m.count > 0 ? `${m.ncc} / ${m.ratio}` : '—'} | ${cell([...new Set(p.warnings)].join(', '))} |`;
    }),
    '',
    '## Thresholds',
    '',
    '| Parameter | Value | Provisional | Margins |',
    '|---|---|---|---|',
    ...Object.entries(s.thresholds).map(([name, t]) => {
      const margins = Object.entries(t.margins).map(([k, m]) => `${k} ${margin(m)}`).join('; ');
      return `| \`${name}\` | ${t.value} | ${yes(t.provisional)} | ${margins} |`;
    }),
    '',
    '## Refusals and errors',
    '',
    '| Pair | Verdict | Code | Message | Cause |',
    '|---|---|---|---|---|',
    ...s.pairs
      .filter((p) => p.decision === 'refused' || p.decision === 'error')
      .map((p) => `| ${cell(p.id)} | ${p.verdict} | ${cell(p.code)} | ${cell(p.message)} | ${cell(p.cause)} |`),
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------- la serie

export interface PairsOptions {
  /** L'elenco delle coppie. */
  list: string;
  /** La cartella dei risultati; per default accanto all'elenco (`defaultResults`). */
  results?: string;
  /** Solo queste coppie; le altre entrano nel riassunto con il report che hanno già. */
  only?: readonly string[];
  /** Rimisura anche le coppie con un report riusabile. */
  again?: boolean;
  /** Cartella da cui si risolvono i percorsi relativi; per default quella del processo. */
  cwd?: string;
  /** Il segnale di stop: la coppia in corso riceve SIGTERM e la serie si ferma. */
  signal?: AbortSignal;
  /** Come si lancia Dyadrr; per default `bin.js` di questo pacchetto con questo Node. */
  dyadrr?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** Righe di avanzamento (stderr). */
  log?: (line: string) => void;
  /** I percorsi del riassunto (stdout). */
  stdout?: (text: string) => void;
}

async function readReport(path: string): Promise<Report | null> {
  try {
    const report = JSON.parse(await readFile(path, 'utf8')) as Report;
    return typeof report.decision === 'string' && Array.isArray(report.reasons) ? report : null;
  } catch {
    return null;
  }
}

/** Scrive con un nome temporaneo che inizia con un punto e rinomina. */
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

const duration = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/**
 * La serie (§15): legge e controlla l'elenco, lancia `dyadrr analyze` per ogni
 * coppia senza un report riusabile, una alla volta, e scrive il riassunto.
 * Restituisce il codice di uscita: 0 se la serie è finita, 30 per un elenco
 * o argomenti sbagliati, 40 se il riassunto non si scrive, 50 se annullata.
 */
export async function runPairs(o: PairsOptions): Promise<number> {
  const cwd = o.cwd ?? process.cwd();
  const log = o.log ?? (() => {});
  const listPath = resolve(cwd, o.list);
  let specs: PairSpec[];
  try {
    let text: string;
    try {
      text = await readFile(listPath, 'utf8');
    } catch (e) {
      throw badList(`${listPath} cannot be read (${(e as NodeJS.ErrnoException).code ?? String(e)})`);
    }
    specs = parsePairList(text);
    for (const id of o.only ?? []) {
      if (!specs.some((s) => s.id === id)) throw new DyadrrError('BAD_ARGUMENTS', `--only: there is no pair [${id}] in the list`);
    }
  } catch (e) {
    if (!(e instanceof DyadrrError)) throw e;
    log(`${e.code}: ${e.message}`);
    return exitCodeFor('error', e.code);
  }

  const results = o.results === undefined ? defaultResults(listPath) : resolve(cwd, o.results);
  try {
    await mkdir(results, { recursive: true });
  } catch (e) {
    log(`OUTPUT_NOT_WRITABLE: the results folder ${results} cannot be created (${(e as NodeJS.ErrnoException).code ?? String(e)})`);
    return exitCodeFor('error', 'OUTPUT_NOT_WRITABLE');
  }

  const calibration = loadCalibration();
  const current = { dyadrr: dyadrrVersion(), calibration: calibration.version };
  const selected = (s: PairSpec) => !o.only || o.only.length === 0 || o.only.includes(s.id);
  const summaries: PairSummary[] = [];
  let cancelled = false;
  for (const [i, spec] of specs.entries()) {
    const at = `[${i + 1}/${specs.length}] ${spec.id}`;
    const name = (ext: string) => `${spec.id}.${ext}`;
    const file = (ext: string) => join(results, name(ext));
    const existing = await readReport(file('json'));
    const usable = reusable(existing, spec, cwd, current);
    if (!selected(spec) || (usable && !o.again) || o.signal?.aborted) {
      if (selected(spec) && usable && !o.again) log(`${at}: report reused (${existing!.decision})`);
      summaries.push(summarizePair(spec, usable ? existing : null, name('json'), true));
      continue;
    }
    await rm(file('json'), { force: true });
    await rm(file('log'), { force: true });
    log(`${at}: analyze`);
    await analyze(pairArguments(spec, cwd, file('json')), spec.inputs.map((p) => resolve(cwd, p)), file, cwd, o);
    const report = await readReport(file('json'));
    if (report?.decision === 'cancelled') cancelled = true;
    log(`${at}: ${report ? `${report.decision}${report.reasons[0] ? ` ${report.reasons[0].code}` : ''} (${duration(report.durationMs)})` : 'no report'}`);
    summaries.push(summarizePair(spec, report, name('json'), false));
  }
  if (o.signal?.aborted) cancelled = true;

  const summary = summarizeSeries(summaries, { list: listPath, results, calibration });
  const json = join(results, 'summary.json');
  const md = join(results, 'summary.md');
  try {
    const ordered = Object.fromEntries(SUMMARY_FIELDS.map((f) => [f, summary[f]]));
    await writeAtomic(json, `${JSON.stringify(ordered, null, 2)}\n`);
    await writeAtomic(md, summaryMarkdown(summary));
  } catch (e) {
    log(`INTERNAL: the summary cannot be written in ${results} (${(e as NodeJS.ErrnoException).code ?? String(e)})`);
    return EXIT_CODES.internalError;
  }
  o.stdout?.(`${json}\n${md}\n`);
  log(`${summary.criterion.measured.value} of ${specs.length} pairs measured; exit criterion met: ${summary.criterion.met ? 'yes' : 'no'}`);
  return cancelled ? EXIT_CODES.cancelled : EXIT_CODES.eligible;
}

/**
 * Una coppia: `dyadrr analyze` nel suo processo, con lo stderr in `<id>.log`.
 * Un solo SIGTERM allo stop; se Dyadrr finisce senza report, lo scrive qui
 * con il solo esito, come il runner (§14.1).
 */
async function analyze(argv: string[], files: string[], file: (ext: string) => string, cwd: string, o: PairsOptions): Promise<void> {
  const [command, ...args] = o.dyadrr ?? [process.execPath, join(__dirname, 'bin.js')];
  const startedAt = new Date();
  // In un gruppo di processi proprio: il Ctrl-C di un terminale arriva a
  // tutto il gruppo, e con il SIGTERM di `stop` Dyadrr riceverebbe due
  // segnali, che lo fanno uscire senza report (§10).
  const child = spawn(command!, [...args, ...argv], {
    cwd,
    env: o.env ?? process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  const logStream = createWriteStream(file('log'));
  const logged = new Promise<void>((done) => logStream.on('close', () => done()));
  child.stderr.pipe(logStream);

  let stopped = false;
  const stop = () => {
    if (stopped || child.exitCode !== null || child.signalCode !== null) return;
    stopped = true;
    child.kill('SIGTERM');
  };
  o.signal?.addEventListener('abort', stop);
  const end = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((done) => {
    child.on('error', (error) => done({ code: null, signal: null, error }));
    child.on('close', (code, signal) => done({ code, signal }));
  });
  o.signal?.removeEventListener('abort', stop);
  if (!logStream.writableEnded) logStream.end();
  await logged;

  if (await readReport(file('json'))) return;
  await writeOutcomeReport(file('json'), { mode: 'analyze', files, startedAt }, end.error
    ? { decision: 'error', code: 'INTERNAL', message: `dyadrr cannot be launched: ${end.error.message}` }
    : end.signal !== null
      ? { decision: 'error', code: 'INTERRUPTED', message: `the analysis was interrupted: dyadrr was killed by ${end.signal}` }
      : { decision: 'error', code: 'INTERNAL', message: `dyadrr exited with code ${end.code} without a report` });
}
