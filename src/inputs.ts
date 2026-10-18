import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Calibration } from './calibration.js';
import { DyadrrError } from './codes.js';
import type { FileFacts, HdrFormat, VideoFacts } from './decision.js';
import { isItalian, type TrackLanguageFields } from './languages.js';
import { TAIL_MAX_BYTES, scanTail, type TailScan } from './matroska.js';
import { DEFAULT_TOOLS, runTool, type ToolPaths } from './tools.js';

// Ingressi (studio §3.1–3.2, §4.8, §11.2): dai due MKV ai fatti che servono
// alla decisione (`FileFacts`) e ai dati del report. La struttura viene da
// mkvmerge -J; framerate, HDR e tag statistici da ffprobe; l'integrità dalla
// coda del file, letta senza programmi esterni (matroska.ts).
//
// Errori: `INPUT_UNREADABLE` (file mancante, illeggibile o non MKV),
// `INPUT_BUSY` (file ancora in scrittura), `TOOL_MISSING` (programma che non
// parte). Un file troncato non è un'eccezione: `truncated` lo dice alla
// decisione, che risponde `INPUT_TRUNCATED` nell'ordine dei controlli (§9.6).

export type TrackType = 'video' | 'audio' | 'subtitles';

/** Tag statistici di una traccia (scritti da mkvmerge e MakeMKV); `null` se mancano. */
export interface TrackStatistics {
  frames: number | null;
  /** Bit al secondo. */
  bps: number | null;
  durationMs: number | null;
  bytes: number | null;
}

/** Una traccia, come la riporta il report (§11.2, punto 2). */
export interface InputTrack extends TrackLanguageFields {
  /** ID di mkvmerge -J: identifica la traccia nel report e nei comandi. */
  id: number;
  type: TrackType;
  /** Nome del codec secondo mkvmerge (per esempio "TrueHD Atmos", "HDMV PGS"). */
  codec: string;
  codecId: string | null;
  /** Profilo secondo ffprobe (per esempio "Dolby TrueHD + Dolby Atmos", "Main 10"). */
  profile: string | null;
  language: string | null;
  languageIetf: string | null;
  channels: number | null;
  name: string | null;
  default: boolean;
  forced: boolean;
  commentary: boolean;
  visualImpaired: boolean;
  /** Compressione del contenitore (per i PGS di solito `zlib` o nessuna). */
  compression: string | null;
  /** Primo timestamp (`minimum_timestamp`). */
  startMs: number | null;
  /** Fine dell'ultimo pacchetto, se è negli ultimi cluster letti. */
  endMs: number | null;
  statistics: TrackStatistics | null;
}

export interface InputVideo extends VideoFacts {
  trackId: number;
  /** Profilo Dolby Vision, se `hdr` è `DV`. */
  dvProfile: number | null;
}

/** Impronta di un ingresso (§11.2): serve a `--expect` per riconoscerlo. */
export interface Fingerprint {
  size: number;
  modifiedAt: string;
  firstMiBSha256: string;
  lastMiBSha256: string;
}

export interface TrackIntegrity {
  id: number;
  /** Primo timestamp più la durata dei tag statistici. */
  expectedEndMs: number | null;
  endMs: number | null;
  result: 'pass' | 'fail' | 'skipped';
  detail?: string;
}

/** Controllo di integrità (§4.8). */
export interface Integrity {
  result: 'pass' | 'fail';
  toleranceMs: number;
  declaredDurationMs: number | null;
  /** Fine più alta di un pacchetto negli ultimi cluster. */
  lastTimestampMs: number | null;
  scannedBytes: number;
  /** Timestamp del primo cluster letto. */
  scannedFromMs: number | null;
  /** Tracce audio e video; i sottotitoli non si controllano. */
  tracks: TrackIntegrity[];
  detail?: string;
}

export interface InputFile extends FileFacts {
  /** Percorso assoluto. */
  path: string;
  fingerprint: Fingerprint;
  /** Durata dichiarata nell'intestazione. */
  durationMs: number | null;
  /** Primo timestamp tra tutte le tracce. */
  startTimeMs: number | null;
  writingApplication: string | null;
  tracks: InputTrack[];
  audio: InputTrack[];
  video: InputVideo;
  /** Almeno una traccia audio italiana (§3.1). */
  italianAudio: boolean;
  /** Almeno una traccia di sottotitoli italiana: non rende il file un donatore. */
  italianSubtitles: boolean;
  integrity: Integrity;
}

