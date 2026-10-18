// Correlazione (studio §4.2, §4.4): dove cade un pezzo di segnale dentro un
// altro, e con quale confidenza. Ricerca grossolana con la correlazione
// sbiancata (GCC-PHAT), rifinitura con la correlazione normalizzata (NCC) e
// interpolazione parabolica; unicità del picco fuori da una zona di
// esclusione. Funzioni pure sui campioni: la FFT è scritta qui, senza
// dipendenze a runtime.

/** La potenza di 2 più piccola che non è sotto `n`. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

interface Twiddles {
  cos: Float64Array;
  sin: Float64Array;
}

const TWIDDLES = new Map<number, Twiddles>();

function twiddles(n: number): Twiddles {
  let t = TWIDDLES.get(n);
  if (!t) {
    const half = n >> 1;
    t = { cos: new Float64Array(half), sin: new Float64Array(half) };
    for (let k = 0; k < half; k++) {
      t.cos[k] = Math.cos((2 * Math.PI * k) / n);
      t.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    TWIDDLES.set(n, t);
  }
  return t;
}

/**
 * FFT complessa in place, radice 2, iterativa. `re` e `im` hanno la stessa
 * lunghezza, una potenza di 2. L'inversa non divide per n.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (im.length !== n || (n & (n - 1)) !== 0) throw new RangeError(`fft: length ${n} is not a power of 2`);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i]!;
      re[i] = re[j]!;
      re[j] = r;
      const m = im[i]!;
      im[i] = im[j]!;
      im[j] = m;
    }
  }
  const { cos, sin } = twiddles(n);
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!;
        const wi = sign * sin[k * step]!;
        const a = start + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/**
 * Correlazione normalizzata di `needle` con `haystack` a partire dall'indice
 * `lag`: tra −1 e 1, 0 se uno dei due tratti è tutto a zero.
 */
export function ncc(needle: Float32Array, haystack: Float32Array, lag: number): number {
  let s = 0;
  let e1 = 0;
  let e2 = 0;
  for (let i = 0; i < needle.length; i++) {
    const x = needle[i]!;
    const y = haystack[lag + i]!;
    s += x * y;
    e1 += x * x;
    e2 += y * y;
  }
  return e1 > 0 && e2 > 0 ? s / Math.sqrt(e1 * e2) : 0;
}

export interface PeakSearchOptions {
  /** Frequenza di campionamento, in Hz. */
  rate: number;
  /** Banda della correlazione sbiancata, in Hz: fuori dalla banda i pesi sono zero. */
  bandHz: readonly [number, number];
  /** Zona di esclusione intorno al picco per l'unicità, in campioni. */
  exclusion: number;
  /** Raggio della rifinitura NCC intorno al picco grossolano, in campioni. */
  refineRadius: number;
}

export interface Peak {
  /** Indice in `haystack` del primo campione di `needle`, con il decimale. */
  lag: number;
  /**
   * Somiglianza: NCC al ritardo rifinito, con il `haystack` interpolato tra un
   * campione e l'altro (sinc a finestra). Non dipende da dove cade il picco
   * rispetto ai campioni.
   */
  ncc: number;
  /**
   * Unicità: NCC del picco diviso l'NCC più alto fuori dalla zona di
   * esclusione, tutti e due con la parabola sui tre campioni intorno al
   * massimo. 1 se fuori dalla zona non c'è niente da confrontare, 0 se la
   * somiglianza è nulla.
   */
  ratio: number;
}

/** Tetto del rapporto, per tenere il report in numeri finiti. */
export const RATIO_CAP = 1000;

/** Prese del sinc per lato nell'interpolazione del ritardo frazionario. */
const SINC_TAPS = 16;

/**
 * Sotto questa energia relativa al pezzo un tratto del `haystack` è silenzio:
 * la sua NCC vale 0 invece del rumore numerico della FFT diviso quasi zero.
 */
const SILENT_RELATIVE_ENERGY = 1e-6;

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Vertice della parabola per tre valori equidistanti: spostamento dal centro e valore. */
function parabola(a: number | undefined, b: number, c: number | undefined): { delta: number; value: number } {
  if (a === undefined || c === undefined) return { delta: 0, value: b };
  const den = a - 2 * b + c;
  if (!(den < 0)) return { delta: 0, value: b };
  const delta = (0.5 * (a - c)) / den;
  return { delta, value: b - 0.25 * (a - c) * delta };
}

