import type { Calibration } from './calibration.js';
import { energyDbfs, hasCenter, readAudioWindow, trackSpan, type AudioSignal } from './audio.js';
import {
  CHOICES,
  CHOICE_NAMES,
  resolveChoices,
  type ChoiceName,
  type ChoiceState,
  type GivenChoices,
} from './choices.js';
import { DyadrrError, type WarningCode } from './codes.js';
import type { Warning } from './decision.js';
import { isCommentaryOrDescription, mainItalianTrack, type InputFile, type InputTrack } from './inputs.js';
import { ITALIAN, isItalian, trackLanguage } from './languages.js';
import { DEFAULT_TOOLS, type ToolPaths } from './tools.js';

// Piano di inizio e fine (studio §5, §7, §8, §10.1): dallo S definitivo e dai
// confini del materiale in comune a dove comincia e finisce l'italiano nel
// file finale, quali tracce italiane si prendono, quali scelte servono e con
// quale effetto, e gli avvisi del piano. `planMerge` è una funzione pura;
// `planPair` le aggiunge il livello dell'italiano nei punti di taglio
// iniziale, letto dal donatore (`ABRUPT_START`).
//
// Tutte le posizioni sono sulla linea del tempo del riferimento (§4.1): un
// istante t del donatore vi cade a t + S.

// Costanti del metodo, non parametri di taratura (§5): dicono dove e come si
// misura, non quando una coppia è idonea.

/**
 * Un'intro o una coda diversa, o un eccesso in coda, più corti di così non
 * contano: niente scelta, niente taglio, niente avviso. È la precisione dei
 * confini (§4.6): la ricerca si ferma con l'intervallo sotto 1 s, quindi un
 * tratto misurato oltre 1 s fuori dal materiale in comune c'è davvero.
 */
export const PLAN_PRECISION_MS = 1000;

/** Tratto dopo un taglio iniziale su cui si misura il livello dell'italiano (`ABRUPT_START`, §5). */
export const CUT_LEVEL_WINDOW_MS = 250;

// ---------------------------------------------------------------- tipi

/** Quello che il piano usa di un ingresso. */
export type PlanFile = Pick<InputFile, 'tracks' | 'video' | 'startTimeMs' | 'durationMs'>;

/** Livello di una traccia italiana subito dopo un punto di taglio iniziale. */
export interface CutLevel {
  /** Punto di taglio, sulla linea del tempo del riferimento. */
  atMs: number;
  trackId: number;
  /** Il più alto tra centrale (se c'è) e L+R, in dBFS; −∞ per un tratto tutto a zero. */
  levelDbfs: number;
}

export interface PlanInput {
  reference: PlanFile;
  donor: PlanFile;
  /** S definitivo, intero (`offset.offsetMs` della decisione). */
  offsetMs: number;
  /** Confini del materiale in comune (§4.6). */
  commonMaterial: { startMs: number; endMs: number };
  /** Scelte indicate da opzione o variabile d'ambiente (§10.1). */
  choices: GivenChoices;
  /** Livelli nei punti di taglio iniziale (`startCuts`); servono per ogni taglio che il piano fa. */
  cutLevels?: readonly CutLevel[];
}

/**
 * Chi ha più materiale a un estremo (§5): `reference-longer` se l'italiano
 * comincia dopo l'inizio del film (o finisce prima della fine), `donor-longer`
 * se comincia prima (o finisce dopo).
 */
export type EdgeCase = 'aligned' | 'reference-longer' | 'donor-longer';

interface PlanEdge {
  case: EdgeCase;
  /** Di quanto, in ms. */
  amountMs: number;
  /** Italiano su un'intro o una coda diversa, fuori dal materiale in comune; 0 se non c'è (sotto 1 s). */
  mismatchMs: number;
  /** Punto di taglio dell'italiano; `null` se non si taglia o se dipende da una scelta in sospeso. */
  cutMs: number | null;
  /** Tratto del film senza italiano a questo estremo; `null` se dipende da una scelta in sospeso. */
  gapMs: number | null;
}

export interface PlanStart extends PlanEdge {
  /** Livello dell'italiano subito dopo il taglio (il più alto tra le tracce tagliate); `null` senza taglio. */
  cutLevelDbfs: number | null;
}

