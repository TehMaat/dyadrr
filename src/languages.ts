import { DyadrrError } from './codes.js';

// Lingue delle tracce (studio §3.1, §3.3). Ogni lingua si riduce a un codice
// canonico ISO 639-2/B, la forma che mkvmerge scrive nel campo classico, così
// `fre`, `fra`, `fr` e `fr-CA` risultano la stessa lingua.

// ISO 639-1 → ISO 639-2/B.
const FROM_639_1: Readonly<Record<string, string>> = {
  aa: 'aar', ab: 'abk', ae: 'ave', af: 'afr', ak: 'aka', am: 'amh', an: 'arg',
  ar: 'ara', as: 'asm', av: 'ava', ay: 'aym', az: 'aze', ba: 'bak', be: 'bel',
  bg: 'bul', bi: 'bis', bm: 'bam', bn: 'ben', bo: 'tib', br: 'bre', bs: 'bos',
  ca: 'cat', ce: 'che', ch: 'cha', co: 'cos', cr: 'cre', cs: 'cze', cu: 'chu',
  cv: 'chv', cy: 'wel', da: 'dan', de: 'ger', dv: 'div', dz: 'dzo', ee: 'ewe',
  el: 'gre', en: 'eng', eo: 'epo', es: 'spa', et: 'est', eu: 'baq', fa: 'per',
  ff: 'ful', fi: 'fin', fj: 'fij', fo: 'fao', fr: 'fre', fy: 'fry', ga: 'gle',
  gd: 'gla', gl: 'glg', gn: 'grn', gu: 'guj', gv: 'glv', ha: 'hau', he: 'heb',
  hi: 'hin', ho: 'hmo', hr: 'hrv', ht: 'hat', hu: 'hun', hy: 'arm', hz: 'her',
  ia: 'ina', id: 'ind', ie: 'ile', ig: 'ibo', ii: 'iii', ik: 'ipk', io: 'ido',
  is: 'ice', it: 'ita', iu: 'iku', ja: 'jpn', jv: 'jav', ka: 'geo', kg: 'kon',
  ki: 'kik', kj: 'kua', kk: 'kaz', kl: 'kal', km: 'khm', kn: 'kan', ko: 'kor',
  kr: 'kau', ks: 'kas', ku: 'kur', kv: 'kom', kw: 'cor', ky: 'kir', la: 'lat',
  lb: 'ltz', lg: 'lug', li: 'lim', ln: 'lin', lo: 'lao', lt: 'lit', lu: 'lub',
  lv: 'lav', mg: 'mlg', mh: 'mah', mi: 'mao', mk: 'mac', ml: 'mal', mn: 'mon',
  mr: 'mar', ms: 'may', mt: 'mlt', my: 'bur', na: 'nau', nb: 'nob', nd: 'nde',
  ne: 'nep', ng: 'ndo', nl: 'dut', nn: 'nno', no: 'nor', nr: 'nbl', nv: 'nav',
  ny: 'nya', oc: 'oci', oj: 'oji', om: 'orm', or: 'ori', os: 'oss', pa: 'pan',
  pi: 'pli', pl: 'pol', ps: 'pus', pt: 'por', qu: 'que', rm: 'roh', rn: 'run',
  ro: 'rum', ru: 'rus', rw: 'kin', sa: 'san', sc: 'srd', sd: 'snd', se: 'sme',
  sg: 'sag', si: 'sin', sk: 'slo', sl: 'slv', sm: 'smo', sn: 'sna', so: 'som',
  sq: 'alb', sr: 'srp', ss: 'ssw', st: 'sot', su: 'sun', sv: 'swe', sw: 'swa',
  ta: 'tam', te: 'tel', tg: 'tgk', th: 'tha', ti: 'tir', tk: 'tuk', tl: 'tgl',
  tn: 'tsn', to: 'ton', tr: 'tur', ts: 'tso', tt: 'tat', tw: 'twi', ty: 'tah',
  ug: 'uig', uk: 'ukr', ur: 'urd', uz: 'uzb', ve: 'ven', vi: 'vie', vo: 'vol',
  wa: 'wln', wo: 'wol', xh: 'xho', yi: 'yid', yo: 'yor', za: 'zha', zh: 'chi',
  zu: 'zul',
};

