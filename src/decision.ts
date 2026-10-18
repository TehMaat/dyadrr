import type { Calibration } from './calibration.js';
import {
  DyadrrError,
  REFUSAL_CODES,
  type Decision,
  type ErrorCode,
  type RefusalCode,
  type WarningCode,
} from './codes.js';
import {
  chooseMeasureLanguage,
  isItalian,
  trackLanguage,
  type MeasureLanguageChoice,
  type TrackLanguageFields,
} from './languages.js';

// Decisione (studio §9, test 1e): una funzione pura dalle misure e dalla
// taratura al giudizio sulla coppia. Non legge file e non lancia programmi:
// chi misura le passa i numeri, e i test le passano serie sintetiche.
//
// I controlli si valutano nell'ordine di §9.4 e il primo che fallisce in modo
// bloccante ferma tutto: i successivi risultano `skipped`.

// ---------------------------------------------------------------- ingressi

/** Livelli HDR di §3.2: SDR < HLG ≈ HDR10 < HDR10+ ≈ Dolby Vision. */
export type HdrFormat = 'SDR' | 'HLG' | 'HDR10' | 'HDR10+' | 'DV';
const HDR_LEVEL: Readonly<Record<HdrFormat, number>> = { SDR: 0, HLG: 1, HDR10: 1, 'HDR10+': 2, DV: 2 };

export interface VideoFacts {
  width: number;
  height: number;
  hdr: HdrFormat;
  codec: string;
  /** Bit al secondo dai tag statistici; `null` se mancano. */
  bitrate: number | null;
  fps: number;
  durationMs: number;
}

/** Un file in ingresso, nell'ordine in cui è stato passato. */
export interface FileFacts {
  audio: readonly TrackLanguageFields[];
  video: VideoFacts;
  /** Esito del controllo di integrità (§4.8). */
  truncated: boolean;
}

/** Un picco di correlazione: spostamento S (decimale) e confidenza (§4.4). */
export interface Match {
  offsetMs: number;
  ncc: number;
  ratio: number;
}

export interface AnchorMeasure extends Match {
  /** Posizione del tratto nel riferimento. */
  positionMs: number;
}

export interface CheckpointMeasure {
  /** Posizione reale nel riferimento, dopo l'eventuale spostamento sul contenuto. */
  positionMs: number;
  /** Energia della finestra del donatore. */
  energyDbfs: number;
  /** Picco migliore vicino allo spostamento delle ancore. */
  local: Match | null;
  /** Picco migliore su tutto l'intervallo di ricerca, se la ricerca locale non ha trovato niente. */
  wide: Match | null;
  /** Punto aggiunto nei tratti scoperti (§4.5, punto 7). */
  added: boolean;
}

/** Ricerca prima del confine iniziale o oltre quello finale (§4.6). */
export interface EdgeProbe {
  side: 'start' | 'end';
  positionMs: number;
  match: Match | null;
}

/** Controllo di trasferimento: italiano contro lingua di misura nel donatore (§4.7). */
export interface TransferProbe {
  positionMs: number;
  match: Match | null;
}

export interface DecisionInput {
  files: readonly [FileFacts, FileFacts];
  /** Valore già validato di `--original-language`. */
  originalLanguage: string | null;
  anchors?: readonly AnchorMeasure[];
  /** Rapporto di velocità trovato dalla diagnosi (§4.4, punto 5), se c'è. */
  speedRatio?: number | null;
  checkpoints?: readonly CheckpointMeasure[];
  commonMaterial?: { startMs: number; endMs: number; probes: readonly EdgeProbe[] };
  transfer?: readonly TransferProbe[];
}

// ---------------------------------------------------------------- report

