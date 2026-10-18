import { randomBytes } from 'node:crypto';
import { access, constants, link, lstat, mkdir, readdir, rename, rm, rmdir, stat, statfs } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { trackSpan } from './audio.js';
import { assertNoPendingChoices } from './choices.js';
import { DyadrrError } from './codes.js';
import type { Warning } from './decision.js';
import type { InputFile, InputTrack, TrackType } from './inputs.js';
import type { Plan, PlannedSubtitleTrack } from './plan.js';
import { DEFAULT_TOOLS, runTool, runToolStreaming, type RunOptions, type ToolName, type ToolPaths, type ToolResult } from './tools.js';

// Costruzione del file finale (studio §6, §7, §13): dal piano ai comandi di
// mkvmerge, e di ffmpeg per la coda delle tracce FLAC, eseguiti in una
// cartella temporanea sullo stesso disco del file finale.
//
// 1. Intermedio (§6.1): le sole tracce italiane prese, spostate di S. Un
//    taglio iniziale in c si fa con due passate di `--sync`: la prima porta c
//    a zero, e mkvmerge scarta i pacchetti che cominciano prima; la seconda
//    rimette la traccia al suo posto. Per TrueHD lo zero cade sul primo punto
//    di sincronizzazione dopo il taglio. Il taglio finale si fa con
//    `--split parts:` sull'intermedio, o con un remux di ffmpeg per FLAC.
// 2. Unione finale (§6.2): il riferimento per primo, gli intermedi senza
//    capitoli né tag, ordine delle tracce e flag espliciti, PGS compressi
//    come nell'originale.
//
// `planBuild` è una funzione pura: dal piano e dai fatti letti nei punti di
// taglio (`readCutFacts`) ai comandi. `buildMerge` li esegue; il file resta
// nella cartella temporanea finché `commitBuild` non lo rinomina al nome
// finale, dopo le verifiche (§9.5).

// Costanti del metodo (§6, §7, §13).

/** Margine di spazio libero oltre ai file che si scrivono (§13), come Wayfinderr. */
export const SPACE_MARGIN_BYTES = 2 * 1024 ** 3;

/** Cartella dei temporanei accanto al file finale, per default (§6.4). */
export const TEMP_DIR_NAME = '.dyadrr';

/**
 * Il primo punto di sincronizzazione TrueHD dopo il taglio si cerca entro
 * così (sui Blu-ray ce n'è uno almeno ogni 107 ms circa, §6.1).
 */
export const TRUEHD_SYNC_SEARCH_MS = 1000;

/**
 * Per sapere se un sottotitolo è a schermo in un punto di taglio si guarda
 * così indietro (§7): un sottotitolo che resta a schermo più a lungo sfugge.
 */
export const SUBTITLE_LOOKBACK_MS = 30_000;

// ---------------------------------------------------------------- tipi

export type TrackSource = 'reference' | 'donor';

/** Una traccia del file finale, nell'ordine in cui ci sarà (§6.2, §11.2 punto 8). */
export interface FinalTrack {
  source: TrackSource;
  /** ID di mkvmerge -J nel file da cui viene. */
  sourceTrackId: number;
  type: TrackType;
  codec: string;
  language: string | null;
  name: string | null;
  default: boolean;
  forced: boolean;
  /** Solo PGS: `none` se nell'originale non era compresso, altrimenti zlib, quella di mkvmerge. */
  compression: 'none' | 'zlib' | null;
  /**
   * Solo audio italiano: inizio e fine attesi, sulla linea del tempo del
   * riferimento, entro un pacchetto del codec (§9.5). Per i PGS non si sa:
   * dipende da dove cadono i sottotitoli.
   */
  expectedStartMs: number | null;
  expectedEndMs: number | null;
}

/** Un sottotitolo a schermo in un punto di taglio (§7). */
export interface SubtitleAtCut {
  trackId: number;
  edge: 'start' | 'end';
  /** Inizio del sottotitolo, nel donatore. */
  startMs: number;
}

/** Quello che si legge dal donatore nei punti di taglio, prima di costruire. */
export interface CutFacts {
  /** Per ogni traccia TrueHD tagliata all'inizio, il primo punto di sincronizzazione dal taglio in poi, nel donatore. */
  trueHdSyncMs: ReadonlyMap<number, number>;
  /** I sottotitoli PGS a schermo nei punti di taglio. */
  subtitlesAtCuts: readonly SubtitleAtCut[];
}

/** Un sottotitolo perso a un taglio (`SUBTITLES_DROPPED_AT_CUT`). */
export interface DroppedSubtitle {
  /** Traccia PGS del donatore. */
  trackId: number;
  edge: 'start' | 'end';
  /** Punto di taglio, sulla linea del tempo del riferimento. */
  cutMs: number;
  /** Inizio del sottotitolo perso, sulla linea del tempo del riferimento. */
  subtitleStartMs: number;
}

export type BuildPhase = 'intermediate' | 'merge';

/** Un comando della costruzione. */
export interface BuildStep {
  phase: BuildPhase;
  tool: Extract<ToolName, 'mkvmerge' | 'ffmpeg'>;
  args: string[];
  output: string;
  /** File temporanei che dopo questo comando non servono più. */
  done: string[];
}

export interface BuildPlan {
  /** Tagli dell'italiano al millisecondo, sulla linea del tempo del riferimento; `null` se non si taglia. */
  startCutMs: number | null;
  endCutMs: number | null;
  steps: BuildStep[];
  /** Il file che esce dall'ultimo comando. */
  file: string;
  tracks: FinalTrack[];
  droppedSubtitles: DroppedSubtitle[];
}

