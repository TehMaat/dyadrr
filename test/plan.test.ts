import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCalibration, parseCalibration } from '../src/calibration.js';
import { assertNoPendingChoices, type GivenChoices } from '../src/choices.js';
import { DyadrrError } from '../src/codes.js';
import type { HdrFormat } from '../src/decision.js';
import type { InputTrack } from '../src/inputs.js';
import {
  classifySubtitles,
  planMerge,
  startCuts,
  type CutLevel,
  type Plan,
  type PlanFile,
  type PlanInput,
} from '../src/plan.js';

// Piano di inizio e fine su ingressi sintetici (studio §5, §7, §8, §10.1):
// nessun file, solo tracce con i loro timestamp. Il riferimento è un film di
// 2 ore che comincia a 0; le tracce del donatore si danno sulla sua linea del
// tempo, e lo spostamento S le porta su quella del riferimento.

const cal = loadCalibration();
const FILM = 7_200_000;

type Kind = InputTrack['type'];
const CODECS: Record<Kind, [string, string]> = {
  video: ['AVC/H.264/MPEG-4p10', 'V_MPEG4/ISO/AVC'],
  audio: ['AC-3', 'A_AC3'],
  subtitles: ['HDMV PGS', 'S_HDMV/PGS'],
};

const track = (id: number, type: Kind, fields: Partial<InputTrack> = {}): InputTrack => ({
  id,
  type,
  codec: CODECS[type][0],
  codecId: CODECS[type][1],
  profile: null,
  language: 'eng',
  languageIetf: null,
  channels: type === 'audio' ? 6 : null,
  channelLayout: type === 'audio' ? '5.1(side)' : null,
  streamIndex: id,
  name: null,
  default: false,
  forced: false,
  commentary: false,
  visualImpaired: false,
  compression: null,
  startMs: 0,
  endMs: type === 'subtitles' ? null : FILM,
  statistics: null,
  ...fields,
});

/** Una traccia audio italiana dal suo inizio alla sua fine, nel donatore. */
const italian = (id: number, startMs: number, endMs: number, fields: Partial<InputTrack> = {}) =>
  track(id, 'audio', { language: 'ita', startMs, endMs, ...fields });

/** Una traccia PGS con il numero di blocchi dei tag statistici. */
const pgs = (id: number, language: string, blocks: number | null, fields: Partial<InputTrack> = {}) =>
  track(id, 'subtitles', {
    language,
    statistics: blocks === null ? null : { frames: blocks, bps: null, durationMs: null, bytes: null },
    ...fields,
  });

const file = (tracks: InputTrack[], hdr: HdrFormat, durationMs: number): PlanFile => ({
  tracks,
  startTimeMs: 0,
  durationMs,
  video: {
    trackId: 0,
    width: hdr === 'SDR' ? 1920 : 3840,
    height: hdr === 'SDR' ? 1080 : 2160,
    hdr,
    dvProfile: null,
    codec: 'V_MPEGH/ISO/HEVC',
    bitrate: null,
    fps: 24000 / 1001,
    durationMs,
  },
});

const reference = (extra: InputTrack[] = [], hdr: HdrFormat = 'SDR') =>
  file([track(0, 'video'), track(1, 'audio'), ...extra], hdr, FILM);
const donor = (tracks: InputTrack[], hdr: HdrFormat = 'SDR') =>
  file([track(0, 'video', { endMs: FILM }), ...tracks, track(9, 'audio')], hdr, FILM);

/** Livelli in un punto di taglio, per le tracce date. */
const levels = (atMs: number, levelDbfs: number, ids: readonly number[] = [2]): CutLevel[] =>
  ids.map((trackId) => ({ atMs, trackId, levelDbfs }));

const choices = (values: Record<string, string>): GivenChoices =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, origin: 'option' }])) as GivenChoices;

const input = (fields: Partial<PlanInput> & Pick<PlanInput, 'donor' | 'offsetMs'>): PlanInput => ({
  reference: reference(),
  commonMaterial: { startMs: Math.max(0, fields.offsetMs), endMs: FILM },
  choices: {},
  ...fields,
});

