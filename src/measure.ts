import type { Calibration } from './calibration.js';
import type { GivenChoices } from './choices.js';
import { DyadrrError } from './codes.js';
import {
  ANALYSIS_RATE,
  LOWPASS_HZ,
  analysisMix,
  energyDbfs,
  hasCenter,
  hasLeftRight,
  readAudioWindow,
  trackSpan,
  type Mix,
} from './audio.js';
import { findPeaks, stretch } from './correlation.js';
import {
  checkStructure,
  decide,
  isConfident,
  type AnchorMeasure,
  type CheckpointMeasure,
  type CheckpointOutcome,
  type DecisionInput,
  type DecisionReport,
  type EdgeProbe,
  type Match,
  type TransferProbe,
} from './decision.js';
import { isCommentaryOrDescription, mainItalianTrack, type InputFile, type InputTrack } from './inputs.js';
import { trackLanguage } from './languages.js';
import { planPair, type Plan } from './plan.js';
import { DEFAULT_TOOLS, type ToolPaths } from './tools.js';

// Misura (studio §4.2, §4.4–4.7): dalle finestre audio dei due file alle misure
// che la decisione si aspetta (`AnchorMeasure`, `CheckpointMeasure`,
// `EdgeProbe`, `TransferProbe`). Il pezzo da cercare si prende sempre dal
// riferimento e la ricerca si fa nel donatore (§4.3). Le posizioni vengono
// dagli inizi reali delle finestre, mai da quelli richiesti; S resta decimale
// e lo arrotonda all'intero solo la decisione (§4.1).
//
// Le fasi seguono l'ordine della decisione (§9.4) e si fermano quando la
// decisione non avrebbe bisogno di altro: senza un'ancora sicura, con ancore
// in disaccordo, con S oltre il massimo, o con un punto contraddittorio o
// senza corrispondenza.

// Costanti del metodo, non parametri di taratura (§4.4–4.7): dicono dove e come
// cercare, non quando una coppia è idonea.

/** Posizioni delle ancore, in frazioni della durata del video di riferimento (§4.4). */
export const ANCHOR_FRACTIONS = [0.15, 0.25, 0.35, 0.5] as const;

/** Ricerca vicina a S dei punti di conferma, dei confini e del trasferimento: ±1 s (§4.5). */
export const LOCAL_SEARCH_MS = 1000;

/** Raggio della rifinitura NCC intorno al picco della correlazione sbiancata. */
export const REFINE_RADIUS_MS = 2;

/** Banda della correlazione sbiancata: fino al passa-basso della lettura (§4.3). */
export const PHAT_BAND_HZ = [20, LOWPASS_HZ] as const;

/** Spostamento massimo di una finestra muta in cerca di contenuto (§4.5, punto 2). */
export const CONTENT_SHIFT_MS = 60_000;

/** Passo con cui si cerca il contenuto vicino a una finestra muta. */
export const CONTENT_STEP_MS = 250;

/** Finestre brevi della ricerca fine dei confini (§4.6). */
export const EDGE_WINDOW_MS = 2000;

/** La ricerca dei confini si ferma quando l'intervallo è più corto di così (§4.6). */
export const EDGE_PRECISION_MS = 1000;

/**
 * Prove al massimo per confine, oltre la prima: la metà per volta ne usa una
 * dozzina; il tetto garantisce che la ricerca finisca.
 */
export const EDGE_MAX_TESTS = 50;

/** Ricerche al massimo prima del confine iniziale e oltre quello finale, per lato (§4.6). */
export const EDGE_PROBES = 3;

/** Punti del controllo di trasferimento (§4.7). */
export const TRANSFER_PROBES = 5;

/** Due coppie di tracce con somiglianze più vicine di così sono alla pari (§4.2). */
export const PAIR_TIE_NCC = 0.02;

/** Rapporti di velocità della diagnosi, provati in tutti e due i versi (§4.4, punto 5). */
export const SPEED_RATIOS = [1001 / 1000, 25 / 24, 25 / (24000 / 1001)] as const;

// ---------------------------------------------------------------- tipi

/** Una coppia di tracce nella lingua di misura, con il segnale con cui si confronta (§4.2). */
export interface TrackPair {
  referenceTrackId: number;
  donorTrackId: number;
  mix: Mix;
}

/** Una coppia provata su un'ancora, per il report (§11.2, punto 3). */
export interface PairTrial extends TrackPair {
  positionMs: number;
  /** `null` se nel donatore non c'è audio nell'intervallo di ricerca. */
  match: Match | null;
}

export interface MeasuredCheckpoint extends CheckpointMeasure {
  /** Posizione richiesta, prima dell'eventuale spostamento sul contenuto. */
  requestedMs: number;
}

export interface MeasuredTransferProbe extends TransferProbe {
  /** Segnale usato: `side` se le tracce non hanno il centrale, `leftRight` se `side` è muto. */
  mix: Mix;
}