export interface PlanEnd extends PlanEdge {
  /**
   * Italiano oltre la fine del video di riferimento: `none` se non c'è (o è
   * sotto 1 s), `trimmed` se si toglie, `kept` se si lascia; `null` in sospeso.
   */
  excess: 'none' | 'trimmed' | 'kept' | null;
  /** Quanto italiano c'è oltre la fine del video, in ms (0 se finisce prima). */
  excessMs: number;
}

export type AudioRole = 'main' | 'commentary' | 'other';

/** Una traccia audio italiana del donatore (§8, §11.2 punto 6). */
export interface PlannedAudioTrack {
  id: number;
  name: string | null;
  /** Ruolo stimato: la principale (predefinita), un commento o un'audiodescrizione, un'altra. */
  role: AudioRole;
  reason: string;
  /** Presa nel file finale; `null` finché `--italian` è in sospeso. */
  taken: boolean | null;
  /** Inizio e fine nel file finale; `null` se dipendono da una scelta in sospeso. */
  startMs: number | null;
  endMs: number | null;
}

/** Classificazione di una traccia di sottotitoli (§7). */
export interface SubtitleClass {
  id: number;
  language: string | null;
  name: string | null;
  pgs: boolean;
  forced: boolean;
  /** Perché è forced: il flag, il nome, oppure molti meno blocchi della traccia più grande della sua lingua. */
  forcedBy: 'flag' | 'name' | 'blocks' | null;
  /** Blocchi dai tag statistici (`NUMBER_OF_FRAMES`); `null` se mancano. */
  blocks: number | null;
  commentary: boolean;
  reason: string;
}

/** Un sottotitolo italiano del donatore: si prendono i PGS, gli altri si scartano (§7). */
export interface PlannedSubtitleTrack extends SubtitleClass {
  taken: boolean;
}

/** Un PGS italiano già nel riferimento (§7): tenuto o scartato con `--reference-italian-subs`. */
export interface ReferenceItalianSubtitle extends SubtitleClass {
  /** `null` finché la scelta è in sospeso. */
  kept: boolean | null;
}

/** Quello che succede con un valore di una scelta (§10.1). */
export interface ChoiceEffect {
  value: string;
  /** Intervallo dell'italiano; `null` se dipende da un'altra scelta in sospeso. */
  italianStartMs: number | null;
  italianEndMs: number | null;
  /** Tracce audio italiane prese; `null` se dipende da `--italian` in sospeso. */
  audioTrackIds: number[] | null;
  /** PGS italiani del riferimento tenuti; `null` se dipende da `--reference-italian-subs` in sospeso. */
  referenceSubtitleTrackIds: number[] | null;
  /** Avvisi che scatterebbero, salvo quelli che dipendono da un'altra scelta in sospeso. */
  warnings: WarningCode[];
}

export type PlanChoice = ChoiceState & { effects: ChoiceEffect[] };

export interface Plan {
  offsetMs: number;
  /** Il film: il video del riferimento, dal primo timestamp alla fine dell'ultimo fotogramma. */
  film: { startMs: number; endMs: number };
  commonMaterial: { startMs: number; endMs: number };
  start: PlanStart;
  end: PlanEnd;
  /** Intervallo in cui l'italiano è presente (tracce prese); `null` se dipende da una scelta in sospeso. */
  italian: { startMs: number | null; endMs: number | null };
  audio: PlannedAudioTrack[];
  subtitles: PlannedSubtitleTrack[];
  referenceItalianSubtitles: ReferenceItalianSubtitle[];
  /** Tutte le scelte, con l'effetto di ogni valore per quelle necessarie. */
  choices: PlanChoice[];
  /** Scelte necessarie in sospeso: il merge le chiede, o si ferma con `CHOICE_REQUIRED`. */
  pending: ChoiceName[];
  warnings: Warning[];
}

// ---------------------------------------------------------------- tracce

const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** PGS (HDMV) dei Blu-ray. */
export function isPgs(track: Pick<InputTrack, 'codec' | 'codecId'>): boolean {
  return track.codecId === 'S_HDMV/PGS' || /\bPGS\b/i.test(track.codec);
}

const FORCED_NAME = /forced|forzati/i;

