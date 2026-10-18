import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findClusters, summarizeClusters } from '../src/matroska.js';

// Cluster costruiti a mano, per i casi che mkvmerge non produce nei test con
// file veri: dimensione sconosciuta, lacing, BlockGroup con durata, firme
// false nei dati, ultimo blocco tagliato.

/** Dimensione EBML su 8 byte, o "sconosciuta". */
const size = (n: number | 'unknown') => {
  const b = Buffer.alloc(8);
  if (n === 'unknown') return Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  b.writeBigUInt64BE(BigInt(n));
  b[0] = 0x01;
  return b;
};
const element = (id: number[], payload: Buffer, unknownSize = false) =>
  Buffer.concat([Buffer.from(id), size(unknownSize ? 'unknown' : payload.length), payload]);

const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const timestamp = (ticks: number) => element([0xe7], Buffer.from([ticks >> 8, ticks & 0xff]));
/** Traccia (1–127), timestamp relativo, e numero di fotogrammi con lacing Xiph se più di uno. */
const blockBody = (track: number, relative: number, frames = 1) => {
  const header = Buffer.alloc(4);
  header[0] = 0x80 | track;
  header.writeInt16BE(relative, 1);
  header[3] = frames > 1 ? 0x82 : 0x80;
  return Buffer.concat([header, frames > 1 ? Buffer.from([frames - 1]) : Buffer.alloc(0), Buffer.alloc(16, 0xaa)]);
};
const simpleBlock = (track: number, relative: number, frames = 1) => element([0xa3], blockBody(track, relative, frames));
const blockGroup = (track: number, relative: number, duration: number) =>
  element([0xa0], Buffer.concat([
    element([0xa1], blockBody(track, relative)),
    element([0x9b], Buffer.from([duration >> 8, duration & 0xff])),
  ]));

const timing = { timestampScaleNs: 1_000_000, defaultDurationNs: new Map([[1, 41_708_333], [2, 32_000_000]]) };

test('cluster: lacing, BlockGroup con durata, dimensione sconosciuta', () => {
  const buf = Buffer.concat([
    element(CLUSTER, Buffer.concat([timestamp(1000), simpleBlock(1, 0), simpleBlock(2, 10, 3)])),
    element(CLUSTER, Buffer.concat([timestamp(2000), simpleBlock(1, 5), blockGroup(3, 100, 1500)]), true),
    element([0x1c, 0x53, 0xbb, 0x6b], Buffer.alloc(8)), // Cues: chiude il cluster di dimensione sconosciuta
  ]);
  const clusters = findClusters(buf);
  assert.deepEqual(clusters.map((c) => [c.timestampTicks, c.blocks.length]), [[1000, 2], [2000, 2]]);
  const scan = summarizeClusters(clusters, timing, buf.length, true);
  assert.equal(scan.firstClusterMs, 1000);
  // Tre fotogrammi AC3 da 32 ms; un fotogramma video; un sottotitolo di 1,5 s.
  assert.equal(scan.trackEndMs.get(2), 1010 + 96);
  assert.equal(scan.trackEndMs.get(1), 2005 + 41.708);
  assert.equal(scan.trackEndMs.get(3), 2100 + 1500);
  assert.equal(scan.maxEndMs, 3600);
});

test('cluster: firme false nei dati e ultimo blocco tagliato', () => {
  const fake = Buffer.concat([Buffer.from(CLUSTER), Buffer.from([0x85, 0x00, 0x11, 0x22, 0x33])]);
  const last = element(CLUSTER, Buffer.concat([timestamp(5000), simpleBlock(1, 0), simpleBlock(2, 40)]));
  const buf = Buffer.concat([
    fake,
    element(CLUSTER, Buffer.concat([timestamp(4000), element([0xa3], Buffer.concat([blockBody(1, 0), fake]))])),
    last.subarray(0, last.length - 5), // il file finisce dentro l'ultimo blocco
  ]);
  const clusters = findClusters(buf);
  assert.deepEqual(clusters.map((c) => [c.timestampTicks, c.blocks.length]), [[4000, 1], [5000, 1]]);
  const scan = summarizeClusters(clusters, timing, buf.length, true);
  assert.equal(scan.trackEndMs.has(2), false);
  assert.equal(scan.maxEndMs, 5000 + 41.708);
});
