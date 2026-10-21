import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadCalibration, parseCalibration, type Calibration } from '../src/calibration.js';
import { decide } from '../src/decision.js';
import { readInput, type InputFile } from '../src/inputs.js';
import {
  analyzePair,
  candidatePairs,
  decisionMeasures,
  isLossless,
  mainTrack,
  transferCandidates,
  transferMix,
  type PairAnalysis,
} from '../src/measure.js';
import { planPair } from '../src/plan.js';
import { realShift, runAsync, settle, tempDir } from './helpers/mkv.js';

// Misura su MKV veri, generati al volo (studio §15, 1a e 1b). Il "film" sono
// 120 s di rumore rosa, un rumore diverso su ogni canale del 5.1: il centrale
// è il dialogo, gli altri canali musica ed effetti. L'italiano ha lo stesso
// 5.1 dell'inglese con un altro centrale, come un doppiaggio. Il riferimento
// ha il video 320x180, il donatore 160x90.
//
// Le varianti del donatore: spostamenti con mkvmerge --sync, code e tagli con
// --split su intermedi senza video, intro diverse, tratti sostituiti o muti,
// velocità diverse e un remix con un altro L+R. La taratura dei test accorcia
// finestre e intervallo di ricerca, perché i file durano due minuti.

const SECONDS = 120;
const RATE = 32000;
const ENGLISH = [1, 2, 3, 4, 5, 6];
const ITALIAN = [1, 2, 7, 4, 5, 6];
const REMIX = [8, 9, 3, 10, 11, 12];
const OTHER = [20, 21, 22, 23, 24, 25];

const base = loadCalibration();
const calibration = (values: Partial<Calibration['values']>) =>
  parseCalibration({ version: base.version, provisional: base.provisional, values: { ...base.values, ...values } });
const cal = calibration({
  maxOffsetMs: 5000,
  searchMarginMs: 2000,
  anchorWindowMs: 10_000,
  checkpointWindowMs: 3000,
  checkpointCount: 20,
  maxCheckpointCount: 30,
  minConsistentCheckpoints: 10,
  maxCheckpointGapMs: 60_000,
  minCoverage: 0.75,
});

let dir: string;
const p = (name: string) => join(dir, name);
const inputs: Record<string, Promise<InputFile>> = {};
const read = (name: string) => (inputs[name] ??= readInput(p(`${name}.mkv`), { calibration: cal }));
const analyses: Record<string, Promise<PairAnalysis>> = {};
const analyze = (reference: string, donor: string, c = cal, tag = '') =>
  (analyses[`${reference}+${donor}${tag}`] ??= (async () => analyzePair([await read(reference), await read(donor)], null, c))());

const reasons = (a: PairAnalysis) => a.report.reasons.map((r) => r.code);
const warnings = (a: PairAnalysis) => a.report.warnings.map((w) => w.code);

// ---------------------------------------------------------------- sorgenti

/** Un 5.1 di rumori rosa (FL, FR, FC, LFE, BL, BR), uno per seed, con l'etichetta `label`. */
function surround(seeds: readonly number[], label: string, seconds = SECONDS): string[] {
  return [
    ...seeds.map((s, i) => `anoisesrc=d=${seconds}:c=pink:r=${RATE}:a=0.2:s=${s}[${label}${i}]`),
    // Mappa esplicita: senza, join mette per nome il primo ingresso mono (FC) nel centrale.
    `${seeds.map((_, i) => `[${label}${i}]`).join('')}join=inputs=6:channel_layout=5.1:` +
      `map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-BL|5.0-BR[${label}]`,
  ];
}

/** Una variante di un 5.1: filtri da `[in]` a `[out]`, con le sorgenti che servono. */
type Variant = (input: string, output: string) => string[];