export interface Measurement {
  measureLanguage: string;
  /** Tutte le coppie provate, con la loro confidenza, finché una ha dato un picco sicuro. */
  pairs: PairTrial[];
  /** La coppia scelta: misura ancore, confini e punti. */
  pair: TrackPair;
  /** Ancore della coppia scelta, nell'ordine di misura. */
  anchors: AnchorMeasure[];
  /** Rapporto di velocità della diagnosi: durata nel donatore ÷ durata nel riferimento. */
  speedRatio: number | null;
  /** S dell'ancora accettata, intorno a cui si cercano confini e punti; `null` senza ancora sicura. */
  anchorOffsetMs: number | null;
  /** Confini del materiale in comune (§4.6), sulla linea del tempo del riferimento. */
  boundaries: { startMs: number; endMs: number } | null;
  checkpoints: MeasuredCheckpoint[] | null;
  edgeProbes: EdgeProbe[] | null;
  transfer: { measureTrackId: number; italianTrackId: number; probes: MeasuredTransferProbe[] } | null;
  /** Byte letti da ogni file (§11.2, punto 4). */
  bytesRead: { reference: number; donor: number };
}

/**
 * Fasi dell'analisi per l'avanzamento (§11.1): ancore, confini, punti di
 * conferma, ricerche oltre i confini, trasferimento, piano.
 */
export type AnalysisPhase = 'anchors' | 'edges' | 'checkpoints' | 'edge-probes' | 'transfer' | 'plan';

export interface MeasureProgress {
  phase: AnalysisPhase;
  /** Prove fatte nella fase finora. */
  done: number;
  /** Prove previste; `null` dove non si sanno prima (confini, ricerche oltre i confini, piano). */
  total: number | null;
  /** Solo per i punti di conferma: quanti punti per esito, finora. */
  outcomes?: Record<CheckpointOutcome, number>;
}

export interface MeasureOptions {
  tools?: ToolPaths;
  /** Interrompe la lettura in corso: la misura fallisce con l'errore dell'annullamento. */
  signal?: AbortSignal;
  /** Ogni passo della misura, per l'avanzamento. */
  onProgress?: (progress: MeasureProgress) => void;
}

// ---------------------------------------------------------------- segnali

/** Un tratto di segnale a 8 kHz con l'istante reale del suo primo campione. */
interface Signal {
  startMs: number;
  samples: Float32Array;
}

interface TrackSignal {
  track: InputTrack;
  mix: Mix;
}

const MS = ANALYSIS_RATE / 1000; // campioni per millisecondo
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const key = (s: TrackSignal) => `${s.track.id}:${s.mix}`;

/** La parte di `w` tra due istanti, con il suo inizio reale. */
function slice(w: Signal, fromMs: number, toMs: number): Signal {
  const n = w.samples.length;
  const a = clamp(Math.round((fromMs - w.startMs) * MS), 0, n);
  const b = clamp(Math.round((toMs - w.startMs) * MS), a, n);
  return { startMs: w.startMs + a / MS, samples: w.samples.subarray(a, b) };
}

const durationOf = (s: Signal) => s.samples.length / MS;

/** Energia in dBFS con due decimali; −∞ per un tratto vuoto o tutto a zero. */
const energy = (s: Signal | null) => (s && s.samples.length > 0 ? round2(energyDbfs(s.samples)) : -Infinity);

/** Un file con i byte letti finora. Le letture si limitano al tratto in cui le tracce hanno audio. */
class Side {
  bytes = 0;

  constructor(readonly file: InputFile, private readonly tools: ToolPaths, private readonly signal?: AbortSignal) {}

  /** Tratto in cui tutte le tracce hanno audio (§4.3). */
  span(tracks: readonly InputTrack[]): { start: number; end: number } {
    let start = -Infinity;
    let end = Infinity;
    for (const t of tracks) {
      const s = trackSpan(this.file, t);
      start = Math.max(start, s.start);
      end = Math.min(end, s.end);
    }
    return { start, end };
  }

  /** Una finestra per segnale, nella stessa lettura; `null` se il tratto cade fuori dalle tracce. */
  async read(signals: readonly TrackSignal[], fromMs: number, toMs: number): Promise<Signal[] | null> {
    const span = this.span(signals.map((s) => s.track));
    const from = Math.max(fromMs, span.start);
    const to = Math.min(toMs, span.end);
    if (!(to - from >= 1)) return null;
    const reading = await readAudioWindow(
      this.file,
      signals.map((s) => ({ trackId: s.track.id, mix: s.mix })),
      { startMs: from, durationMs: to - from },
      { tools: this.tools, signal: this.signal },
    );
    this.bytes += reading.bytesRead ?? 0;
    return reading.windows.map((w) => ({ startMs: w.startMs, samples: w.samples }));
  }
}

/**
 * Cerca ogni pezzo del riferimento nel tratto del donatore. S = istante reale
 * del pezzo − istante del donatore in cui il pezzo comincia (§4.1).
 */