export const CHECK_NAMES = [
  'roles',
  'measure-language',
  'video',
  'framerate',
  'integrity',
  'anchor-match',
  'offset-range',
  'anchor-agreement',
  'drift',
  'contradiction',
  'unmatched',
  'edges',
  'checkpoint-distribution',
  'coverage',
  'transfer',
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export interface Check {
  name: CheckName;
  result: 'pass' | 'fail' | 'skipped';
  /** Falso per i controlli che danno solo avvisi. */
  blocking: boolean;
  code?: RefusalCode | ErrorCode | WarningCode;
  measured?: number | string;
  threshold?: number | string;
  detail?: string;
}

export interface Reason {
  code: RefusalCode | ErrorCode;
  message: string;
}

export interface Warning {
  code: WarningCode;
  message: string;
  value?: number;
}

export type AnchorOutcome = 'accepted' | 'agrees' | 'disagrees' | 'ambiguous' | 'no-match';
export type CheckpointOutcome = 'consistent' | 'inconclusive' | 'contradictory' | 'unmatched';

export interface CheckpointReport {
  positionMs: number;
  energyDbfs: number;
  outcome: CheckpointOutcome;
  /** Spostamento del picco usato; `null` se non ce n'è uno sicuro. */
  offsetMs: number | null;
  /** Scarto dallo spostamento delle ancore. */
  deviationMs: number | null;
  ncc: number | null;
  ratio: number | null;
  added: boolean;
}

export interface Jump {
  /** Ultimo punto prima del salto e primo dopo, nel riferimento. */
  afterMs: number;
  beforeMs: number;
  fromOffsetMs: number;
  toOffsetMs: number;
  amountMs: number;
  frames: number;
}

/** Forma di una contraddizione (§4.5, punto 6). */
export interface ContradictionShape {
  kind: 'single-jump' | 'multiple-jumps' | 'noise';
  jumps: Jump[];
}

export interface DecisionReport {
  decision: Exclude<Decision, 'cancelled'>;
  reasons: Reason[];
  warnings: Warning[];
  checks: Check[];
  /** Indici in `files`. */
  roles: { reference: 0 | 1; donor: 0 | 1 } | null;
  measureLanguage: (MeasureLanguageChoice & { originalLanguage: string | null }) | null;
  anchors: (AnchorMeasure & { outcome: AnchorOutcome })[];
  offset: {
    /** S dell'ancora accettata. */
    anchorMs: number;
    /** Mediana dei punti coerenti, al decimo di ms. */
    medianMs: number;
    /** S definitivo, intero, per mkvmerge `--sync`. */
    offsetMs: number;
    /** Deviazione assoluta mediana dei punti coerenti. */
    dispersionMs: number;
  } | null;
  drift: { msPerHour: number; totalMs: number; spanMs: number } | null;
  contradiction: ContradictionShape | null;
  checkpoints: CheckpointReport[];
  commonMaterial: {
    startMs: number;
    endMs: number;
    /** Tratto verificato: dal primo all'ultimo punto coerente. */
    verifiedStartMs: number | null;
    verifiedEndMs: number | null;
    coverage: number;
  } | null;
  transfer: { offsetMs: number | null; probes: number; confident: number } | null;
  calibration: Calibration;
}

// ---------------------------------------------------------------- calcoli

const round1 = (x: number) => Math.round(x * 10) / 10;
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length === 0) return NaN;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Un picco è sicuro se è abbastanza somigliante e abbastanza unico (§4.4). */
export function isConfident(match: Match | null | undefined, cal: Calibration): boolean {
  return !!match && match.ncc >= cal.values.nccMin && match.ratio >= cal.values.peakRatioMin;
}

interface Point {
  x: number;
  y: number;
}

/** Retta robusta di Theil–Sen: pendenza mediana tra tutte le coppie di punti. */
function theilSen(points: readonly Point[]): { slope: number; intercept: number } {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      if (b.x !== a.x) slopes.push((b.y - a.y) / (b.x - a.x));
    }
  }
  const slope = slopes.length > 0 ? median(slopes) : 0;
  return { slope, intercept: median(points.map((p) => p.y - slope * p.x)) };
}

/**
 * Divide i punti, in ordine di posizione, in tratti a spostamento costante: un
 * tratto finisce quando un punto si allontana dal primo del tratto più della
 * tolleranza. Un tratto lungo è un salto; più tratti di almeno due punti sono
 * più salti; tratti di un punto solo sono rumore.
 */