export interface ReadInputOptions {
  calibration: Calibration;
  tools?: ToolPaths;
}

// ---------------------------------------------------------------- ffprobe

interface FfprobeSideData {
  side_data_type?: string;
  dv_profile?: number;
}

interface FfprobeStream {
  index: number;
  codec_type?: string;
  profile?: string;
  width?: number;
  height?: number;
  channels?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  color_transfer?: string;
  side_data_list?: FfprobeSideData[];
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

/**
 * Livello HDR (§3.2) dai metadati del flusso video e del suo primo fotogramma:
 * Dolby Vision dal record di configurazione (con il profilo), HDR10+ dai
 * metadati dinamici SMPTE 2094-40 su PQ, HDR10 da PQ, HLG dalla sua curva.
 */
export function hdrFormat(
  colorTransfer: string | undefined,
  streamSideData: readonly FfprobeSideData[] = [],
  frameSideData: readonly FfprobeSideData[] = [],
): { hdr: HdrFormat; dvProfile: number | null } {
  const dovi = streamSideData.find((s) => /DOVI configuration/i.test(s.side_data_type ?? ''));
  if (dovi) return { hdr: 'DV', dvProfile: typeof dovi.dv_profile === 'number' ? dovi.dv_profile : null };
  if (colorTransfer === 'smpte2084') {
    const hdr10plus = frameSideData.some((s) => /SMPTE ?2094-40/i.test(s.side_data_type ?? ''));
    return { hdr: hdr10plus ? 'HDR10+' : 'HDR10', dvProfile: null };
  }
  if (colorTransfer === 'arib-std-b67') return { hdr: 'HLG', dvProfile: null };
  return { hdr: 'SDR', dvProfile: null };
}

/** Un tag di ffprobe, anche con il suffisso della lingua (`BPS-eng`). */
function tag(tags: Record<string, string> | undefined, name: string): string | undefined {
  if (!tags) return undefined;
  const key = Object.keys(tags).find((k) => {
    const upper = k.toUpperCase();
    return upper === name || upper.startsWith(`${name}-`);
  });
  return key === undefined ? undefined : tags[key];
}

/** Durata dei tag statistici ("01:23:45.678000000") in ms. */
export function parseTagDuration(value: string | undefined): number | null {
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value?.trim() ?? '');
  if (!m) return null;
  const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
  return Math.round(ms * 1000) / 1000;
}

