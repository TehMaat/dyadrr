import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATIO_CAP, fft, findPeaks, ncc, nextPow2, stretch, type PeakSearchOptions } from '../src/correlation.js';

// Correlazione su segnali sintetici, senza file (studio §4.2, §4.4).

const RATE = 8000;
const OPTIONS: PeakSearchOptions = { rate: RATE, bandHz: [20, 3000], exclusion: 25 * 8, refineRadius: 16 };

/** Generatore pseudocasuale ripetibile. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Un segnale a banda larga e limitata (sotto 3 kHz) definito in ogni istante:
 * rumore bianco a 8 kHz interpolato con un sinc a finestra. `at(t)` lo valuta
 * in t secondi, anche tra un campione e l'altro.
 */
function bandLimited(seed: number, seconds = 16): (t: number) => number {
  const r = random(seed);
  const white = Float64Array.from({ length: seconds * RATE }, () => r() - 0.5);
  const fc = 3000 / RATE;
  const K = 48;
  return (t) => {
    const u = t * RATE;
    const j0 = Math.floor(u);
    let sum = 0;
    for (let j = j0 - K; j <= j0 + K; j++) {
      if (j < 0 || j >= white.length) continue;
      const d = u - j;
      const sinc = d === 0 ? 1 : Math.sin(2 * Math.PI * fc * d) / (2 * Math.PI * fc * d);
      const window = 0.5 + 0.5 * Math.cos((Math.PI * d) / (K + 1));
      sum += white[j]! * 2 * fc * sinc * window;
    }
    return sum;
  };
}

/** Campioni a 8 kHz di `signal` da `fromS` secondi, per `seconds` secondi. */
function sample(signal: (t: number) => number, fromS: number, seconds: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => signal(fromS + i / RATE));
}

test('FFT: uguale alla DFT diretta, e l\'inversa torna al segnale', () => {
  for (const n of [1, 2, 8, 64]) {
    const r = random(n);
    const x = Array.from({ length: n }, () => [r() - 0.5, r() - 0.5] as const);
    const re = Float64Array.from(x.map((v) => v[0]));
    const im = Float64Array.from(x.map((v) => v[1]));
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      x.forEach(([a, b], j) => {
        const w = (-2 * Math.PI * j * k) / n;
        sr += a * Math.cos(w) - b * Math.sin(w);
        si += a * Math.sin(w) + b * Math.cos(w);
      });
      assert.ok(Math.abs(re[k]! - sr) < 1e-9 && Math.abs(im[k]! - si) < 1e-9, `n=${n} k=${k}`);
    }
    fft(re, im, true);
    x.forEach(([a, b], j) => assert.ok(Math.abs(re[j]! / n - a) < 1e-12 && Math.abs(im[j]! / n - b) < 1e-12));
  }
  assert.throws(() => fft(new Float64Array(6), new Float64Array(6)), RangeError);
  assert.equal(nextPow2(1), 1);
  assert.equal(nextPow2(1025), 2048);
});

test('ritardo noto con il decimale: picco al campione giusto, somiglianza e unicità alte', () => {
  const signal = bandLimited(7);
  // Il pezzo comincia a 2,15425 s dentro il pagliaio: 17234 campioni.
  const haystack = sample(signal, 0, 6);
  for (const shift of [17234, 17234.375, 17234.5, 17234.875]) {
    const needle = sample(signal, shift / RATE, 2);
    const [peak] = findPeaks([needle], haystack, OPTIONS);
    assert.ok(peak, 'peak');
    assert.ok(Math.abs(peak.lag - shift) < 0.1, `shift ${shift}: lag ${peak.lag}`);
    assert.ok(peak.ncc > 0.99, `ncc ${peak.ncc}`);
    assert.ok(peak.ratio > 5, `ratio ${peak.ratio}`);
  }

  // Più pezzi contro lo stesso pagliaio, anche di lunghezze diverse; uno più
  // lungo del pagliaio, o vuoto, non si può cercare.
  const peaks = findPeaks(
    [sample(signal, 1, 1), sample(signal, 3.5, 2.5), new Float32Array(0), sample(signal, 0, 7)],
    haystack,
    OPTIONS,
  );
  assert.ok(Math.abs(peaks[0]!.lag - 8000) < 0.1);
  assert.ok(Math.abs(peaks[1]!.lag - 28000) < 0.1);
  assert.deepEqual(peaks.slice(2), [null, null]);

  // Con rumore aggiunto e una diversa ampiezza la somiglianza scende ma il picco resta.
  const noise = random(3);
  const noisy = sample(signal, 1, 2).map((v) => 0.3 * v + 0.2 * (noise() - 0.5));
  const [p] = findPeaks([noisy], haystack, OPTIONS);
  assert.ok(Math.abs(p!.lag - 8000) < 0.5, String(p!.lag));
  assert.ok(p!.ncc > 0.6 && p!.ncc < 0.95, String(p!.ncc));
});

test('contenuto ripetitivo: somiglianza alta, unicità bassa', () => {
  const signal = bandLimited(11);
  // Un motivo di 0,5 s ripetuto: ogni ripetizione è un picco quasi uguale.
  const loop = (t: number) => signal(((t % 0.5) + 0.5) % 0.5);
  const haystack = sample(loop, 0, 8);
  const [peak] = findPeaks([sample(loop, 2.1, 2)], haystack, OPTIONS);
  assert.ok(peak!.ncc > 0.95, String(peak!.ncc));
  assert.ok(peak!.ratio < 1.1, String(peak!.ratio));
  assert.equal(Math.round(peak!.lag) % 4000, (2.1 * RATE) % 4000);
});

test('silenzio e segnali diversi: nessuna somiglianza', () => {
  const haystack = sample(bandLimited(5), 0, 4);
  const [silent] = findPeaks([new Float32Array(8000)], haystack, OPTIONS);
  assert.deepEqual(silent, { lag: silent!.lag, ncc: 0, ratio: 0 });
  const [other] = findPeaks([sample(bandLimited(6), 0, 1)], haystack, OPTIONS);
  assert.ok(Math.abs(other!.ncc) < 0.2, String(other!.ncc));
  assert.ok(other!.ratio < 2, String(other!.ratio));
  assert.ok(RATIO_CAP >= 10);
  assert.equal(ncc(new Float32Array(4), new Float32Array(4), 0), 0);
});

test('stiramento: il pezzo a velocità 1,001 si ritrova solo stirato', () => {
  const signal = bandLimited(9);
  const haystack = sample(signal, 0, 12);
  // Nel riferimento il film va più veloce dell'1 per mille: 10 s del pagliaio
  // durano 10/1,001 s.
  const needle = sample((t) => signal(2 + t * 1.001), 0, 10 / 1.001);
  const [plain] = findPeaks([needle], haystack, OPTIONS);
  const [stretched] = findPeaks([stretch(needle, 1.001)], haystack, OPTIONS);
  assert.ok(stretched!.ncc > 0.95, String(stretched!.ncc));
  assert.ok(Math.abs(stretched!.lag - 2 * RATE) < 1, String(stretched!.lag));
  assert.ok(plain!.ncc < stretched!.ncc - 0.3, `${plain!.ncc} vs ${stretched!.ncc}`);

  const x = Float32Array.from([0, 1, 2, 3, 4]);
  // Su un segnale lineare la cubica è esatta, lontano dai bordi.
  assert.deepEqual([...stretch(x, 2)].slice(2, 7), [1, 1.5, 2, 2.5, 3]);
  assert.equal(stretch(x, 2).length, 9);
  assert.equal(stretch(new Float32Array(0), 2).length, 0);
});
