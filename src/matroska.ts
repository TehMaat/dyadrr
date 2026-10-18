import { open } from 'node:fs/promises';

// Lettura della coda di un MKV (studio §4.8). Dyadrr riconosce da sé gli
// ultimi cluster, senza ffmpeg: un file troncato ha perso l'indice (Cues), e
// ffmpeg cercherebbe la fine leggendo tutto il file. Da ogni cluster servono
// solo i timestamp e la durata dei blocchi, non il contenuto.

const ID = {
  cluster: 0x1f43b675,
  timestamp: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  blockDuration: 0x9b,
  crc32: 0xbf,
  void: 0xec,
} as const;

// Elementi di primo livello: chiudono un cluster di dimensione sconosciuta.
const LEVEL_1: ReadonlySet<number> = new Set([
  0x1f43b675, // Cluster
  0x1c53bb6b, // Cues
  0x1254c367, // Tags
  0x1941a469, // Attachments
  0x1043a770, // Chapters
  0x114d9b74, // SeekHead
  0x1549a966, // Info
  0x1654ae6b, // Tracks
  0x18538067, // Segment
]);

const CLUSTER_SIGNATURE = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

interface Vint {
  value: number;
  length: number;
  /** Dimensione "sconosciuta" (tutti i bit a 1), ammessa solo per i cluster. */
  unknown: boolean;
}

/** ID EBML: 1–4 byte, con il bit di lunghezza compreso nel valore. */
function readId(buf: Buffer, pos: number): { id: number; length: number } | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || pos + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + buf[pos + i]!;
  return { id, length };
}

/** Intero a lunghezza variabile EBML (dimensioni e numeri di traccia). */
function readVint(buf: Buffer, pos: number): Vint | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  if (pos + length > buf.length) return null;
  const marker = 0x80 >> (length - 1);
  let value = first & (marker - 1);
  let allOnes = value === marker - 1;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i]!;
    allOnes &&= b === 0xff;
    value = value * 256 + b;
  }
  return { value, length, unknown: allOnes };
}

function readUint(buf: Buffer, pos: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i]!;
  return value;
}

/** Un blocco: traccia, inizio e durata in tick della scala dei timestamp. */
export interface ScannedBlock {
  track: number;
  startTicks: number;
  /** BlockDuration, se il blocco ne ha una. */
  durationTicks: number | null;
  /** Fotogrammi nel blocco (più di uno con il lacing). */
  frames: number;
}

export interface ScannedCluster {
  /** Posizione nel buffer. */
  offset: number;
  timestampTicks: number;
  blocks: ScannedBlock[];
}

/** Intestazione di un Block o SimpleBlock: traccia, timestamp relativo, fotogrammi. */
function blockHeader(buf: Buffer, pos: number, end: number): { track: number; relative: number; frames: number } | null {
  const track = readVint(buf, pos);
  if (!track || track.unknown) return null;
  const p = pos + track.length;
  if (p + 3 > end) return null;
  const relative = buf.readInt16BE(p);
  const lacing = (buf[p + 2]! >> 1) & 0x03;
  if (lacing === 0) return { track: track.value, relative, frames: 1 };
  if (p + 4 > end) return null;
  return { track: track.value, relative, frames: buf[p + 3]! + 1 };
}

/**
 * Legge un cluster che inizia in `pos`. Restituisce `null` se a quella
 * posizione non c'è un cluster valido: i quattro byte dell'ID possono
 * comparire per caso dentro i dati, quindi si chiede che il Timestamp venga
 * prima di ogni blocco e che le dimensioni dei figli tornino. Un cluster
 * tagliato dalla fine del buffer dà solo i blocchi completi.
 */
export function parseCluster(buf: Buffer, pos: number): (ScannedCluster & { end: number }) | null {
  const id = readId(buf, pos);
  if (!id || id.id !== ID.cluster) return null;
  const size = readVint(buf, pos + id.length);
  if (!size) return null;
  const dataStart = pos + id.length + size.length;
  const declaredEnd = size.unknown ? Infinity : dataStart + size.value;
  const limit = Math.min(declaredEnd, buf.length);

  let timestamp: number | null = null;
  const blocks: ScannedBlock[] = [];
  let p = dataStart;
  while (p < limit) {
    const child = readId(buf, p);
    if (!child) break;
    if (size.unknown && LEVEL_1.has(child.id)) break;
    const childSize = readVint(buf, p + child.length);
    if (!childSize || childSize.unknown) {
      if (timestamp === null) return null;
      break;
    }
    const childStart = p + child.length + childSize.length;
    const childEnd = childStart + childSize.value;
    if (childEnd > declaredEnd) {
      if (timestamp === null) return null;
      break;
    }
    if (childEnd > buf.length) break; // tagliato dalla fine del file

    if (child.id === ID.timestamp) {
      if (childSize.value < 1 || childSize.value > 8) return null;
      timestamp = readUint(buf, childStart, childSize.value);
    } else if (child.id === ID.simpleBlock || child.id === ID.blockGroup) {
      if (timestamp === null) return null;
      const block = child.id === ID.simpleBlock
        ? simpleBlock(buf, childStart, childEnd, timestamp)
        : blockGroup(buf, childStart, childEnd, timestamp);
      if (!block) return null;
      blocks.push(block);
    } else if (timestamp === null && child.id !== ID.crc32 && child.id !== ID.void) {
      return null;
    }
    p = childEnd;
  }
  if (timestamp === null) return null;
  return { offset: pos, timestampTicks: timestamp, blocks, end: p };
}