function tagInteger(tags: Record<string, string> | undefined, name: string): number | null {
  const value = tag(tags, name)?.trim();
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

function statistics(tags: Record<string, string> | undefined): TrackStatistics | null {
  const s: TrackStatistics = {
    frames: tagInteger(tags, 'NUMBER_OF_FRAMES'),
    bps: tagInteger(tags, 'BPS'),
    durationMs: parseTagDuration(tag(tags, 'DURATION')),
    bytes: tagInteger(tags, 'NUMBER_OF_BYTES'),
  };
  return Object.values(s).every((v) => v === null) ? null : s;
}

function frameRate(value: string | undefined): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(value ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  const d = Number(m[2]);
  return n > 0 && d > 0 ? n / d : null;
}

// ---------------------------------------------------------------- mkvmerge

interface MkvmergeTrack {
  id: number;
  type: string;
  codec: string;
  properties?: Record<string, unknown>;
}

interface MkvmergeIdentification {
  container?: { recognized?: boolean; type?: string; properties?: Record<string, unknown> };
  tracks?: MkvmergeTrack[];
  errors?: string[];
}

const TRACK_TYPES: Readonly<Record<string, TrackType>> = { video: 'video', audio: 'audio', subtitles: 'subtitles' };
const FFPROBE_TYPES: Readonly<Record<TrackType, string>> = { video: 'video', audio: 'audio', subtitles: 'subtitle' };

// ContentCompAlgo di Matroska.
const COMPRESSION: Readonly<Record<string, string>> = { 0: 'zlib', 1: 'bzlib', 2: 'lzo1x', 3: 'header-stripping' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const nsToMs = (ns: number | null) => (ns === null ? null : Math.round(ns / 1000) / 1000);

const unreadable = (path: string, why: string) => new DyadrrError('INPUT_UNREADABLE', `${path}: ${why}`);

// ---------------------------------------------------------------- lettura

const MiB = 1024 * 1024;

async function fingerprint(path: string, size: number, modifiedMs: number): Promise<Fingerprint> {
  const handle = await open(path, 'r');
  try {
    const hash = async (position: number) => {
      const length = Math.min(MiB, size - position);
      const buf = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(buf, read, length - read, position + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      return createHash('sha256').update(buf.subarray(0, read)).digest('hex');
    };
    return {
      size,
      modifiedAt: new Date(modifiedMs).toISOString(),
      firstMiBSha256: await hash(0),
      lastMiBSha256: await hash(Math.max(0, size - MiB)),
    };
  } finally {
    await handle.close();
  }
}

async function statFile(path: string) {
  try {
    const st = await stat(path);
    if (!st.isFile()) throw unreadable(path, 'not a regular file');
    return st;
  } catch (e) {
    if (e instanceof DyadrrError) throw e;
    throw unreadable(path, `cannot be read (${(e as NodeJS.ErrnoException).code ?? String(e)})`);
  }
}

async function identify(path: string, tools: ToolPaths): Promise<MkvmergeIdentification> {
  const result = await runTool(tools, 'mkvmerge', ['-J', path]);
  let id: MkvmergeIdentification;
  try {
    id = JSON.parse(result.stdout) as MkvmergeIdentification;
  } catch {
    throw unreadable(path, `mkvmerge -J failed (exit code ${result.exitCode}): ${result.stderr.trim()}`);
  }
  const error = id.errors?.find((e) => e.trim() !== '');
  if (error) throw unreadable(path, error.trim());
  if (!id.container?.recognized) throw unreadable(path, 'not a Matroska file (format not recognized)');
  if (id.container.type !== 'Matroska') throw unreadable(path, `not a Matroska file (${id.container.type})`);
  return id;
}

async function probe(path: string, tools: ToolPaths, args: readonly string[]): Promise<Record<string, unknown>> {
  const result = await runTool(tools, 'ffprobe', ['-v', 'error', '-of', 'json', ...args, path]);
  try {
    if (result.exitCode !== 0) throw new Error();
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw unreadable(path, `ffprobe failed (exit code ${result.exitCode}): ${result.stderr.trim()}`);
  }
}

/**
 * Accoppia i flussi di ffprobe alle tracce di mkvmerge. ffprobe non riporta
 * il numero di traccia di Matroska ma segue lo stesso ordine; gli allegati
 * vengono dopo. Se numero o tipi non tornano, nessuna traccia viene accoppiata.
 */
function pairStreams(tracks: readonly MkvmergeTrack[], streams: readonly FfprobeStream[]): (FfprobeStream | null)[] {
  const media = streams.filter((s) => s.codec_type !== 'attachment' && !s.disposition?.attached_pic);
  const paired = media.length === tracks.length &&
    tracks.every((t, i) => FFPROBE_TYPES[TRACK_TYPES[t.type]!] === media[i]?.codec_type);
  return tracks.map((_, i) => (paired ? media[i]! : null));
}

/**
 * Legge un ingresso: impronta, tracce, video, integrità. Lancia `DyadrrError`
 * con `INPUT_UNREADABLE`, `INPUT_BUSY` o `TOOL_MISSING`.
 */
export async function readInput(file: string, options: ReadInputOptions): Promise<InputFile> {
  const tools = options.tools ?? DEFAULT_TOOLS;
  const cal = options.calibration.values;
  const path = resolve(file);

  // 1. Esiste, ed è fermo da abbastanza tempo (§10).
  const before = await statFile(path);
  const age = Date.now() - before.mtimeMs;
  if (age < cal.inputBusyMs) {
    const when = age < 0 ? 'in the future' : `${Math.round(age / 1000)} s ago`;
    throw new DyadrrError(
      'INPUT_BUSY',
      `${path}: modified ${when}, less than ${cal.inputBusyMs / 1000} s: it may still be being written`,
    );
  }

  // 2. Impronta (§11.2).
  let print: Fingerprint;
  try {
    print = await fingerprint(path, before.size, before.mtimeMs);
  } catch (e) {
    throw unreadable(path, `cannot be read (${(e as NodeJS.ErrnoException).code ?? String(e)})`);
  }

  // 3. Struttura da mkvmerge -J, flussi da ffprobe.
  const id = await identify(path, tools);
  const mkvTracks = (id.tracks ?? []).filter((t) => TRACK_TYPES[t.type] !== undefined);
  const container = id.container?.properties ?? {};
  const ff = await probe(path, tools, ['-show_streams']);
  const streams = (ff.streams ?? []) as FfprobeStream[];
  const paired = pairStreams(mkvTracks, streams);

  const tracks: InputTrack[] = mkvTracks.map((t, i) => {
    const p = t.properties ?? {};
    const s = paired[i];
    const algorithms = str(p.content_encoding_algorithms);
    return {
      id: t.id,
      type: TRACK_TYPES[t.type]!,
      codec: t.codec,
      codecId: str(p.codec_id),
      profile: str(s?.profile),
      language: str(p.language),
      languageIetf: str(p.language_ietf),
      channels: num(p.audio_channels) ?? num(s?.channels),
      name: str(p.track_name),
      default: p.default_track === true,
      forced: p.forced_track === true,
      commentary: p.flag_commentary === true,
      visualImpaired: p.flag_visual_impaired === true,
      compression: algorithms === null
        ? null
        : algorithms.split(',').map((a) => COMPRESSION[a.trim()] ?? a.trim()).join(','),
      startMs: nsToMs(num(p.minimum_timestamp)),
      endMs: null,
      statistics: statistics(s?.tags),
    };
  });

  // 4. Video: la prima traccia video.
  const videoIndex = mkvTracks.findIndex((t) => t.type === 'video');
  if (videoIndex === -1) throw unreadable(path, 'no video track');
  const videoTrack = mkvTracks[videoIndex]!;
  const videoStream =
    paired[videoIndex] ?? streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic) ?? null;
  const vp = videoTrack.properties ?? {};
  const frames = videoStream
    ? await probe(path, tools, [
      '-select_streams', String(videoStream.index),
      '-read_intervals', '%+#1',
      '-show_entries', 'frame=side_data_list',
    ])
    : {};
  const firstFrame = ((frames.frames ?? []) as { side_data_list?: FfprobeSideData[] }[])[0];
  const { hdr, dvProfile } = hdrFormat(videoStream?.color_transfer, videoStream?.side_data_list, firstFrame?.side_data_list);
  const defaultDuration = num(vp.default_duration);
  const fps = frameRate(videoStream?.avg_frame_rate) ?? frameRate(videoStream?.r_frame_rate) ??
    (defaultDuration ? 1e9 / defaultDuration : null);
  if (fps === null) throw unreadable(path, 'cannot determine the video frame rate');
  const [pw, ph] = (str(vp.pixel_dimensions) ?? '').split('x').map(Number);
  const width = videoStream?.width ?? pw;
  const height = videoStream?.height ?? ph;
  if (!width || !height) throw unreadable(path, 'cannot determine the video resolution');

  // 5. Integrità (§4.8).
  const integrity = await checkIntegrity(path, before.size, mkvTracks, tracks, container, cal.integrityToleranceMs);

  // 6. Il file non deve essere cambiato mentre lo si leggeva (§10).
  const after = await statFile(path);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new DyadrrError('INPUT_BUSY', `${path}: changed while it was being read: it may still be being written`);
  }

  const video = tracks[videoIndex]!;
  const declaredDurationMs = nsToMs(num(container.duration));
  const starts = tracks.map((t) => t.startMs).filter((s): s is number => s !== null);
  const videoDurationMs = video.endMs !== null && video.startMs !== null
    ? Math.round((video.endMs - video.startMs) * 1000) / 1000
    : video.statistics?.durationMs ?? declaredDurationMs ?? 0;

  const audio = tracks.filter((t) => t.type === 'audio');
  return {
    path,
    fingerprint: print,
    durationMs: declaredDurationMs,
    startTimeMs: starts.length > 0 ? Math.min(...starts) : null,
    writingApplication: str(container.writing_application),
    tracks,
    audio,
    video: {
      trackId: video.id,
      width,
      height,
      hdr,
      dvProfile,
      codec: video.codecId ?? video.codec,
      bitrate: video.statistics?.bps ?? null,
      fps,
      durationMs: videoDurationMs,
    },
    italianAudio: audio.some(isItalian),
    italianSubtitles: tracks.some((t) => t.type === 'subtitles' && isItalian(t)),
    integrity,
    truncated: integrity.result === 'fail',
  };
}

/**
 * Controllo di integrità (§4.8): la fine più alta negli ultimi cluster contro
 * la durata dichiarata, e la fine di ogni traccia audio e video contro i suoi
 * tag statistici. Scrive in `tracks` la fine letta di ogni traccia.
 */
async function checkIntegrity(
  path: string,
  size: number,
  mkvTracks: readonly MkvmergeTrack[],
  tracks: InputTrack[],
  container: Record<string, unknown>,
  toleranceMs: number,
): Promise<Integrity> {
  const numbers = mkvTracks.map((t) => num(t.properties?.number));
  const defaultDurationNs = new Map<number, number>();
  mkvTracks.forEach((t, i) => {
    const d = num(t.properties?.default_duration);
    if (numbers[i] !== null && d !== null) defaultDurationNs.set(numbers[i]!, d);
  });

  const checked = tracks
    .map((t, i) => ({ track: t, number: numbers[i] ?? null }))
    .filter(({ track }) => track.type !== 'subtitles' && track.startMs !== null);
  const expected = (t: InputTrack) =>
    t.statistics?.durationMs != null && t.startMs !== null
      ? Math.round((t.startMs + t.statistics.durationMs) * 1000) / 1000
      : null;

  // La coda letta basta quando ogni traccia controllata ha il suo ultimo
  // pacchetto, oppure il tratto letto comincia prima della sua fine attesa.
  const covered = (scan: TailScan, end: number) => scan.firstClusterMs !== null && scan.firstClusterMs <= end - toleranceMs;
  const enough = (scan: TailScan) =>
    scan.clusters > 0 &&
    checked.every(({ track, number }) => {
      const end = expected(track);
      return end === null || (number !== null && scan.trackEndMs.has(number)) || covered(scan, end);
    });
  const scan = await scanTail(path, size, {
    timestampScaleNs: num(container.timestamp_scale) ?? 1_000_000,
    defaultDurationNs,
  }, enough);

  tracks.forEach((t, i) => {
    const n = numbers[i];
    t.endMs = n === null || n === undefined ? null : scan.trackEndMs.get(n) ?? null;
  });

  const trackResults = checked.map(({ track }): TrackIntegrity => {
    const end = expected(track);
    const base = { id: track.id, expectedEndMs: end, endMs: track.endMs };
    if (end === null) return { ...base, result: 'skipped', detail: 'no statistics tags' };
    if (track.endMs !== null) {
      return Math.abs(track.endMs - end) <= toleranceMs
        ? { ...base, result: 'pass' }
        : { ...base, result: 'fail', detail: `ends at ${track.endMs} ms, its statistics tags say ${end} ms` };
    }
    if (covered(scan, end)) {
      return { ...base, result: 'fail', detail: `no packets after ${scan.firstClusterMs} ms, its statistics tags say it ends at ${end} ms` };
    }
    return { ...base, result: 'skipped', detail: `its end is before the last ${scan.bytesRead} bytes read` };
  });

  const declared = nsToMs(num(container.duration));
  const starts = tracks.map((t) => t.startMs).filter((s): s is number => s !== null);
  const firstTimestamp = starts.length > 0 ? Math.min(...starts) : 0;
  const integrity: Integrity = {
    result: 'pass',
    toleranceMs,
    declaredDurationMs: declared,
    lastTimestampMs: scan.maxEndMs,
    scannedBytes: scan.bytesRead,
    scannedFromMs: scan.firstClusterMs,
    tracks: trackResults,
  };
  const fail = (detail: string): Integrity => ({ ...integrity, result: 'fail', detail });

  if (declared === null) return fail('the header declares no duration: integrity cannot be verified');
  if (scan.maxEndMs === null) {
    return fail(`no cluster found in the last ${Math.min(size, TAIL_MAX_BYTES)} bytes`);
  }
  // mkvmerge dichiara la fine più alta meno il primo timestamp; altri la
  // contano da zero (§4.8).
  const gap = Math.min(Math.abs(scan.maxEndMs - declared), Math.abs(scan.maxEndMs - firstTimestamp - declared));
  if (gap > toleranceMs) {
    return fail(`the last clusters end at ${scan.maxEndMs} ms, the header declares ${declared} ms`);
  }
  const broken = trackResults.find((t) => t.result === 'fail');
  if (broken) return fail(`track ${broken.id} ${broken.detail}`);
  return integrity;
}
