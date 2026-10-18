import { DyadrrError } from './codes.js';
import calibrationFile from './calibration.json';

// Parametri di taratura (studio §9.2). I valori stanno nel file versionato
// `calibration.json` e non si cambiano a ogni esecuzione; i limiti stanno qui,
// nel codice, e non si cambiano affatto. I limiti non superano mai le regole
// fisse di §9.1 (tolleranza per punto ≤ 30 ms, spostamento massimo ≤ 300 s).

interface Limit {
  min: number;
  max: number;
  integer?: boolean;
}

export const CALIBRATION_LIMITS = {
  /** Tolleranza per punto, in ms. §9.1: mai oltre 30 ms. */
  toleranceMs: { min: 1, max: 30 },
  /** Spostamento massimo S_max, in ms. §9.1: mai oltre 300 s. */
  maxOffsetMs: { min: 1000, max: 300_000 },
  /** θ_ncc: somiglianza minima del picco (§4.4). */
  nccMin: { min: 0.2, max: 0.99 },
  /** θ_rapporto: unicità minima del picco (§4.4). */
  peakRatioMin: { min: 1.05, max: 10 },
  /** Ampiezza della fascia sopra θ_ncc in cui scatta `MEASURE_MIX_DIFFERS`. */
  measureMixDiffersBand: { min: 0, max: 0.5 },
  /** E_min: sotto questa energia la finestra è non conclusiva (§4.5). */
  silenceDbfs: { min: -90, max: -20 },
  /** Punti coerenti minimi (§9.3). */
  minConsistentCheckpoints: { min: 10, max: 60, integer: true },
  /** Buco massimo tra due punti coerenti consecutivi, in ms (§9.3). */
  maxCheckpointGapMs: { min: 60_000, max: 1_800_000 },
  /** Frazione iniziale e finale del materiale in comune con un punto coerente (§9.3). */
  edgeFraction: { min: 0.02, max: 0.25 },
  /** Copertura minima del video di riferimento (§9.3). */
  minCoverage: { min: 0.5, max: 1 },
  /** Frazione di punti non conclusivi oltre la quale scatta `MANY_INCONCLUSIVE`. */
  manyInconclusiveFraction: { min: 0.01, max: 0.5 },
  /** Margine di bitrate per `VIDEO_QUALITY_UNCERTAIN` (§3.2). */
  bitrateMargin: { min: 0.05, max: 1 },
  /**
   * Differenza relativa massima tra i framerate (§9.2). Il massimo resta sotto
   * 1e-3, la differenza tra 24 e 23,976: altrimenti passerebbero per uguali.
   */
  fpsRelativeTolerance: { min: 1e-6, max: 5e-4 },
} as const satisfies Record<string, Limit>;

export type CalibrationName = keyof typeof CALIBRATION_LIMITS;
export const CALIBRATION_NAMES = Object.keys(CALIBRATION_LIMITS) as CalibrationName[];

export interface Calibration {
  /** Versione del file di taratura, registrata nel report. */
  version: number;
  values: Readonly<Record<CalibrationName, number>>;
  /** Parametri con un valore provvisorio, ancora da tarare in fase 1. */
  provisional: readonly CalibrationName[];
}

const bad = (message: string) => new DyadrrError('BAD_ARGUMENTS', `calibration: ${message}`);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Valida un file di taratura. Un parametro mancante, sconosciuto o fuori dai
 * limiti è `BAD_ARGUMENTS` (§9.2): un valore fuori dai limiti è un errore di
 * utilizzo, non una taratura.
 */
export function parseCalibration(raw: unknown): Calibration {
  if (!isObject(raw) || !isObject(raw.values)) throw bad('expected { version, values, provisional }');
  const { version, values, provisional } = raw;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw bad('version must be a positive integer');
  }

  for (const key of Object.keys(values)) {
    if (!(CALIBRATION_NAMES as string[]).includes(key)) throw bad(`unknown parameter "${key}"`);
  }
  const parsed = {} as Record<CalibrationName, number>;
  for (const name of CALIBRATION_NAMES) {
    const value = values[name];
    const limit: Limit = CALIBRATION_LIMITS[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw bad(`${name} is missing or not a number`);
    if (value < limit.min || value > limit.max) {
      throw bad(`${name} = ${value} is outside its limits [${limit.min}, ${limit.max}]`);
    }
    if (limit.integer && !Number.isInteger(value)) throw bad(`${name} must be an integer`);
    parsed[name] = value;
  }

  if (!Array.isArray(provisional)) throw bad('provisional must be a list of parameters');
  for (const name of provisional) {
    if (!(CALIBRATION_NAMES as unknown[]).includes(name)) throw bad(`unknown provisional parameter "${String(name)}"`);
  }

  return { version, values: parsed, provisional: provisional as CalibrationName[] };
}

/** La taratura versionata con Dyadrr. */
export function loadCalibration(): Calibration {
  return parseCalibration(calibrationFile);
}