const warnings = (p: Plan) => p.warnings.map((w) => w.code);
const choice = (p: Plan, name: string) => p.choices.find((c) => c.name === name)!;
const effect = (p: Plan, name: string, value: string) => choice(p, name).effects.find((e) => e.value === value)!;
const isInternal = (e: unknown) => e instanceof DyadrrError && e.code === 'INTERNAL';

test('casi di inizio e fine: il riferimento ha più intro, il donatore ha più intro, una coda in più', () => {
  // S > 0: l'italiano parte a S, i primi S ms sono senza italiano.
  const later = planMerge(input({ donor: donor([italian(2, 0, FILM - 1234)]), offsetMs: 1234 }), cal);
  assert.deepEqual(later.start, {
    case: 'reference-longer', amountMs: 1234, mismatchMs: 0, cutMs: null, gapMs: 1234, cutLevelDbfs: null,
  });
  assert.deepEqual(later.end, {
    case: 'aligned', amountMs: 0, mismatchMs: 0, cutMs: null, gapMs: 0, excess: 'none', excessMs: 0,
  });
  assert.deepEqual(later.italian, { startMs: 1234, endMs: FILM });
  assert.deepEqual(later.pending, []);
  assert.ok(later.choices.every((c) => !c.needed && c.effects.length === 0));
  assert.deepEqual(warnings(later), []);
  assert.deepEqual(later.audio.map((a) => [a.id, a.role, a.taken, a.startMs, a.endMs]), [[2, 'main', true, 1234, FILM]]);

  // S < 0: si scarta l'italiano prima dell'inizio del film; sotto la soglia nessun avviso.
  const earlier = planMerge(input({
    donor: donor([italian(2, 0, FILM + 1234)]),
    offsetMs: -1234,
    cutLevels: levels(0, -62.5),
  }), cal);
  assert.deepEqual(earlier.start, {
    case: 'donor-longer', amountMs: 1234, mismatchMs: 0, cutMs: 0, gapMs: 0, cutLevelDbfs: -62.5,
  });
  assert.deepEqual(earlier.italian, { startMs: 0, endMs: FILM });
  assert.deepEqual(warnings(earlier), []);

  // Il riferimento ha più coda: l'italiano finisce prima.
  const shorter = planMerge(input({
    donor: donor([italian(2, 0, FILM - 90_000)]),
    offsetMs: 0,
    commonMaterial: { startMs: 0, endMs: FILM - 90_000 },
  }), cal);
  assert.equal(shorter.end.case, 'reference-longer');
  assert.equal(shorter.end.amountMs, 90_000);
  assert.equal(shorter.end.gapMs, 90_000);
  assert.equal(shorter.end.excess, 'none');
  assert.deepEqual(shorter.pending, []);
});

test('ABRUPT_START: taglio iniziale con l\'italiano sopra soglia; senza il livello del taglio è INTERNAL', () => {
  const base = input({ donor: donor([italian(2, 0, FILM + 1234)]), offsetMs: -1234 });
  const abrupt = planMerge({ ...base, cutLevels: levels(0, -21.37) }, cal);
  assert.deepEqual(warnings(abrupt), ['ABRUPT_START']);
  assert.equal(abrupt.warnings[0]!.value, -21.37);
  assert.equal(abrupt.start.cutLevelDbfs, -21.37);

  // Il livello serve per ogni taglio che il piano fa.
  assert.deepEqual(startCuts(base), [{ atMs: 0, trackIds: [2] }]);
  assert.throws(() => planMerge(base, cal), isInternal);
  // Una traccia che finisce tutta prima del taglio non viene tagliata: il livello non serve.
  const short = { ...base, donor: donor([italian(2, 0, FILM + 1234), italian(3, 0, 1000)]) };
  assert.deepEqual(startCuts(short), [{ atMs: 0, trackIds: [2] }]);
  assert.equal(planMerge({ ...short, cutLevels: levels(0, -60) }, cal).start.cutLevelDbfs, -60);
  // Senza taglio non serve: l'italiano parte da sé.
  const noCut = input({ donor: donor([italian(2, 0, FILM)]), offsetMs: 0 });
  assert.deepEqual(startCuts(noCut), []);
  assert.deepEqual(warnings(planMerge(noCut, cal)), []);
});