const plain: Variant = (i, o) => [`[${i}]anull[${o}]`];
/** 30 s di silenzio digitale a metà film. */
const silence: Variant = (i, o) => [`[${i}]volume=enable='between(t,60,90)':volume=0[${o}]`];
/** 8 s di silenzio all'inizio e alla fine. */
const quietEdges: Variant = (i, o) => [`[${i}]volume=enable='lt(t,8)+gt(t,${SECONDS - 8})':volume=0[${o}]`];
/** Un'intro diversa di 8 s al posto dei primi 5 s del film: S = −3 s, materiale in comune da 5 s. */
const intro: Variant = (i, o) => [
  ...surround(OTHER, `${o}logo`, 8),
  `[${i}]atrim=start=5,asetpts=PTS-STARTPTS[${o}film]`,
  `[${o}logo][${o}film]concat=n=2:v=0:a=1[${o}]`,
];
/** Da 60 a 80 s un altro contenuto, della stessa lunghezza. */
const replaced: Variant = (i, o) => [
  ...surround(OTHER, `${o}other`, 20),
  `[${i}]asplit=2[${o}a][${o}b]`,
  `[${o}a]atrim=0:60,asetpts=PTS-STARTPTS[${o}1]`,
  `[${o}b]atrim=80:${SECONDS},asetpts=PTS-STARTPTS[${o}3]`,
  `[${o}1][${o}other][${o}3]concat=n=3:v=0:a=1[${o}]`,
];
/** Velocità diversa: il film suona `rate`/32000 volte più veloce, tono compreso. */
const speed = (rate: number): Variant => (i, o) => [`[${i}]asetrate=${rate},aresample=${RATE}[${o}]`];
/** Un motivo di 1,5 s ripetuto per tutto il film. */
const loop: Variant = (i, o) => [`[${i}]atrim=0:1.5,aloop=loop=-1:size=${1.5 * RATE},atrim=0:${SECONDS}[${o}]`];
/** Downmix stereo di un 5.1, come lo farebbe un disco. */
const stereo: Variant = (i, o) => [`[${i}]pan=stereo|FL=FL+0.707*FC+0.707*BL|FR=FR+0.707*FC+0.707*BR[${o}]`];

interface TrackSpec {
  seeds: readonly number[];
  variant?: Variant;
  language: string;
  name?: string;
}

/** Un MKV: il video dato e le tracce audio in AC3, passato per mkvmerge. */
async function film(name: string, video: string, tracks: readonly TrackSpec[]): Promise<void> {
  const graph = tracks.flatMap((t, i) => [...surround(t.seeds, `s${i}`), ...(t.variant ?? plain)(`s${i}`, `t${i}`)]);
  await runAsync('ffmpeg', [
    '-v', 'error', '-y', '-filter_complex', graph.join(';'),
    ...tracks.flatMap((_, i) => ['-map', `[t${i}]`]), '-c:a', 'ac3', p(`${name}.mka`),
  ]);
  await mux(name, [
    p(video),
    ...tracks.flatMap((t, i) => ['--language', `${i}:${t.language}`, ...(t.name ? ['--track-name', `${i}:${t.name}`] : [])]),
    p(`${name}.mka`),
  ]);
}

async function mux(name: string, args: readonly string[]): Promise<void> {
  await runAsync('mkvmerge', ['-q', '-o', p(`${name}.mkv`), ...args]);
  settle(p(`${name}.mkv`));
}

/** Il donatore con tutte le tracce spostate di `ms` con --sync. */
const synced = (name: string, ms: number) => mux(name, ['--sync', `0:${ms}`, '--sync', `1:${ms}`, '--sync', `2:${ms}`, p('donor.mkv')]);

/** Il donatore con l'audio diviso con --split sull'intermedio senza video, rimesso con il video. */
async function split(name: string, parts: string): Promise<void> {
  await runAsync('mkvmerge', ['-q', '-o', p(`${name}.mka`), '--split', `parts:${parts}`, p('donor-audio.mka')]);
  await mux(name, [p('donor-video.mkv'), p(`${name}.mka`)]);
}

const donorTracks = (variant?: Variant): TrackSpec[] => [
  { seeds: ITALIAN, variant, language: 'ita' },
  { seeds: ENGLISH, variant, language: 'eng' },
];