function contradictionShape(points: readonly Point[], toleranceMs: number, fps: number): ContradictionShape | null {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const segments: Point[][] = [];
  for (const p of sorted) {
    const current = segments[segments.length - 1];
    if (current && Math.abs(p.y - current[0]!.y) <= toleranceMs) current.push(p);
    else segments.push([p]);
  }
  if (segments.length < 2) return null;

  const jumps = segments.slice(1).map((seg, i): Jump => {
    const prev = segments[i]!;
    const from = median(prev.map((p) => p.y));
    const to = median(seg.map((p) => p.y));
    return {
      afterMs: prev[prev.length - 1]!.x,
      beforeMs: seg[0]!.x,
      fromOffsetMs: round1(from),
      toOffsetMs: round1(to),
      amountMs: round1(to - from),
      frames: round1(((to - from) * fps) / 1000),
    };
  });
  const kind =
    segments.length === 2 ? 'single-jump'
    : segments.every((s) => s.length >= 2) ? 'multiple-jumps'
    : 'noise';
  return { kind, jumps };
}

/** Rapporti di velocità della diagnosi (§4.4, punto 5). */
const SPEED_RATIOS: readonly { ratio: number; code: RefusalCode }[] = [
  { ratio: 1001 / 1000, code: 'FPS_MISMATCH' },
  { ratio: 25 / 24, code: 'PAL_SPEEDUP' },
  { ratio: 25 / (24000 / 1001), code: 'PAL_SPEEDUP' },
];

function speedCode(ratio: number): RefusalCode {
  const r = ratio >= 1 ? ratio : 1 / ratio;
  let best = SPEED_RATIOS[0]!;
  for (const s of SPEED_RATIOS) if (Math.abs(r - s.ratio) < Math.abs(r - best.ratio)) best = s;
  return best.code;
}

const missing = (what: string) =>
  new DyadrrError('INTERNAL', `decision: ${what} missing although the previous checks passed`);

const REFUSALS: ReadonlySet<string> = new Set(REFUSAL_CODES);

// ---------------------------------------------------------------- decisione

/**
 * Dalle misure e dalla taratura al giudizio sulla coppia. Le misure di una fase
 * servono solo se le fasi precedenti sono passate; se mancano quando servono è
 * un errore interno (`INTERNAL`).
 */