/**
 * Classifica le tracce di sottotitoli di un file (§7). Una traccia è forced se
 * ha il flag, se il nome lo dice ("forced", "forzati"), o se ha meno blocchi
 * di `forcedSubsFraction` di quelli della traccia più grande della sua lingua.
 * I blocchi vengono dai tag statistici: contare i sottotitoli vorrebbe dire
 * leggere tutto il file.
 */
export function classifySubtitles(tracks: readonly InputTrack[], cal: Calibration): SubtitleClass[] {
  const fraction = cal.values.forcedSubsFraction;
  const subtitles = tracks.filter((t) => t.type === 'subtitles');
  const largest = new Map<string | null, number>();
  for (const t of subtitles) {
    const blocks = t.statistics?.frames ?? null;
    const language = trackLanguage(t);
    if (blocks !== null) largest.set(language, Math.max(largest.get(language) ?? 0, blocks));
  }
  return subtitles.map((t): SubtitleClass => {
    const language = trackLanguage(t);
    const blocks = t.statistics?.frames ?? null;
    const top = largest.get(language) ?? null;
    const base = { id: t.id, language, name: t.name, pgs: isPgs(t), blocks, commentary: isCommentaryOrDescription(t) };
    if (t.forced) return { ...base, forced: true, forcedBy: 'flag', reason: 'forced flag set' };
    if (FORCED_NAME.test(t.name ?? '')) return { ...base, forced: true, forcedBy: 'name', reason: `the name "${t.name}" says forced` };
    if (blocks === null || top === null || top === 0) {
      return { ...base, forced: false, forcedBy: null, reason: 'no forced flag or name, and no block count to compare' };
    }
    const share = `${blocks} blocks, ${round2((blocks / top) * 100)}% of the largest ${language ?? 'und'} track (${top})`;
    return blocks < fraction * top
      ? { ...base, forced: true, forcedBy: 'blocks', reason: `${share}: below ${round2(fraction * 100)}%` }
      : { ...base, forced: false, forcedBy: null, reason: blocks === top ? `${blocks} blocks, the largest ${language ?? 'und'} track` : share };
  });
}

/** Ruolo stimato di ogni traccia audio italiana, con il motivo (§8). */
function audioRoles(italian: readonly InputTrack[], main: InputTrack): Map<number, { role: AudioRole; reason: string }> {
  const roles = new Map<number, { role: AudioRole; reason: string }>();
  for (const t of italian) {
    if (t === main) {
      const reason = t.default
        ? 'default flag set in the donor'
        : !isCommentaryOrDescription(t) ? 'first Italian track that does not look like a commentary or audio description'
        : 'first Italian track (all of them look like commentaries or audio descriptions)';
      roles.set(t.id, { role: 'main', reason });
    } else if (isCommentaryOrDescription(t)) {
      const why = t.commentary ? 'commentary flag' : t.visualImpaired ? 'visual impaired flag' : `name "${t.name}"`;
      roles.set(t.id, { role: 'commentary', reason: `looks like a commentary or audio description (${why})` });
    } else {
      roles.set(t.id, { role: 'other', reason: 'not the main track' });
    }
  }
  return roles;
}

// ---------------------------------------------------------------- piano

interface Timeline {
  S: number;
  film: { startMs: number; endMs: number };
  common: { startMs: number; endMs: number };
  italianAudio: InputTrack[];
  main: InputTrack;
  /** Inizio e fine di ogni traccia audio italiana, sulla linea del tempo del riferimento. */
  extents: Map<number, { start: number; end: number }>;
}

/** Il film, il materiale in comune e le tracce audio italiane, sulla linea del tempo del riferimento. */
function timeline(input: Omit<PlanInput, 'choices' | 'cutLevels'>): Timeline {
  const { reference, donor, offsetMs: S } = input;
  const refVideo = reference.tracks.find((t) => t.id === reference.video.trackId);
  const filmStart = refVideo?.startMs ?? reference.startTimeMs ?? 0;
  const italianAudio = donor.tracks.filter((t) => t.type === 'audio' && isItalian(t));
  const main = mainItalianTrack(italianAudio);
  if (main === null) throw new DyadrrError('INTERNAL', 'plan: the donor has no Italian audio track');
  // La fine è quella dell'ultimo pacchetto, se è stata letta in coda; altrimenti dai tag statistici.
  const extents = new Map(italianAudio.map((t) => {
    const span = trackSpan(donor, t);
    return [t.id, { start: round3(span.start + S), end: round3((t.endMs ?? span.end) + S) }];
  }));
  return {
    S,
    film: { startMs: filmStart, endMs: round3(filmStart + reference.video.durationMs) },
    common: input.commonMaterial,
    italianAudio,
    main,
    extents,
  };
}