function search(needles: readonly Signal[], hay: Signal | null, cal: Calibration): (Match | null)[] {
  if (!hay) return needles.map(() => null);
  const peaks = findPeaks(
    needles.map((n) => n.samples),
    hay.samples,
    {
      rate: ANALYSIS_RATE,
      bandHz: PHAT_BAND_HZ,
      exclusion: Math.round(cal.values.exclusionZoneMs * MS),
      refineRadius: REFINE_RADIUS_MS * MS,
    },
  );
  return peaks.map((p, i) =>
    p && { offsetMs: round3(needles[i]!.startMs - (hay.startMs + p.lag / MS)), ncc: p.ncc, ratio: p.ratio });
}

// ---------------------------------------------------------------- tracce

/** Una traccia senza perdite: FLAC, TrueHD, PCM, DTS-HD Master Audio e simili (§4.2). */
export function isLossless(track: Pick<InputTrack, 'codec' | 'codecId'>): boolean {
  return /^A_(FLAC|TRUEHD|MLP|PCM|ALAC|WAVPACK)/i.test(track.codecId ?? '') ||
    /flac|truehd|master audio|pcm|lossless/i.test(track.codec);
}

/**
 * Segnale del controllo di trasferimento (§4.7), sui canali non centrali: L+R
 * se entrambe le tracce hanno il centrale (lì il dialogo non c'è), altrimenti
 * (L − R)/2, che toglie il dialogo al centro di una traccia stereo; L+R se una
 * delle due non ha nemmeno L e R.
 */
export function transferMix(
  a: Pick<InputTrack, 'channelLayout' | 'channels'>,
  b: Pick<InputTrack, 'channelLayout' | 'channels'>,
): Mix {
  if (hasCenter(a) && hasCenter(b)) return 'leftRight';
  return hasLeftRight(a) && hasLeftRight(b) ? 'side' : 'leftRight';
}

interface Pair {
  reference: InputTrack;
  donor: InputTrack;
  mix: Mix;
}

const pairIds = (p: Pair): TrackPair => ({ referenceTrackId: p.reference.id, donorTrackId: p.donor.id, mix: p.mix });

/**
 * Le coppie possibili nella lingua di misura (§4.2): tutte, esclusi commenti e
 * audiodescrizioni. Se in un file restano solo quelli, si usano comunque.
 */
export function candidatePairs(reference: InputFile, donor: InputFile, language: string): Pair[] {
  const tracks = (f: InputFile) => {
    const all = f.audio.filter((t) => trackLanguage(t) === language);
    const clean = all.filter((t) => !isCommentaryOrDescription(t));
    return clean.length > 0 ? clean : all;
  };
  return tracks(reference).flatMap((r) => tracks(donor).map((d) => ({ reference: r, donor: d, mix: analysisMix(r, d) })));
}

/**
 * La coppia migliore tra `indices` (§4.2): la somiglianza più alta; alla pari
 * (entro `PAIR_TIE_NCC`) due tracce senza perdite, poi lo stesso codec, poi
 * l'ordine delle tracce.
 */
function bestPair(indices: readonly number[], pairs: readonly Pair[], ncc: (i: number) => number): number {
  const top = Math.max(...indices.map(ncc));
  const tied = indices.filter((i) => ncc(i) >= top - PAIR_TIE_NCC);
  const score = (i: number) => {
    const p = pairs[i]!;
    return (isLossless(p.reference) && isLossless(p.donor) ? 2 : 0) +
      ((p.reference.codecId ?? p.reference.codec) === (p.donor.codecId ?? p.donor.codec) ? 1 : 0);
  };
  return tied.reduce((best, i) => (score(i) > score(best) ? i : best));
}

// ---------------------------------------------------------------- misura

/**
 * Misura una coppia di file già passata per i controlli strutturali
 * (`checkStructure`): ruoli e lingua di misura vengono da lì.
 *
 * Errori: quelli della lettura delle finestre (`INPUT_UNREADABLE`,
 * `INPUT_BUSY`, `TOOL_MISSING`); `INTERNAL` se nella lingua di misura non c'è
 * una coppia di tracce o il donatore non ha una traccia italiana.
 */