test('INTRO_MISMATCH: intro diverse, l\'italiano dell\'intro si tiene o si scarta con --edge-mismatch', () => {
  // Il donatore ha un'intro di 8 s al posto dei primi 5 s del film: S = −3 s,
  // materiale in comune da 5 s.
  const base = input({
    donor: donor([italian(2, 0, FILM + 3000)]),
    offsetMs: -3000,
    commonMaterial: { startMs: 5000, endMs: FILM },
    cutLevels: [...levels(0, -18), ...levels(5000, -55)],
  });
  assert.deepEqual(startCuts(base).map((c) => c.atMs), [0, 5000]);

  const pending = planMerge(base, cal);
  assert.equal(pending.start.mismatchMs, 5000);
  assert.deepEqual(pending.pending, ['edgeMismatch']);
  assert.deepEqual(pending.italian, { startMs: null, endMs: FILM });
  assert.equal(pending.start.cutMs, null);
  assert.deepEqual(warnings(pending), []);
  assert.deepEqual(effect(pending, 'edgeMismatch', 'drop'), {
    value: 'drop', italianStartMs: 5000, italianEndMs: FILM, audioTrackIds: [2], referenceSubtitleTrackIds: [], warnings: [],
  });
  assert.deepEqual(effect(pending, 'edgeMismatch', 'keep').warnings, ['INTRO_MISMATCH', 'ABRUPT_START']);
  assert.throws(() => assertNoPendingChoices(pending.choices), (e: unknown) => e instanceof DyadrrError && e.code === 'CHOICE_REQUIRED');

  const keep = planMerge({ ...base, choices: choices({ edgeMismatch: 'keep' }) }, cal);
  assert.deepEqual(warnings(keep), ['INTRO_MISMATCH', 'ABRUPT_START']);
  assert.equal(keep.warnings[0]!.value, 5000);
  assert.deepEqual(keep.italian, { startMs: 0, endMs: FILM });
  assert.equal(keep.start.cutMs, 0);

  // Con drop il taglio cade sul confine, dove l'italiano è quasi muto.
  const drop = planMerge({ ...base, choices: choices({ edgeMismatch: 'drop' }) }, cal);
  assert.deepEqual(warnings(drop), []);
  assert.deepEqual(drop.italian, { startMs: 5000, endMs: FILM });
  assert.equal(drop.start.cutMs, 5000);
  assert.equal(drop.start.gapMs, 5000);
  assert.equal(drop.audio[0]!.startMs, 5000);

  // Un tratto diverso sotto 1 s sta nella precisione dei confini: non conta.
  const close = planMerge({ ...base, commonMaterial: { startMs: 900, endMs: FILM } }, cal);
  assert.equal(close.start.mismatchMs, 0);
  assert.deepEqual(close.pending, []);
});

test('OUTRO_MISMATCH: code diverse, l\'italiano dopo il materiale in comune si tiene o si scarta', () => {
  const base = input({
    donor: donor([italian(2, 0, FILM)]),
    offsetMs: 0,
    commonMaterial: { startMs: 0, endMs: FILM - 200_000 },
  });
  const keep = planMerge({ ...base, choices: choices({ edgeMismatch: 'keep' }) }, cal);
  assert.deepEqual(warnings(keep), ['OUTRO_MISMATCH']);
  assert.equal(keep.warnings[0]!.value, 200_000);
  assert.deepEqual(keep.italian, { startMs: 0, endMs: FILM });

  const drop = planMerge({ ...base, choices: choices({ edgeMismatch: 'drop' }) }, cal);
  assert.deepEqual(warnings(drop), []);
  assert.equal(drop.end.cutMs, FILM - 200_000);
  assert.equal(drop.end.gapMs, 200_000);
  assert.deepEqual(drop.italian, { startMs: 0, endMs: FILM - 200_000 });
});