interface Context extends Timeline {
  cal: Calibration;
  donorSubtitles: SubtitleClass[];
  referenceItalianPgs: SubtitleClass[];
  referenceForcedOther: SubtitleClass[];
  sdrOnHdr: boolean;
  levels: readonly CutLevel[];
}

function context(input: PlanInput, cal: Calibration): Context {
  const referenceSubtitles = classifySubtitles(input.reference.tracks, cal);
  return {
    ...timeline(input),
    cal,
    donorSubtitles: classifySubtitles(input.donor.tracks, cal).filter((s) => s.language === ITALIAN),
    referenceItalianPgs: referenceSubtitles.filter((s) => s.language === ITALIAN && s.pgs),
    referenceForcedOther: referenceSubtitles.filter((s) => s.language !== ITALIAN && s.forced),
    sdrOnHdr: input.donor.video.hdr === 'SDR' && input.reference.video.hdr !== 'SDR',
    levels: input.cutLevels ?? [],
  };
}

/** Un taglio dell'italiano: nessuno, in un punto, oppure in sospeso su una scelta. */
type Cut = { kind: 'none' } | { kind: 'at'; ms: number } | { kind: 'pending' };
const NONE: Cut = { kind: 'none' };
const PENDING: Cut = { kind: 'pending' };
const at = (ms: number): Cut => ({ kind: 'at', ms });

interface Layout {
  needed: Set<ChoiceName>;
  /** Tracce audio prese; `null` con `--italian` in sospeso. */
  taken: InputTrack[] | null;
  naturalStart: number;
  naturalEnd: number;
  startMismatch: number;
  endMismatch: number;
  excess: number;
  startCut: Cut;
  endCut: Cut;
  italianStart: number | null;
  italianEnd: number | null;
  cutLevel: number | null;
  referenceSubtitlesKept: boolean | null;
  warnings: Warning[];
}

const mismatch = (ms: number) => (ms > PLAN_PRECISION_MS ? round3(ms) : 0);

/**
 * Il piano con i valori dati delle scelte: un valore manca se la scelta è in
 * sospeso, e allora quello che ne dipende resta in sospeso. I valori delle
 * scelte che non servono non si usano.
 */