export async function measurePair(
  files: readonly [InputFile, InputFile],
  roles: { reference: 0 | 1; donor: 0 | 1 },
  measureLanguage: string,
  cal: Calibration,
  options: MeasureOptions = {},
): Promise<Measurement> {
  const tools = options.tools ?? DEFAULT_TOOLS;
  const ref = new Side(files[roles.reference], tools, options.signal);
  const donor = new Side(files[roles.donor], tools, options.signal);
  const v = cal.values;
  const tol = v.toleranceMs;
  const progress = (phase: AnalysisPhase, done: number, total: number | null, outcomes?: MeasureProgress['outcomes']) =>
    options.onProgress?.({ phase, done, total, ...(outcomes ? { outcomes } : {}) });

  const pairs = candidatePairs(ref.file, donor.file, measureLanguage);
  if (pairs.length === 0) {
    throw new DyadrrError('INTERNAL', `no ${measureLanguage} audio track in both files`);
  }

  // 1. Ancore (§4.4). Sulla prima ancora si misurano tutte le coppie, nella
  // stessa lettura; se nessuna dà un picco sicuro, anche sulle ancore dopo.
  const L = v.anchorWindowMs;
  const W = v.maxOffsetMs + v.searchMarginMs;
  const refVideo = ref.file.tracks.find((t) => t.id === ref.file.video.trackId);
  const filmStart = refVideo?.startMs ?? ref.file.startTimeMs ?? 0;
  const anchorSpan = ref.span(pairs.map((p) => p.reference));
  // Sempre oltre l'intervallo di ricerca, così nel donatore c'è posto per ogni S.
  const positions = [...new Set(ANCHOR_FRACTIONS.map((f) =>
    Math.round(clamp(filmStart + Math.max(f * ref.file.video.durationMs, W), anchorSpan.start, anchorSpan.end - L))))];

  const trials: PairTrial[] = [];
  const perPair: AnchorMeasure[][] = pairs.map(() => []);
  let chosen: number | null = null;
  let firstReading: { needles: Map<string, Signal>; hays: Map<string, Signal | null> } | null = null;

  progress('anchors', 0, positions.length);
  for (const [n, position] of positions.entries()) {
    const active = chosen === null ? pairs.map((_, i) => i) : [chosen];
    const unique = (list: TrackSignal[]) => [...new Map(list.map((s) => [key(s), s])).values()];
    const refSignals = unique(active.map((i) => ({ track: pairs[i]!.reference, mix: pairs[i]!.mix })));
    const donorSignals = unique(active.map((i) => ({ track: pairs[i]!.donor, mix: pairs[i]!.mix })));
    const [refWindows, donorWindows] = await Promise.all([
      ref.read(refSignals, position, position + L),
      donor.read(donorSignals, position - W, position + L + W),
    ]);
    if (!refWindows) throw new DyadrrError('INTERNAL', `anchor at ${position} ms is outside the reference tracks`);
    const needles = new Map(refSignals.map((s, j) => [key(s), refWindows[j]!]));
    const hays = new Map(donorSignals.map((s, j) => [key(s), donorWindows?.[j] ?? null]));
    firstReading ??= { needles, hays };

    // Ogni tratto del donatore si trasforma una volta per tutte le coppie che lo usano.
    const matches = new Map<number, Match | null>();
    for (const s of donorSignals) {
      const users = active.filter((i) => key({ track: pairs[i]!.donor, mix: pairs[i]!.mix }) === key(s));
      const found = search(users.map((i) => needles.get(key({ track: pairs[i]!.reference, mix: pairs[i]!.mix }))!), hays.get(key(s))!, cal);
      users.forEach((i, k) => matches.set(i, found[k]!));
    }
    for (const i of active) {
      const needle = needles.get(key({ track: pairs[i]!.reference, mix: pairs[i]!.mix }))!;
      const m = matches.get(i) ?? null;
      // Senza audio del donatore nell'intervallo non c'è corrispondenza.
      perPair[i]!.push({ positionMs: round3(needle.startMs), ...(m ?? { offsetMs: 0, ncc: 0, ratio: 0 }) });
      if (chosen === null) trials.push({ ...pairIds(pairs[i]!), positionMs: round3(needle.startMs), match: m });
    }
    progress('anchors', n + 1, positions.length);
    if (chosen === null) {
      const confident = active.filter((i) => isConfident(matches.get(i), cal));
      if (confident.length > 0) chosen = bestPair(confident, pairs, (i) => matches.get(i)!.ncc);
    }
    if (chosen !== null) {
      const sure = perPair[chosen]!.filter((a) => isConfident(a, cal));
      // Due ancore sicure bastano; con S oltre il massimo la decisione si ferma lì.
      if (sure.length >= 2 || Math.abs(sure[0]!.offsetMs) > v.maxOffsetMs) break;
    }
  }

  // Senza ancore sicure si tiene la coppia più somigliante.
  const pick = chosen ?? bestPair(pairs.map((_, i) => i), pairs, (i) => Math.max(...perPair[i]!.map((a) => a.ncc)));
  const result = (fields: Partial<Measurement>): Measurement => ({
    measureLanguage,
    pairs: trials,
    pair: pairIds(pairs[pick]!),
    anchors: perPair[pick]!,
    speedRatio: null,
    anchorOffsetMs: null,
    boundaries: null,
    checkpoints: null,
    edgeProbes: null,
    transfer: null,
    ...fields,
    bytesRead: { reference: ref.bytes, donor: donor.bytes },
  });

  const pair = pairs[pick]!;
  const signal: TrackSignal = { track: pair.donor, mix: pair.mix };
  if (chosen === null) {
    // Diagnosi di velocità sul tratto della prima ancora, già in memoria.
    const needle = firstReading!.needles.get(key({ track: pair.reference, mix: pair.mix }))!;
    const hay = firstReading!.hays.get(key(signal)) ?? null;
    for (const ratio of SPEED_RATIOS.flatMap((r) => [r, 1 / r])) {
      const [m] = search([{ startMs: needle.startMs, samples: stretch(needle.samples, ratio) }], hay, cal);
      if (isConfident(m, cal)) return result({ speedRatio: Math.round(ratio * 1e6) / 1e6 });
    }
    return result({});
  }

  const anchors = perPair[pick]!;
  const S = anchors.find((a) => isConfident(a, cal))!.offsetMs;
  const agreeing = anchors.filter((a) => isConfident(a, cal) && Math.abs(a.offsetMs - S) <= tol);
  if (Math.abs(S) > v.maxOffsetMs || agreeing.length < anchors.filter((a) => isConfident(a, cal)).length) {
    return result({ anchorOffsetMs: S });
  }

  // Le misure dopo le ancore usano solo la coppia scelta.
  const Lc = v.checkpointWindowMs;
  const refSignal: TrackSignal = { track: pair.reference, mix: pair.mix };
  const refSpan = ref.span([pair.reference]);
  const donorSpan = donor.span([pair.donor]);

  interface Local {
    needle: Signal;
    energyDbfs: number;
    local: Match | null;
  }

  /**
   * Il tratto [x, x + len] del riferimento cercato nel donatore vicino a S
   * (±1 s), con l'energia della finestra corrispondente del donatore. Su una
   * finestra muta non si correla: il non conclusivo si decide dall'energia.
   */
  const localCheck = async (x: number, len: number): Promise<Local> => {
    const [refWindows, donorWindows] = await Promise.all([
      ref.read([refSignal], x, x + len),
      donor.read([signal], x - S - LOCAL_SEARCH_MS, x + len - S + LOCAL_SEARCH_MS),
    ]);
    if (!refWindows) throw new DyadrrError('INTERNAL', `window at ${x} ms is outside reference track ${pair.reference.id}`);
    const needle = refWindows[0]!;
    const hay = donorWindows?.[0] ?? null;
    const e = energy(hay && slice(hay, needle.startMs - S, needle.startMs - S + durationOf(needle)));
    return { needle, energyDbfs: e, local: e >= v.silenceDbfs ? search([needle], hay, cal)[0]! : null };
  };

  /**
   * L'inizio, nel donatore, del tratto lungo `len` con energia sopra E_min più
   * vicino a `preferMs`, con l'inizio tra `fromMs` e `toMs` (§4.5, punto 2).
   */
  const findContent = async (fromMs: number, toMs: number, len: number, preferMs: number): Promise<number | null> => {
    if (toMs < fromMs) return null;
    const windows = await donor.read([signal], fromMs, toMs + len);
    if (!windows) return null;
    const w = windows[0]!;
    const n = Math.round(len * MS);
    const sums = new Float64Array(w.samples.length + 1);
    for (let i = 0; i < w.samples.length; i++) sums[i + 1] = sums[i]! + w.samples[i]! * w.samples[i]!;
    const steps = Math.ceil(Math.max(preferMs - fromMs, toMs - preferMs) / CONTENT_STEP_MS);
    for (let k = 0; k <= steps; k++) {
      for (const q of k === 0 ? [preferMs] : [preferMs - k * CONTENT_STEP_MS, preferMs + k * CONTENT_STEP_MS]) {
        if (q < fromMs || q > toMs) continue;
        const i = Math.round((q - w.startMs) * MS);
        if (i < 0 || i + n > w.samples.length) continue;
        if (10 * Math.log10((sums[i + n]! - sums[i]!) / n) >= v.silenceDbfs) return w.startMs + i / MS;
      }
    }
    return null;
  };

  const wideSearch = async (needle: Signal): Promise<Match | null> => {
    const hay = await donor.read([signal], needle.startMs - W, needle.startMs + durationOf(needle) + W);
    return search([needle], hay?.[0] ?? null, cal)[0]!;
  };

  // 2. Confini del materiale in comune (§4.6): dalle ancore coerenti verso
  // l'inizio e verso la fine, a metà per volta. "In comune" vuol dire che il
  // tratto ha un picco sicuro vicino a S: se il film continua a uno spostamento
  // poco diverso (un salto, una deriva) lo dicono i punti di conferma.
  //
  // Ogni prova dà il punto `at` che restringe l'intervallo [lo, hi] in cui sta
  // il confine: l'inizio della finestra per il confine iniziale, la fine per
  // quello finale. Una finestra muta si sposta sul contenuto più vicino, ma
  // strettamente dentro l'intervallo, così ogni prova lo restringe; se intorno
  // è tutto muto, il tratto muto resta fuori dal materiale in comune.
  type Verdict = { kind: 'match' | 'mismatch' | 'silent'; at: number };
  let edgeTests = 0;
  const boundaryTest = async (side: 'start' | 'end', m: number, len: number, lo: number, hi: number): Promise<Verdict> => {
    progress('edges', edgeTests++, null);
    const startOf = (at: number) => (side === 'start' ? at : at - len);
    let r = await localCheck(startOf(m), len);
    let at = m;
    if (r.energyDbfs < v.silenceDbfs) {
      const margin = EDGE_PRECISION_MS / 2;
      const from = Math.max(lo + margin, m - CONTENT_SHIFT_MS);
      const to = Math.min(hi - margin, m + CONTENT_SHIFT_MS);
      const q = await findContent(startOf(from) - S, startOf(to) - S, len, startOf(m) - S);
      if (q === null) return { kind: 'silent', at: m };
      r = await localCheck(q + S, len);
      at = side === 'start' ? r.needle.startMs : r.needle.startMs + len;
    }
    return { kind: isConfident(r.local, cal) ? 'match' : 'mismatch', at };
  };

  const lo0 = Math.max(refSpan.start, donorSpan.start + S);
  const hi0 = Math.min(refSpan.end, donorSpan.end + S);
  const firstAnchor = Math.min(...agreeing.map((a) => a.positionMs));
  const lastAnchorEnd = Math.max(...agreeing.map((a) => a.positionMs + L));

  // Si prova prima l'estremo: di solito il materiale in comune arriva fin lì.
  // Le finestre lunghe finché l'intervallo è largo, poi quelle brevi.
  let lo = lo0;
  let hi = clamp(firstAnchor, lo0, hi0);
  const startStep = (r: Verdict) => (r.kind === 'match' ? (hi = Math.min(hi, r.at)) : (lo = Math.max(lo, r.at)));
  startStep(await boundaryTest('start', lo, Lc, lo, hi));
  for (let n = 0; hi - lo > EDGE_PRECISION_MS && n < EDGE_MAX_TESTS; n++) {
    startStep(await boundaryTest('start', (lo + hi) / 2, hi - lo > Lc ? Lc : EDGE_WINDOW_MS, lo, hi));
  }
  const startMs = Math.round(hi);

  lo = clamp(lastAnchorEnd, startMs, hi0);
  hi = hi0;
  const endStep = (r: Verdict) => (r.kind === 'match' ? (lo = Math.max(lo, r.at)) : (hi = Math.min(hi, r.at)));
  endStep(await boundaryTest('end', hi, Lc, lo, hi));
  for (let n = 0; hi - lo > EDGE_PRECISION_MS && n < EDGE_MAX_TESTS; n++) {
    endStep(await boundaryTest('end', (lo + hi) / 2, hi - lo > Lc ? Lc : EDGE_WINDOW_MS, lo, hi));
  }
  const endMs = Math.round(lo);
  const boundaries = { startMs, endMs };

  // 3. Punti di conferma (§4.5), al centro di intervalli uguali del materiale
  // in comune. Una finestra muta si sposta sul contenuto, ma resta nel suo
  // intervallo: al massimo metà della distanza dai vicini, e 60 s.
  const measureCheckpoint = async (x: number, bound: number, added: boolean): Promise<MeasuredCheckpoint> => {
    let r = await localCheck(x, Lc);
    if (r.energyDbfs < v.silenceDbfs) {
      const from = Math.max(x - bound, startMs);
      const to = Math.min(x + bound, endMs - Lc);
      const q = await findContent(from - S, to - S, Lc, x - S);
      if (q !== null) r = await localCheck(q + S, Lc);
    }
    // Senza corrispondenza vicina: di nuovo su tutto l'intervallo ±(S_max + margine).
    const wide = r.energyDbfs >= v.silenceDbfs && !isConfident(r.local, cal) ? await wideSearch(r.needle) : null;
    return {
      requestedMs: round3(x),
      positionMs: round3(r.needle.startMs),
      energyDbfs: r.energyDbfs,
      local: r.local,
      wide,
      added,
    };
  };

  /** Esito di un punto, con le regole della decisione (§9.6). */
  const outcome = (c: CheckpointMeasure) => {
    if (c.energyDbfs < v.silenceDbfs) return 'inconclusive';
    const m = isConfident(c.local, cal) ? c.local : isConfident(c.wide, cal) ? c.wide : null;
    if (m === null) return 'unmatched';
    return Math.abs(m.offsetMs - S) <= tol ? 'consistent' : 'contradictory';
  };

  /** I punti coerenti bastano e sono distribuiti bene (§9.3)? */
  const coverageOk = (consistent: readonly number[]) => {
    const edge = (endMs - startMs) * v.edgeFraction;
    let gap = 0;
    for (let i = 1; i < consistent.length; i++) gap = Math.max(gap, consistent[i]! - consistent[i - 1]!);
    return consistent.length >= v.minConsistentCheckpoints && gap <= v.maxCheckpointGapMs &&
      consistent.some((p) => p <= startMs + edge) && consistent.some((p) => p >= endMs - edge);
  };

  const checkpoints: MeasuredCheckpoint[] = [];
  const checkpointProgress = () => {
    const outcomes = { consistent: 0, inconclusive: 0, contradictory: 0, unmatched: 0 };
    for (const c of checkpoints) outcomes[outcome(c)]++;
    progress('checkpoints', checkpoints.length, Math.max(v.checkpointCount, checkpoints.length), outcomes);
  };
  checkpointProgress();
  const slot = (endMs - startMs) / v.checkpointCount;
  for (let i = 0; i < v.checkpointCount; i++) {
    const x = clamp(startMs + (i + 0.5) * slot - Lc / 2, startMs, endMs - Lc);
    checkpoints.push(await measureCheckpoint(x, Math.min(CONTENT_SHIFT_MS, slot / 2), false));
    checkpointProgress();
  }

  // Punti aggiunti nei tratti scoperti (§4.5, punto 7): finché la
  // distribuzione dei punti coerenti non basta, a metà del buco più lungo tra
  // due punti coerenti (o tra un confine e il primo punto coerente). Un buco
  // in cui il punto aggiunto non è coerente non si riprova.
  const tried = new Set<string>();
  while (checkpoints.length < v.maxCheckpointCount) {
    const outcomes = checkpoints.map(outcome);
    if (outcomes.some((o) => o === 'contradictory' || o === 'unmatched')) break;
    const consistent = checkpoints.filter((_, i) => outcomes[i] === 'consistent').map((c) => c.positionMs).sort((a, b) => a - b);
    if (coverageOk(consistent)) break;
    const marks = [startMs, ...consistent, endMs - Lc];
    let gap: [number, number] | null = null;
    for (let i = 1; i < marks.length; i++) {
      const [a, b] = [marks[i - 1]!, marks[i]!];
      if (b - a >= Lc && !tried.has(`${a}-${b}`) && (gap === null || b - a > gap[1] - gap[0])) gap = [a, b];
    }
    if (gap === null) break;
    const point = await measureCheckpoint((gap[0] + gap[1]) / 2, Math.min(CONTENT_SHIFT_MS, (gap[1] - gap[0]) / 4), true);
    checkpoints.push(point);
    checkpointProgress();
    if (outcome(point) !== 'consistent') tried.add(`${gap[0]}-${gap[1]}`);
  }
  checkpoints.sort((a, b) => a.positionMs - b.positionMs);

  const blocked = checkpoints.some((c) => outcome(c) === 'contradictory' || outcome(c) === 'unmatched');
  if (blocked) return result({ anchorOffsetMs: S, boundaries, checkpoints });

  // 4. Oltre i confini (§4.6): il riferimento prima del confine iniziale e dopo
  // quello finale, cercato nel donatore a qualsiasi spostamento.
  const edgeProbes: EdgeProbe[] = [];
  progress('edge-probes', 0, null);
  for (const side of ['start', 'end'] as const) {
    const outside = side === 'start' ? startMs - refSpan.start : refSpan.end - endMs;
    if (outside < EDGE_WINDOW_MS) continue;
    const len = Math.min(Lc, outside);
    const count = Math.max(1, Math.min(EDGE_PROBES, Math.floor(outside / len)));
    const spacing = count > 1 ? (outside - len) / (count - 1) : 0;
    for (let j = 0; j < count; j++) {
      // La prima ricerca è quella accanto al confine.
      const x = side === 'start' ? startMs - len - j * spacing : endMs + j * spacing;
      const windows = await ref.read([refSignal], x, x + len);
      if (!windows) continue;
      edgeProbes.push({ side, positionMs: round3(windows[0]!.startMs), match: await wideSearch(windows[0]!) });
      progress('edge-probes', edgeProbes.length, null);
    }
  }

  // 5. Controllo di trasferimento (§4.7): nel donatore, italiano contro lingua
  // di misura, al centro di intervalli uguali del materiale in comune.
  const italian = mainItalianTrack(donor.file.audio);
  if (italian === null) throw new DyadrrError('INTERNAL', 'the donor has no Italian audio track');
  const transferAt = transferPositions(startMs, endMs, Lc).map((x) => x - S);
  progress('transfer', 0, transferAt.length);
  const transferProbes = (await transferProbesIn(donor, pair.donor, italian, transferAt, cal))
    .map((probe) => ({ ...probe, positionMs: round3(probe.positionMs + S) }));
  progress('transfer', transferProbes.length, transferAt.length);

  return result({
    anchorOffsetMs: S,
    boundaries,
    checkpoints,
    edgeProbes,
    transfer: { measureTrackId: pair.donor.id, italianTrackId: italian.id, probes: transferProbes },
  });
}