test('TAIL_EXCESS_KEPT: il donatore ha più coda, l\'eccesso si lascia o si toglie con --tail', () => {
  const base = input({ donor: donor([italian(2, 0, FILM + 60_000)]), offsetMs: 0 });
  const pending = planMerge(base, cal);
  assert.equal(pending.end.case, 'donor-longer');
  assert.equal(pending.end.excessMs, 60_000);
  assert.equal(pending.end.excess, null);
  assert.deepEqual(pending.pending, ['tail']);
  assert.deepEqual(effect(pending, 'tail', 'trim').italianEndMs, FILM);
  assert.deepEqual(effect(pending, 'tail', 'keep').warnings, ['TAIL_EXCESS_KEPT']);

  const keep = planMerge({ ...base, choices: choices({ tail: 'keep' }) }, cal);
  assert.deepEqual(warnings(keep), ['TAIL_EXCESS_KEPT']);
  assert.equal(keep.warnings[0]!.value, 60_000);
  assert.equal(keep.end.excess, 'kept');
  assert.equal(keep.italian.endMs, FILM + 60_000);

  const trim = planMerge({ ...base, choices: choices({ tail: 'trim' }) }, cal);
  assert.deepEqual(warnings(trim), []);
  assert.equal(trim.end.excess, 'trimmed');
  assert.equal(trim.end.cutMs, FILM);
  assert.equal(trim.italian.endMs, FILM);

  // Sotto 1 s l'eccesso non conta: niente scelta, e resta com'è.
  const small = planMerge({ ...base, donor: donor([italian(2, 0, FILM + 500)]), choices: choices({ tail: 'trim' }) }, cal);
  assert.equal(small.end.excess, 'none');
  assert.equal(small.end.excessMs, 500);
  assert.equal(choice(small, 'tail').status, 'ignored');
  assert.equal(small.italian.endMs, FILM + 500);
});

test('--tail non serve con code diverse e --edge-mismatch drop: il taglio cade già sul confine', () => {
  const base = input({
    donor: donor([italian(2, 0, FILM + 60_000)]),
    offsetMs: 0,
    commonMaterial: { startMs: 0, endMs: FILM - 200_000 },
  });
  const pending = planMerge(base, cal);
  assert.deepEqual(pending.pending, ['tail', 'edgeMismatch']);

  const drop = planMerge({ ...base, choices: choices({ edgeMismatch: 'drop', tail: 'keep' }) }, cal);
  assert.deepEqual(drop.pending, []);
  assert.equal(choice(drop, 'tail').status, 'ignored');
  assert.equal(drop.end.excess, 'trimmed');
  assert.equal(drop.italian.endMs, FILM - 200_000);
  assert.deepEqual(warnings(drop), []);

  // Con keep l'italiano resta sulla coda diversa, e l'eccesso lo decide --tail.
  const keep = planMerge({ ...base, choices: choices({ edgeMismatch: 'keep', tail: 'trim' }) }, cal);
  assert.deepEqual(warnings(keep), ['OUTRO_MISMATCH']);
  assert.equal(keep.italian.endMs, FILM);
});

