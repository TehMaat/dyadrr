import { stat } from 'node:fs/promises';
import { DyadrrError } from './codes.js';
import type { InputFile, InputTrack } from './inputs.js';
import { DEFAULT_TOOLS, runToolPiped, type ToolPaths } from './tools.js';

// Lettura delle finestre audio (studio §4.2, §4.3, §4.8). Un solo processo
// ffmpeg per finestra, con tutte le tracce che servono di quel file:
// timestamp della traccia non ribasati (-copyts, -seek_timestamp 1), pre-roll,
// taglio sui timestamp decodificati e inizio reale letto da ashowinfo. Mai
// dare per scontato che il primo campione cada all'istante richiesto.

/** Frequenza del segnale di analisi (§4.2). */
export const ANALYSIS_RATE = 8000;

/** Passa-basso del ricampionamento: 0,75 della metà di 8 kHz, cioè 3 kHz (§4.3). */
export const LOWPASS_HZ = 3000;

// Costanti del metodo, non parametri di taratura (§4.3).

/** Si comincia a decodificare così prima dell'inizio della finestra. */
export const PREROLL_MS = 2000;

/**
 * Buchi e sovrapposizioni nei timestamp oltre questa soglia si riempiono di
 * silenzio o si tolgono. Sotto no: con i timestamp al millisecondo di
 * Matroska l'arrotondamento da solo dà scarti fino a 1 ms.
 */
export const GAP_COMPENSATION_MS = 2;

/** Sotto questa frazione dei campioni attesi la finestra è `INPUT_UNREADABLE`. */
export const MIN_WINDOW_FRACTION = 0.9;

/** Segnale di una traccia: il solo canale centrale, oppure la media di L e R. */
export type Mix = 'center' | 'leftRight';

/** Canali delle disposizioni standard di ffmpeg (`ffmpeg -layouts`). */
const LAYOUTS: Readonly<Record<string, string>> = {
  mono: 'FC',
  stereo: 'FL+FR',
  '2.1': 'FL+FR+LFE',
  '3.0': 'FL+FR+FC',
  '3.0(back)': 'FL+FR+BC',
  '4.0': 'FL+FR+FC+BC',
  quad: 'FL+FR+BL+BR',
  'quad(side)': 'FL+FR+SL+SR',
  '3.1': 'FL+FR+FC+LFE',
  '5.0': 'FL+FR+FC+BL+BR',
  '5.0(side)': 'FL+FR+FC+SL+SR',
  '4.1': 'FL+FR+FC+LFE+BC',
  '5.1': 'FL+FR+FC+LFE+BL+BR',
  '5.1(side)': 'FL+FR+FC+LFE+SL+SR',
  '6.0': 'FL+FR+FC+BC+SL+SR',
  '6.0(front)': 'FL+FR+FLC+FRC+SL+SR',
  '3.1.2': 'FL+FR+FC+LFE+TFL+TFR',
  hexagonal: 'FL+FR+FC+BL+BR+BC',
  '6.1': 'FL+FR+FC+LFE+BC+SL+SR',
  '6.1(back)': 'FL+FR+FC+LFE+BL+BR+BC',
  '6.1(front)': 'FL+FR+LFE+FLC+FRC+SL+SR',
  '7.0': 'FL+FR+FC+BL+BR+SL+SR',
  '7.0(front)': 'FL+FR+FC+FLC+FRC+SL+SR',
  '7.1': 'FL+FR+FC+LFE+BL+BR+SL+SR',
  '7.1(wide)': 'FL+FR+FC+LFE+BL+BR+FLC+FRC',
  '7.1(wide-side)': 'FL+FR+FC+LFE+FLC+FRC+SL+SR',
  '5.1.2': 'FL+FR+FC+LFE+BL+BR+TFL+TFR',
  octagonal: 'FL+FR+FC+BL+BR+BC+SL+SR',
  cube: 'FL+FR+BL+BR+TFL+TFR+TBL+TBR',
  '5.1.4': 'FL+FR+FC+LFE+BL+BR+TFL+TFR+TBL+TBR',
  '7.1.2': 'FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR',
  '7.1.4': 'FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR+TBL+TBR',
  downmix: 'DL+DR',
};