function layout(ctx: Context, values: Partial<Record<ChoiceName, string>>): Layout {
  const { film, common, cal } = ctx;
  const needed = new Set<ChoiceName>();
  const warnings: Warning[] = [];
  const warn = (code: WarningCode, message: string, value?: number) => {
    warnings.push(value === undefined ? { code, message } : { code, message, value });
  };
  const value = (name: ChoiceName, isNeeded: boolean) => {
    if (isNeeded) needed.add(name);
    return isNeeded ? values[name] : undefined;
  };

  // Tracce audio (§8): con una sola traccia italiana non c'è niente da scegliere.
  const italian = value('italian', ctx.italianAudio.length > 1);
  const taken = ctx.italianAudio.length === 1 || italian === 'all' ? ctx.italianAudio
    : italian === 'main' ? [ctx.main]
    : null;
  if (italian === 'main') {
    for (const t of ctx.italianAudio.filter((x) => x !== ctx.main)) {
      warn('ITALIAN_TRACKS_SKIPPED', `Italian audio track ${t.id}${t.name ? ` ("${t.name}")` : ''} skipped: only the main track is taken`, t.id);
    }
  }

  // Estensione dell'italiano: le tracce prese, o tutte finché la scelta è in sospeso.
  const span = (taken ?? ctx.italianAudio).map((t) => ctx.extents.get(t.id)!);
  const naturalStart = Math.min(...span.map((s) => s.start));
  const naturalEnd = Math.max(...span.map((s) => s.end));

  // Intro e code diverse: italiano fuori dal materiale in comune, dentro il film (§5).
  const startMismatch = mismatch(common.startMs - Math.max(naturalStart, film.startMs));
  const endMismatch = mismatch(Math.min(naturalEnd, film.endMs) - common.endMs);
  const excess = naturalEnd - film.endMs;
  const edge = value('edgeMismatch', startMismatch > 0 || endMismatch > 0);
  // Con code diverse e `drop` il taglio cade sul confine, prima della fine del
  // video: l'eccesso se ne va comunque e `--tail` non serve.
  const tail = value('tail', excess > PLAN_PRECISION_MS && !(endMismatch > 0 && edge === 'drop'));

  const startCut: Cut =
    startMismatch > 0 && edge === undefined ? PENDING
    : startMismatch > 0 && edge === 'drop' ? at(common.startMs)
    : naturalStart < film.startMs ? at(film.startMs)
    : NONE;
  const endCut: Cut =
    endMismatch > 0 && edge === undefined ? PENDING
    : endMismatch > 0 && edge === 'drop' ? at(common.endMs)
    : needed.has('tail') ? (tail === undefined ? PENDING : tail === 'trim' ? at(film.endMs) : NONE)
    : NONE;

  const italianStart = startCut.kind === 'pending' ? null : startCut.kind === 'at' ? Math.max(naturalStart, startCut.ms) : naturalStart;
  const italianEnd = endCut.kind === 'pending' ? null : endCut.kind === 'at' ? Math.min(naturalEnd, endCut.ms) : naturalEnd;

  if (edge === 'keep' && startMismatch > 0) {
    warn('INTRO_MISMATCH', `${startMismatch} ms of Italian audio kept over a different intro, before the common material`, startMismatch);
  }
  if (edge === 'keep' && endMismatch > 0) {
    warn('OUTRO_MISMATCH', `${endMismatch} ms of Italian audio kept over a different ending, after the common material`, endMismatch);
  }
  if (tail === 'keep') {
    warn('TAIL_EXCESS_KEPT', `${round3(excess)} ms of Italian audio kept after the end of the reference video`, round3(excess));
  }

  // Buchi senza italiano all'inizio e alla fine del film (§5).
  const longGap = cal.values.longGapWithoutItalianMs;
  if (italianStart !== null && italianStart - film.startMs > longGap) {
    const gap = round3(italianStart - film.startMs);
    warn('LONG_GAP_WITHOUT_ITALIAN', `the first ${gap} ms of the film have no Italian audio`, gap);
  }
  if (italianEnd !== null && film.endMs - italianEnd > longGap) {
    const gap = round3(film.endMs - italianEnd);
    warn('LONG_GAP_WITHOUT_ITALIAN', `the last ${gap} ms of the film have no Italian audio`, gap);
  }

  // Partenza brusca (§5): il livello delle tracce tagliate subito dopo il taglio.
  let cutLevel: number | null = null;
  if (startCut.kind === 'at') {
    const cut = (taken ?? ctx.italianAudio).filter((t) => crosses(ctx, t, startCut.ms));
    for (const t of cut) {
      const level = ctx.levels.find((l) => l.trackId === t.id && l.atMs === startCut.ms);
      if (!level) throw new DyadrrError('INTERNAL', `plan: no level of track ${t.id} at the cut at ${startCut.ms} ms`);
      cutLevel = cutLevel === null ? level.levelDbfs : Math.max(cutLevel, level.levelDbfs);
    }
    if (cutLevel !== null && cutLevel > cal.values.abruptStartDbfs) {
      warn(
        'ABRUPT_START',
        `the Italian audio is cut at ${startCut.ms} ms while playing at ${round2(cutLevel)} dBFS: it starts abruptly`,
        round2(cutLevel),
      );
    }
  }

  // Sottotitoli (§7).
  const pgs = ctx.donorSubtitles.filter((s) => s.pgs);
  for (const s of ctx.donorSubtitles.filter((x) => !x.pgs)) {
    warn('ITALIAN_SUBS_NOT_PGS', `Italian subtitle track ${s.id} of the donor is not PGS: dropped`, s.id);
  }
  const refSubs = value('referenceItalianSubs', ctx.referenceItalianPgs.length > 0);
  if (ctx.referenceItalianPgs.length > 0) {
    const what = refSubs === 'keep' ? 'kept after the donor ones, never default'
      : refSubs === 'drop' ? 'dropped'
      : 'kept or dropped with --reference-italian-subs';
    warn('REFERENCE_HAS_ITALIAN_SUBS', `the reference already has ${ctx.referenceItalianPgs.length} Italian PGS track(s): ${what}`, ctx.referenceItalianPgs.length);
  }
  if (ctx.referenceForcedOther.length > 0 && !pgs.some((s) => s.forced)) {
    const ids = ctx.referenceForcedOther.map((s) => `${s.id} (${s.language ?? 'und'})`).join(', ');
    warn('NO_FORCED_ITALIAN_SUBS', `the reference has forced subtitles (track ${ids}) but the donor has no forced Italian PGS`);
  }
  if (pgs.length > 0 && ctx.sdrOnHdr) {
    warn('SDR_SUBS_ON_HDR', 'Italian PGS from an SDR disc over an HDR video: some players show them too bright');
  }

  return {
    needed,
    taken,
    naturalStart,
    naturalEnd,
    startMismatch,
    endMismatch,
    excess,
    startCut,
    endCut,
    italianStart,
    italianEnd,
    cutLevel: cutLevel === null ? null : round2(cutLevel),
    referenceSubtitlesKept: refSubs === undefined ? (ctx.referenceItalianPgs.length > 0 ? null : false) : refSubs === 'keep',
    warnings,
  };
}