test('ITALIAN_TRACKS_SKIPPED: con --italian main si prende solo la traccia principale', () => {
  const tracks = [
    italian(2, 0, FILM, { name: 'Commento del regista' }),
    italian(3, 0, FILM),
    italian(4, 0, FILM, { name: 'Audiodescrizione', codec: 'E-AC-3', codecId: 'A_EAC3' }),
  ];
  const base = input({ donor: donor(tracks), offsetMs: 0 });
  const pending = planMerge(base, cal);
  assert.deepEqual(pending.pending, ['italian']);
  assert.deepEqual(pending.audio.map((a) => [a.id, a.role, a.taken]), [[2, 'commentary', null], [3, 'main', null], [4, 'commentary', null]]);
  assert.deepEqual(effect(pending, 'italian', 'all').audioTrackIds, [2, 3, 4]);
  assert.deepEqual(effect(pending, 'italian', 'main').audioTrackIds, [3]);
  assert.deepEqual(effect(pending, 'italian', 'main').warnings, ['ITALIAN_TRACKS_SKIPPED', 'ITALIAN_TRACKS_SKIPPED']);

  const main = planMerge({ ...base, choices: choices({ italian: 'main' }) }, cal);
  assert.deepEqual(warnings(main), ['ITALIAN_TRACKS_SKIPPED', 'ITALIAN_TRACKS_SKIPPED']);
  assert.deepEqual(main.warnings.map((w) => w.value), [2, 4]);
  assert.deepEqual(main.audio.map((a) => a.taken), [false, true, false]);

  const all = planMerge({ ...base, choices: choices({ italian: 'all' }) }, cal);
  assert.deepEqual(warnings(all), []);
  assert.deepEqual(all.audio.map((a) => a.taken), [true, true, true]);

  // La traccia già predefinita nel donatore è la principale.
  const flagged = planMerge(input({ donor: donor([italian(2, 0, FILM), italian(3, 0, FILM, { default: true })]), offsetMs: 0 }), cal);
  assert.deepEqual(flagged.audio.map((a) => [a.id, a.role, a.reason]), [
    [2, 'other', 'not the main track'],
    [3, 'main', 'default flag set in the donor'],
  ]);
  // Con una sola traccia italiana non c'è niente da scegliere.
  const single = planMerge({ ...input({ donor: donor([italian(2, 0, FILM)]), offsetMs: 0 }), choices: choices({ italian: 'main' }) }, cal);
  assert.equal(choice(single, 'italian').status, 'ignored');
  assert.deepEqual(warnings(single), []);
});

test('LONG_GAP_WITHOUT_ITALIAN: un buco senza italiano oltre la soglia, all\'inizio o alla fine', () => {
  // Il donatore finisce 11 minuti prima: oltre i 10 minuti della soglia.
  const end = planMerge(input({
    donor: donor([italian(2, 0, FILM - 660_000)]),
    offsetMs: 0,
    commonMaterial: { startMs: 0, endMs: FILM - 660_000 },
  }), cal);
  assert.deepEqual(warnings(end), ['LONG_GAP_WITHOUT_ITALIAN']);
  assert.equal(end.warnings[0]!.value, 660_000);

  // All'inizio, con un'intro diversa di 11 minuti scartata.
  const start = planMerge(input({
    donor: donor([italian(2, 0, FILM)]),
    offsetMs: 0,
    commonMaterial: { startMs: 660_000, endMs: FILM },
    choices: choices({ edgeMismatch: 'drop' }),
    cutLevels: levels(660_000, -60),
  }), cal);
  assert.deepEqual(warnings(start), ['LONG_GAP_WITHOUT_ITALIAN']);
  assert.match(start.warnings[0]!.message, /first/);

  // Sotto la soglia nessun avviso.
  const short = planMerge(input({ donor: donor([italian(2, 0, FILM - 540_000)]), offsetMs: 0, commonMaterial: { startMs: 0, endMs: FILM - 540_000 } }), cal);
  assert.deepEqual(warnings(short), []);
  const strict = parseCalibration({ ...cal, values: { ...cal.values, longGapWithoutItalianMs: 300_000 } });
  assert.deepEqual(warnings(planMerge(input({ donor: donor([italian(2, 0, FILM - 540_000)]), offsetMs: 0, commonMaterial: { startMs: 0, endMs: FILM - 540_000 } }), strict)), ['LONG_GAP_WITHOUT_ITALIAN']);
});