/**
 * Canali di una disposizione di ffprobe: una standard ("5.1(side)") o una
 * scritta per esteso ("FL+FR+FC"). `null` se è sconosciuta.
 */
export function layoutChannels(layout: string | null): string[] | null {
  if (layout === null) return null;
  const known = LAYOUTS[layout];
  if (known !== undefined) return known.split('+');
  return /^[A-Z][A-Z0-9]*(\+[A-Z][A-Z0-9]*)+$/.test(layout) ? layout.split('+') : null;
}

/**
 * Una traccia "ha il canale centrale" se ha più di un canale e la sua
 * disposizione comprende FC. Il canale di una traccia mono è il mix completo,
 * non il dialogo (§4.2).
 */
export function hasCenter(track: Pick<InputTrack, 'channelLayout'>): boolean {
  const channels = layoutChannels(track.channelLayout);
  return channels !== null && channels.length > 1 && channels.includes('FC');
}

/** Segnale di una coppia di tracce: il centrale se lo hanno entrambe, altrimenti L+R (§4.2). */
export function analysisMix(a: Pick<InputTrack, 'channelLayout'>, b: Pick<InputTrack, 'channelLayout'>): Mix {
  return hasCenter(a) && hasCenter(b) ? 'center' : 'leftRight';
}

/** Il filtro `pan` che dà il segnale di analisi di una traccia. */
export function panFilter(track: Pick<InputTrack, 'id' | 'channelLayout' | 'channels'>, mix: Mix): string {
  const channels = layoutChannels(track.channelLayout);
  if (mix === 'center') {
    if (!hasCenter(track)) {
      throw new DyadrrError('INTERNAL', `track ${track.id} has no center channel (${track.channelLayout ?? 'unknown layout'})`);
    }
    return 'pan=mono|c0=FC';
  }
  if (channels?.includes('FL') && channels.includes('FR')) return 'pan=mono|c0=0.5*FL+0.5*FR';
  if ((channels?.length ?? track.channels) === 1) return 'pan=mono|c0=c0';
  return 'pan=mono|c0=0.5*c0+0.5*c1';
}

export interface AudioSignal {
  /** ID di mkvmerge -J della traccia. */
  trackId: number;
  mix: Mix;
}

export interface WindowRequest {
  /** Inizio richiesto, sulla linea del tempo delle tracce (§4.1). */
  startMs: number;
  durationMs: number;
}

export interface AudioWindow extends AudioSignal {
  /**
   * Inizio reale: il timestamp del primo campione decodificato, con il
   * decimale (multipli di 1/8 ms). Il campione n cade a startMs + n/8 ms.
   */
  startMs: number;
  /** Segnale di analisi a 8 kHz. */
  samples: Float32Array;
  /** Campioni attesi: la parte della finestra che cade dentro la traccia. */
  expectedSamples: number;
  /** Media dei quadrati in dBFS (fondo scala 1,0); −∞ per una finestra tutta a zero. */
  energyDbfs: number;
}

export interface AudioReading {
  request: WindowRequest;
  /** Da dove si è cominciato a decodificare: inizio richiesto meno il pre-roll, non sotto zero. */
  seekMs: number;
  /** Byte letti dal file, secondo ffmpeg (§11.2, punto 4); `null` se ffmpeg non li riporta. */
  bytesRead: number | null;
  /** Una finestra per segnale, nello stesso ordine. */
  windows: AudioWindow[];
}

export interface ReadWindowOptions {
  tools?: ToolPaths;
}

/** Energia in dBFS: media dei quadrati dei campioni (§4.5). */
export function energyDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return 10 * Math.log10(sum / samples.length);
}

const seconds = (ms: number) => (ms / 1000).toFixed(6);
const unreadable = (path: string, why: string) => new DyadrrError('INPUT_UNREADABLE', `${path}: ${why}`);

