import { trackSpan } from './audio.js';
import { discardBuild, isFlac, isTrueHd, type Build } from './build.js';
import type { Calibration } from './calibration.js';
import { DyadrrError } from './codes.js';
import { transferResult, type Warning } from './decision.js';
import { readInput, type InputFile, type InputTrack } from './inputs.js';
import { trackLanguage } from './languages.js';
import {
  bestTransfer,
  measureTracks,
  measureTransfer,
  transferCandidates,
  transferPositions,
  type MeasuredTransferProbe,
  type TransferCandidate,
} from './measure.js';
import type { Plan } from './plan.js';
import { DEFAULT_TOOLS, runTool, type RunOptions, type ToolPaths } from './tools.js';

// Verifiche dopo il merge (studio §9.5): il file costruito da `buildMerge`,
// ancora nella cartella di lavoro, deve essere quello previsto prima di essere
// rinominato con `commitBuild`. Si legge come un ingresso (mkvmerge -J,
// ffprobe, ultimi cluster) e si confronta con il riferimento e con
// `Build.tracks`: tracce, video, pacchetti delle tracce del riferimento,
// inizio e fine dell'italiano, durata. Il controllo di trasferimento (§4.7)
// rifatto sul file finale dà solo avvisi.
//
// Una verifica bloccante che fallisce elimina la cartella di lavoro ed esce
// con `VERIFY_FAILED` (`VerifyFailedError`, con l'esito di ogni verifica per
// il report).

// Costanti del metodo, non parametri di taratura (§9.5): dicono quanto può
// scostarsi un file costruito bene, non quando una coppia è idonea.

/** I timestamp di Matroska sono al millisecondo: ogni confronto di tempi ammette 1 ms in più. */
export const TIMESTAMP_ROUNDING_MS = 1;

/**
 * "Entro un pacchetto" (§9.5): di quanto l'inizio o la fine di una traccia
 * audio italiana può scostarsi da quelli previsti, per codec. È il tratto più
 * lungo che un taglio può togliere o lasciare: un pacchetto, e per TrueHD la
 * distanza tra due punti di sincronizzazione, perché mkvmerge divide TrueHD
 * solo lì (§6.5, §18).
 */
export const PACKET_TOLERANCE_MS = {
  /** AC-3 ed E-AC-3: 1536 campioni a 48 kHz. */
  ac3: 32,
  /** DTS, anche HD e X: 512 campioni a 48 kHz. */
  dts: 11,
  /** TrueHD: un punto di sincronizzazione almeno ogni 107 ms circa sui Blu-ray. */
  trueHd: 107,
  /** FLAC: blocchi fino a 4608 campioni a 48 kHz. */
  flac: 96,
  /** Gli altri codec (AAC, Opus, PCM…): un pacchetto non supera questo. */
  other: 100,
} as const;

/** Tolleranza di inizio e fine di una traccia audio italiana, senza l'arrotondamento. */
export function packetToleranceMs(track: Pick<InputTrack, 'codec' | 'codecId'>): number {
  const id = track.codecId ?? '';
  if (isTrueHd(track) || id.startsWith('A_MLP')) return PACKET_TOLERANCE_MS.trueHd;
  if (isFlac(track)) return PACKET_TOLERANCE_MS.flac;
  if (/^A_E?AC3/.test(id) || /^E?-?AC-?3$/i.test(track.codec)) return PACKET_TOLERANCE_MS.ac3;
  if (id.startsWith('A_DTS') || /^DTS/i.test(track.codec)) return PACKET_TOLERANCE_MS.dts;
  return PACKET_TOLERANCE_MS.other;
}

// ---------------------------------------------------------------- tipi

export const VERIFY_CHECK_NAMES = ['layout', 'video', 'reference-tracks', 'italian-tracks', 'duration', 'transfer'] as const;
export type VerifyCheckName = (typeof VERIFY_CHECK_NAMES)[number];