test('REFERENCE_HAS_ITALIAN_SUBS: PGS italiani già nel riferimento, tenuti o scartati', () => {
  const base = input({
    reference: reference([pgs(5, 'eng', 3000), pgs(6, 'ita', 2900)]),
    donor: donor([italian(2, 0, FILM), pgs(3, 'ita', 3100)]),
    offsetMs: 0,
  });
  const pending = planMerge(base, cal);
  assert.deepEqual(pending.pending, ['referenceItalianSubs']);
  assert.deepEqual(warnings(pending), ['REFERENCE_HAS_ITALIAN_SUBS']);
  assert.deepEqual(pending.referenceItalianSubtitles.map((s) => [s.id, s.kept]), [[6, null]]);
  assert.deepEqual(effect(pending, 'referenceItalianSubs', 'keep').referenceSubtitleTrackIds, [6]);
  assert.deepEqual(effect(pending, 'referenceItalianSubs', 'drop').referenceSubtitleTrackIds, []);

  for (const value of ['keep', 'drop']) {
    const p = planMerge({ ...base, choices: choices({ referenceItalianSubs: value }) }, cal);
    assert.deepEqual(warnings(p), ['REFERENCE_HAS_ITALIAN_SUBS']);
    assert.deepEqual(p.referenceItalianSubtitles.map((s) => s.kept), [value === 'keep']);
    assert.deepEqual(p.pending, []);
  }
});

test('ITALIAN_SUBS_NOT_PGS: i sottotitoli italiani non PGS del donatore si scartano', () => {
  const p = planMerge(input({
    donor: donor([
      italian(2, 0, FILM),
      pgs(3, 'ita', 3000),
      track(4, 'subtitles', { language: 'ita', codec: 'SubRip/SRT', codecId: 'S_TEXT/UTF8' }),
      pgs(5, 'eng', 3000),
    ]),
    offsetMs: 0,
  }), cal);
  assert.deepEqual(warnings(p), ['ITALIAN_SUBS_NOT_PGS']);
  assert.equal(p.warnings[0]!.value, 4);
  // I sottotitoli non italiani del donatore non si prendono e non si elencano.
  assert.deepEqual(p.subtitles.map((s) => [s.id, s.pgs, s.taken]), [[3, true, true], [4, false, false]]);
});

test('NO_FORCED_ITALIAN_SUBS: il riferimento ha un forced in un\'altra lingua e il donatore nessun forced italiano', () => {
  const ref = reference([pgs(5, 'eng', 3000), pgs(6, 'eng', 40)]);
  const missing = planMerge(input({ reference: ref, donor: donor([italian(2, 0, FILM), pgs(3, 'ita', 3000)]), offsetMs: 0 }), cal);
  assert.deepEqual(warnings(missing), ['NO_FORCED_ITALIAN_SUBS']);

  const present = planMerge(input({ reference: ref, donor: donor([italian(2, 0, FILM), pgs(3, 'ita', 3000), pgs(4, 'ita', 60)]), offsetMs: 0 }), cal);
  assert.deepEqual(warnings(present), []);
  // Senza un forced nel riferimento l'avviso non scatta: scatterebbe su quasi tutti i film.
  const none = planMerge(input({ reference: reference([pgs(5, 'eng', 3000)]), donor: donor([italian(2, 0, FILM), pgs(3, 'ita', 3000)]), offsetMs: 0 }), cal);
  assert.deepEqual(warnings(none), []);
});

test('SDR_SUBS_ON_HDR: PGS italiani da un disco SDR sopra un video HDR', () => {
  const tracks = [italian(2, 0, FILM), pgs(3, 'ita', 3000)];
  const hdr = planMerge(input({ reference: reference([], 'HDR10'), donor: donor(tracks, 'SDR'), offsetMs: 0 }), cal);
  assert.deepEqual(warnings(hdr), ['SDR_SUBS_ON_HDR']);
  const dv = planMerge(input({ reference: reference([], 'DV'), donor: donor(tracks, 'SDR'), offsetMs: 0 }), cal);
  assert.deepEqual(warnings(dv), ['SDR_SUBS_ON_HDR']);
  // Senza PGS italiani, o con due video SDR, niente avviso.
  assert.deepEqual(warnings(planMerge(input({ reference: reference([], 'HDR10'), donor: donor([italian(2, 0, FILM)]), offsetMs: 0 }), cal)), []);
  assert.deepEqual(warnings(planMerge(input({ reference: reference([], 'SDR'), donor: donor(tracks, 'SDR'), offsetMs: 0 }), cal)), []);
});