before(async () => {
  dir = tempDir();
  const video = (name: string, size: string) => runAsync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24000/1001`, '-t', String(SECONDS),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', p(name),
  ]);
  await Promise.all([video('ref-video.mkv', '320x180'), video('donor-video.mkv', '160x90')]);

  await Promise.all([
    film('reference', 'ref-video.mkv', [{ seeds: ENGLISH, language: 'eng' }]),
    film('donor', 'donor-video.mkv', donorTracks()),
    film('ref-silence', 'ref-video.mkv', [{ seeds: ENGLISH, variant: silence, language: 'eng' }]),
    film('donor-silence', 'donor-video.mkv', donorTracks(silence)),
    film('donor-intro', 'donor-video.mkv', donorTracks(intro)),
    film('ref-quiet', 'ref-video.mkv', [{ seeds: ENGLISH, variant: quietEdges, language: 'eng' }]),
    film('donor-quiet', 'donor-video.mkv', donorTracks(quietEdges)),
    film('donor-replaced', 'donor-video.mkv', donorTracks(replaced)),
    film('donor-drift', 'donor-video.mkv', donorTracks(speed(32010))),
    film('donor-speed', 'donor-video.mkv', donorTracks(speed(32032))),
    film('ref-loop', 'ref-video.mkv', [{ seeds: ENGLISH, variant: loop, language: 'eng' }]),
    film('donor-loop', 'donor-video.mkv', donorTracks(loop)),
    film('ref-remix', 'ref-video.mkv', [{ seeds: REMIX, language: 'eng' }]),
    film('donor-stereo', 'donor-video.mkv', [
      { seeds: ITALIAN, variant: stereo, language: 'ita' },
      { seeds: ENGLISH, variant: stereo, language: 'eng' },
    ]),
    film('donor-multi', 'donor-video.mkv', [
      { seeds: ITALIAN, language: 'ita' },
      { seeds: ENGLISH, variant: stereo, language: 'eng' },
      { seeds: ENGLISH, language: 'eng' },
      { seeds: OTHER, language: 'eng', name: "Director's Commentary" },
    ]),
  ]);

  await Promise.all([
    synced('donor-plus', 1537),
    synced('donor-minus', -263),
    synced('donor-far', 6500),
    // Il riferimento finisce a 100 s (sul primo fotogramma chiave dopo): il donatore ha 20 s di coda in più.
    runAsync('mkvmerge', ['-q', '-o', p('ref-tail.mkv'), '--split', 'parts:00:00:00-00:01:40', p('reference.mkv')])
      .then(() => settle(p('ref-tail.mkv'))),
  ]);
  await runAsync('mkvmerge', ['-q', '-o', p('donor-audio.mka'), '-D', p('donor.mkv')]);
  await Promise.all([
    split('donor-tail', '00:00:00-00:01:40'),
    split('donor-cut', '00:00:00-00:01:00,+00:01:04-00:02:00'),
    split('donor-jump', '00:00:00-00:01:00,+00:01:00.1-00:02:00'),
  ]);
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ---------------------------------------------------------------- test

test('coppie di tracce: esclusi i commenti, centrale solo se lo hanno entrambe; lossless e segnale del trasferimento', async () => {
  const pairs = candidatePairs(await read('reference'), await read('donor-multi'), 'eng');
  // Il commento inglese è escluso; restano la stereo (L+R) e il 5.1 (centrale).
  assert.deepEqual(pairs.map((x) => [x.reference.id, x.donor.id, x.mix]), [[1, 2, 'leftRight'], [1, 3, 'center']]);

  assert.equal(isLossless({ codec: 'TrueHD Atmos', codecId: 'A_TRUEHD' }), true);
  assert.equal(isLossless({ codec: 'DTS-HD Master Audio', codecId: 'A_DTS' }), true);
  assert.equal(isLossless({ codec: 'FLAC', codecId: 'A_FLAC' }), true);
  assert.equal(isLossless({ codec: 'AC-3', codecId: 'A_AC3' }), false);
  assert.equal(isLossless({ codec: 'DTS', codecId: 'A_DTS' }), false);

  const layout = (channelLayout: string | null, channels = 6) => ({ channelLayout, channels });
  assert.equal(transferMix(layout('5.1(side)'), layout('7.1')), 'leftRight');
  assert.equal(transferMix(layout('5.1'), layout('stereo', 2)), 'side');
  assert.equal(transferMix(layout('stereo', 2), layout(null, 2)), 'side');
  assert.equal(transferMix(layout('5.1'), layout('mono', 1)), 'leftRight');
});

test('traccia principale e tracce del trasferimento: come Scott Pilgrim e Cattivissimo me 4', () => {
  const t = (id: number, codec: string, codecId: string, channels: number) => ({ id, codec, codecId, channels });
  // Scott Pilgrim, UHD: TrueHD 7.1, AC-3 5.1 e quattro commenti stereo senza flag.
  const uhd = [t(1, 'TrueHD Atmos', 'A_TRUEHD', 8), t(2, 'AC-3', 'A_AC3', 6), t(3, 'AC-3', 'A_AC3', 2), t(4, 'AC-3', 'A_AC3', 2)];
  assert.equal(mainTrack(uhd)?.id, 1);
  // BD: DTS-HD MA 5.1 e il suo core DTS 5.1, alla pari di canali: vince il lossless.
  const bd = [t(2, 'DTS', 'A_DTS', 6), t(1, 'DTS-HD Master Audio', 'A_DTS', 6), t(3, 'AC-3', 'A_AC3', 2)];
  assert.equal(mainTrack(bd)?.id, 1);
  assert.equal(mainTrack([]), null);

  // Italiano DTS 5.1: prima lo stesso codec e la stessa classe (il core DTS),
  // poi lo stesso codec (DTS-HD), poi la traccia della misura, poi l'ordine.
  const ita = { codec: 'DTS', codecId: 'A_DTS' };
  assert.deepEqual(transferCandidates(bd, ita, 3).map((x) => x.id), [2, 1, 3]);
  // Cattivissimo me 4: italiano E-AC-3, inglese TrueHD (la misura) e AC-3: prima l'AC-3, lossy come l'italiano.
  const dm4 = [t(1, 'TrueHD Atmos', 'A_TRUEHD', 8), t(2, 'AC-3', 'A_AC3', 6)];
  assert.deepEqual(transferCandidates(dm4, { codec: 'E-AC-3', codecId: 'A_EAC3' }, 1).map((x) => x.id), [2, 1]);
});

test('spostamenti noti con --sync, di entrambi i segni: S dai timestamp dei file prodotti, al decimo di ms', async () => {
  for (const [donor, sign] of [['donor-plus', 1], ['donor-minus', -1]] as const) {
    const shift = realShift(p('donor.mkv'), p(`${donor}.mkv`));
    assert.ok(Math.abs(shift - sign * (sign > 0 ? 1537 : 263)) < 1, `${donor}: real shift ${shift}`);
    const a = await analyze('reference', donor);
    assert.equal(a.report.decision, 'eligible', JSON.stringify(a.report.reasons));
    assert.deepEqual(warnings(a), []);
    // S = posizione nel riferimento − posizione nel donatore: il contrario dello spostamento del donatore.
    const offset = a.report.offset!;
    assert.ok(Math.abs(offset.medianMs + shift) < 0.6, `${donor}: S ${offset.medianMs}, expected ${-shift}`);
    assert.equal(offset.offsetMs, Math.round(-shift));
    assert.equal(offset.medianMs, Math.round(offset.medianMs * 10) / 10);
    assert.ok(offset.dispersionMs < 0.5, String(offset.dispersionMs));

    const m = a.measurement!;
    assert.deepEqual(m.pair, { referenceTrackId: 1, donorTrackId: 2, mix: 'center' });
    assert.equal(m.anchors.filter((x) => x.ncc > 0.9 && x.ratio > 5).length, 2);
    // Il materiale in comune è tutto il film; nessuna ricerca oltre i confini.
    assert.ok(m.boundaries!.startMs <= 1000 && m.boundaries!.endMs >= SECONDS * 1000 - 1500, JSON.stringify(m.boundaries));
    assert.deepEqual(m.edgeProbes, []);
    assert.equal(m.checkpoints!.length, 20);
    assert.ok(m.checkpoints!.every((c) => c.local !== null && c.wide === null && !c.added));
    // L'italiano condivide L e R con l'inglese: trasferimento a zero.
    assert.equal(a.report.transfer?.confident, 5);
    assert.ok(Math.abs(a.report.transfer!.offsetMs!) < 0.5);
    assert.ok(m.transfer!.probes.every((x) => x.mix === 'leftRight'));
    // Una sola traccia inglese nel donatore: è quella del trasferimento; nessuna coppia diversa da quella principale.
    assert.deepEqual(m.transfer!.candidates.map((c) => [c.trackId, c.confident]), [[2, 5]]);
    assert.equal(m.mainPair, null);
    assert.ok(m.bytesRead.reference > 0 && m.bytesRead.donor > m.bytesRead.reference);
  }
});

test('code tagliate con --split: confine finale al secondo, LOW_COVERAGE se il materiale in comune non basta', async () => {
  const a = await analyze('reference', 'donor-tail');
  assert.equal(a.report.decision, 'eligible', JSON.stringify(a.report.reasons));
  const { startMs, endMs } = a.measurement!.boundaries!;
  assert.ok(startMs <= 1000, String(startMs));
  // Il donatore finisce a 100 s: il confine cade lì, entro una finestra breve.
  assert.ok(endMs > 98_000 && endMs <= 100_100, String(endMs));
  // Dopo il confine il riferimento continua, ma il film non è altrove nel donatore.
  const probes = a.measurement!.edgeProbes!;
  assert.ok(probes.length > 0 && probes.every((x) => x.side === 'end' && x.positionMs >= endMs - 1));
  assert.ok(probes.every((x) => x.match === null || x.match.ncc < 0.3), JSON.stringify(probes));

  const strict = decide({ files: [await read('reference'), await read('donor-tail')], originalLanguage: null, ...decisionMeasures(a.measurement!) }, calibration({ ...cal.values, minCoverage: 0.9 }));
  assert.deepEqual(strict.reasons.map((r) => r.code), ['LOW_COVERAGE']);
});

test('intro diverse: confine iniziale, e prima del confine il film non continua altrove', async () => {
  const a = await analyze('reference', 'donor-intro');
  assert.equal(a.report.decision, 'eligible', JSON.stringify(a.report.reasons));
  assert.ok(Math.abs(a.report.offset!.medianMs + 3000) < 1, String(a.report.offset!.medianMs));
  const { startMs, endMs } = a.measurement!.boundaries!;
  // Il film comune comincia a 5 s; una finestra a cavallo può anticiparlo di poco.
  assert.ok(startMs >= 3000 && startMs <= 6000, String(startMs));
  assert.ok(endMs >= SECONDS * 1000 - 1500, String(endMs));
  const probes = a.measurement!.edgeProbes!;
  assert.ok(probes.length >= 1 && probes.every((x) => x.side === 'start'));
});

test('silenzio all\'inizio e alla fine: i confini si fermano vicino al contenuto e la ricerca finisce', async () => {
  const a = await analyze('ref-quiet', 'donor-quiet');
  assert.equal(a.report.decision, 'eligible', JSON.stringify(a.report.reasons));
  const { startMs, endMs } = a.measurement!.boundaries!;
  // Il contenuto va da 8 a 112 s; una finestra che ne tocca un po' basta.
  assert.ok(startMs >= 4000 && startMs <= 8100, String(startMs));
  assert.ok(endMs >= 111_900 && endMs <= 116_000, String(endMs));
  // Prima e dopo i confini c'è solo silenzio: nessuna corrispondenza altrove.
  assert.ok(a.measurement!.edgeProbes!.every((x) => x.match === null || x.match.ncc < 0.5));
});

test('CHECKPOINT_CONTRADICTION: un taglio a metà film, di 4 s o di pochi fotogrammi', async () => {
  // 4 s tolti a 60 s: dopo il taglio il film continua a 4 s di distanza,
  // fuori dalla ricerca vicina. Il confine finale cade sul taglio, e oltre il
  // confine il film si ritrova: è un salto, non una coda diversa.
  const cut = await analyze('reference', 'donor-cut');
  assert.deepEqual(reasons(cut), ['CHECKPOINT_CONTRADICTION']);
  const end = cut.measurement!.boundaries!.endMs;
  assert.ok(end > 57_000 && end < 62_000, String(end));
  const shape = cut.report.contradiction!;
  assert.equal(shape.kind, 'single-jump');
  assert.ok(Math.abs(shape.jumps[0]!.amountMs - 4000) < 50, JSON.stringify(shape));

  // Circa 100 ms tolti a 60 s (mkvmerge taglia sui pacchetti di 48 ms): i
  // punti dopo il taglio trovano il film poco più in là, nella ricerca vicina.
  const jump = await analyze('reference', 'donor-jump');
  assert.deepEqual(reasons(jump), ['CHECKPOINT_CONTRADICTION']);
  const j = jump.report.contradiction!;
  assert.equal(j.kind, 'single-jump');
  assert.ok(j.jumps[0]!.amountMs > 40 && j.jumps[0]!.amountMs < 150, JSON.stringify(j));
  assert.ok(j.jumps[0]!.afterMs < 60_000 && j.jumps[0]!.beforeMs > 60_000, JSON.stringify(j));
  // Con un punto contraddittorio la misura si ferma: niente confini né trasferimento.
  assert.equal(jump.measurement!.edgeProbes, null);
  assert.equal(jump.measurement!.transfer, null);
});

test('CHECKPOINT_UNMATCHED: un tratto sostituito a metà film non trova corrispondenza', async () => {
  const a = await analyze('reference', 'donor-replaced');
  assert.deepEqual(reasons(a), ['CHECKPOINT_UNMATCHED']);
  const unmatched = a.report.checkpoints.filter((c) => c.outcome === 'unmatched');
  assert.ok(unmatched.length >= 2);
  assert.ok(unmatched.every((c) => c.positionMs > 57_000 && c.positionMs < 80_000), JSON.stringify(unmatched.map((c) => c.positionMs)));
  // Prima di dirlo si è cercato su tutto l'intervallo.
  const measured = a.measurement!.checkpoints!.filter((c) => unmatched.some((u) => u.positionMs === c.positionMs));
  assert.ok(measured.every((c) => c.wide !== null && c.wide.ncc < 0.3));
});

test('MANY_INCONCLUSIVE: silenzi lunghi danno punti non conclusivi, e punti aggiunti nei tratti scoperti', async () => {
  const a = await analyze('ref-silence', 'donor-silence');
  assert.equal(a.report.decision, 'eligible', JSON.stringify(a.report.reasons));
  assert.deepEqual(warnings(a), ['MANY_INCONCLUSIVE']);
  const points = a.measurement!.checkpoints!;
  const inconclusive = a.report.checkpoints.filter((c) => c.outcome === 'inconclusive');
  assert.ok(inconclusive.length >= 3, String(inconclusive.length));
  assert.ok(inconclusive.every((c) => c.positionMs >= 60_000 && c.positionMs <= 90_000 && c.energyDbfs < cal.values.silenceDbfs));
  // Le finestre vicine al silenzio si spostano sul contenuto, dentro il loro intervallo.
  const moved = points.filter((c) => c.positionMs !== c.requestedMs);
  assert.ok(moved.length >= 1, 'no checkpoint moved');
  assert.ok(moved.every((c) => Math.abs(c.positionMs - c.requestedMs) <= 3000 && c.energyDbfs >= cal.values.silenceDbfs));
  assert.ok(points.every((c) => !c.added));

  // Con più punti coerenti richiesti se ne aggiungono, fino a bastare.
  const more = calibration({ ...cal.values, minConsistentCheckpoints: points.length - inconclusive.length + 1 });
  const b = await analyze('ref-silence', 'donor-silence', more, '+more');
  assert.equal(b.report.decision, 'eligible', JSON.stringify(b.report.reasons));
  const added = b.measurement!.checkpoints!.filter((c) => c.added);
  assert.ok(added.length >= 1 && b.measurement!.checkpoints!.length <= more.values.maxCheckpointCount);
  assert.ok(b.report.checkpoints.filter((c) => c.outcome === 'consistent').length >= more.values.minConsistentCheckpoints);
  assert.ok(b.report.checkpoints.some((c) => c.added && c.outcome === 'consistent'));
});

test('canale centrale contro L+R su un remix: la coppia con il centrale, NO_MATCH con il solo L+R', async () => {
  // Stesso dialogo, musica ed effetti diversi: il centrale è identico.
  const remix = await analyze('ref-remix', 'donor');
  assert.equal(remix.report.decision, 'eligible', JSON.stringify(remix.report.reasons));
  assert.equal(remix.measurement!.pair.mix, 'center');
  assert.ok(Math.abs(remix.report.offset!.medianMs) < 0.5);

  // Il donatore ha l'inglese stereo e 5.1 (e un commento, escluso): si provano
  // tutte e due le coppie sulla prima ancora, e vince quella con il centrale.
  const multi = await analyze('ref-remix', 'donor-multi');
  assert.equal(multi.report.decision, 'eligible', JSON.stringify(multi.report.reasons));
  const trials = multi.measurement!.pairs;
  assert.deepEqual(trials.map((t) => [t.donorTrackId, t.mix]), [[2, 'leftRight'], [3, 'center']]);
  assert.ok(trials[0]!.match!.ncc < 0.3 && trials[1]!.match!.ncc > 0.9, JSON.stringify(trials));
  assert.deepEqual(multi.measurement!.pair, { referenceTrackId: 1, donorTrackId: 3, mix: 'center' });

  // Con il solo stereo nel donatore si confronta L+R, che nel remix è un'altra musica.
  const stereoOnly = await analyze('ref-remix', 'donor-stereo');
  assert.deepEqual(reasons(stereoOnly), ['NO_MATCH']);
  assert.equal(stereoOnly.measurement!.pair.mix, 'leftRight');
  assert.equal(stereoOnly.measurement!.anchors.length, 4);
  assert.equal(stereoOnly.measurement!.checkpoints, null);
});

test('OFFSET_TOO_LARGE: spostamento sicuro oltre il massimo, dentro l\'intervallo di ricerca', async () => {
  const a = await analyze('reference', 'donor-far');
  assert.deepEqual(reasons(a), ['OFFSET_TOO_LARGE']);
  assert.ok(Math.abs(a.measurement!.anchorOffsetMs! + 6500) < 1);
  // Ci si ferma alla prima ancora sicura.
  assert.equal(a.measurement!.anchors.length, 1);
});

test('DRIFT: il donatore va più veloce di 0,3 per mille', async () => {
  const a = await analyze('reference', 'donor-drift');
  assert.deepEqual(reasons(a), ['DRIFT']);
  const drift = a.report.drift!;
  // 32010/32000: 1,1 ms al minuto, circa 1125 ms all'ora.
  assert.ok(Math.abs(drift.msPerHour - 1125) < 30, JSON.stringify(drift));
});

test('FPS_MISMATCH: con un rapporto di 1,001 nessuna ancora corrisponde, la diagnosi di velocità lo trova', async () => {
  // Ancore da 30 s, come nella taratura vera: con 10 s lo scarto dentro la
  // finestra è solo di 10 ms e la somiglianza resta vicina alla soglia.
  const a = await analyze('reference', 'donor-speed', calibration({ ...cal.values, anchorWindowMs: 30_000 }), '+30s');
  assert.deepEqual(reasons(a), ['FPS_MISMATCH']);
  assert.ok(a.report.anchors.every((x) => x.ncc < 0.35), JSON.stringify(a.report.anchors));
  assert.ok(a.report.anchors.every((x) => x.outcome === 'no-match'), JSON.stringify(a.report.anchors));
  // Nel donatore il film dura 1/1,001 di quello del riferimento.
  assert.equal(a.measurement!.speedRatio, Math.round((1000 / 1001) * 1e6) / 1e6);
});

test('AMBIGUOUS_MATCH: un contenuto che si ripete corrisponde ovunque', async () => {
  const a = await analyze('ref-loop', 'donor-loop');
  assert.deepEqual(reasons(a), ['AMBIGUOUS_MATCH']);
  assert.ok(a.report.anchors.every((x) => x.ncc > 0.9 && x.ratio < 1.2), JSON.stringify(a.report.anchors));
});

test('controlli strutturali falliti: non si legge l\'audio', async () => {
  const a = await analyzePair([await read('reference'), await read('ref-remix')], null, cal);
  assert.deepEqual(reasons(a), ['NO_ITALIAN_AUDIO']);
  assert.equal(a.measurement, null);
  assert.equal(a.plan, null);
});

// ---------------------------------------------------------------- piano

const planWarnings = (a: PairAnalysis) => a.plan!.warnings.map((w) => w.code);

/** Il piano della coppia già misurata, con le scelte date. */
async function replan(a: PairAnalysis, reference: string, donor: string, choices: Record<string, string>) {
  const given = Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, { value: v, origin: 'option' as const }]));
  return planPair(await read(reference), await read(donor), a.report.offset!.offsetMs, a.measurement!.boundaries!, given, cal);
}

test('piano su file veri: con --sync l\'italiano comincia dove comincia il film, o S dopo', async () => {
  // --sync sposta tutto il donatore: l'italiano comincia con il film, e non c'è niente da tagliare.
  const plus = await analyze('reference', 'donor-plus');
  const plan = plus.plan!;
  assert.equal(plan.offsetMs, -1537);
  assert.equal(plan.film.startMs, 0);
  assert.equal(plan.start.case, 'aligned');
  assert.equal(plan.start.cutMs, null);
  assert.equal(plan.end.excess, 'none');
  assert.ok(plan.end.amountMs < 100, String(plan.end.amountMs));
  assert.deepEqual(plan.pending, []);
  assert.deepEqual(planWarnings(plus), []);
  assert.deepEqual(plan.audio.map((t) => [t.id, t.role, t.taken, t.startMs]), [[1, 'main', true, 0]]);

  // Il riferimento ha 263 ms in più all'inizio: l'italiano parte lì, senza taglio.
  const minus = await analyze('reference', 'donor-minus');
  assert.equal(minus.plan!.start.case, 'reference-longer');
  assert.ok(minus.plan!.start.amountMs >= 263 && minus.plan!.start.amountMs < 300, String(minus.plan!.start.amountMs));
  assert.equal(minus.plan!.start.cutMs, null);
  assert.equal(minus.plan!.start.gapMs, minus.plan!.start.amountMs);
  assert.deepEqual(planWarnings(minus), []);
});

test('INTRO_MISMATCH: su file veri l\'italiano di un\'intro diversa si tiene o si scarta (--edge-mismatch)', async () => {
  // Un'intro di 8 s al posto dei primi 5 s: S = −3 s, il donatore ha più intro.
  const a = await analyze('reference', 'donor-intro');
  const plan = a.plan!;
  const boundary = a.measurement!.boundaries!.startMs;
  assert.equal(plan.start.case, 'donor-longer');
  assert.ok(Math.abs(plan.start.amountMs - 3000) < 40, String(plan.start.amountMs));
  assert.deepEqual(plan.pending, ['edgeMismatch']);
  assert.equal(plan.start.mismatchMs, boundary);
  assert.equal(plan.italian.startMs, null);

  // keep: l'italiano dall'inizio del film, sopra l'intro diversa. Si taglia
  // a 0 mentre l'intro del donatore suona già: ABRUPT_START.
  const keep = await replan(a, 'reference', 'donor-intro', { edgeMismatch: 'keep' });
  assert.deepEqual(keep.warnings.map((w) => w.code), ['INTRO_MISMATCH', 'ABRUPT_START']);
  assert.equal(keep.italian.startMs, 0);
  assert.equal(keep.start.cutMs, 0);
  assert.ok(keep.start.cutLevelDbfs! > -30, String(keep.start.cutLevelDbfs));
  // drop: l'italiano dal confine del materiale in comune.
  const drop = await replan(a, 'reference', 'donor-intro', { edgeMismatch: 'drop' });
  assert.equal(drop.italian.startMs, boundary);
  assert.equal(drop.start.cutMs, boundary);
  assert.ok(!drop.warnings.some((w) => w.code === 'INTRO_MISMATCH'));
});

test('TAIL_EXCESS_KEPT: su file veri il donatore ha 20 s di coda in più; --tail trim taglia alla fine del video', async () => {
  const a = await analyze('ref-tail', 'donor');
  assert.equal(a.report.decision, 'eligible', JSON.stringify(a.report.reasons));
  const plan = a.plan!;
  assert.ok(plan.film.endMs > 100_000 && plan.film.endMs < 101_100, String(plan.film.endMs));
  assert.deepEqual(plan.pending, ['tail']);
  assert.equal(plan.end.case, 'donor-longer');
  assert.ok(Math.abs(plan.end.excessMs - (SECONDS * 1000 - plan.film.endMs)) < 100, String(plan.end.excessMs));

  const keep = await replan(a, 'ref-tail', 'donor', { tail: 'keep' });
  assert.deepEqual(keep.warnings.map((w) => w.code), ['TAIL_EXCESS_KEPT']);
  assert.equal(keep.end.excess, 'kept');
  const trim = await replan(a, 'ref-tail', 'donor', { tail: 'trim' });
  assert.deepEqual(trim.warnings, []);
  assert.equal(trim.end.excess, 'trimmed');
  assert.equal(trim.italian.endMs, plan.film.endMs);
});