export function decide(input: DecisionInput, cal: Calibration): DecisionReport {
  const v = cal.values;
  const tol = v.toleranceMs;

  const report: DecisionReport = {
    decision: 'eligible',
    reasons: [],
    warnings: [],
    checks: CHECK_NAMES.map((name) => ({ name, result: 'skipped', blocking: name !== 'transfer' })),
    roles: null,
    measureLanguage: null,
    anchors: [],
    offset: null,
    drift: null,
    contradiction: null,
    checkpoints: [],
    commonMaterial: null,
    transfer: null,
    calibration: cal,
  };

  const check = (name: CheckName) => report.checks.find((c) => c.name === name)!;
  const pass = (name: CheckName, fields: Partial<Check> = {}) => {
    Object.assign(check(name), fields, { result: 'pass' });
  };
  /** Fallimento bloccante: chiude il report con un rifiuto o un errore. */
  const fail = (name: CheckName, code: RefusalCode | ErrorCode, message: string, fields: Partial<Check> = {}) => {
    Object.assign(check(name), fields, { result: 'fail', code });
    report.reasons.push({ code, message });
    report.decision = REFUSALS.has(code) ? 'refused' : 'error';
    return report;
  };
  const warn = (code: WarningCode, message: string, value?: number) => {
    report.warnings.push(value === undefined ? { code, message } : { code, message, value });
  };

  // 1. Controlli strutturali (§9.4, punto 1).

  const italian = input.files.map((f) => f.audio.some(isItalian));
  if (!italian[0] && !italian[1]) {
    return fail('roles', 'NO_ITALIAN_AUDIO', 'neither file has an Italian audio track');
  }
  if (italian[0] && italian[1]) {
    return fail('roles', 'BOTH_ITALIAN_AUDIO', 'both files have an Italian audio track: nothing to merge');
  }
  const donorIndex = italian[0] ? 0 : 1;
  const roles = { reference: (1 - donorIndex) as 0 | 1, donor: donorIndex as 0 | 1 };
  report.roles = roles;
  const reference = input.files[roles.reference];
  const donor = input.files[roles.donor];
  pass('roles', { detail: `file ${roles.donor + 1} is the only one with Italian audio` });

  const languages = (f: FileFacts) => f.audio.map(trackLanguage).filter((l): l is string => l !== null);
  const measure = chooseMeasureLanguage(languages(reference), languages(donor), input.originalLanguage);
  if (measure === null) {
    return fail(
      'measure-language',
      'NO_COMMON_LANGUAGE',
      'no non-Italian audio language is present in both files: rip the Italian disc keeping English or the original language',
    );
  }
  report.measureLanguage = { ...measure, originalLanguage: input.originalLanguage };
  pass('measure-language', { measured: measure.language, detail: measure.reason });
  if (measure.originalNotCommon) {
    warn(
      'ORIGINAL_LANGUAGE_NOT_COMMON',
      `original language ${input.originalLanguage} is not in both files: measuring on ${measure.language}`,
    );
  }

  const rv = reference.video;
  const dv = donor.video;
  const rPixels = rv.width * rv.height;
  const dPixels = dv.width * dv.height;
  const resolutions = `${dv.width}x${dv.height} vs ${rv.width}x${rv.height}`;
  if (dPixels > rPixels) {
    return fail('video', 'DONOR_BETTER_VIDEO', `the donor video has a higher resolution (${resolutions})`);
  }
  if (dPixels === rPixels && HDR_LEVEL[dv.hdr] > HDR_LEVEL[rv.hdr]) {
    return fail('video', 'DONOR_BETTER_VIDEO', `the donor video has a higher HDR level (${dv.hdr} vs ${rv.hdr})`);
  }
  const sameClass =
    dPixels === rPixels && HDR_LEVEL[dv.hdr] === HDR_LEVEL[rv.hdr] && dv.codec.toLowerCase() === rv.codec.toLowerCase();
  if (sameClass && (dv.bitrate === null || rv.bitrate === null)) {
    pass('video', { detail: 'bitrate unknown: criterion skipped' });
  } else if (sameClass && dv.bitrate! > rv.bitrate! * (1 + v.bitrateMargin)) {
    const excess = round4(dv.bitrate! / rv.bitrate! - 1);
    pass('video', { measured: excess, threshold: v.bitrateMargin, detail: 'donor bitrate higher' });
    warn(
      'VIDEO_QUALITY_UNCERTAIN',
      `same resolution, HDR and codec, but the donor bitrate is ${Math.round(excess * 100)}% higher`,
      excess,
    );
  } else {
    pass('video');
  }

  const fpsDiff = Math.abs(rv.fps - dv.fps) / rv.fps;
  if (!(fpsDiff < v.fpsRelativeTolerance)) {
    return fail('framerate', 'FPS_MISMATCH', `different frame rates: ${dv.fps} vs ${rv.fps}`, {
      measured: fpsDiff,
      threshold: v.fpsRelativeTolerance,
    });
  }
  pass('framerate', { measured: fpsDiff, threshold: v.fpsRelativeTolerance });

  for (const role of ['reference', 'donor'] as const) {
    if (input.files[roles[role]].truncated) {
      return fail('integrity', 'INPUT_TRUNCATED', `the ${role} file is truncated`);
    }
  }
  pass('integrity');

  // 2. Misura iniziale: le ancore (§4.4).

  if (!input.anchors) throw missing('anchors');
  const accepted = input.anchors.find((a) => isConfident(a, cal));
  report.anchors = input.anchors.map((a) => ({
    ...a,
    outcome:
      a === accepted ? 'accepted'
      : isConfident(a, cal) ? (Math.abs(a.offsetMs - accepted!.offsetMs) <= tol ? 'agrees' : 'disagrees')
      : a.ncc >= v.nccMin ? 'ambiguous'
      : 'no-match',
  }));

  if (!accepted) {
    const best = Math.max(...input.anchors.map((a) => a.ncc));
    const fields = { measured: Number.isFinite(best) ? best : 'none', threshold: v.nccMin };
    if (report.anchors.some((a) => a.outcome === 'ambiguous')) {
      return fail(
        'anchor-match',
        'AMBIGUOUS_MATCH',
        'the anchors match, but not uniquely (repetitive content)',
        { ...fields, detail: `peak ratio below ${v.peakRatioMin}` },
      );
    }
    if (input.speedRatio != null) {
      const code = speedCode(input.speedRatio);
      return fail('anchor-match', code, `the files match only at a speed ratio of ${round4(input.speedRatio)}`, {
        ...fields,
        detail: `speed ratio ${round4(input.speedRatio)}`,
      });
    }
    return fail('anchor-match', 'NO_MATCH', 'no anchor finds a sufficiently similar match', fields);
  }
  pass('anchor-match', { measured: accepted.ncc, threshold: v.nccMin });
  if (accepted.ncc < v.nccMin + v.measureMixDiffersBand) {
    warn(
      'MEASURE_MIX_DIFFERS',
      `the measure tracks are only moderately similar (NCC ${accepted.ncc}): the mixes probably differ`,
      accepted.ncc,
    );
  }

  const anchorS = accepted.offsetMs;
  if (Math.abs(anchorS) > v.maxOffsetMs) {
    return fail('offset-range', 'OFFSET_TOO_LARGE', `offset ${round1(anchorS)} ms is beyond the maximum`, {
      measured: round1(anchorS),
      threshold: v.maxOffsetMs,
    });
  }
  pass('offset-range', { measured: round1(anchorS), threshold: v.maxOffsetMs });

  const disagreeing = report.anchors.filter((a) => a.outcome === 'disagrees');
  if (disagreeing.length > 0) {
    const confident = report.anchors.filter((a) => a.outcome !== 'ambiguous' && a.outcome !== 'no-match');
    const points = confident.map((a) => ({ x: a.positionMs, y: a.offsetMs }));
    report.contradiction = contradictionShape(points, tol, rv.fps);
    return fail(
      'anchor-agreement',
      'CHECKPOINT_CONTRADICTION',
      `confident anchors disagree: ${confident.map((a) => `${round1(a.offsetMs)} ms`).join(', ')}`,
      { measured: round1(Math.max(...disagreeing.map((a) => Math.abs(a.offsetMs - anchorS)))), threshold: tol },
    );
  }
  const agreeing = report.anchors.filter((a) => a.outcome === 'agrees').length;
  pass('anchor-agreement', {
    detail: agreeing > 0 ? `${agreeing + 1} confident anchors agree` : 'single confident anchor: confirmed by the checkpoints',
  });

  // 3. Punti di conferma (§4.5): deriva, contraddizioni, confini, copertura.

  if (!input.checkpoints) throw missing('checkpoints');
  report.checkpoints = input.checkpoints.map((c): CheckpointReport => {
    const base = { positionMs: c.positionMs, energyDbfs: c.energyDbfs, added: c.added };
    // Il non conclusivo si decide dall'energia, mai dall'assenza di un picco.
    if (c.energyDbfs < v.silenceDbfs) {
      return { ...base, outcome: 'inconclusive', offsetMs: null, deviationMs: null, ncc: null, ratio: null };
    }
    const m = isConfident(c.local, cal) ? c.local : isConfident(c.wide, cal) ? c.wide : null;
    if (m === null) {
      return { ...base, outcome: 'unmatched', offsetMs: null, deviationMs: null, ncc: null, ratio: null };
    }
    const deviation = m.offsetMs - anchorS;
    return {
      ...base,
      outcome: Math.abs(deviation) <= tol ? 'consistent' : 'contradictory',
      offsetMs: m.offsetMs,
      deviationMs: round1(deviation),
      ncc: m.ncc,
      ratio: m.ratio,
    };
  });
  const points = report.checkpoints;
  const consistent = points.filter((p) => p.outcome === 'consistent').sort((a, b) => a.positionMs - b.positionMs);
  const matched = points
    .filter((p) => p.offsetMs !== null)
    .map((p) => ({ x: p.positionMs, y: p.offsetMs! }))
    .sort((a, b) => a.x - b.x);

  if (consistent.length > 0) {
    const med = median(consistent.map((p) => p.offsetMs!));
    report.offset = {
      anchorMs: round1(anchorS),
      medianMs: round1(med),
      offsetMs: Math.round(med),
      dispersionMs: round1(median(consistent.map((p) => Math.abs(p.offsetMs! - med)))),
    };
  }

  // Deriva prima delle contraddizioni: se una retta spiega tutti i punti con un
  // picco sicuro e la deriva totale supera la tolleranza, è DRIFT. Se la retta
  // non li spiega (un salto, rumore), la deriva non c'entra e decidono le
  // contraddizioni.
  if (matched.length >= 3) {
    const { slope, intercept } = theilSen(matched);
    const spanMs = matched[matched.length - 1]!.x - matched[0]!.x;
    const totalMs = slope * spanMs;
    report.drift = { msPerHour: round1(slope * 3_600_000), totalMs: round1(totalMs), spanMs };
    const fitsLine = matched.every((p) => Math.abs(p.y - (intercept + slope * p.x)) <= tol);
    if (fitsLine && Math.abs(totalMs) > tol) {
      return fail(
        'drift',
        'DRIFT',
        `the offset drifts by ${round1(slope * 3_600_000)} ms per hour (${round1(totalMs)} ms over the measured span)`,
        { measured: round1(totalMs), threshold: tol },
      );
    }
    pass('drift', { measured: round1(totalMs), threshold: tol });
  } else {
    pass('drift', { detail: 'fewer than 3 matched checkpoints: drift not measurable' });
  }

  const contradictory = points.filter((p) => p.outcome === 'contradictory');
  if (contradictory.length > 0) {
    report.contradiction = contradictionShape(matched, tol, rv.fps);
    const shape = report.contradiction;
    const first = shape?.jumps[0];
    const what =
      shape?.kind === 'single-jump' && first
        ? `a single jump of ${first.amountMs} ms (${first.frames} frames) between ${first.afterMs} and ${first.beforeMs} ms`
        : shape?.kind === 'multiple-jumps' ? `${shape.jumps.length} jumps`
        : 'noise';
    return fail(
      'contradiction',
      'CHECKPOINT_CONTRADICTION',
      `${contradictory.length} checkpoint(s) match at another offset: ${what}`,
      { measured: contradictory.length, threshold: 0 },
    );
  }
  pass('contradiction', { measured: 0, threshold: 0 });

  const unmatched = points.filter((p) => p.outcome === 'unmatched');
  if (unmatched.length > 0) {
    return fail(
      'unmatched',
      'CHECKPOINT_UNMATCHED',
      `${unmatched.length} checkpoint(s) with content match nowhere, first at ${unmatched[0]!.positionMs} ms`,
      { measured: unmatched.length, threshold: 0 },
    );
  }
  pass('unmatched', { measured: 0, threshold: 0 });

  // Confini del materiale in comune (§4.6): oltre i confini il film non deve
  // continuare a un altro spostamento.
  if (!input.commonMaterial) throw missing('common material');
  const { startMs, endMs, probes } = input.commonMaterial;
  const length = endMs - startMs;
  report.commonMaterial = {
    startMs,
    endMs,
    verifiedStartMs: consistent[0]?.positionMs ?? null,
    verifiedEndMs: consistent[consistent.length - 1]?.positionMs ?? null,
    coverage: round4(length / rv.durationMs),
  };
  const S = report.offset?.medianMs ?? anchorS;
  const beyond = probes.filter((p) => isConfident(p.match, cal) && Math.abs(p.match!.offsetMs - S) > tol);
  if (beyond.length > 0) {
    const edgePoints = [...matched, ...beyond.map((p) => ({ x: p.positionMs, y: p.match!.offsetMs }))];
    report.contradiction = contradictionShape(edgePoints, tol, rv.fps);
    const p = beyond[0]!;
    return fail(
      'edges',
      'CHECKPOINT_CONTRADICTION',
      `the film continues at another offset (${round1(p.match!.offsetMs)} ms) ${p.side === 'start' ? 'before the start' : 'after the end'} of the common material`,
      { measured: beyond.length, threshold: 0 },
    );
  }
  pass('edges', { detail: `common material ${startMs}–${endMs} ms` });

  // Copertura dei punti coerenti (§9.3).
  const problems: string[] = [];
  if (consistent.length < v.minConsistentCheckpoints) {
    problems.push(`${consistent.length} consistent checkpoints (minimum ${v.minConsistentCheckpoints})`);
  }
  let maxGap = 0;
  for (let i = 1; i < consistent.length; i++) {
    maxGap = Math.max(maxGap, consistent[i]!.positionMs - consistent[i - 1]!.positionMs);
  }
  if (maxGap > v.maxCheckpointGapMs) {
    problems.push(`a gap of ${round1(maxGap / 60_000)} min between consistent checkpoints (maximum ${round1(v.maxCheckpointGapMs / 60_000)})`);
  }
  const edge = length * v.edgeFraction;
  const pct = Math.round(v.edgeFraction * 100);
  if (!consistent.some((p) => p.positionMs <= startMs + edge)) {
    problems.push(`no consistent checkpoint in the first ${pct}% of the common material`);
  }
  if (!consistent.some((p) => p.positionMs >= endMs - edge)) {
    problems.push(`no consistent checkpoint in the last ${pct}% of the common material`);
  }
  if (problems.length > 0) {
    return fail('checkpoint-distribution', 'TOO_FEW_CHECKPOINTS', problems.join('; '), {
      measured: consistent.length,
      threshold: v.minConsistentCheckpoints,
    });
  }
  pass('checkpoint-distribution', { measured: consistent.length, threshold: v.minConsistentCheckpoints });

  const coverage = report.commonMaterial.coverage;
  if (coverage < v.minCoverage) {
    return fail(
      'coverage',
      'LOW_COVERAGE',
      `the common material covers ${round1(coverage * 100)}% of the reference video (minimum ${round1(v.minCoverage * 100)}%)`,
      { measured: coverage, threshold: v.minCoverage },
    );
  }
  pass('coverage', { measured: coverage, threshold: v.minCoverage });

  // Sui non conclusivi non c'è una soglia di rifiuto propria: solo un avviso,
  // quando la copertura è comunque sufficiente.
  const inconclusive = points.filter((p) => p.outcome === 'inconclusive').length;
  const inconclusiveFraction = inconclusive / points.length;
  if (inconclusiveFraction > v.manyInconclusiveFraction) {
    warn(
      'MANY_INCONCLUSIVE',
      `${inconclusive} of ${points.length} checkpoints are inconclusive (silence or no content)`,
      round4(inconclusiveFraction),
    );
  }

  // Controllo di trasferimento (§4.7): per ora dà solo avvisi.
  if (!input.transfer) throw missing('transfer probes');
  const confidentTransfer = input.transfer.filter((p) => isConfident(p.match, cal)).map((p) => p.match!.offsetMs);
  const transferOffset = confidentTransfer.length > 0 ? round1(median(confidentTransfer)) : null;
  report.transfer = { offsetMs: transferOffset, probes: input.transfer.length, confident: confidentTransfer.length };
  if (transferOffset === null) {
    Object.assign(check('transfer'), { result: 'fail', code: 'ITALIAN_UNVERIFIED' });
    warn('ITALIAN_UNVERIFIED', 'the Italian track does not correlate with the measure language in the donor');
  } else if (Math.abs(transferOffset) > tol) {
    Object.assign(check('transfer'), { result: 'fail', code: 'ITALIAN_TRANSFER_OFFSET', measured: transferOffset, threshold: tol });
    warn(
      'ITALIAN_TRANSFER_OFFSET',
      `in the donor the Italian track is offset by ${transferOffset} ms from the measure language`,
      transferOffset,
    );
  } else {
    pass('transfer', { measured: transferOffset, threshold: tol });
  }

  return report;
}