test('forced: flag, nome, oppure molti meno blocchi della traccia più grande della stessa lingua', () => {
  const classes = classifySubtitles([
    pgs(3, 'ita', 3000),
    pgs(4, 'ita', 120),
    pgs(5, 'ita', 600),
    pgs(6, 'ita', null, { name: 'Forzati' }),
    pgs(7, 'ita', 2800, { forced: true }),
    pgs(8, 'ita', null),
    pgs(9, 'eng', 300),
    pgs(10, 'ita', 2500, { name: 'Commento' }),
  ], cal);
  assert.deepEqual(classes.map((c) => [c.id, c.forced, c.forcedBy]), [
    [3, false, null],
    [4, true, 'blocks'],
    // 20%: sopra la soglia del 15%.
    [5, false, null],
    [6, true, 'name'],
    [7, true, 'flag'],
    [8, false, null],
    // La più grande della sua lingua.
    [9, false, null],
    [10, false, null],
  ]);
  assert.equal(classes[1]!.reason, '120 blocks, 4% of the largest ita track (3000): below 15%');
  assert.equal(classes[7]!.commentary, true);
});

test('scelte: si chiedono solo se servono, con l\'effetto di ogni valore; quelle indicate e non necessarie si ignorano', () => {
  const p = planMerge(input({
    donor: donor([italian(2, 0, FILM)]),
    offsetMs: 0,
    choices: { tail: { value: 'keep', origin: 'env' } },
  }), cal);
  assert.deepEqual(p.choices.map((c) => [c.name, c.status]), [
    ['tail', 'ignored'],
    ['italian', 'not-needed'],
    ['referenceItalianSubs', 'not-needed'],
    ['edgeMismatch', 'not-needed'],
  ]);
  assert.deepEqual(warnings(p), []);

  // Tutte e quattro necessarie: le decise hanno valore e origine, le altre restano in sospeso.
  const all = planMerge(input({
    reference: reference([pgs(6, 'ita', 3000)]),
    donor: donor([italian(2, 0, FILM + 60_000), italian(3, 0, FILM + 60_000)]),
    offsetMs: 0,
    commonMaterial: { startMs: 30_000, endMs: FILM },
    choices: { italian: { value: 'all', origin: 'env' }, tail: { value: 'trim', origin: 'option' } },
    cutLevels: levels(30_000, -70, [2, 3]),
  }), cal);
  assert.deepEqual(all.choices.map((c) => [c.name, c.status]), [
    ['tail', 'decided'],
    ['italian', 'decided'],
    ['referenceItalianSubs', 'pending'],
    ['edgeMismatch', 'pending'],
  ]);
  assert.deepEqual(all.pending, ['referenceItalianSubs', 'edgeMismatch']);
  assert.deepEqual(all.italian, { startMs: null, endMs: FILM });
  // Con un'altra scelta in sospeso l'effetto dice solo quello che non dipende da lei.
  assert.deepEqual(effect(all, 'edgeMismatch', 'drop').referenceSubtitleTrackIds, null);
  assert.equal(effect(all, 'edgeMismatch', 'drop').italianStartMs, 30_000);
  assert.equal(effect(all, 'edgeMismatch', 'keep').italianStartMs, 0);
});

test('INTERNAL: il piano di un donatore senza audio italiano', () => {
  assert.throws(
    () => planMerge(input({ donor: donor([]), offsetMs: 0 }), cal),
    (e: unknown) => e instanceof DyadrrError && e.code === 'INTERNAL',
  );
});