/**
 * Posizioni del controllo di trasferimento (§4.7): l'inizio di una finestra
 * lunga `windowMs` al centro di ognuno di `TRANSFER_PROBES` intervalli uguali
 * tra `fromMs` e `toMs`.
 */
export function transferPositions(fromMs: number, toMs: number, windowMs: number): number[] {
  return Array.from({ length: TRANSFER_PROBES }, (_, i) =>
    clamp(fromMs + ((i + 0.5) * (toMs - fromMs)) / TRANSFER_PROBES - windowMs / 2, fromMs, toMs - windowMs));
}

/**
 * Il controllo di trasferimento in un file (§4.7): in ogni posizione, la
 * finestra della lingua di misura cercata nell'italiano vicino allo
 * spostamento zero (±1 s), sui canali non centrali. Lo spostamento è come S:
 * posizione nella lingua di misura − posizione nell'italiano. Posizioni sulla
 * linea del tempo del file.
 */
async function transferProbesIn(
  side: Side,
  measure: InputTrack,
  italian: InputTrack,
  positions: readonly number[],
  cal: Calibration,
): Promise<MeasuredTransferProbe[]> {
  const len = cal.values.checkpointWindowMs;
  const mix = transferMix(measure, italian);
  const signals: TrackSignal[] = [{ track: measure, mix }, { track: italian, mix }];
  if (mix === 'side') signals.push({ track: measure, mix: 'leftRight' }, { track: italian, mix: 'leftRight' });
  const probes: MeasuredTransferProbe[] = [];
  for (const x of positions) {
    const w = await side.read(signals, x - LOCAL_SEARCH_MS, x + len + LOCAL_SEARCH_MS);
    if (!w) {
      probes.push({ positionMs: round3(x), match: null, mix });
      continue;
    }
    let used = mix;
    let needle = slice(w[0]!, x, x + len);
    let hay = w[1]!;
    // (L − R)/2 è muto se la traccia è un mono su due canali: si torna a L+R.
    if (mix === 'side' && energy(needle) < cal.values.silenceDbfs) {
      used = 'leftRight';
      needle = slice(w[2]!, x, x + len);
      hay = w[3]!;
    }
    probes.push({ positionMs: round3(needle.startMs), match: search([needle], hay, cal)[0]!, mix: used });
  }
  return probes;
}