/** NCC con il `haystack` letto a un ritardo con il decimale (sinc a finestra di Hann). */
export function fractionalNcc(needle: Float32Array, haystack: Float32Array, lag: number): number {
  const base = Math.floor(lag);
  const frac = lag - base;
  if (frac < 1e-9) return ncc(needle, haystack, base);
  const weights = new Float64Array(2 * SINC_TAPS);
  for (let t = 0; t < weights.length; t++) {
    const d = frac - (t - SINC_TAPS + 1);
    weights[t] = (Math.sin(Math.PI * d) / (Math.PI * d)) * (0.5 + 0.5 * Math.cos((Math.PI * d) / (SINC_TAPS + 1)));
  }
  let s = 0;
  let e1 = 0;
  let e2 = 0;
  for (let i = 0; i < needle.length; i++) {
    const at = base + i - SINC_TAPS + 1;
    let y = 0;
    for (let t = 0; t < weights.length; t++) {
      const j = at + t;
      if (j >= 0 && j < haystack.length) y += weights[t]! * haystack[j]!;
    }
    const x = needle[i]!;
    s += x * y;
    e1 += x * x;
    e2 += y * y;
  }
  return e1 > 0 && e2 > 0 ? s / Math.sqrt(e1 * e2) : 0;
}

/**
 * Cerca ogni `needle` dentro `haystack`, su tutti gli spostamenti in cui ci
 * sta per intero.
 *
 * - **Posizione grossolana:** il massimo della correlazione sbiancata
 *   (GCC-PHAT), più robusta con la musica.
 * - **Rifinitura:** NCC ai campioni intorno, parabola sul massimo.
 * - **Unicità:** sull'NCC di tutti gli spostamenti, non sulla correlazione
 *   sbiancata: un contenuto che si ripete esattamente ha uno spettro a righe,
 *   e sbiancarlo darebbe un picco "unico" che non lo è.
 *
 * Le due correlazioni si calcolano a blocchi (overlap-save), insieme in una
 * sola trasformata inversa, così la memoria non cresce con l'intervallo di
 * ricerca; ogni blocco del `haystack` si trasforma una volta sola per tutti i
 * pezzi. Un pezzo vuoto o più lungo del `haystack` dà `null`.
 */