/** Il taglio attraversa la traccia: comincia prima e finisce dopo. */
const crosses = (t: Timeline, track: InputTrack, ms: number) => {
  const e = t.extents.get(track.id)!;
  return e.start < ms && e.end > ms;
};

const cutMs = (cut: Cut) => (cut.kind === 'at' ? cut.ms : null);

function edgeCase(diff: number): { case: EdgeCase; amountMs: number } {
  return { case: diff > 0 ? 'reference-longer' : diff < 0 ? 'donor-longer' : 'aligned', amountMs: round3(Math.abs(diff)) };
}

/**
 * I punti in cui l'italiano può essere tagliato all'inizio, con le tracce che
 * vi verrebbero tagliate: l'inizio del film, e il confine iniziale del
 * materiale in comune (`--edge-mismatch drop`). `planPair` vi legge il livello
 * dell'italiano.
 */
export function startCuts(input: Omit<PlanInput, 'choices' | 'cutLevels'>): { atMs: number; trackIds: number[] }[] {
  const ctx = timeline(input);
  const points = [...new Set([ctx.film.startMs, ctx.common.startMs])];
  return points
    .map((ms) => ({ atMs: ms, trackIds: ctx.italianAudio.filter((t) => crosses(ctx, t, ms)).map((t) => t.id) }))
    .filter((c) => c.trackIds.length > 0);
}

/**
 * Il piano di inizio e fine (§5) con le tracce prese (§7, §8), le scelte
 * necessarie con l'effetto di ogni valore (§10.1) e gli avvisi del piano.
 * Funzione pura: il livello nei punti di taglio lo dà chi chiama
 * (`cutLevels`); se manca per un taglio che il piano fa, è `INTERNAL`.
 */