/**
 * Il controllo di trasferimento nel file finale (§9.5): la traccia della
 * lingua di misura del riferimento contro l'italiano principale, che lì
 * devono correlare a spostamento circa zero. Posizioni sulla linea del tempo
 * del file.
 *
 * Errori: quelli della lettura delle finestre (`INPUT_UNREADABLE`,
 * `INPUT_BUSY`, `TOOL_MISSING`).
 */
export async function measureTransfer(
  file: InputFile,
  measureTrackId: number,
  italianTrackId: number,
  positions: readonly number[],
  cal: Calibration,
  options: MeasureOptions = {},
): Promise<{ probes: MeasuredTransferProbe[]; bytesRead: number }> {
  const side = new Side(file, options.tools ?? DEFAULT_TOOLS, options.signal);
  const track = (id: number) => {
    const t = file.audio.find((x) => x.id === id);
    if (!t) throw new DyadrrError('INTERNAL', `${file.path}: no audio track with ID ${id}`);
    return t;
  };
  const probes = await transferProbesIn(side, track(measureTrackId), track(italianTrackId), positions, cal);
  return { probes, bytesRead: side.bytes };
}

/** Le misure nella forma che la decisione si aspetta; quelle non fatte restano assenti. */
export function decisionMeasures(m: Measurement): Omit<DecisionInput, 'files' | 'originalLanguage'> {
  return {
    anchors: m.anchors,
    speedRatio: m.speedRatio,
    ...(m.checkpoints ? { checkpoints: m.checkpoints } : {}),
    ...(m.boundaries && m.edgeProbes ? { commonMaterial: { ...m.boundaries, probes: m.edgeProbes } } : {}),
    ...(m.transfer ? { transfer: m.transfer.probes } : {}),
  };
}

