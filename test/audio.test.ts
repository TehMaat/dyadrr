import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, rmSync, statSync, truncateSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANALYSIS_RATE,
  PREROLL_MS,
  analysisMix,
  energyDbfs,
  hasCenter,
  layoutChannels,
  readAudioWindow,
  type AudioSignal,
  type AudioWindow,
  type Mix,
} from '../src/audio.js';
import { loadCalibration } from '../src/calibration.js';
import { DyadrrError } from '../src/codes.js';
import { readInput, type InputFile } from '../src/inputs.js';
import { locate } from './helpers/correlate.js';
import { mkvmerge, realShift, run, settle, tempDir } from './helpers/mkv.js';

// Lettura delle finestre audio (studio §4.3, §15 punto 1d) su MKV veri,
// generati al volo. Sorgente: 12 s di video di prova (un fotogramma chiave
// ogni 24, cioè ogni 1,001 s) e un 5.1 di rumore con un rumore diverso su ogni
// canale, così il centrale e L+R sono segnali indipendenti. Lo stesso audio è
// codificato in AC3, E-AC3, FLAC, TrueHD e DTS e passato per mkvmerge.
// FLAC è senza perdite e ha pacchetti di 96 ms esatti: fa da verità.

const cal = loadCalibration();
const CODECS = ['ac3', 'eac3', 'flac', 'truehd', 'dts'] as const;
type Codec = (typeof CODECS)[number];
const SECONDS = 12;
const MS = ANALYSIS_RATE / 1000; // campioni per millisecondo

let dir: string;
const p = (name: string) => join(dir, name);
const inputs: Record<string, Promise<InputFile>> = {};
const read = (name: string) => (inputs[name] ??= readInput(p(`${name}.mkv`), { calibration: cal }));

const code = (expected: string) => (e: unknown) => {
  assert.ok(e instanceof DyadrrError, String(e));
  assert.equal(e.code, expected, e.message);
  return true;
};

/** Le tracce audio di un file con il loro segnale. */
const signal = (file: InputFile, n: number, mix: Mix): AudioSignal => ({ trackId: file.audio[n]!.id, mix });

/** Una finestra di una sola traccia. */
async function window(name: string, startMs: number, durationMs: number, mix: Mix = 'center', n = 0): Promise<AudioWindow> {
  const file = await read(name);
  const reading = await readAudioWindow(file, [signal(file, n, mix)], { startMs, durationMs });
  return reading.windows[0]!;
}

/**
 * Dove cade il contenuto di `w` dentro la verità (`truth`, letta da 0), in ms:
 * di quanto l'inizio reale di `w` è più tardi del suo contenuto nella verità.
 */
function offsetFromTruth(w: AudioWindow, truth: AudioWindow, expectedMs = 0): { ms: number; ncc: number } {
  const around = (w.startMs - expectedMs - truth.startMs) * MS;
  const m = locate(w.samples, truth.samples, around, 25 * MS);
  return { ms: w.startMs - (truth.startMs + m.index / MS), ncc: m.ncc };
}