// ISO 639-2/T → ISO 639-2/B, per le sole lingue in cui le due forme differiscono.
const FROM_639_2T: Readonly<Record<string, string>> = {
  bod: 'tib', ces: 'cze', cym: 'wel', deu: 'ger', ell: 'gre', eus: 'baq',
  fas: 'per', fra: 'fre', hye: 'arm', isl: 'ice', kat: 'geo', mkd: 'mac',
  mri: 'mao', msa: 'may', mya: 'bur', nld: 'dut', ron: 'rum', slk: 'slo',
  sqi: 'alb', zho: 'chi',
};

// Codici che non indicano una lingua: una traccia così non conta mai, né come
// italiana né come lingua di misura (§3.1).
const NOT_A_LANGUAGE: ReadonlySet<string> = new Set(['und', 'zxx', 'mis', 'mul']);

export const ITALIAN = 'ita';
export const ENGLISH = 'eng';

/**
 * Riduce un codice ISO 639-1, ISO 639-2 (B o T) o un tag IETF al codice
 * canonico. Restituisce `null` se il codice non indica una lingua o non è
 * riconoscibile.
 */
export function canonicalLanguage(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  // Di un tag IETF (`it-IT`, `pt-BR`, `es-419`) conta solo la lingua primaria.
  const primary = code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  let canonical: string | undefined;
  if (/^[a-z]{2}$/.test(primary)) canonical = FROM_639_1[primary];
  else if (/^[a-z]{3}$/.test(primary)) canonical = FROM_639_2T[primary] ?? primary;
  if (canonical === undefined || NOT_A_LANGUAGE.has(canonical)) return null;
  return canonical;
}

/** I due campi lingua di una traccia Matroska, come li riporta mkvmerge -J. */
export interface TrackLanguageFields {
  language?: string | null;
  languageIetf?: string | null;
}

/**
 * Lingua di una traccia. Se il campo IETF indica una lingua vale quello, come
 * prevede Matroska; altrimenti il campo classico.
 */
export function trackLanguage(track: TrackLanguageFields): string | null {
  const ietf = canonicalLanguage(track.languageIetf);
  if (ietf !== null) return ietf;
  return canonicalLanguage(track.language);
}

export function isItalian(track: TrackLanguageFields): boolean {
  return trackLanguage(track) === ITALIAN;
}

/**
 * Legge il valore di `--original-language`. Accetta codici ISO 639-1 e 639-2,
 * in maiuscolo o minuscolo, e tag IETF. Un valore non riconoscibile è
 * `BAD_ARGUMENTS`.
 */
export function parseOriginalLanguage(value: string): string {
  const canonical = canonicalLanguage(value);
  if (canonical === null) {
    throw new DyadrrError(
      'BAD_ARGUMENTS',
      `--original-language: "${value}" is not a language code (expected e.g. eng, jpn, fr)`,
    );
  }
  return canonical;
}

export type MeasureLanguageReason = 'original' | 'english' | 'other';

export interface MeasureLanguageChoice {
  language: string;
  reason: MeasureLanguageReason;
  /** Vero se la lingua originale era indicata ma non è in entrambi i file. */
  originalNotCommon: boolean;
}

/**
 * Sceglie la lingua di misura (§3.3) tra le lingue non italiane presenti in
 * entrambi i file: prima la lingua originale indicata, poi l'inglese, poi la
 * prima altra lingua in comune nell'ordine del riferimento. `null` vuol dire
 * `NO_COMMON_LANGUAGE`.
 */
export function chooseMeasureLanguage(
  referenceLanguages: readonly string[],
  donorLanguages: readonly string[],
  originalLanguage: string | null,
): MeasureLanguageChoice | null {
  const donor = new Set(donorLanguages);
  const common = referenceLanguages.filter((l, i) =>
    l !== ITALIAN && donor.has(l) && referenceLanguages.indexOf(l) === i);

  const originalUsable = originalLanguage !== null && originalLanguage !== ITALIAN;
  const originalNotCommon = originalUsable && !common.includes(originalLanguage);

  if (originalUsable && !originalNotCommon) {
    return { language: originalLanguage, reason: 'original', originalNotCommon };
  }
  if (common.includes(ENGLISH)) {
    return { language: ENGLISH, reason: 'english', originalNotCommon };
  }
  const first = common[0];
  if (first === undefined) return null;
  return { language: first, reason: 'other', originalNotCommon };
}