export interface VerifyCheck {
  name: VerifyCheckName;
  result: 'pass' | 'fail' | 'skipped';
  /** Falso per il trasferimento, che dà solo avvisi. */
  blocking: boolean;
  code?: 'VERIFY_FAILED' | 'OUTPUT_TRANSFER_OFFSET' | 'OUTPUT_TRANSFER_UNVERIFIED';
  /** Cosa non torna, una voce per problema; per una verifica saltata, il motivo. */
  details: string[];
}

/** Inizio e fine di una traccia audio italiana nel file finale (§9.5). */
export interface ItalianTrackVerification {
  /** ID nel file finale. */
  trackId: number;
  /** ID nel donatore. */
  sourceTrackId: number;
  codec: string;
  /** Tolleranza del codec, con l'arrotondamento al millisecondo. */
  toleranceMs: number;
  expectedStartMs: number;
  startMs: number | null;
  expectedEndMs: number;
  endMs: number | null;
}

export interface Verification {
  result: 'pass' | 'fail';
  checks: VerifyCheck[];
  italian: ItalianTrackVerification[];
  /**
   * Fine del file: dove può cadere (`minMs`–`maxMs`), la fine più alta negli
   * ultimi cluster e la durata dichiarata.
   */
  duration: { referenceEndMs: number; minMs: number; maxMs: number; endMs: number | null; declaredMs: number | null } | null;
  /** Il controllo di trasferimento sul file finale, con gli ID del file finale. */
  transfer: {
    measureTrackId: number;
    italianTrackId: number;
    offsetMs: number | null;
    confident: number;
    probes: MeasuredTransferProbe[];
    /** Ogni traccia della lingua di misura del riferimento provata, con il suo esito. */
    candidates: TransferCandidate[];
  } | null;
  /** `OUTPUT_TRANSFER_OFFSET` o `OUTPUT_TRANSFER_UNVERIFIED`. */
  warnings: Warning[];
  /** Byte letti dal file finale per il controllo di trasferimento. */
  bytesRead: number;
}

/** `VERIFY_FAILED`, con l'esito di ogni verifica. */
export class VerifyFailedError extends DyadrrError {
  constructor(readonly verification: Verification, message: string) {
    super('VERIFY_FAILED', message);
  }
}

export interface VerifyRequest {
  reference: InputFile;
  /** Il piano da cui è stato costruito il file. */
  plan: Plan;
  /**
   * Traccia della lingua di misura del riferimento usata nella misura
   * (`Measurement.pair.referenceTrackId`). Il trasferimento prova tutte le
   * tracce del riferimento in quella lingua; a parità preferisce questa.
   */
  measureTrackId: number;
}