export function findPeaks(
  needles: readonly Float32Array[],
  haystack: Float32Array,
  options: PeakSearchOptions,
): (Peak | null)[] {
  const H = haystack.length;
  const usable = needles.map((n) => n.length > 0 && n.length <= H);
  const lengths = needles.filter((_, i) => usable[i]).map((n) => n.length);
  if (lengths.length === 0) return needles.map(() => null);

  const longest = Math.max(...lengths);
  const maxLags = H - Math.min(...lengths) + 1;
  // Blocchi lunghi circa tre pezzi: un terzo di spreco, poche trasformate.
  const M = nextPow2(longest + Math.min(H - longest + 1, 2 * longest) - 1);
  const step = M - longest + 1;

  // Banda: i pesi fuori dalla banda (sopra il passa-basso, e la continua) sono
  // zero, così il rumore di quei bin non entra nella correlazione sbiancata.
  const band = new Uint8Array(M);
  for (let k = 0; k < M; k++) {
    const f = (Math.min(k, M - k) * options.rate) / M;
    band[k] = f >= options.bandHz[0] && f <= options.bandHz[1] ? 1 : 0;
  }

  // Energia del haystack su ogni tratto, dalle somme cumulative dei quadrati.
  const energy = new Float64Array(H + 1);
  for (let j = 0; j < H; j++) energy[j + 1] = energy[j]! + haystack[j]! * haystack[j]!;

  const spectra = needles.map((n, i) => {
    if (!usable[i]) return null;
    const re = new Float64Array(M);
    const im = new Float64Array(M);
    let e = 0;
    for (let j = 0; j < n.length; j++) {
      re[j] = n[j]!;
      e += n[j]! * n[j]!;
    }
    fft(re, im);
    return { re, im, energy: e };
  });
  const lagsOf = (i: number) => H - needles[i]!.length + 1;
  const phat = needles.map((_, i) => (usable[i] ? new Float32Array(lagsOf(i)) : null));
  const curve = needles.map((_, i) => (usable[i] ? new Float32Array(lagsOf(i)) : null));

  const blockRe = new Float64Array(M);
  const blockIm = new Float64Array(M);
  const outRe = new Float64Array(M);
  const outIm = new Float64Array(M);
  for (let b = 0; b < maxLags; b += step) {
    blockRe.fill(0);
    blockIm.fill(0);
    const end = Math.min(H, b + M);
    for (let j = b; j < end; j++) blockRe[j - b] = haystack[j]!;
    fft(blockRe, blockIm);

    spectra.forEach((s, i) => {
      const p = phat[i];
      const c = curve[i];
      if (!s || !p || !c || b >= p.length) return;
      // Spettro incrociato coniugato(pezzo) × blocco: la correlazione semplice.
      // Quella sbiancata ne tiene solo la fase, nella banda. Entrambe sono
      // reali: si trasformano insieme come parte reale e immaginaria.
      let sum = 0;
      let count = 0;
      for (let k = 0; k < M; k++) {
        if (band[k]) {
          sum += Math.hypot(
            s.re[k]! * blockRe[k]! + s.im[k]! * blockIm[k]!,
            s.re[k]! * blockIm[k]! - s.im[k]! * blockRe[k]!,
          );
          count++;
        }
      }
      const eps = (count > 0 ? (sum / count) * 1e-3 : 0) + Number.MIN_VALUE;
      for (let k = 0; k < M; k++) {
        const cr = s.re[k]! * blockRe[k]! + s.im[k]! * blockIm[k]!;
        const ci = s.re[k]! * blockIm[k]! - s.im[k]! * blockRe[k]!;
        const w = band[k] ? 1 / (Math.hypot(cr, ci) + eps) : 0;
        outRe[k] = cr - ci * w;
        outIm[k] = ci + cr * w;
      }
      fft(outRe, outIm, true);
      const last = Math.min(p.length, b + step);
      const n = needles[i]!.length;
      const floor = s.energy * SILENT_RELATIVE_ENERGY;
      for (let lag = b; lag < last; lag++) {
        p[lag] = outIm[lag - b]! / M;
        const e2 = energy[lag + n]! - energy[lag]!;
        c[lag] = s.energy > 0 && e2 > floor ? outRe[lag - b]! / M / Math.sqrt(s.energy * e2) : 0;
      }
    });
  }

  return needles.map((needle, i) => {
    const p = phat[i];
    const c = curve[i];
    if (!p || !c) return null;
    let top = 0;
    for (let k = 1; k < p.length; k++) if (p[k]! > p[top]!) top = k;

    // Rifinitura: NCC esatta ai campioni intorno al picco grossolano.
    const from = Math.max(0, top - options.refineRadius);
    const to = Math.min(p.length - 1, top + options.refineRadius);
    const scores = new Float64Array(to - from + 1);
    let best = 0;
    for (let k = from; k <= to; k++) {
      scores[k - from] = ncc(needle, haystack, k);
      if (scores[k - from]! > scores[best]!) best = k - from;
    }
    const peak = parabola(scores[best - 1], scores[best]!, scores[best + 1]);
    const lag = from + best + peak.delta;
    const similarity = fractionalNcc(needle, haystack, lag);

    // Unicità: il massimo dell'NCC fuori dalla zona di esclusione.
    const center = from + best;
    let other = -1;
    for (let k = 0; k < c.length; k++) {
      if (Math.abs(k - center) > options.exclusion && (other === -1 || c[k]! > c[other]!)) other = k;
    }
    let ratio: number;
    if (!(peak.value > 0)) ratio = 0;
    else if (other === -1) ratio = 1;
    else {
      const rival = parabola(c[other - 1], c[other]!, c[other + 1]).value;
      ratio = rival > 0 ? Math.min(RATIO_CAP, peak.value / rival) : RATIO_CAP;
    }
    return { lag, ncc: round4(Math.max(-1, Math.min(1, similarity))), ratio: round4(ratio) };
  });
}

/**
 * Stira un segnale nel tempo di un fattore `factor` (interpolazione cubica di
 * Catmull-Rom): il campione j dell'uscita vale il segnale all'istante j/factor.
 * Serve solo alla diagnosi di velocità (§4.4, punto 5): nulla di quello che
 * produce finisce in un file.
 */
export function stretch(x: Float32Array, factor: number): Float32Array {
  if (x.length === 0) return new Float32Array(0);
  const n = Math.floor((x.length - 1) * factor) + 1;
  const out = new Float32Array(n);
  const at = (i: number) => x[Math.max(0, Math.min(x.length - 1, i))]!;
  for (let j = 0; j < n; j++) {
    const t = j / factor;
    const i = Math.floor(t);
    const f = t - i;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    out[j] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}