export interface PairAnalysis {
  report: DecisionReport;
  /** `null` se un controllo strutturale ha già deciso: niente da misurare. */
  measurement: Measurement | null;
  /** Piano di inizio e fine (`plan.ts`), solo per una coppia idonea. */
  plan: Plan | null;
}

export interface AnalyzeOptions extends MeasureOptions {
  /** Scelte indicate da opzione o variabile d'ambiente; quelle che mancano restano in sospeso. */
  choices?: GivenChoices;
}

/**
 * Analisi di una coppia: controlli strutturali, misura se servono, decisione
 * e, per una coppia idonea, il piano. Senza i controlli strutturali passati
 * non si legge l'audio: un ingresso troncato o un donatore con il video
 * migliore non costano gigabyte di lettura.
 */
export async function analyzePair(
  files: readonly [InputFile, InputFile],
  originalLanguage: string | null,
  cal: Calibration,
  options: AnalyzeOptions = {},
): Promise<PairAnalysis> {
  const structure = checkStructure({ files, originalLanguage }, cal);
  if (structure.decision !== 'eligible') return { report: structure, measurement: null, plan: null };
  const roles = structure.roles!;
  const measurement = await measurePair(files, roles, structure.measureLanguage!.language, cal, options);
  const report = decide({ files, originalLanguage, ...decisionMeasures(measurement) }, cal);
  if (report.decision !== 'eligible') return { report, measurement, plan: null };
  // Il piano parte dallo S definitivo, intero, e dai confini del materiale in comune.
  if (!report.offset || !measurement.boundaries) throw new DyadrrError('INTERNAL', 'eligible pair without offset or boundaries');
  options.onProgress?.({ phase: 'plan', done: 0, total: null });
  const plan = await planPair(
    files[roles.reference],
    files[roles.donor],
    report.offset.offsetMs,
    measurement.boundaries,
    options.choices ?? {},
    cal,
    options,
  );
  return { report, measurement, plan };
}