function simpleBlock(buf: Buffer, start: number, end: number, clusterTicks: number): ScannedBlock | null {
  const header = blockHeader(buf, start, end);
  if (!header) return null;
  return { track: header.track, startTicks: clusterTicks + header.relative, durationTicks: null, frames: header.frames };
}

function blockGroup(buf: Buffer, start: number, end: number, clusterTicks: number): ScannedBlock | null {
  let header: ReturnType<typeof blockHeader> = null;
  let durationTicks: number | null = null;
  let p = start;
  while (p < end) {
    const child = readId(buf, p);
    const childSize = child && readVint(buf, p + child.length);
    if (!child || !childSize || childSize.unknown) return null;
    const childStart = p + child.length + childSize.length;
    const childEnd = childStart + childSize.value;
    if (childEnd > end) return null;
    if (child.id === ID.block) header = blockHeader(buf, childStart, childEnd);
    else if (child.id === ID.blockDuration && childSize.value <= 8) durationTicks = readUint(buf, childStart, childSize.value);
    p = childEnd;
  }
  if (!header) return null;
  return { track: header.track, startTicks: clusterTicks + header.relative, durationTicks, frames: header.frames };
}

/** Tutti i cluster validi del buffer, in ordine. */
export function findClusters(buf: Buffer): ScannedCluster[] {
  const clusters: ScannedCluster[] = [];
  let from = 0;
  for (;;) {
    const pos = buf.indexOf(CLUSTER_SIGNATURE, from);
    if (pos === -1) break;
    const cluster = parseCluster(buf, pos);
    if (cluster) {
      const { end, ...rest } = cluster;
      clusters.push(rest);
      // Le firme dentro un cluster valido sono dati, non cluster.
      from = Math.max(end, pos + 1);
    } else {
      from = pos + 1;
    }
  }
  return clusters;
}

export interface TrackTiming {
  /** Scala dei timestamp del segmento, in ns per tick (di norma 1 000 000). */
  timestampScaleNs: number;
  /** Durata predefinita di un fotogramma per numero di traccia, in ns. */
  defaultDurationNs: ReadonlyMap<number, number>;
}

export interface TailScan {
  /** Byte letti dalla fine del file. */
  bytesRead: number;
  /** Vero se il tratto letto è tutto il file. */
  wholeFile: boolean;
  clusters: number;
  /** Timestamp del primo cluster letto: da lì alla fine del file i blocchi sono tutti visti. */
  firstClusterMs: number | null;
  /** Fine più alta di un blocco (timestamp + durata). */
  maxEndMs: number | null;
  /** Fine più alta per numero di traccia. */
  trackEndMs: Map<number, number>;
}

const nsToMs = (ns: number) => Math.round(ns / 1000) / 1000;

/** Riassume i cluster: inizio del tratto, fine più alta, fine di ogni traccia. */
export function summarizeClusters(
  clusters: readonly ScannedCluster[],
  timing: TrackTiming,
  bytesRead: number,
  wholeFile: boolean,
): TailScan {
  const scale = timing.timestampScaleNs;
  const trackEndNs = new Map<number, number>();
  let maxEndNs: number | null = null;
  let firstNs: number | null = null;
  for (const cluster of clusters) {
    const clusterNs = cluster.timestampTicks * scale;
    if (firstNs === null || clusterNs < firstNs) firstNs = clusterNs;
    for (const b of cluster.blocks) {
      const duration = b.durationTicks !== null
        ? b.durationTicks * scale
        : b.frames * (timing.defaultDurationNs.get(b.track) ?? 0);
      const end = b.startTicks * scale + duration;
      trackEndNs.set(b.track, Math.max(trackEndNs.get(b.track) ?? -Infinity, end));
      if (maxEndNs === null || end > maxEndNs) maxEndNs = end;
    }
  }
  return {
    bytesRead,
    wholeFile,
    clusters: clusters.length,
    firstClusterMs: firstNs === null ? null : nsToMs(firstNs),
    maxEndMs: maxEndNs === null ? null : nsToMs(maxEndNs),
    trackEndMs: new Map([...trackEndNs].map(([track, ns]) => [track, nsToMs(ns)])),
  };
}

/** Si parte dagli ultimi 8 MiB e si raddoppia fino a 256 MiB (§4.8). */
export const TAIL_INITIAL_BYTES = 8 * 1024 * 1024;
export const TAIL_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Legge la coda del file a finestre crescenti, finché `enough` è soddisfatto,
 * il tratto letto è tutto il file o si arriva a `TAIL_MAX_BYTES`.
 */
export async function scanTail(
  path: string,
  size: number,
  timing: TrackTiming,
  enough: (scan: TailScan) => boolean,
): Promise<TailScan> {
  const handle = await open(path, 'r');
  try {
    let window = TAIL_INITIAL_BYTES;
    for (;;) {
      const length = Math.min(window, size);
      const buf = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(buf, read, length - read, size - length + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      const wholeFile = length === size;
      const scan = summarizeClusters(findClusters(buf.subarray(0, read)), timing, read, wholeFile);
      if (enough(scan) || wholeFile || window >= TAIL_MAX_BYTES) return scan;
      window *= 2;
    }
  } finally {
    await handle.close();
  }
}