/**
 * Tratto in cui la traccia dichiara di avere audio, in ms: dal suo primo
 * timestamp alla fine secondo i tag statistici, altrimenti alla fine dichiarata
 * del file (§4.3). Mai dalla fine letta in coda: è quella che la finestra deve
 * controllare, e in un file troncato i tag, scritti in fondo, mancano.
 */
function trackSpan(input: InputFile, track: InputTrack): { start: number; end: number } {
  const start = track.startMs ?? input.startTimeMs ?? 0;
  if (track.statistics?.durationMs != null) return { start, end: start + track.statistics.durationMs };
  if (input.durationMs !== null) return { start, end: (input.startTimeMs ?? 0) + input.durationMs };
  return { start, end: track.endMs ?? Infinity };
}

/** Il PCM float little-endian di ffmpeg, copiato in un buffer allineato. */
function float32(buf: Buffer): Float32Array {
  const out = new Float32Array(Math.floor(buf.length / 4));
  new Uint8Array(out.buffer).set(buf.subarray(0, out.length * 4));
  return out;
}

interface Frame {
  n: number;
  pts: number;
  samples: number;
}

/** I blocchi che ashowinfo ha scritto per ogni segnale ("[ashowinfo@s0 @ 0x…] n:0 pts:80136 … nb_samples:8000"). */
function showinfoFrames(stderr: string, signals: number): Frame[][] {
  const frames: Frame[][] = Array.from({ length: signals }, () => []);
  const re = /^\[ashowinfo@s(\d+) @ [^\]]*\] n:(\d+) pts:(-?\d+) .*\bnb_samples:(\d+)/gm;
  for (const m of stderr.matchAll(re)) {
    frames[Number(m[1])]?.push({ n: Number(m[2]), pts: Number(m[3]), samples: Number(m[4]) });
  }
  return frames;
}

/**
 * Legge una finestra di audio da più tracce dello stesso file, in una sola
 * lettura (§4.2–4.3). Ogni finestra riporta il suo inizio reale.
 *
 * Errori: `INPUT_UNREADABLE` se una finestra decodifica meno del 90% dei
 * campioni attesi (per esempio oltre il punto in cui il file è troncato, §4.8)
 * o se ffmpeg fallisce; `INPUT_BUSY` se il file è cambiato da quando è stato
 * letto; `INTERNAL` per una richiesta sbagliata (traccia inesistente, finestra
 * tutta fuori dalla traccia, centrale che manca).
 */
