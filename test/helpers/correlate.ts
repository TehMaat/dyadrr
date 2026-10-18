// Correlazione normalizzata per i test della lettura delle finestre: trova dove
// cade un pezzo di segnale dentro un altro, al campione con il decimale.

export interface Match {
  /** Indice in `haystack` del primo campione di `needle`, con interpolazione parabolica. */
  index: number;
  ncc: number;
}

/**
 * Cerca `needle` in `haystack` intorno a `around` (± `maxLag` campioni). Usa al
 * massimo i primi `length` campioni di `needle`.
 */
export function locate(
  needle: Float32Array,
  haystack: Float32Array,
  around: number,
  maxLag: number,
  length = 4000,
): Match {
  const n = Math.min(needle.length, length);
  let e1 = 0;
  for (let i = 0; i < n; i++) e1 += needle[i]! ** 2;
  const scores = new Map<number, number>();
  let best = -Infinity;
  let bestAt = 0;
  const center = Math.round(around);
  for (let at = center - maxLag; at <= center + maxLag; at++) {
    if (at < 0 || at + n > haystack.length) continue;
    let s = 0;
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      const h = haystack[at + i]!;
      s += needle[i]! * h;
      e2 += h * h;
    }
    const c = s / Math.sqrt(e1 * e2);
    scores.set(at, c);
    if (c > best) {
      best = c;
      bestAt = at;
    }
  }
  const a = scores.get(bestAt - 1);
  const c = scores.get(bestAt + 1);
  const frac = a !== undefined && c !== undefined && a - 2 * best + c !== 0 ? (0.5 * (a - c)) / (a - 2 * best + c) : 0;
  return { index: bestAt + frac, ncc: best };
}