export interface ExecutedCommand {
  tool: Extract<ToolName, 'mkvmerge' | 'ffmpeg'>;
  args: string[];
  exitCode: number | null;
  warnings: string[];
  errors: string[];
}

export interface BuildProgress {
  phase: BuildPhase;
  /** Comando in corso, da 1, e numero di comandi. */
  step: number;
  steps: number;
  /** Avanzamento del comando, se il programma lo dà (mkvmerge `--gui-mode`). */
  percent: number | null;
}

export interface BuildRequest {
  reference: InputFile;
  donor: InputFile;
  /** Il piano della coppia, senza scelte in sospeso; il suo `offsetMs` è `report.offset.offsetMs`. */
  plan: Plan;
  /** File finale (§6.4): non deve esistere, salvo quello di `replace`. */
  output: string;
  /** Cartella dei temporanei; per default `.dyadrr/` accanto al file finale. */
  tempDir?: string;
  /**
   * Il file finale che c'è già, da cancellare con il consenso dell'utente
   * (§6.4): si cancella solo in `commitBuild`, dopo le verifiche, e solo se è
   * ancora lui.
   */
  replace?: ExistingOutput;
}

/** Un file finale che c'è già, riconosciuto da disco, inode, dimensione e data di modifica. */
export interface ExistingOutput {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

export interface BuildOptions {
  tools?: ToolPaths;
  signal?: AbortSignal;
  onProgress?: (progress: BuildProgress) => void;
  /** Spazio libero in byte sul disco di una cartella; per default da `statfs`. */
  freeSpace?: (dir: string) => Promise<number>;
}

/** Un file costruito, ancora nella cartella temporanea. */
export interface Build {
  output: string;
  /** Il file costruito, da verificare (§9.5) e poi rinominare con `commitBuild`. */
  file: string;
  jobDir: string;
  tempDir: string;
  /** La cartella dei temporanei è quella predefinita: si toglie quando resta vuota. */
  defaultTempDir: boolean;
  startCutMs: number | null;
  endCutMs: number | null;
  tracks: FinalTrack[];
  droppedSubtitles: DroppedSubtitle[];
  /** Spazio richiesto e disponibile al momento del controllo (§13). */
  space: SpaceRequirement & { availableBytes: number };
  commands: ExecutedCommand[];
  /** `SUBTITLES_DROPPED_AT_CUT` e `MKVMERGE_WARNING`. */
  warnings: Warning[];
  /** Il file finale che c'era già, da sostituire; `null` se non c'era. */
  replace: ExistingOutput | null;
  /** Vero quando `commitBuild` l'ha cancellato. */
  replaced: boolean;
}

// ---------------------------------------------------------------- tracce

export const isTrueHd = (t: Pick<InputTrack, 'codec' | 'codecId'>) => t.codecId === 'A_TRUEHD' || /truehd/i.test(t.codec);
export const isFlac = (t: Pick<InputTrack, 'codec' | 'codecId'>) => t.codecId === 'A_FLAC' || /^flac$/i.test(t.codec);

/** Le tracce italiane prese, nell'ordine del file finale (§6.2). */
function takenTracks(donor: InputFile, plan: Plan) {
  const byId = (id: number) => {
    const t = donor.tracks.find((x) => x.id === id);
    if (!t) throw new DyadrrError('INTERNAL', `build: track ${id} of the plan is not in the donor`);
    return t;
  };
  // Prima la principale, poi le altre nell'ordine del donatore.
  const audioPlan = plan.audio.filter((a) => a.taken);
  const audio = [...audioPlan.filter((a) => a.role === 'main'), ...audioPlan.filter((a) => a.role !== 'main')]
    .map((a) => ({ track: byId(a.id), main: a.role === 'main' }));
  // Prima i forced, poi i completi.
  const subsPlan = plan.subtitles.filter((s) => s.taken);
  const pgs = [...subsPlan.filter((s) => s.forced), ...subsPlan.filter((s) => !s.forced)]
    .map((s) => ({ track: byId(s.id), cls: s }));
  return { audio, pgs };
}

/** Tagli al millisecondo (`--sync` e `--split` vogliono ms interi). */
function cuts(plan: Plan) {
  const startCutMs = plan.start.cutMs === null ? null : Math.round(plan.start.cutMs);
  const endCutMs = plan.end.cutMs === null ? null : Math.round(plan.end.cutMs);
  // Una coda tagliata prima della fine del video (code diverse con `drop`):
  // un sottotitolo a schermo nel taglio vi resterebbe fino alla fine del video.
  const endBeforeVideo = endCutMs !== null && endCutMs < Math.round(plan.film.endMs);
  return { startCutMs, endCutMs, endBeforeVideo };
}

/** La traccia comincia prima del taglio iniziale, nel donatore. */
const cutAtStart = (donor: InputFile, t: InputTrack, cutDonorMs: number | null) =>
  cutDonorMs !== null && trackSpan(donor, t).start < cutDonorMs;

// ---------------------------------------------------------------- piano dei comandi

const sync = (id: number, ms: number) => ['--sync', `${id}:${ms}`];
const flag = (option: string, id: number, on: boolean) => [option, `${id}:${on ? 1 : 0}`];

/** "HH:MM:SS.mmm" per `--split parts:`. */
export function splitTimestamp(ms: number): string {
  const total = Math.round(ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(total % 1000, 3)}`;
}

const MKVMERGE_COMMON = ['--gui-mode', '--flush-on-close'];
const INTERMEDIATE_INPUT = ['--no-chapters', '--no-global-tags', '--no-track-tags', '--no-attachments', '--no-buttons'];

/**
 * I comandi della costruzione (§6.1–6.2), dal piano e dai fatti letti nei
 * punti di taglio. Funzione pura: scrive solo nomi di file dentro `jobDir`.
 */
export function planBuild(
  reference: InputFile,
  donor: InputFile,
  plan: Plan,
  facts: CutFacts,
  jobDir: string,
  outputName: string,
): BuildPlan {
  assertNoPendingChoices(plan.choices);
  const S = plan.offsetMs;
  if (!Number.isInteger(S)) throw new DyadrrError('INTERNAL', `build: the offset ${S} ms is not an integer`);
  const { startCutMs, endCutMs, endBeforeVideo } = cuts(plan);
  const { audio, pgs } = takenTracks(donor, plan);
  const cutDonor = startCutMs === null ? null : startCutMs - S;

  // Tracce dell'intermedio: prima l'audio, poi i PGS, nell'ordine finale. Nel
  // primo intermedio l'ID di una traccia è la sua posizione.
  interface Item {
    track: InputTrack;
    kind: 'audio' | 'pgs';
    main: boolean;
    cls: PlannedSubtitleTrack | null;
    /** Spostamenti delle due passate. */
    first: number;
    second: number;
    /** Taglio finale, sulla linea del tempo del riferimento. */
    endMs: number | null;
    expectedStartMs: number | null;
  }
  const dropped: DroppedSubtitle[] = [];
  const items: Item[] = [
    ...audio.map((a) => ({ ...a, kind: 'audio' as const, cls: null })),
    ...pgs.map((p) => ({ ...p, kind: 'pgs' as const, main: false })),
  ].map(({ track, kind, main, cls }): Item => {
    const span = trackSpan(donor, track);
    const cut = cutAtStart(donor, track, cutDonor);
    // Dove riparte la traccia, nel donatore: il taglio, o per TrueHD il
    // primo punto di sincronizzazione dal taglio in poi (§6.1).
    let from: number | null = null;
    if (cut) {
      from = cutDonor;
      if (kind === 'audio' && isTrueHd(track)) {
        const at = facts.trueHdSyncMs.get(track.id);
        if (at === undefined) throw new DyadrrError('INTERNAL', `build: no sync point for TrueHD track ${track.id} after the cut`);
        // Con i timestamp al millisecondo il punto cade sul suo pacchetto; altrimenti resta al più un pacchetto prima.
        from = Math.floor(at);
      }
    }
    // Senza taglio iniziale una sola passata, di S; con il taglio, la prima
    // porta il punto di ripartenza a zero e la seconda lo rimette a posto.
    const first = startCutMs === null ? S : from !== null ? -from : S - startCutMs;
    const second = startCutMs === null ? 0 : from !== null ? S + from : startCutMs;

    let endMs = endCutMs;
    if (kind === 'pgs' && endCutMs !== null) {
      const atEnd = endBeforeVideo ? facts.subtitlesAtCuts.find((x) => x.trackId === track.id && x.edge === 'end') : undefined;
      if (atEnd) {
        // Un sottotitolo a schermo nel taglio finale si toglie tutto: senza il
        // blocco che lo spegne resterebbe a schermo fino alla fine del video.
        endMs = Math.round(atEnd.startMs) + S;
        dropped.push({ trackId: track.id, edge: 'end', cutMs: endCutMs, subtitleStartMs: endMs });
      }
    }
    if (kind === 'pgs' && cut) {
      const atStart = facts.subtitlesAtCuts.find((x) => x.trackId === track.id && x.edge === 'start');
      if (atStart) dropped.push({ trackId: track.id, edge: 'start', cutMs: startCutMs!, subtitleStartMs: atStart.startMs + S });
    }
    const expectedStartMs = kind === 'pgs' ? null : from !== null ? from + S : span.start + S;
    return { track, kind, main, cls, first, second, endMs, expectedStartMs };
  });

  const steps: BuildStep[] = [];
  const uncompressed = (t: InputTrack) => t.compression === null;
  const compression = (list: readonly { track: InputTrack; id: number }[]) =>
    list.filter((x) => x.track.type === 'subtitles' && uncompressed(x.track)).flatMap((x) => ['--compression', `${x.id}:none`]);
  const selection = (list: readonly { kind: Item['kind']; id: number }[]) => {
    const a = list.filter((x) => x.kind === 'audio').map((x) => x.id);
    const s = list.filter((x) => x.kind === 'pgs').map((x) => x.id);
    return [
      ...(a.length > 0 ? ['--audio-tracks', a.join(',')] : ['--no-audio']),
      ...(s.length > 0 ? ['--subtitle-tracks', s.join(',')] : ['--no-subtitles']),
    ];
  };

  // 1. Le tracce italiane, spostate (e, con il taglio iniziale, portate a zero sul punto di taglio).
  const firstFile = join(jobDir, 'italian-1.mkv');
  steps.push({
    phase: 'intermediate',
    tool: 'mkvmerge',
    output: firstFile,
    done: [],
    args: [
      ...MKVMERGE_COMMON, '-o', firstFile, '--title', '',
      '--no-video', ...INTERMEDIATE_INPUT,
      ...selection(items.map((x) => ({ kind: x.kind, id: x.track.id }))),
      ...items.flatMap((x) => sync(x.track.id, x.first)),
      ...compression(items.map((x) => ({ track: x.track, id: x.track.id }))),
      '--track-order', items.map((x) => `0:${x.track.id}`).join(','),
      donor.path,
    ],
  });
  let current = firstFile;

  // 2. Con il taglio iniziale, la seconda passata rimette le tracce al loro posto.
  if (items.some((x) => x.second !== 0)) {
    const secondFile = join(jobDir, 'italian-2.mkv');
    steps.push({
      phase: 'intermediate',
      tool: 'mkvmerge',
      output: secondFile,
      done: [current],
      args: [
        ...MKVMERGE_COMMON, '-o', secondFile, '--title', '', ...INTERMEDIATE_INPUT,
        ...items.flatMap((x, i) => sync(i, x.second)),
        ...compression(items.map((x, i) => ({ track: x.track, id: i }))),
        current,
      ],
    });
    current = secondFile;
  }

  // 3. Taglio finale: `--split parts:` per punto di taglio, ffmpeg per FLAC
  // (mkvmerge non sa dividere le tracce FLAC). Ogni gruppo è un file.
  interface Part { file: string; members: number[] }
  const parts: Part[] = [];
  if (endCutMs === null) {
    parts.push({ file: current, members: items.map((_, i) => i) });
  } else {
    const flac = items.map((x, i) => ({ x, i })).filter(({ x }) => x.kind === 'audio' && isFlac(x.track));
    const groups = new Map<number, number[]>();
    items.forEach((x, i) => {
      if (x.kind === 'audio' && isFlac(x.track)) return;
      groups.set(x.endMs!, [...(groups.get(x.endMs!) ?? []), i]);
    });
    const pending: BuildStep[] = [];
    [...groups].forEach(([at, members], g) => {
      const file = join(jobDir, `italian-end-${g + 1}.mkv`);
      parts.push({ file, members });
      pending.push({
        phase: 'intermediate',
        tool: 'mkvmerge',
        output: file,
        done: [],
        args: [
          ...MKVMERGE_COMMON, '-o', file, '--title', '',
          '--split', `parts:00:00:00.000-${splitTimestamp(at)}`,
          ...selection(members.map((i) => ({ kind: items[i]!.kind, id: i }))),
          ...compression(members.map((i) => ({ track: items[i]!.track, id: i }))),
          current,
        ],
      });
    });
    if (flac.length > 0) {
      // `-copyts`: senza, ffmpeg riporterebbe la traccia a zero e perderebbe lo spostamento.
      const file = join(jobDir, 'italian-end-flac.mka');
      parts.push({ file, members: flac.map(({ i }) => i) });
      pending.push({
        phase: 'intermediate',
        tool: 'ffmpeg',
        output: file,
        done: [],
        args: [
          '-v', 'error', '-nostdin', '-y', '-copyts', '-i', current,
          ...flac.flatMap(({ i }) => ['-map', `0:${i}`]),
          '-map_chapters', '-1', '-c', 'copy', '-to', (endCutMs / 1000).toFixed(3), '-f', 'matroska', file,
        ],
      });
    }
    pending[pending.length - 1]!.done.push(current);
    steps.push(...pending);
  }

  // 4. Unione finale (§6.2).
  // I PGS italiani del riferimento tenuti restano dopo quelli del donatore, mai predefiniti (§7).
  const droppedReference = plan.referenceItalianSubtitles.filter((s) => s.kept === false).map((s) => s.id);
  for (const s of plan.referenceItalianSubtitles) {
    if (s.kept === null) throw new DyadrrError('INTERNAL', 'build: --reference-italian-subs is still pending');
  }
  const refTracks = reference.tracks.filter((t) => !droppedReference.includes(t.id));
  const refSubtitles = reference.tracks.filter((t) => t.type === 'subtitles');
  const defaultPgs = items.find((x) => x.kind === 'pgs' && x.cls!.forced && !x.cls!.commentary)?.track.id ?? null;

  const out = join(jobDir, outputName);
  const args: string[] = [...MKVMERGE_COMMON, '-o', out];
  // Riferimento: flag espliciti per ogni traccia; default solo il video principale.
  for (const t of refTracks) {
    args.push(...flag('--default-track-flag', t.id, t.type === 'video' && t.id === reference.video.trackId));
    args.push(...flag('--forced-display-flag', t.id, t.forced));
    if (t.type === 'subtitles' && uncompressed(t)) args.push('--compression', `${t.id}:none`);
  }
  if (droppedReference.length > 0) {
    args.push(...(droppedReference.length === refSubtitles.length
      ? ['--no-subtitles']
      : ['--subtitle-tracks', `!${droppedReference.join(',')}`]));
  }
  args.push(reference.path);
  // Intermedi: niente capitoli né tag; default l'audio principale e il primo PGS forced.
  const where = new Map<number, string>();
  parts.forEach((part, f) => {
    args.push(...INTERMEDIATE_INPUT);
    part.members.forEach((i, tid) => {
      const x = items[i]!;
      where.set(i, `${f + 1}:${tid}`);
      args.push(...flag('--default-track-flag', tid, x.main || x.track.id === defaultPgs));
      args.push(...flag('--forced-display-flag', tid, x.kind === 'pgs' ? x.cls!.forced : x.track.forced));
      if (x.kind === 'pgs' && uncompressed(x.track)) args.push('--compression', `${tid}:none`);
    });
    args.push(part.file);
  });

  // Ordine (§6.2): video, audio italiano, audio del riferimento, PGS italiani
  // (forced, poi completi), sottotitoli del riferimento.
  const finalTrack = (source: TrackSource, t: InputTrack, extra: Partial<FinalTrack> = {}): FinalTrack => ({
    source,
    sourceTrackId: t.id,
    type: t.type,
    codec: t.codec,
    language: t.language,
    name: t.name,
    default: false,
    forced: t.forced,
    compression: t.type === 'subtitles' ? (uncompressed(t) ? 'none' : 'zlib') : null,
    expectedStartMs: null,
    expectedEndMs: null,
    ...extra,
  });
  const order: string[] = [];
  const tracks: FinalTrack[] = [];
  const addReference = (type: TrackType) => {
    for (const t of refTracks.filter((x) => x.type === type)) {
      order.push(`0:${t.id}`);
      tracks.push(finalTrack('reference', t, { default: type === 'video' && t.id === reference.video.trackId }));
    }
  };
  const addItalian = (kind: Item['kind']) => {
    items.forEach((x, i) => {
      if (x.kind !== kind) return;
      order.push(where.get(i)!);
      const end = x.track.endMs ?? trackSpan(donor, x.track).end;
      tracks.push(finalTrack('donor', x.track, {
        default: x.main || x.track.id === defaultPgs,
        forced: kind === 'pgs' ? x.cls!.forced : x.track.forced,
        expectedStartMs: x.expectedStartMs,
        expectedEndMs: kind === 'pgs' ? null : x.endMs === null ? end + S : Math.min(end + S, x.endMs),
      }));
    });
  };
  addReference('video');
  addItalian('audio');
  addReference('audio');
  addItalian('pgs');
  addReference('subtitles');
  args.push('--track-order', order.join(','));
  steps.push({ phase: 'merge', tool: 'mkvmerge', output: out, done: parts.map((p) => p.file), args });
  return { startCutMs, endCutMs, steps, file: out, tracks, droppedSubtitles: dropped };
}

// ---------------------------------------------------------------- fatti nei punti di taglio

interface Packet {
  ptsMs: number;
  data: Buffer;
}

/** I byte di un `data` di ffprobe ("00000000: 1600 0b07 …  ascii"). */
export function hexDumpBytes(dump: string): Buffer {
  const hex = dump
    .split('\n')
    .map((line) => /^[0-9a-f]{8}: ((?:[0-9a-f]{2,4} )*[0-9a-f]{2,4})/.exec(line)?.[1] ?? '')
    .join('')
    .replace(/ /g, '');
  return Buffer.from(hex, 'hex');
}

/** Un pacchetto TrueHD che comincia con un punto di sincronizzazione completo (major sync). */
export function isTrueHdSync(data: Buffer): boolean {
  return data.length >= 8 && data.readUInt32BE(4) === 0xf8726fba;
}

/**
 * Il primo punto di sincronizzazione TrueHD da `fromMs` in poi. Il primo che
 * si incontra nella lettura non conta: dopo una ricerca, ffmpeg gli dà il
 * tempo dei pacchetti che lo precedevano.
 */
export function firstTrueHdSync(packets: readonly Packet[], fromMs: number): number | null {
  let seen = false;
  for (const p of packets) {
    if (!isTrueHdSync(p.data)) continue;
    if (!seen) {
      seen = true;
      continue;
    }
    if (p.ptsMs >= fromMs) return p.ptsMs;
  }
  return null;
}

/** Oggetti mostrati da un blocco PGS (la sua PCS); `null` se il blocco non comincia con una PCS. */
export function pgsObjectCount(data: Buffer): number | null {
  if (data.length < 14 || data[0] !== 0x16) return null;
  return data[13]!;
}

/**
 * L'inizio del sottotitolo a schermo in `atMs`: la prima composizione che
 * mostra qualcosa dopo l'ultima che toglie tutto. `null` se a schermo non c'è
 * niente.
 */
export function subtitleOnScreen(packets: readonly Packet[], atMs: number): number | null {
  let start: number | null = null;
  for (const p of [...packets].sort((a, b) => a.ptsMs - b.ptsMs)) {
    if (p.ptsMs >= atMs) break;
    const objects = pgsObjectCount(p.data);
    if (objects === null) continue;
    if (objects === 0) start = null;
    else start ??= p.ptsMs;
  }
  return start;
}

async function probePackets(donor: InputFile, track: InputTrack, fromMs: number, toMs: number, tools: ToolPaths, run: RunOptions): Promise<Packet[]> {
  if (track.streamIndex === null) {
    throw new DyadrrError('INPUT_UNREADABLE', `${donor.path}: track ${track.id} has no ffprobe stream to read`);
  }
  const seconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);
  const result = await runTool(tools, 'ffprobe', [
    '-v', 'error', '-select_streams', String(track.streamIndex),
    '-read_intervals', `${seconds(fromMs)}%${seconds(toMs)}`,
    '-show_entries', 'packet=pts_time,data', '-show_data', '-of', 'json', donor.path,
  ], run);
  try {
    if (result.exitCode !== 0) throw new Error();
    const json = JSON.parse(result.stdout) as { packets?: { pts_time?: string; data?: string }[] };
    return (json.packets ?? [])
      .filter((p) => p.pts_time !== undefined && p.pts_time !== 'N/A')
      .map((p) => ({ ptsMs: Math.round(Number(p.pts_time) * 1e6) / 1000, data: hexDumpBytes(p.data ?? '') }));
  } catch {
    throw new DyadrrError('INPUT_UNREADABLE', `${donor.path}: ffprobe failed on track ${track.id} (exit code ${result.exitCode}): ${result.stderr.trim()}`);
  }
}

/**
 * Legge dal donatore quello che serve nei punti di taglio (§6.1, §7): il
 * punto di sincronizzazione delle tracce TrueHD tagliate all'inizio e i
 * sottotitoli PGS a schermo nei tagli. Legge pochi secondi intorno a ogni
 * taglio, mai tutto il file.
 *
 * Errori: `INPUT_UNREADABLE` (ffprobe fallisce, o una traccia TrueHD senza
 * punto di sincronizzazione dopo il taglio), `TOOL_MISSING`.
 */
export async function readCutFacts(donor: InputFile, plan: Plan, options: { tools?: ToolPaths } & RunOptions = {}): Promise<CutFacts> {
  const tools = options.tools ?? DEFAULT_TOOLS;
  const run = { signal: options.signal };
  const S = plan.offsetMs;
  const { startCutMs, endCutMs, endBeforeVideo } = cuts(plan);
  const { audio, pgs } = takenTracks(donor, plan);
  const cutDonor = startCutMs === null ? null : startCutMs - S;
  const trueHdSyncMs = new Map<number, number>();
  const subtitlesAtCuts: SubtitleAtCut[] = [];

  for (const { track } of audio) {
    if (!isTrueHd(track) || !cutAtStart(donor, track, cutDonor)) continue;
    const packets = await probePackets(donor, track, cutDonor! - TRUEHD_SYNC_SEARCH_MS, cutDonor! + TRUEHD_SYNC_SEARCH_MS, tools, run);
    const at = firstTrueHdSync(packets, cutDonor!);
    if (at === null) {
      throw new DyadrrError('INPUT_UNREADABLE', `${donor.path}: TrueHD track ${track.id} has no sync point within ${TRUEHD_SYNC_SEARCH_MS} ms after the cut at ${cutDonor} ms`);
    }
    trueHdSyncMs.set(track.id, at);
  }

  const edges: { edge: 'start' | 'end'; atMs: number }[] = [];
  if (cutDonor !== null) edges.push({ edge: 'start', atMs: cutDonor });
  if (endBeforeVideo) edges.push({ edge: 'end', atMs: endCutMs! - S });
  for (const { track } of pgs) {
    for (const { edge, atMs } of edges) {
      if (edge === 'start' && !cutAtStart(donor, track, cutDonor)) continue;
      const packets = await probePackets(donor, track, atMs - SUBTITLE_LOOKBACK_MS, atMs, tools, run);
      const start = subtitleOnScreen(packets, atMs);
      if (start !== null) subtitlesAtCuts.push({ trackId: track.id, edge, startMs: start });
    }
  }
  return { trueHdSyncMs, subtitlesAtCuts };
}

// ---------------------------------------------------------------- spazio

export interface SpaceRequirement {
  requiredBytes: number;
  /** Le tracce italiane prese, dai tag statistici o, se mancano, la dimensione intera del donatore. */
  italianBytes: number;
  italianEstimated: boolean;
}

/**
 * Spazio libero necessario sul disco del file finale (§13): il riferimento,
 * le tracce italiane due volte (gli intermedi e il file finale) e un margine.
 */
export function requiredSpace(reference: InputFile, donor: InputFile, plan: Plan): SpaceRequirement {
  const ids = [...plan.audio.filter((a) => a.taken).map((a) => a.id), ...plan.subtitles.filter((s) => s.taken).map((s) => s.id)];
  const sizes = ids.map((id) => donor.tracks.find((t) => t.id === id)?.statistics?.bytes ?? null);
  const estimated = sizes.some((b) => b === null);
  const italianBytes = estimated ? donor.fingerprint.size : sizes.reduce<number>((sum, b) => sum + b!, 0);
  return {
    requiredBytes: reference.fingerprint.size + 2 * italianBytes + SPACE_MARGIN_BYTES,
    italianBytes,
    italianEstimated: estimated,
  };
}

async function statfsFree(dir: string): Promise<number> {
  const s = await statfs(dir);
  return s.bavail * s.bsize;
}

// ---------------------------------------------------------------- esito dei programmi

export interface ToolOutcome {
  ok: boolean;
  warnings: string[];
  errors: string[];
  /** Il disco si è riempito: `NO_SPACE`, riprovabile, e non `MERGE_FAILED`. */
  noSpace: boolean;
}

const NO_SPACE_TEXT = /no space left on device|ENOSPC|disk full/i;

/**
 * Esito di mkvmerge in `--gui-mode` (§6.3): 0 riuscito, 1 riuscito con
 * avvisi, 2 (o un segnale) fallito.
 */
export function mkvmergeOutcome(result: ToolResult): ToolOutcome {
  const lines = (kind: string) => [...result.stdout.matchAll(new RegExp(`^#GUI#${kind} (.*)$`, 'gm'))].map((m) => m[1]!.trim());
  const warnings = lines('warning');
  const errors = lines('error');
  const ok = result.exitCode === 0 || result.exitCode === 1;
  return { ok, warnings, errors, noSpace: !ok && NO_SPACE_TEXT.test(`${errors.join('\n')}\n${result.stderr}`) };
}

export function ffmpegOutcome(result: ToolResult): ToolOutcome {
  const ok = result.exitCode === 0;
  const errors = ok ? [] : result.stderr.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  return { ok, warnings: [], errors, noSpace: !ok && NO_SPACE_TEXT.test(result.stderr) };
}

// ---------------------------------------------------------------- cartelle

const exists = (path: string) => lstat(path).then(() => true, () => false);

/** Il nome di una cartella di lavoro: host e processo che la usano (§6.4). */
const JOB_NAME = /^job-(.+)-(\d+)-[0-9a-f]{8}$/;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Le cartelle di lavoro di questo processo, ancora in uso. */
const ownJobs = new Set<string>();

/**
 * Elimina gli avanzi di un'interruzione brusca (§6.4): le cartelle di lavoro
 * di questo host il cui processo non esiste più. Il PID di un processo nuovo
 * può essere quello di uno interrotto (in un container riparte spesso con lo
 * stesso numero): una cartella con il PID di questo processo è un avanzo, se
 * non l'ha creata lui. Quelle di un altro host (un altro container sulla
 * stessa cartella) restano.
 */
export async function removeStaleJobs(tempDir: string): Promise<string[]> {
  const removed: string[] = [];
  const entries = await readdir(tempDir).catch(() => []);
  for (const name of entries) {
    const m = JOB_NAME.exec(name);
    if (!m || m[1] !== hostname()) continue;
    const pid = Number(m[2]);
    if (pid === process.pid ? ownJobs.has(name) : processAlive(pid)) continue;
    await rm(join(tempDir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

const notWritable = (path: string, e: unknown) =>
  new DyadrrError('OUTPUT_NOT_WRITABLE', `${path}: not writable (${(e as NodeJS.ErrnoException).code ?? String(e)})`);

/**
 * Il file finale che c'è già, se è un file normale (non una cartella né un
 * link); `null` se non c'è o non è un file che si possa sostituire.
 */
export async function existingOutput(path: string): Promise<ExistingOutput | null> {
  const st = await lstat(path).catch(() => null);
  if (!st?.isFile()) return null;
  return { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
}

const sameFile = (a: ExistingOutput | null, b: ExistingOutput) =>
  a !== null && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

/** Il file finale non esiste (o è quello da sostituire) e la sua cartella è scrivibile (§6.4). */
async function checkOutput(output: string, replace?: ExistingOutput): Promise<string> {
  if (await exists(output) && !(replace && sameFile(await existingOutput(output), replace))) {
    throw new DyadrrError('OUTPUT_EXISTS', `${output} already exists: it is never overwritten`);
  }
  const outDir = dirname(output);
  try {
    if (!(await stat(outDir)).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    await access(outDir, constants.W_OK);
  } catch (e) {
    throw notWritable(outDir, e);
  }
  return outDir;
}

/**
 * La cartella dei temporanei (§6.4, §10): in una cartella che inizia con un
 * punto, che il watcher di Wayfinderr ignora, e sullo stesso disco del file
 * finale, perché una rinomina tra dischi diversi fallisce. Non la crea.
 */
async function checkTempDir(outDir: string, tempDir: string | undefined): Promise<string> {
  const dir = resolve(tempDir ?? join(outDir, TEMP_DIR_NAME));
  if (!dir.split(sep).some((part) => part.startsWith('.') && part !== '.' && part !== '..')) {
    throw new DyadrrError('BAD_ARGUMENTS', `--temp-dir ${dir}: it must be in a folder whose name starts with a dot`);
  }
  let existing = dir;
  while (!(await exists(existing)) && dirname(existing) !== existing) existing = dirname(existing);
  if ((await stat(existing)).dev !== (await stat(outDir)).dev) {
    throw new DyadrrError('BAD_ARGUMENTS', `--temp-dir ${dir}: it must be on the same disk as the output (${outDir})`);
  }
  return dir;
}

/**
 * Il file finale e la cartella dei temporanei si possono usare (§6.4): il
 * file non esiste (o è `replace`), la sua cartella è scrivibile, i temporanei stanno in una
 * cartella che inizia con un punto, sullo stesso disco. `buildMerge` lo
 * controlla prima di scrivere; la riga di comando anche prima dell'analisi,
 * che costa gigabyte di letture (§10).
 *
 * Errori: `OUTPUT_EXISTS`, `OUTPUT_NOT_WRITABLE`, `BAD_ARGUMENTS`.
 */
export async function checkBuildTarget(
  output: string,
  tempDir?: string,
  replace?: ExistingOutput,
): Promise<{ output: string; outDir: string; tempDir: string }> {
  const resolved = resolve(output);
  const outDir = await checkOutput(resolved, replace);
  return { output: resolved, outDir, tempDir: await checkTempDir(outDir, tempDir) };
}

// ---------------------------------------------------------------- costruzione

/** mkvmerge, con `--split`, può aggiungere "-001" al nome. */
async function splitOutput(path: string): Promise<void> {
  if (await exists(path)) return;
  const ext = extname(path);
  const numbered = `${path.slice(0, path.length - ext.length)}-001${ext}`;
  if (await exists(numbered)) await rename(numbered, path);
}

/**
 * Costruisce il file finale nella cartella temporanea (§6): controlli del file
 * finale e della cartella dei temporanei, spazio libero, fatti nei punti di
 * taglio, intermedi e unione finale. Non rinomina: dopo le verifiche (§9.5)
 * si chiama `commitBuild`, altrimenti `discardBuild`. Se qualcosa fallisce la
 * cartella di lavoro si elimina.
 *
 * Errori: `CHOICE_REQUIRED` (scelta in sospeso), `OUTPUT_EXISTS`,
 * `OUTPUT_NOT_WRITABLE`, `BAD_ARGUMENTS` (`tempDir` senza un punto o su un
 * altro disco), `INPUT_BUSY` (un ingresso è cambiato da quando è stato
 * letto), `NO_SPACE` (prima di scrivere, o un disco che si riempie),
 * `INPUT_UNREADABLE`, `MERGE_FAILED` (mkvmerge esce con 2, ffmpeg fallisce),
 * `TOOL_MISSING`. Con `signal` interrotto, l'errore dell'annullamento.
 */
export async function buildMerge(request: BuildRequest, options: BuildOptions = {}): Promise<Build> {
  const tools = options.tools ?? DEFAULT_TOOLS;
  const { reference, donor, plan } = request;
  assertNoPendingChoices(plan.choices);
  const { output, outDir, tempDir } = await checkBuildTarget(request.output, request.tempDir, request.replace);
  const defaultTempDir = request.tempDir === undefined;

  // Gli ingressi non devono essere cambiati dall'analisi.
  for (const input of [reference, donor]) {
    const st = await stat(input.path).catch(() => null);
    if (!st || st.size !== input.fingerprint.size || st.mtime.toISOString() !== input.fingerprint.modifiedAt) {
      throw new DyadrrError('INPUT_BUSY', `${input.path}: changed since it was read: it may still be being written`);
    }
  }

  // Lo spazio si controlla prima di scrivere qualsiasi cosa (§9.4, §13).
  const space = requiredSpace(reference, donor, plan);
  const availableBytes = await (options.freeSpace ?? statfsFree)(outDir);
  if (availableBytes < space.requiredBytes) {
    throw new DyadrrError(
      'NO_SPACE',
      `${outDir}: ${availableBytes} bytes free, ${space.requiredBytes} needed (reference, Italian tracks twice${space.italianEstimated ? ' estimated from the donor size' : ''}, ${SPACE_MARGIN_BYTES} bytes of margin)`,
    );
  }

  const facts = await readCutFacts(donor, plan, { tools, signal: options.signal });
  try {
    await mkdir(tempDir, { recursive: true });
  } catch (e) {
    throw notWritable(tempDir, e);
  }
  await removeStaleJobs(tempDir);
  const jobDir = join(tempDir, `job-${hostname()}-${process.pid}-${randomBytes(4).toString('hex')}`);
  const build: Build = {
    output,
    file: '',
    jobDir,
    tempDir,
    defaultTempDir,
    startCutMs: null,
    endCutMs: null,
    tracks: [],
    droppedSubtitles: [],
    replace: request.replace ?? null,
    replaced: false,
    space: { ...space, availableBytes },
    commands: [],
    warnings: [],
  };
  try {
    await mkdir(jobDir);
    ownJobs.add(basename(jobDir));
    const steps = planBuild(reference, donor, plan, facts, jobDir, basename(output));
    Object.assign(build, {
      file: steps.file,
      startCutMs: steps.startCutMs,
      endCutMs: steps.endCutMs,
      tracks: steps.tracks,
      droppedSubtitles: steps.droppedSubtitles,
    });
    if (steps.droppedSubtitles.length > 0) {
      const list = steps.droppedSubtitles
        .map((d) => `track ${d.trackId} at the ${d.edge} cut (${d.cutMs} ms), subtitle from ${d.subtitleStartMs} ms`)
        .join('; ');
      build.warnings.push({
        code: 'SUBTITLES_DROPPED_AT_CUT',
        message: `${steps.droppedSubtitles.length} subtitle(s) on screen at a cut are lost: ${list}`,
        value: steps.droppedSubtitles.length,
      });
    }

    for (const [i, step] of steps.steps.entries()) {
      const progress = (percent: number | null) =>
        options.onProgress?.({ phase: step.phase, step: i + 1, steps: steps.steps.length, percent });
      progress(null);
      const result = await runToolStreaming(tools, step.tool, step.args, {
        signal: options.signal,
        env: { LC_ALL: 'C.UTF-8' },
        onLine: (line) => {
          const m = /^#GUI#progress (\d{1,3})%/.exec(line);
          if (m) progress(Number(m[1]));
        },
      });
      const outcome = step.tool === 'mkvmerge' ? mkvmergeOutcome(result) : ffmpegOutcome(result);
      build.commands.push({ tool: step.tool, args: step.args, exitCode: result.exitCode, warnings: outcome.warnings, errors: outcome.errors });
      for (const w of outcome.warnings) build.warnings.push({ code: 'MKVMERGE_WARNING', message: w });
      if (!outcome.ok) {
        const why = outcome.errors.join('; ') || result.stderr.trim() || `exit code ${result.exitCode}`;
        throw new DyadrrError(outcome.noSpace ? 'NO_SPACE' : 'MERGE_FAILED', `${step.tool} failed (exit code ${result.exitCode}): ${why}`);
      }
      if (step.tool === 'mkvmerge' && step.args.includes('--split')) await splitOutput(step.output);
      if (!(await exists(step.output))) {
        throw new DyadrrError('MERGE_FAILED', `${step.tool} exited with ${result.exitCode} but wrote no ${step.output}`);
      }
      for (const file of step.done) await rm(file, { force: true });
    }
    return build;
  } catch (e) {
    await discardBuild(build);
    throw e;
  }
}

/** Elimina la cartella di lavoro, e la cartella dei temporanei predefinita se resta vuota. */
export async function discardBuild(build: Pick<Build, 'jobDir' | 'tempDir' | 'defaultTempDir'>): Promise<void> {
  await rm(build.jobDir, { recursive: true, force: true });
  ownJobs.delete(basename(build.jobDir));
  if (build.defaultTempDir) await rmdir(build.tempDir).catch(() => undefined);
}

/** Errori di `link` per un filesystem che non ha link fisici. */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK']);

/**
 * Porta il file costruito al nome finale (§6.4), da chiamare dopo le
 * verifiche. Con `Build.replace` prima cancella il file che c'era, se è
 * ancora lui. Con un link fisico, che non sovrascrive mai: se nel frattempo il
 * file finale è comparso (o quello da sostituire è cambiato), `OUTPUT_EXISTS`. Su un filesystem senza link fisici
 * si rinomina, dopo aver controllato che il nome sia libero. Poi la cartella
 * di lavoro si elimina, anche se qualcosa è fallito.
 */
export async function commitBuild(build: Build): Promise<void> {
  try {
    if (build.replace && sameFile(await existingOutput(build.output), build.replace)) {
      await rm(build.output);
      build.replaced = true;
    }
    try {
      await link(build.file, build.output);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (code === 'EEXIST') throw new DyadrrError('OUTPUT_EXISTS', `${build.output} appeared while merging: it is never overwritten`);
      if (!NO_HARD_LINKS.has(code)) throw notWritable(build.output, e);
      if (await exists(build.output)) throw new DyadrrError('OUTPUT_EXISTS', `${build.output} appeared while merging: it is never overwritten`);
      await rename(build.file, build.output);
    }
  } finally {
    await discardBuild(build);
  }
}