export interface VerifyOptions {
  tools?: ToolPaths;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------- lettura

/** Un errore nel leggere il file finale vuol dire che il file non è quello previsto. */
class OutputUnreadable extends Error {}

interface Probed {
  /** Titolo e dati del codec (CodecPrivate, in esadecimale) per ID di traccia, da mkvmerge -J. */
  title: string | null;
  codecPrivate: Map<number, string | null>;
  /** Inizio e titolo; gli UID no: mkvmerge può generarne di nuovi (§9.5). */
  chapters: { startMs: number; title: string | null }[];
  /** Metadati del flusso video e side data del suo primo fotogramma, da ffprobe. */
  video: Record<string, unknown>;
}

/** I campi del flusso video che devono restare identici (§9.5). */
const VIDEO_FIELDS = [
  'codec_name', 'profile', 'level', 'width', 'height', 'coded_width', 'coded_height', 'pix_fmt',
  'color_range', 'color_space', 'color_transfer', 'color_primaries', 'chroma_location', 'field_order',
  'sample_aspect_ratio', 'display_aspect_ratio', 'r_frame_rate', 'avg_frame_rate', 'side_data_list',
] as const;

/** Programmi e annullamento delle letture. */
type Run = RunOptions & { tools: ToolPaths };

async function json(
  run: Run,
  tool: 'mkvmerge' | 'ffprobe',
  args: readonly string[],
  fail: (why: string) => Error,
) {
  const result = await runTool(run.tools, tool, args, run);
  try {
    if (tool === 'ffprobe' && result.exitCode !== 0) throw new Error();
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw fail(`${tool} failed (exit code ${result.exitCode}): ${result.stderr.trim()}`);
  }
}

async function probe(file: InputFile, video: InputTrack, run: Run, fail: (why: string) => Error): Promise<Probed> {
  const id = await json(run, 'mkvmerge', ['-J', file.path], fail);
  const tracks = (id.tracks ?? []) as { id: number; properties?: { codec_private_data?: string } }[];
  const container = (id.container ?? {}) as { properties?: { title?: string } };
  const chapters = await json(run, 'ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file.path], fail);
  if (video.streamIndex === null) throw fail(`video track ${video.id} cannot be matched to an ffprobe stream`);
  const stream = await json(run, 'ffprobe', ['-v', 'error', '-select_streams', String(video.streamIndex), '-show_streams', '-of', 'json', file.path], fail);
  const frame = await json(run, 'ffprobe', [
    '-v', 'error', '-select_streams', String(video.streamIndex), '-read_intervals', '%+#1',
    '-show_entries', 'frame=side_data_list', '-of', 'json', file.path,
  ], fail);
  const s = ((stream.streams ?? []) as Record<string, unknown>[])[0] ?? {};
  return {
    title: container.properties?.title ?? null,
    codecPrivate: new Map(tracks.map((t) => [t.id, t.properties?.codec_private_data ?? null])),
    chapters: ((chapters.chapters ?? []) as { start_time: string; tags?: { title?: string } }[])
      .map((c) => ({ startMs: Math.round(Number(c.start_time) * 1e6) / 1000, title: c.tags?.title ?? null })),
    video: {
      ...Object.fromEntries(VIDEO_FIELDS.map((f) => [f, s[f] ?? null])),
      first_frame_side_data_list: ((frame.frames ?? []) as { side_data_list?: unknown }[])[0]?.side_data_list ?? null,
    },
  };
}

/** Pacchetti di ogni flusso, contati da ffprobe: legge tutto il file. Solo se mancano i tag statistici. */
async function countPackets(file: InputFile, run: Run, fail: (why: string) => Error): Promise<Map<number, number>> {
  const result = await json(run, 'ffprobe', [
    '-v', 'error', '-count_packets', '-show_entries', 'stream=index,nb_read_packets', '-of', 'json', file.path,
  ], fail);
  return new Map(((result.streams ?? []) as { index: number; nb_read_packets?: string }[])
    .filter((s) => s.nb_read_packets !== undefined)
    .map((s) => [s.index, Number(s.nb_read_packets)]));
}

// ---------------------------------------------------------------- verifiche

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const show = (x: unknown) => (x === null || x === undefined ? 'none' : JSON.stringify(x));

/** La fine di una traccia: dagli ultimi cluster, altrimenti dai tag statistici (§4.3). */
const trackEnd = (file: InputFile, t: InputTrack) => t.endMs ?? trackSpan(file, t).end;

/**
 * Verifica il file costruito (§9.5), prima della rinomina. Restituisce
 * l'esito di ogni verifica; con una verifica bloccante fallita elimina la
 * cartella di lavoro e lancia `VerifyFailedError` (`VERIFY_FAILED`). Dopo si
 * chiama `commitBuild`.
 *
 * Errori: `VERIFY_FAILED` (anche un file finale che non si riesce a leggere),
 * `INPUT_UNREADABLE` (il riferimento non si legge più), `TOOL_MISSING`; con
 * `signal` interrotto, l'errore dell'annullamento. In ogni caso d'errore la
 * cartella di lavoro si elimina.
 */
export async function verifyBuild(
  request: VerifyRequest,
  build: Build,
  cal: Calibration,
  options: VerifyOptions = {},
): Promise<Verification> {
  try {
    const verification = await verify(request, build, cal, options);
    if (verification.result === 'fail') {
      const failed = verification.checks.filter((c) => c.blocking && c.result === 'fail');
      throw new VerifyFailedError(
        verification,
        `the final file is not the planned one: ${failed.map((c) => `${c.name} (${c.details.join('; ')})`).join('; ')}`,
      );
    }
    return verification;
  } catch (e) {
    await discardBuild(build);
    if (e instanceof OutputUnreadable) throw new DyadrrError('VERIFY_FAILED', `${build.file}: the final file cannot be read: ${e.message}`);
    throw e;
  }
}

async function verify(request: VerifyRequest, build: Build, cal: Calibration, options: VerifyOptions): Promise<Verification> {
  const tools = options.tools ?? DEFAULT_TOOLS;
  const run: Run = { tools, signal: options.signal };
  const { reference, plan } = request;
  const step = () => options.signal?.throwIfAborted();
  const outputFail = (why: string) => new OutputUnreadable(why);
  const referenceFail = (why: string) => new DyadrrError('INPUT_UNREADABLE', `${reference.path}: ${why}`);

  step();
  let out: InputFile;
  try {
    out = await readInput(build.file, { calibration: cal, tools, ownOutput: true, signal: options.signal });
  } catch (e) {
    if (e instanceof DyadrrError && e.code !== 'TOOL_MISSING') throw outputFail(e.message);
    throw e;
  }
  const expected = build.tracks;
  const refVideo = reference.tracks.find((t) => t.id === reference.video.trackId)!;
  const outVideo = out.tracks.find((t) => t.id === out.video.trackId)!;
  step();
  const refProbe = await probe(reference, refVideo, run, referenceFail);
  const outProbe = await probe(out, outVideo, run, outputFail);

  const checks: VerifyCheck[] = [];
  const add = (name: VerifyCheckName, details: string[], blocking = true) =>
    checks.push({ name, result: details.length > 0 ? 'fail' : 'pass', blocking, ...(details.length > 0 ? { code: 'VERIFY_FAILED' as const } : {}), details });
  const skip = (name: VerifyCheckName, why: string, blocking = true) => checks.push({ name, result: 'skipped', blocking, details: [why] });

  // 1. Tracce (§6.2): numero, ordine, codec, lingue, nomi, flag e compressione
  // come in `Build.tracks`; tutte quelle del riferimento tranne i PGS italiani
  // scartati; titolo e capitoli del riferimento.
  const layout: string[] = [];
  if (out.tracks.length !== expected.length) layout.push(`${out.tracks.length} tracks, ${expected.length} expected`);
  const aligned = out.tracks.length === expected.length && expected.every((e, i) => out.tracks[i]!.type === e.type);
  expected.forEach((e, i) => {
    const t = out.tracks[i];
    if (!t) return;
    const fields: [string, unknown, unknown][] = [
      ['type', t.type, e.type],
      ['codec', t.codec, e.codec],
      ['language', t.language, e.language],
      ['name', t.name, e.name],
      ['default', t.default, e.default],
      ['forced', t.forced, e.forced],
      ['compression', t.compression, e.type === 'subtitles' ? (e.compression === 'none' ? null : e.compression) : t.compression],
    ];
    for (const [field, actual, wanted] of fields) {
      if (!same(actual, wanted)) layout.push(`track ${t.id} (${e.source} ${e.sourceTrackId}): ${field} ${show(actual)}, expected ${show(wanted)}`);
    }
  });
  const dropped = new Set(plan.referenceItalianSubtitles.filter((s) => s.kept === false).map((s) => s.id));
  const wantedReference = reference.tracks.filter((t) => !dropped.has(t.id)).map((t) => t.id).sort((a, b) => a - b);
  const builtReference = expected.filter((e) => e.source === 'reference').map((e) => e.sourceTrackId).sort((a, b) => a - b);
  if (!same(builtReference, wantedReference)) {
    layout.push(`reference tracks ${show(builtReference)} in the final file, expected ${show(wantedReference)}`);
  }
  if (outProbe.title !== refProbe.title) layout.push(`title ${show(outProbe.title)}, expected ${show(refProbe.title)}`);
  if (!same(outProbe.chapters, refProbe.chapters)) {
    layout.push(`chapters ${show(outProbe.chapters)}, expected those of the reference ${show(refProbe.chapters)}`);
  }
  add('layout', layout);

  // Le verifiche seguenti confrontano traccia per traccia.
  const notAligned = 'the tracks of the final file are not in the planned order';
  const outTrack = (i: number) => out.tracks[i]!;
  const refTrack = (id: number) => reference.tracks.find((t) => t.id === id)!;
  const refIndices = expected.flatMap((e, i) => (e.source === 'reference' ? [i] : []));

  // Pacchetti delle tracce del riferimento: dai tag statistici, che mkvmerge
  // riscrive contando i pacchetti; se il riferimento non li ha, contati.
  let counts: { reference: Map<number, number>; output: Map<number, number> } | null = null;
  const packets = async (i: number): Promise<[number | null, number | null]> => {
    const r = refTrack(expected[i]!.sourceTrackId);
    const o = outTrack(i);
    if (r.statistics?.frames != null && o.statistics?.frames != null) return [r.statistics.frames, o.statistics.frames];
    step();
    counts ??= { reference: await countPackets(reference, run, referenceFail), output: await countPackets(out, run, outputFail) };
    return [
      r.streamIndex === null ? null : counts.reference.get(r.streamIndex) ?? null,
      o.streamIndex === null ? null : counts.output.get(o.streamIndex) ?? null,
    ];
  };

  // 2. Video (§6.2): identico al riferimento.
  const videoIndex = expected.findIndex((e) => e.source === 'reference' && e.sourceTrackId === refVideo.id);
  if (!aligned || videoIndex === -1) {
    skip('video', notAligned);
  } else {
    const v = outTrack(videoIndex);
    const problems: string[] = [];
    const codecPrivate = refProbe.codecPrivate.get(refVideo.id);
    if (codecPrivate === undefined || codecPrivate !== outProbe.codecPrivate.get(v.id)) problems.push('codec private data differ');
    for (const [field, wanted] of Object.entries(refProbe.video)) {
      if (!same(outProbe.video[field], wanted)) problems.push(`${field} ${show(outProbe.video[field])}, expected ${show(wanted)}`);
    }
    if (out.video.trackId !== v.id || out.video.hdr !== reference.video.hdr || out.video.dvProfile !== reference.video.dvProfile) {
      problems.push(`HDR ${out.video.hdr} (Dolby Vision profile ${show(out.video.dvProfile)}), expected ${reference.video.hdr} (${show(reference.video.dvProfile)})`);
    }
    const [refFrames, outFrames] = await packets(videoIndex);
    if (refFrames === null || refFrames !== outFrames) problems.push(`${show(outFrames)} frames, expected ${show(refFrames)}`);
    const frameMs = 1000 / reference.video.fps;
    const near = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= frameMs;
    if (!near(v.startMs, refVideo.startMs)) problems.push(`first timestamp ${show(v.startMs)} ms, expected ${show(refVideo.startMs)} ms`);
    const [vEnd, refEnd] = [trackEnd(out, v), trackEnd(reference, refVideo)];
    if (!near(vEnd, refEnd)) problems.push(`ends at ${round3(vEnd)} ms, expected ${round3(refEnd)} ms`);
    add('video', problems);
  }

  // 3. Tracce del riferimento: lo stesso numero di pacchetti.
  if (!aligned) {
    skip('reference-tracks', notAligned);
  } else {
    const problems: string[] = [];
    for (const i of refIndices) {
      const [r, o] = await packets(i);
      if (r === null || r !== o) problems.push(`track ${outTrack(i).id} (reference ${expected[i]!.sourceTrackId}): ${show(o)} packets, expected ${show(r)}`);
    }
    add('reference-tracks', problems);
  }

  // 4. Italiano: inizio da mkvmerge -J, fine dagli ultimi cluster, entro un
  // pacchetto del codec.
  const italian: ItalianTrackVerification[] = [];
  if (!aligned) {
    skip('italian-tracks', notAligned);
  } else {
    expected.forEach((e, i) => {
      if (e.source !== 'donor' || e.type !== 'audio' || e.expectedStartMs === null || e.expectedEndMs === null) return;
      const t = outTrack(i);
      italian.push({
        trackId: t.id,
        sourceTrackId: e.sourceTrackId,
        codec: t.codec,
        toleranceMs: packetToleranceMs(t) + TIMESTAMP_ROUNDING_MS,
        expectedStartMs: e.expectedStartMs,
        startMs: t.startMs,
        expectedEndMs: e.expectedEndMs,
        endMs: t.startMs === null ? null : round3(trackEnd(out, t)),
      });
    });
    const problems: string[] = [];
    for (const x of italian) {
      const off = (a: number | null, b: number) => a === null || Math.abs(a - b) > x.toleranceMs;
      if (off(x.startMs, x.expectedStartMs)) problems.push(`track ${x.trackId} starts at ${show(x.startMs)} ms, expected ${x.expectedStartMs} ms ± ${x.toleranceMs}`);
      if (off(x.endMs, x.expectedEndMs)) problems.push(`track ${x.trackId} ends at ${show(x.endMs)} ms, expected ${x.expectedEndMs} ms ± ${x.toleranceMs}`);
    }
    add('italian-tracks', problems);
  }

  // 5. Durata: la fine del file è la più alta tra quella del riferimento e
  // quelle previste dell'italiano, entro un pacchetto.
  let duration: Verification['duration'] = null;
  if (!aligned) {
    skip('duration', notAligned);
  } else {
    // La fine del riferimento senza le tracce scartate; una traccia che non è
    // negli ultimi cluster finisce prima di quelle che ci sono.
    const ends = reference.tracks.filter((t) => !dropped.has(t.id) && t.endMs !== null).map((t) => t.endMs!);
    const referenceEndMs = ends.length > 0 ? Math.max(...ends) : reference.integrity.lastTimestampMs ?? 0;
    const minMs = Math.max(referenceEndMs, ...italian.map((x) => x.expectedEndMs - x.toleranceMs)) - TIMESTAMP_ROUNDING_MS;
    const maxMs = Math.max(referenceEndMs, ...italian.map((x) => x.expectedEndMs + x.toleranceMs)) + TIMESTAMP_ROUNDING_MS;
    const endMs = out.integrity.lastTimestampMs;
    const declaredMs = out.durationMs;
    duration = { referenceEndMs, minMs: round3(minMs), maxMs: round3(maxMs), endMs, declaredMs };
    const inside = (x: number | null) => x !== null && x >= minMs && x <= maxMs;
    const problems: string[] = [];
    if (!inside(endMs)) problems.push(`the last clusters end at ${show(endMs)} ms, expected ${round3(minMs)}–${round3(maxMs)} ms`);
    // Durata dichiarata: mkvmerge la conta dal primo timestamp del file (§4.8).
    if (!inside(declaredMs) && !inside(declaredMs === null ? null : declaredMs + (out.startTimeMs ?? 0))) {
      problems.push(`declared duration ${show(declaredMs)} ms, expected ${round3(minMs)}–${round3(maxMs)} ms`);
    }
    add('duration', problems);
  }

  // 6. Trasferimento (§4.7) sul file finale: le tracce della lingua di misura
  // del riferimento e l'italiano principale, a spostamento circa zero; vale la
  // traccia con più picchi sicuri (§4.7). Solo avvisi.
  const warnings: Warning[] = [];
  let transfer: Verification['transfer'] = null;
  let bytesRead = 0;
  const blockingFailed = checks.some((c) => c.blocking && c.result !== 'pass');
  const italianIndex = expected.findIndex((e) => e.source === 'donor' && e.type === 'audio' && e.default);
  const measureIndex = expected.findIndex((e) => e.source === 'reference' && e.sourceTrackId === request.measureTrackId && e.type === 'audio');
  const measureSource = reference.audio.find((t) => t.id === request.measureTrackId);
  if (blockingFailed) {
    skip('transfer', 'a blocking check failed', false);
  } else if (italianIndex === -1 || measureIndex === -1 || !measureSource) {
    skip('transfer', `no ${italianIndex === -1 ? 'main Italian' : `measure language (reference track ${request.measureTrackId})`} audio track in the final file`, false);
  } else {
    const e = expected[italianIndex]!;
    const from = Math.max(plan.commonMaterial.startMs, e.expectedStartMs!);
    const to = Math.min(plan.commonMaterial.endMs, e.expectedEndMs!);
    // Le tracce del riferimento nella lingua di misura, con gli ID del file finale.
    const language = trackLanguage(measureSource);
    const sources = new Set(measureTracks(reference.audio, language ?? '').map((t) => t.id));
    const inOutput = expected.flatMap((x, i) => (x.source === 'reference' && x.type === 'audio' && sources.has(x.sourceTrackId) ? [outTrack(i)] : []));
    const candidates = transferCandidates(inOutput.length > 0 ? inOutput : [outTrack(measureIndex)], outTrack(italianIndex), outTrack(measureIndex).id);
    step();
    const measured = await measureTransfer(
      out,
      candidates.map((t) => t.id),
      outTrack(italianIndex).id,
      transferPositions(from, to, cal.values.checkpointWindowMs),
      cal,
      run,
    ).catch((err: unknown) => {
      if (err instanceof DyadrrError && err.code !== 'TOOL_MISSING') throw outputFail(err.message);
      throw err;
    });
    bytesRead = measured.bytesRead;
    const best = bestTransfer(candidates, measured.probes, cal);
    const { offsetMs, confident } = transferResult(measured.probes[best]!, cal);
    transfer = {
      measureTrackId: candidates[best]!.id,
      italianTrackId: outTrack(italianIndex).id,
      offsetMs,
      confident,
      probes: measured.probes[best]!,
      candidates: candidates.map((t, i) => {
        const r = transferResult(measured.probes[i]!, cal);
        return { trackId: t.id, offsetMs: r.offsetMs, confident: r.confident };
      }),
    };
    const tol = cal.values.toleranceMs;
    if (offsetMs === null) {
      const message = 'in the final file the Italian track does not correlate with the measure language of the reference';
      checks.push({ name: 'transfer', result: 'fail', blocking: false, code: 'OUTPUT_TRANSFER_UNVERIFIED', details: [message] });
      warnings.push({ code: 'OUTPUT_TRANSFER_UNVERIFIED', message });
    } else if (Math.abs(offsetMs) > tol) {
      const message = `in the final file the Italian track is offset by ${offsetMs} ms from the measure language of the reference (tolerance ${tol} ms)`;
      checks.push({ name: 'transfer', result: 'fail', blocking: false, code: 'OUTPUT_TRANSFER_OFFSET', details: [message] });
      warnings.push({ code: 'OUTPUT_TRANSFER_OFFSET', message, value: offsetMs });
    } else {
      checks.push({ name: 'transfer', result: 'pass', blocking: false, details: [] });
    }
  }

  return {
    result: checks.some((c) => c.blocking && c.result === 'fail') ? 'fail' : 'pass',
    checks,
    italian,
    duration,
    transfer,
    warnings,
    bytesRead,
  };
}