export async function readAudioWindow(
  input: InputFile,
  signals: readonly AudioSignal[],
  request: WindowRequest,
  options: ReadWindowOptions = {},
): Promise<AudioReading> {
  const tools = options.tools ?? DEFAULT_TOOLS;
  const { path } = input;
  if (signals.length === 0) throw new DyadrrError('INTERNAL', 'no audio signal requested');
  if (!(request.durationMs > 0) || !Number.isFinite(request.startMs)) {
    throw new DyadrrError('INTERNAL', `invalid window ${JSON.stringify(request)}`);
  }
  const endMs = request.startMs + request.durationMs;

  const plan = signals.map((signal) => {
    const track = input.tracks.find((t) => t.id === signal.trackId);
    if (track?.type !== 'audio') throw new DyadrrError('INTERNAL', `${path}: no audio track with ID ${signal.trackId}`);
    if (track.streamIndex === null) throw unreadable(path, `track ${track.id} cannot be matched to an ffmpeg stream`);
    const span = trackSpan(input, track);
    const expectedMs = Math.min(endMs, span.end) - Math.max(request.startMs, span.start);
    if (!(expectedMs > 0)) {
      throw new DyadrrError(
        'INTERNAL',
        `${path}: window ${request.startMs}–${endMs} ms is outside track ${track.id} (${span.start}–${span.end} ms)`,
      );
    }
    return { signal, track, expectedSamples: Math.round((expectedMs * ANALYSIS_RATE) / 1000), filter: panFilter(track, signal.mix) };
  });

  // Il file non deve essere cambiato da quando è stato letto (§10).
  let st;
  try {
    st = await stat(path);
  } catch (e) {
    throw unreadable(path, `cannot be read (${(e as NodeJS.ErrnoException).code ?? String(e)})`);
  }
  if (st.size !== input.fingerprint.size || st.mtime.toISOString() !== input.fingerprint.modifiedAt) {
    throw new DyadrrError('INPUT_BUSY', `${path}: changed since it was read: it may still be being written`);
  }

  const seekMs = Math.max(0, request.startMs - PREROLL_MS);
  const gap = GAP_COMPENSATION_MS / 1000;
  const resample = `aresample=${ANALYSIS_RATE}:cutoff=${(2 * LOWPASS_HZ) / ANALYSIS_RATE}` +
    `:min_comp=${gap}:min_hard_comp=${gap}:max_soft_comp=0`;
  const chains = plan.map(({ track, filter }, i) =>
    `[0:${track.streamIndex}]${filter},${resample},` +
    `atrim=start=${seconds(request.startMs)}:end=${seconds(endMs)},` +
    `asetnsamples=n=${ANALYSIS_RATE}:p=0,ashowinfo@s${i}[o${i}]`);
  const args = [
    '-hide_banner', '-nostdin', '-nostats', '-v', 'verbose',
    // Compressione dinamica di AC3 ed E-AC3: il default di ffmpeg è piena (§4.2).
    '-drc_scale', '0',
    '-copyts', '-seek_timestamp', '1',
    ...(seekMs > 0 ? ['-ss', seconds(seekMs)] : []),
    '-i', path,
    '-filter_complex', chains.join(';'),
    ...plan.flatMap((_, i) => ['-map', `[o${i}]`, '-f', 'f32le', `pipe:${3 + i}`]),
  ];
  const result = await runToolPiped(tools, 'ffmpeg', args, plan.length);
  if (result.exitCode !== 0) {
    const last = result.stderr.trim().split('\n').slice(-3).join(' / ');
    throw unreadable(path, `ffmpeg could not decode ${request.startMs}–${endMs} ms (exit code ${result.exitCode}): ${last}`);
  }

  const frames = showinfoFrames(result.stderr, plan.length);
  const windows = plan.map(({ signal, track, expectedSamples }, i): AudioWindow => {
    const samples = float32(result.outputs[i]!);
    const list = frames[i]!;
    if (samples.length < MIN_WINDOW_FRACTION * expectedSamples) {
      throw unreadable(
        path,
        `track ${track.id}: window ${request.startMs}–${endMs} ms decoded ${samples.length} samples ` +
          `of ${expectedSamples} expected (less than ${MIN_WINDOW_FRACTION * 100}%): the file may be truncated or damaged`,
      );
    }
    // Il PCM non ha timestamp: i blocchi di ashowinfo devono essere contigui
    // e coprire esattamente i campioni ricevuti.
    let next = list[0]?.pts;
    let total = 0;
    for (const [k, f] of list.entries()) {
      if (f.n !== k || f.pts !== next) {
        throw new DyadrrError('INTERNAL', `${path}: track ${track.id}: discontinuous timestamps from ffmpeg at block ${k}`);
      }
      next = f.pts + f.samples;
      total += f.samples;
    }
    if (list.length === 0 || total !== samples.length) {
      throw new DyadrrError(
        'INTERNAL',
        `${path}: track ${track.id}: ffmpeg reported ${total} samples in ${list.length} blocks, ${samples.length} received`,
      );
    }
    return {
      ...signal,
      startMs: (list[0]!.pts * 1000) / ANALYSIS_RATE,
      samples,
      expectedSamples,
      energyDbfs: energyDbfs(samples),
    };
  });

  const bytes = [...result.stderr.matchAll(/Statistics: (\d+) bytes read/g)].map((m) => Number(m[1]));
  return {
    request: { ...request },
    seekMs,
    bytesRead: bytes.length > 0 ? bytes.reduce((a, b) => a + b, 0) : null,
    windows,
  };
}