before(() => {
  dir = tempDir();
  const noise = (seed: number, color = 'pink') => ['-f', 'lavfi', '-i', `anoisesrc=d=${SECONDS}:c=${color}:r=48000:a=0.25:s=${seed}`];
  run('ffmpeg', [
    '-v', 'error', '-y', ...noise(1), ...noise(2), ...noise(3), ...noise(4, 'brown'), ...noise(5), ...noise(6),
    '-filter_complex', '[0][1][2][3][4][5]join=inputs=6:channel_layout=5.1[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', p('source.wav'),
  ]);
  run('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24000/1001', '-t', String(SECONDS),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', p('video.mkv'),
  ]);
  for (const codec of CODECS) {
    run('ffmpeg', [
      '-v', 'error', '-y', '-i', p('video.mkv'), '-i', p('source.wav'), '-map', '0', '-map', '1',
      '-c:v', 'copy', '-c:a', codec, ...(codec === 'truehd' || codec === 'dts' ? ['-strict', '-2'] : []),
      p(`ff-${codec}.mkv`),
    ]);
    settle(mkvmerge(p(`${codec}.mkv`), [p(`ff-${codec}.mkv`)]));
  }

  // Spostamenti noti con --sync su tutte le tracce (§15, 1a): uno positivo,
  // che dà anche uno start_time diverso da zero, e uno negativo.
  for (const codec of CODECS) {
    for (const [suffix, shift] of [['plus', 1537], ['minus', -263]] as const) {
      settle(mkvmerge(p(`${codec}-${suffix}.mkv`), ['--sync', `0:${shift}`, '--sync', `1:${shift}`, p(`${codec}.mkv`)]));
    }
  }
  // Tutto spostato oltre il pre-roll: start_time di 6,5 s.
  settle(mkvmerge(p('late-file.mkv'), ['--sync', '0:6500', '--sync', '1:6500', p('flac.mkv')]));
  // Solo l'audio spostato: la traccia parte dopo lo zero, il video no.
  settle(mkvmerge(p('late-audio.mkv'), ['--sync', '1:700', p('ac3.mkv')]));

  // Due tracce nello stesso file: AC3 5.1 e FLAC stereo (FL e FR della sorgente).
  run('ffmpeg', ['-v', 'error', '-y', '-i', p('source.wav'), '-af', 'pan=stereo|c0=FL|c1=FR', '-c:a', 'flac', p('stereo.mka')]);
  settle(mkvmerge(p('two-tracks.mkv'), [p('ac3.mkv'), p('stereo.mka')]));

  // Troncato a metà: l'intestazione e i tag dicono ancora 12 s (§4.8).
  copyFileSync(p('flac.mkv'), p('truncated.mkv'));
  truncateSync(p('truncated.mkv'), Math.floor(statSync(p('flac.mkv')).size / 2));
  settle(p('truncated.mkv'));
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('disposizioni dei canali e segnale della coppia: centrale solo se lo hanno entrambe', () => {
  assert.deepEqual(layoutChannels('5.1(side)'), ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR']);
  assert.deepEqual(layoutChannels('FL+FR+FC'), ['FL', 'FR', 'FC']);
  assert.equal(layoutChannels('6 channels'), null);
  assert.equal(layoutChannels(null), null);

  const layout = (channelLayout: string | null) => ({ channelLayout });
  assert.equal(hasCenter(layout('5.1')), true);
  assert.equal(hasCenter(layout('7.1')), true);
  assert.equal(hasCenter(layout('3.0')), true);
  assert.equal(hasCenter(layout('stereo')), false);
  assert.equal(hasCenter(layout('quad')), false);
  // Il canale di una traccia mono è il mix completo, non il dialogo (§4.2).
  assert.equal(hasCenter(layout('mono')), false);
  assert.equal(hasCenter(layout(null)), false);

  assert.equal(analysisMix(layout('5.1(side)'), layout('7.1')), 'center');
  assert.equal(analysisMix(layout('5.1(side)'), layout('stereo')), 'leftRight');
  assert.equal(analysisMix(layout('mono'), layout('5.1')), 'leftRight');
});

test('energia in dBFS', () => {
  assert.equal(energyDbfs(new Float32Array([1, -1, 1, -1])), 0);
  assert.ok(Math.abs(energyDbfs(new Float32Array([0.5, -0.5])) - -6.0206) < 1e-3);
  assert.equal(energyDbfs(new Float32Array(8)), -Infinity);
  assert.equal(energyDbfs(new Float32Array(0)), -Infinity);
});

test('finestra: 8 kHz, inizio reale, energia, byte letti e disposizione delle tracce', async () => {
  const file = await read('ac3');
  assert.deepEqual(file.audio.map((t) => [t.channelLayout, t.streamIndex]), [['5.1(side)', 1]]);
  const reading = await readAudioWindow(file, [signal(file, 0, 'center')], { startMs: 5000, durationMs: 1500 });
  assert.equal(reading.seekMs, 5000 - PREROLL_MS);
  const w = reading.windows[0]!;
  assert.equal(w.startMs, 5000);
  assert.equal(w.samples.length, 1.5 * ANALYSIS_RATE);
  assert.equal(w.expectedSamples, 1.5 * ANALYSIS_RATE);
  assert.ok(w.energyDbfs > -40 && w.energyDbfs < 0, String(w.energyDbfs));
  // Si legge il pre-roll più la finestra, video compreso: più dell'audio da solo.
  assert.ok(reading.bytesRead !== null && reading.bytesRead > 3.5 * (file.audio[0]!.statistics!.bps! / 8), String(reading.bytesRead));

  // Vicino all'inizio il pre-roll non va sotto lo zero.
  const first = await readAudioWindow(file, [signal(file, 0, 'center')], { startMs: 500, durationMs: 1000 });
  assert.equal(first.seekMs, 0);
  assert.equal(first.windows[0]!.startMs, 500);
});

test('finestre 0–100 ms dopo i fotogrammi chiave: errore sotto il millisecondo su AC3, E-AC3, FLAC, TrueHD e DTS', async () => {
  const truth = await window('flac', 0, SECONDS * 1000);
  assert.equal(truth.startMs, 0);
  // Fotogrammi chiave a 3,003, 6,006 e 9,009 s; finestre da 1 s subito dopo.
  const starts = [3003, 6006, 9009].flatMap((k) => [0, 33, 67, 100].map((d) => k + d));
  const errors: Record<Codec, number[]> = { ac3: [], eac3: [], flac: [], truehd: [], dts: [] };
  await Promise.all(CODECS.flatMap((codec) => starts.map(async (startMs) => {
    const w = await window(codec, startMs, 1000);
    assert.equal(w.startMs, startMs, `${codec} ${startMs}`);
    const { ms, ncc } = offsetFromTruth(w, truth);
    assert.ok(ncc > 0.9, `${codec} at ${startMs} ms: ncc ${ncc}`);
    errors[codec].push(ms);
  })));
  for (const codec of CODECS) {
    // Il ritardo costante del codec è a parte (§4.9): conta la dispersione.
    const spread = Math.max(...errors[codec]) - Math.min(...errors[codec]);
    assert.ok(spread <= 1, `${codec}: errors ${errors[codec].map((e) => e.toFixed(3)).join(' ')}`);
  }
  assert.ok(errors.flac.every((e) => Math.abs(e) < 0.01), errors.flac.join(' '));
});

test('spostamenti noti con --sync, positivi e negativi, letti dai timestamp dei file prodotti', async () => {
  await Promise.all(CODECS.flatMap((codec) => (['plus', 'minus'] as const).map(async (suffix) => {
    const shifted = await read(`${codec}-${suffix}`);
    const shift = realShift(p(`${codec}.mkv`), p(`${codec}-${suffix}.mkv`));
    assert.ok(Math.abs(Math.abs(shift) - (suffix === 'plus' ? 1537 : 263)) < 1, `${codec} ${suffix}: ${shift}`);
    if (suffix === 'plus') assert.ok(shifted.startTimeMs! >= 1537, 'start_time is not zero');

    for (const startMs of [4004, 7040, 10_010]) {
      const a = await window(codec, startMs, 1000);
      const b = await window(`${codec}-${suffix}`, startMs + shift - 150, 1300);
      // Dove cade in b il contenuto di a, sulla linea del tempo di b.
      const m = locate(a.samples, b.samples, 150 * MS, 30 * MS);
      const measured = b.startMs + m.index / MS - a.startMs;
      assert.ok(m.ncc > 0.9, `${codec} ${suffix} at ${startMs}: ncc ${m.ncc}`);
      assert.ok(Math.abs(measured - shift) < 1, `${codec} ${suffix} at ${startMs}: measured ${measured}, expected ${shift}`);
    }
  })));
});

test('una traccia che non parte da zero: la finestra comincia al suo primo campione', async () => {
  const file = await read('late-audio');
  assert.equal(file.audio[0]!.startMs, 700);
  assert.equal(file.video.trackId, 0);
  assert.equal(file.startTimeMs, 0);
  const w = await window('late-audio', 200, 2000);
  // L'AC3 scritto da ffmpeg dichiara un ritardo del codec di 5,33 ms, che
  // ffmpeg sottrae arrotondato al ms (§4.3): il primo campione è a 695 ms, e
  // nell'originale a −5 ms.
  const truth = await window('ac3', -10, 3000);
  assert.equal(truth.startMs, -5);
  assert.equal(w.startMs, 695);
  assert.equal(w.expectedSamples, 1500 * MS);
  assert.equal(w.samples.length, (2200 - w.startMs) * MS);
  // Il contenuto è la sorgente spostata di 700 ms, sulla stessa linea del tempo dell'originale.
  const { ms } = offsetFromTruth(w, truth, 700);
  assert.ok(Math.abs(ms - 700) < 1, String(ms));

  // Una finestra tutta prima della traccia è una richiesta sbagliata.
  await assert.rejects(window('late-audio', 0, 500), code('INTERNAL'));
});

test('start_time oltre il pre-roll: la finestra comincia comunque all\'istante richiesto', async () => {
  const file = await read('late-file');
  assert.equal(file.startTimeMs, 6500);
  const truth = await window('flac', 0, SECONDS * 1000);
  for (const startMs of [9000, 12_345]) {
    const w = await window('late-file', startMs, 1000);
    assert.equal(w.startMs, startMs);
    assert.equal(w.samples.length, ANALYSIS_RATE);
    const { ms, ncc } = offsetFromTruth(w, truth, 6500);
    assert.ok(ncc > 0.99 && Math.abs(ms - 6500) < 0.01, `${startMs}: ${ms} ms, ncc ${ncc}`);
  }
});

test('canale centrale contro L+R, anche dalla stessa traccia e da più tracce nella stessa lettura', async () => {
  const truthCenter = await window('flac', 0, SECONDS * 1000, 'center');
  const truthLeftRight = await window('flac', 0, SECONDS * 1000, 'leftRight');

  const file = await read('two-tracks');
  assert.deepEqual(file.audio.map((t) => t.channelLayout), ['5.1(side)', 'stereo']);
  const signals = [signal(file, 0, 'center'), signal(file, 0, 'leftRight'), signal(file, 1, 'leftRight')];
  const reading = await readAudioWindow(file, signals, { startMs: 6000, durationMs: 1000 });
  const [center, leftRight, stereo] = reading.windows;
  assert.deepEqual(reading.windows.map((w) => [w.trackId, w.mix, w.startMs]), [[1, 'center', 6000], [1, 'leftRight', 6000], [2, 'leftRight', 6000]]);

  // Ogni segnale corrisponde alla sua verità, e non all'altra.
  assert.ok(offsetFromTruth(center!, truthCenter).ncc > 0.95);
  assert.ok(offsetFromTruth(leftRight!, truthLeftRight).ncc > 0.95);
  assert.ok(offsetFromTruth(stereo!, truthLeftRight).ncc > 0.99);
  assert.ok(offsetFromTruth(center!, truthLeftRight).ncc < 0.3);
  assert.ok(offsetFromTruth(stereo!, truthCenter).ncc < 0.3);
  // Il centrale di un 5.1 non c'è in una traccia stereo.
  await assert.rejects(readAudioWindow(file, [signal(file, 1, 'center')], { startMs: 0, durationMs: 1000 }), code('INTERNAL'));
});

test('INPUT_UNREADABLE: finestra oltre la fine di un file troncato, o a cavallo del troncamento', async () => {
  const file = await read('truncated');
  assert.equal(file.truncated, true);
  // L'intestazione dichiara ancora 12 s; i tag statistici, scritti in fondo, sono persi.
  assert.ok(file.durationMs! >= SECONDS * 1000 - 50, String(file.durationMs));
  assert.equal(file.audio[0]!.statistics, null);
  await assert.rejects(window('truncated', 9000, 1000), code('INPUT_UNREADABLE'));
  await assert.rejects(window('truncated', 9000, 1000), /decoded 0 samples of 8000 expected/);
  const lastMs = file.integrity.lastTimestampMs!;
  await assert.rejects(window('truncated', lastMs - 500, 2000), code('INPUT_UNREADABLE'));
  // Prima del troncamento si legge normalmente.
  assert.equal((await window('truncated', 1000, 1000)).samples.length, ANALYSIS_RATE);
});

test('INPUT_BUSY: il file è cambiato da quando è stato letto', async () => {
  const file = await readInput(p('eac3.mkv'), { calibration: cal });
  const later = new Date(Date.now() - 60_000);
  utimesSync(p('eac3.mkv'), later, later);
  try {
    await assert.rejects(readAudioWindow(file, [signal(file, 0, 'center')], { startMs: 1000, durationMs: 1000 }), code('INPUT_BUSY'));
  } finally {
    settle(p('eac3.mkv'));
    delete inputs.eac3;
  }
});