export function planMerge(input: PlanInput, cal: Calibration): Plan {
  const ctx = context(input, cal);
  const given: Partial<Record<ChoiceName, string>> = {};
  for (const name of CHOICE_NAMES) {
    const g = input.choices[name];
    if (g) given[name] = g.value;
  }
  const top = layout(ctx, given);
  const states = resolveChoices(top.needed, input.choices);

  const choices = states.map((state): PlanChoice => ({
    ...state,
    effects: !state.needed ? [] : CHOICES[state.name].values.map((value): ChoiceEffect => {
      const l = layout(ctx, { ...given, [state.name]: value });
      return {
        value,
        italianStartMs: l.italianStart,
        italianEndMs: l.italianEnd,
        audioTrackIds: l.taken?.map((t) => t.id) ?? null,
        referenceSubtitleTrackIds: l.referenceSubtitlesKept === null ? null
          : l.referenceSubtitlesKept ? ctx.referenceItalianPgs.map((s) => s.id) : [],
        warnings: l.warnings.map((w) => w.code),
      };
    }),
  }));

  const { film } = ctx;
  const trackTime = (t: InputTrack) => {
    const e = ctx.extents.get(t.id)!;
    return {
      startMs: top.startCut.kind === 'pending' ? null : top.startCut.kind === 'at' ? Math.max(e.start, top.startCut.ms) : e.start,
      endMs: top.endCut.kind === 'pending' ? null : top.endCut.kind === 'at' ? Math.min(e.end, top.endCut.ms) : e.end,
    };
  };
  const roles = audioRoles(ctx.italianAudio, ctx.main);
  const excessMs = round3(Math.max(0, top.excess));

  return {
    offsetMs: ctx.S,
    film,
    commonMaterial: ctx.common,
    start: {
      ...edgeCase(top.naturalStart - film.startMs),
      mismatchMs: top.startMismatch,
      cutMs: cutMs(top.startCut),
      gapMs: top.italianStart === null ? null : round3(Math.max(0, top.italianStart - film.startMs)),
      cutLevelDbfs: top.cutLevel,
    },
    end: {
      ...edgeCase(film.endMs - top.naturalEnd),
      mismatchMs: top.endMismatch,
      cutMs: cutMs(top.endCut),
      gapMs: top.italianEnd === null ? null : round3(Math.max(0, film.endMs - top.italianEnd)),
      excess: top.excess <= PLAN_PRECISION_MS ? 'none'
        : top.endCut.kind === 'pending' ? null
        : top.endCut.kind === 'at' ? 'trimmed'
        : 'kept',
      excessMs,
    },
    italian: { startMs: top.italianStart, endMs: top.italianEnd },
    audio: ctx.italianAudio.map((t) => ({
      id: t.id,
      name: t.name,
      ...roles.get(t.id)!,
      taken: top.taken === null ? null : top.taken.includes(t),
      ...trackTime(t),
    })),
    subtitles: ctx.donorSubtitles.map((s) => ({ ...s, taken: s.pgs })),
    referenceItalianSubtitles: ctx.referenceItalianPgs.map((s) => ({ ...s, kept: top.referenceSubtitlesKept })),
    choices,
    pending: states.filter((s) => s.status === 'pending').map((s) => s.name),
    warnings: top.warnings,
  };
}

export interface PlanOptions {
  tools?: ToolPaths;
  /** Interrompe la lettura dei livelli: il piano fallisce con l'errore dell'annullamento. */
  signal?: AbortSignal;
}

/**
 * Il piano di una coppia idonea: legge dal donatore il livello dell'italiano
 * nei punti di taglio iniziale, una lettura per punto con tutte le tracce che
 * vi verrebbero tagliate, poi calcola il piano (`planMerge`).
 *
 * Errori: quelli della lettura delle finestre (`INPUT_UNREADABLE`,
 * `INPUT_BUSY`, `TOOL_MISSING`); `INTERNAL` se il donatore non ha audio italiano.
 */
export async function planPair(
  reference: InputFile,
  donor: InputFile,
  offsetMs: number,
  commonMaterial: { startMs: number; endMs: number },
  choices: GivenChoices,
  cal: Calibration,
  options: PlanOptions = {},
): Promise<Plan> {
  const input = { reference, donor, offsetMs, commonMaterial, choices };
  const levels: CutLevel[] = [];
  for (const cut of startCuts(input)) {
    const from = cut.atMs - offsetMs;
    const tracks = cut.trackIds.map((id) => donor.tracks.find((t) => t.id === id)!);
    // Il tratto si legge fin dove arrivano tutte le tracce tagliate.
    const to = Math.min(from + CUT_LEVEL_WINDOW_MS, ...tracks.map((t) => trackSpan(donor, t).end));
    if (!(to > from)) continue;
    // Il dialogo sta nel centrale, la musica in L e R: conta il più alto.
    const signals: AudioSignal[] = tracks.flatMap((t) => [
      { trackId: t.id, mix: 'leftRight' as const },
      ...(hasCenter(t) ? [{ trackId: t.id, mix: 'center' as const }] : []),
    ]);
    const reading = await readAudioWindow(donor, signals, { startMs: from, durationMs: to - from }, {
      tools: options.tools ?? DEFAULT_TOOLS,
      signal: options.signal,
    });
    for (const t of tracks) {
      const energies = reading.windows.filter((w) => w.trackId === t.id).map((w) => energyDbfs(w.samples));
      levels.push({ atMs: cut.atMs, trackId: t.id, levelDbfs: round2(Math.max(...energies)) });
    }
  }
  return planMerge({ ...input, cutLevels: levels }, cal);
}
