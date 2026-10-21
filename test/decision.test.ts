import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCalibration } from '../src/calibration.js';
import { DyadrrError } from '../src/codes.js';
import {
  checkStructure,
  decide,
  type AnchorMeasure,
  type CheckpointMeasure,
  type DecisionInput,
  type DecisionReport,
  type FileFacts,
  type Match,
} from '../src/decision.js';

// Serie sintetiche (studio §15, test 1e): nessun file, solo numeri. La coppia
// di base è un UHD inglese come riferimento e un BD italiano come donatore,
// con S = 1234,4 ms, 30 punti di conferma e un rumore di misura di ±1,5 ms.

const cal = loadCalibration();
const FPS = 24000 / 1001;
const DURATION = 7_200_000;
const S = 1234.4;
const START = 2000;
const END = DURATION - 10_000;

const reference = (): FileFacts => ({
  audio: [{ language: 'eng' }],
  video: { width: 3840, height: 2160, hdr: 'HDR10', codec: 'hevc', bitrate: 60e6, fps: FPS, durationMs: DURATION },
  truncated: false,
});
const donor = (): FileFacts => ({
  audio: [{ language: 'ita' }, { language: 'eng' }],
  video: { width: 1920, height: 1080, hdr: 'SDR', codec: 'h264', bitrate: 30e6, fps: 23.976, durationMs: DURATION + 20_000 },
  truncated: false,
});

const noise = (i: number) => 1.5 * Math.sin(i * 12.9898);
const match = (offsetMs: number, ncc = 0.9, ratio = 3): Match => ({ offsetMs, ncc, ratio });
const anchor = (fraction: number, offsetMs = S, ncc = 0.9, ratio = 3): AnchorMeasure => ({
  positionMs: Math.round(DURATION * fraction),
  ...match(offsetMs, ncc, ratio),
});

/** Posizioni distribuite in modo uniforme nel materiale in comune. */
const positions = (n = 30, start = START, end = END) =>
  Array.from({ length: n }, (_, i) => Math.round(start + ((i + 0.5) / n) * (end - start)));

/** Un punto con contenuto e un picco sicuro allo spostamento dato. */
const point = (positionMs: number, offsetMs: number): CheckpointMeasure => ({
  positionMs,
  energyDbfs: -22,
  local: match(offsetMs),
  wide: null,
  added: false,
});

/** Una serie di punti con lo spostamento dato in funzione della posizione. */
const series = (offsetAt: (positionMs: number) => number, pos = positions()) =>
  pos.map((p, i) => point(p, offsetAt(p) + noise(i)));

const base = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
  files: [reference(), donor()],
  originalLanguage: null,
  anchors: [anchor(0.15), anchor(0.25)],
  speedRatio: null,
  checkpoints: series(() => S),
  commonMaterial: { startMs: START, endMs: END, probes: [] },
  transfer: [0.15, 0.4, 0.6, 0.85].map((f) => ({ positionMs: DURATION * f, match: match(0.3, 0.7, 2) })),
  ...overrides,
});

const reasons = (r: DecisionReport) => r.reasons.map((x) => x.code);
const warnings = (r: DecisionReport) => r.warnings.map((x) => x.code);
const result = (r: DecisionReport, name: string) => r.checks.find((c) => c.name === name)?.result;

test('coppia idonea: spostamento costante, nessun avviso', () => {
  const r = decide(base(), cal);
  assert.equal(r.decision, 'eligible');
  assert.deepEqual(reasons(r), []);
  assert.deepEqual(warnings(r), []);
  assert.ok(r.checks.every((c) => c.result === 'pass'), JSON.stringify(r.checks));
  assert.deepEqual(r.roles, { reference: 0, donor: 1 });
  assert.equal(r.measureLanguage?.language, 'eng');
  assert.ok(r.checkpoints.every((p) => p.outcome === 'consistent'));
  assert.equal(r.calibration.version, cal.version);
});

test('S definitivo: mediana dei punti coerenti, intero solo alla fine', () => {
  const r = decide(base(), cal);
  assert.ok(r.offset);
  assert.ok(Math.abs(r.offset.medianMs - S) <= 1.5, String(r.offset.medianMs));
  assert.equal(r.offset.offsetMs, 1234);
  assert.ok(r.offset.dispersionMs <= 1.5);

  const negative = -2500.6;
  const n = decide(base({
    anchors: [anchor(0.15, negative)],
    checkpoints: positions().map((p) => point(p, negative)),
  }), cal);
  assert.equal(n.decision, 'eligible');
  assert.equal(n.offset?.offsetMs, -2501);
});

test('ruoli: il donatore è l\'unico file con audio italiano, in qualunque ordine', () => {
  const r = decide(base({ files: [donor(), reference()] }), cal);
  assert.equal(r.decision, 'eligible');
  assert.deepEqual(r.roles, { reference: 1, donor: 0 });
});

test('NO_ITALIAN_AUDIO: nessuno dei due file ha audio italiano; i controlli seguenti sono saltati', () => {
  // Un file con soli sottotitoli italiani non è un donatore: contano le tracce audio.
  const r = decide(base({ files: [reference(), { ...donor(), audio: [{ language: 'eng' }] }] }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['NO_ITALIAN_AUDIO']);
  assert.equal(result(r, 'roles'), 'fail');
  assert.ok(r.checks.slice(1).every((c) => c.result === 'skipped'));
  assert.equal(r.roles, null);
});

test('BOTH_ITALIAN_AUDIO: entrambi i file hanno audio italiano', () => {
  const r = decide(base({ files: [{ ...reference(), audio: [{ language: 'it' }] }, donor()] }), cal);
  assert.deepEqual(reasons(r), ['BOTH_ITALIAN_AUDIO']);
});

test('NO_COMMON_LANGUAGE: nessuna lingua di misura in comune', () => {
  const r = decide(base({ files: [{ ...reference(), audio: [{ language: 'jpn' }] }, donor()] }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['NO_COMMON_LANGUAGE']);
});

test('ORIGINAL_LANGUAGE_NOT_COMMON: la lingua originale non è in entrambi i file', () => {
  const r = decide(base({ originalLanguage: 'jpn' }), cal);
  assert.equal(r.decision, 'eligible');
  assert.deepEqual(warnings(r), ['ORIGINAL_LANGUAGE_NOT_COMMON']);
  assert.equal(r.measureLanguage?.language, 'eng');
  assert.equal(r.measureLanguage?.originalLanguage, 'jpn');
});

test('DONOR_BETTER_VIDEO: risoluzione più alta, o HDR più alto a parità di risoluzione', () => {
  const sharper = donor();
  sharper.video = { ...sharper.video, width: 3840, height: 2160, hdr: 'SDR' };
  const r1 = decide(base({ files: [{ ...reference(), video: { ...reference().video, width: 1920, height: 1080 } }, sharper] }), cal);
  assert.deepEqual(reasons(r1), ['DONOR_BETTER_VIDEO']);

  const dv = donor();
  dv.video = { ...dv.video, width: 3840, height: 2160, hdr: 'DV' };
  const r2 = decide(base({ files: [reference(), dv] }), cal);
  assert.deepEqual(reasons(r2), ['DONOR_BETTER_VIDEO']);

  // La risoluzione viene prima dell'HDR: un donatore 1080p DV non è migliore di un 2160p SDR.
  const sdr = reference();
  sdr.video = { ...sdr.video, hdr: 'SDR' };
  const dv1080 = donor();
  dv1080.video = { ...dv1080.video, hdr: 'DV' };
  assert.equal(decide(base({ files: [sdr, dv1080] }), cal).decision, 'eligible');
});

test('VIDEO_QUALITY_UNCERTAIN: stessa risoluzione, HDR e codec, bitrate del donatore oltre il margine', () => {
  const bd = (bitrate: number | null): FileFacts['video'] =>
    ({ width: 1920, height: 1080, hdr: 'SDR', codec: 'h264', bitrate, fps: FPS, durationMs: DURATION });

  const r = decide(base({ files: [{ ...reference(), video: bd(20e6) }, { ...donor(), video: bd(30e6) }] }), cal);
  assert.equal(r.decision, 'eligible');
  assert.deepEqual(warnings(r), ['VIDEO_QUALITY_UNCERTAIN']);
  assert.equal(r.warnings[0]?.value, 0.5);

  // Dentro il margine: niente avviso.
  const within = decide(base({ files: [{ ...reference(), video: bd(20e6) }, { ...donor(), video: bd(23e6) }] }), cal);
  assert.deepEqual(warnings(within), []);

  // Bitrate sconosciuto: il criterio si salta e il report lo dice.
  const unknown = decide(base({ files: [{ ...reference(), video: bd(null) }, { ...donor(), video: bd(30e6) }] }), cal);
  assert.deepEqual(warnings(unknown), []);
  assert.match(unknown.checks.find((c) => c.name === 'video')?.detail ?? '', /bitrate unknown/);
});

test('FPS_MISMATCH: framerate diversi nei metadati; 23,976 scritto in modi diversi è uguale', () => {
  const pal = donor();
  pal.video = { ...pal.video, fps: 24 };
  const r = decide(base({ files: [reference(), pal] }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['FPS_MISMATCH']);
  assert.equal(result(r, 'framerate'), 'fail');
  // La riga 'donor' di base ha 23.976, il riferimento 24000/1001.
  assert.equal(result(decide(base(), cal), 'framerate'), 'pass');
});

test('FPS_MISMATCH: la diagnosi di velocità trova un rapporto 1,001', () => {
  const r = decide(base({ anchors: [anchor(0.15, S, 0.1), anchor(0.25, S, 0.12)], speedRatio: 1.001 }), cal);
  assert.deepEqual(reasons(r), ['FPS_MISMATCH']);
  assert.equal(result(r, 'anchor-match'), 'fail');
});

test('PAL_SPEEDUP: la diagnosi di velocità trova un rapporto PAL, in un verso o nell\'altro', () => {
  for (const ratio of [25 / 24, 24 / 25, 23.976 / 25]) {
    const r = decide(base({ anchors: [anchor(0.15, S, 0.1)], speedRatio: ratio }), cal);
    assert.deepEqual(reasons(r), ['PAL_SPEEDUP'], String(ratio));
  }
});

test('INPUT_TRUNCATED: un ingresso troncato è un errore, non un rifiuto', () => {
  const r = decide(base({ files: [reference(), { ...donor(), truncated: true }] }), cal);
  assert.equal(r.decision, 'error');
  assert.deepEqual(reasons(r), ['INPUT_TRUNCATED']);
  assert.equal(result(r, 'anchor-match'), 'skipped');
});

test('NO_MATCH: nessuna ancora abbastanza somigliante', () => {
  const r = decide(base({ anchors: [0.15, 0.25, 0.35, 0.5].map((f) => anchor(f, S, 0.3)) }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['NO_MATCH']);
  assert.ok(r.anchors.every((a) => a.outcome === 'no-match'));
});

test('AMBIGUOUS_MATCH: ancore somiglianti ma non uniche', () => {
  const r = decide(base({ anchors: [0.15, 0.25, 0.35, 0.5].map((f) => anchor(f, S, 0.9, 1.1)) }), cal);
  assert.deepEqual(reasons(r), ['AMBIGUOUS_MATCH']);
  assert.ok(r.anchors.every((a) => a.outcome === 'ambiguous'));
});

test('OFFSET_TOO_LARGE: picco sicuro oltre lo spostamento massimo', () => {
  const r = decide(base({ anchors: [anchor(0.15, -200_000)] }), cal);
  assert.deepEqual(reasons(r), ['OFFSET_TOO_LARGE']);
  assert.equal(r.checks.find((c) => c.name === 'offset-range')?.threshold, cal.values.maxOffsetMs);
});

test('CHECKPOINT_CONTRADICTION: due ancore sicure con spostamenti diversi', () => {
  const r = decide(base({ anchors: [anchor(0.15), anchor(0.25, S + 500)] }), cal);
  assert.deepEqual(reasons(r), ['CHECKPOINT_CONTRADICTION']);
  assert.equal(result(r, 'anchor-agreement'), 'fail');
  assert.deepEqual(r.anchors.map((a) => a.outcome), ['accepted', 'disagrees']);
  assert.equal(r.contradiction?.kind, 'single-jump');
  // Un'ancora non sicura non conta, e una sola ancora sicura basta: confermano i punti.
  const single = decide(base({ anchors: [anchor(0.15, S, 0.3), anchor(0.25)] }), cal);
  assert.equal(single.decision, 'eligible');
  assert.deepEqual(single.anchors.map((a) => a.outcome), ['no-match', 'accepted']);
});

test('MEASURE_MIX_DIFFERS: somiglianza nella fascia bassa ma sufficiente', () => {
  const ncc = cal.values.nccMin + cal.values.measureMixDiffersBand / 2;
  const r = decide(base({ anchors: [anchor(0.15, S, ncc), anchor(0.25, S, ncc)] }), cal);
  assert.equal(r.decision, 'eligible');
  assert.deepEqual(warnings(r), ['MEASURE_MIX_DIFFERS']);
});

test('DRIFT: lo spostamento cresce nel tempo, e risulta deriva e non contraddizione', () => {
  // 30 ms su tutto il film: molti punti sono fuori tolleranza dallo S delle ancore.
  const drifting = (p: number) => S + (30 * p) / DURATION;
  const r = decide(base({ anchors: [anchor(0.15, drifting(DURATION * 0.15))], checkpoints: series(drifting) }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['DRIFT']);
  assert.ok(r.checkpoints.some((p) => p.outcome === 'contradictory'));
  assert.equal(result(r, 'contradiction'), 'skipped');
  assert.ok(r.drift && Math.abs(r.drift.msPerHour - 15) < 1, JSON.stringify(r.drift));
  assert.ok(r.drift.totalMs > cal.values.toleranceMs);

  // Anche se tutti i punti restano entro la tolleranza, conta la deriva totale.
  const centered = (p: number) => S + (16 * (p - DURATION / 2)) / DURATION;
  const r2 = decide(base({ checkpoints: series(centered) }), cal);
  assert.ok(r2.checkpoints.every((p) => p.outcome === 'consistent'));
  assert.deepEqual(reasons(r2), ['DRIFT']);

  // Una deriva totale sotto la tolleranza passa.
  const slight = (p: number) => S + (5 * p) / DURATION;
  assert.equal(decide(base({ checkpoints: series(slight) }), cal).decision, 'eligible');
});

test('CHECKPOINT_CONTRADICTION: un salto di due fotogrammi a metà film', () => {
  const jump = 2000 / FPS;
  const r = decide(base({ checkpoints: series((p) => (p < DURATION / 2 ? S : S + jump)) }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['CHECKPOINT_CONTRADICTION']);
  assert.equal(result(r, 'drift'), 'pass');
  assert.equal(r.contradiction?.kind, 'single-jump');
  const j = r.contradiction.jumps[0]!;
  assert.equal(j.frames, 2);
  assert.ok(j.afterMs < DURATION / 2 && j.beforeMs > DURATION / 2);
});

test('CHECKPOINT_CONTRADICTION: più salti, oppure rumore', () => {
  const steps = decide(base({
    checkpoints: series((p) => S + 42 * Math.floor((3 * p) / DURATION)),
  }), cal);
  assert.deepEqual(reasons(steps), ['CHECKPOINT_CONTRADICTION']);
  assert.equal(steps.contradiction?.kind, 'multiple-jumps');
  assert.equal(steps.contradiction.jumps.length, 2);

  const pos = positions();
  const outlier = decide(base({ checkpoints: series((p) => (p === pos[12] ? S + 300 : S), pos) }), cal);
  assert.deepEqual(reasons(outlier), ['CHECKPOINT_CONTRADICTION']);
  assert.equal(outlier.contradiction?.kind, 'noise');

  // Come Thor: Ragnarok (UHD e BD), un punto solo a ciascun bordo, -27 ms
  // all'inizio e un fotogramma nei titoli di coda: due salti, non rumore.
  const edges = decide(base({
    checkpoints: series((p) => (p === pos[0] ? S - 27 : p === pos[29] ? S + 42 : S), pos),
  }), cal);
  assert.deepEqual(reasons(edges), ['CHECKPOINT_CONTRADICTION']);
  assert.equal(edges.contradiction?.kind, 'multiple-jumps');
  assert.deepEqual(edges.contradiction.jumps.map((j) => Math.round(Math.abs(j.frames))), [1, 1]);
});

test('CHECKPOINT_CONTRADICTION: il film continua a un altro spostamento oltre il confine', () => {
  const probe = { side: 'end' as const, positionMs: END + 5000, match: match(S + 4000) };
  const r = decide(base({ commonMaterial: { startMs: START, endMs: END, probes: [probe] } }), cal);
  assert.deepEqual(reasons(r), ['CHECKPOINT_CONTRADICTION']);
  assert.equal(result(r, 'edges'), 'fail');
  assert.equal(r.contradiction?.kind, 'single-jump');

  // Una coda davvero diversa: nessuna corrispondenza oltre il confine.
  const different = decide(base({
    commonMaterial: { startMs: START, endMs: END, probes: [{ ...probe, match: match(S + 4000, 0.2) }] },
  }), cal);
  assert.equal(different.decision, 'eligible');
});

test('CHECKPOINT_UNMATCHED: un tratto con contenuto non trova corrispondenza da nessuna parte', () => {
  // Una scena in più nel donatore verso la fine: contenuto, ma nessun picco sicuro.
  const pts = series(() => S).map((p, i) => (i >= 26 ? { ...p, local: match(S, 0.2, 1.1), wide: match(S + 9000, 0.25) } : p));
  const r = decide(base({ checkpoints: pts }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['CHECKPOINT_UNMATCHED']);
  assert.equal(r.checkpoints.filter((p) => p.outcome === 'unmatched').length, 4);
});

test('punti: il non conclusivo si decide dall\'energia; la ricerca ampia può dare contraddizione', () => {
  const pos = positions();
  const pts = series(() => S, pos);
  pts[3] = { ...pts[3]!, energyDbfs: -70, local: null };             // muto: non conclusivo
  pts[4] = { ...pts[4]!, energyDbfs: -70 };                          // muto anche con un picco
  pts[5] = { ...pts[5]!, local: null, wide: match(S + 0.5) };        // ritrovato allo stesso S
  const r = decide(base({ checkpoints: pts }), cal);
  assert.deepEqual(r.checkpoints.slice(3, 6).map((p) => p.outcome), ['inconclusive', 'inconclusive', 'consistent']);
  assert.equal(r.decision, 'eligible');

  pts[6] = { ...pts[6]!, local: null, wide: match(S + 3000) };       // ritrovato altrove
  const c = decide(base({ checkpoints: pts }), cal);
  assert.equal(c.checkpoints[6]?.outcome, 'contradictory');
  assert.deepEqual(reasons(c), ['CHECKPOINT_CONTRADICTION']);
});

test('TOO_FEW_CHECKPOINTS: meno di 20 punti coerenti', () => {
  const r = decide(base({ checkpoints: series(() => S, positions(15)) }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['TOO_FEW_CHECKPOINTS']);
  assert.match(r.reasons[0]!.message, /15 consistent checkpoints/);
});

test('TOO_FEW_CHECKPOINTS: un buco oltre 15 minuti tra punti coerenti', () => {
  const pos = positions(40).filter((p) => p < DURATION * 0.3 || p > DURATION * 0.6);
  const r = decide(base({ checkpoints: series(() => S, pos) }), cal);
  assert.deepEqual(reasons(r), ['TOO_FEW_CHECKPOINTS']);
  assert.match(r.reasons[0]!.message, /gap of/);
});

test('TOO_FEW_CHECKPOINTS: nessun punto coerente nell\'ultimo 10% del materiale in comune', () => {
  const pos = positions(30).filter((p) => p < START + (END - START) * 0.88);
  const r = decide(base({ checkpoints: series(() => S, pos) }), cal);
  assert.deepEqual(reasons(r), ['TOO_FEW_CHECKPOINTS']);
  assert.match(r.reasons[0]!.message, /last 10%/);
});

test('LOW_COVERAGE: il materiale in comune copre troppo poco del video di riferimento', () => {
  const [start, end] = [600_000, 6_600_000];
  const r = decide(base({
    checkpoints: series(() => S, positions(30, start, end)),
    commonMaterial: { startMs: start, endMs: end, probes: [] },
  }), cal);
  assert.equal(r.decision, 'refused');
  assert.deepEqual(reasons(r), ['LOW_COVERAGE']);
  assert.equal(r.commonMaterial?.coverage, 0.8333);
});

test('MANY_INCONCLUSIVE: più del 10% di punti non conclusivi, copertura comunque sufficiente', () => {
  const pts = series(() => S).map((p, i) => (i % 6 === 3 ? { ...p, energyDbfs: -65, local: null } : p));
  const r = decide(base({ checkpoints: pts }), cal);
  assert.equal(r.decision, 'eligible');
  assert.deepEqual(warnings(r), ['MANY_INCONCLUSIVE']);
  assert.equal(r.warnings[0]?.value, 0.1667);
});

test('ITALIAN_TRANSFER_OFFSET: nel donatore l\'italiano è sfasato rispetto alla lingua di misura', () => {
  const r = decide(base({ transfer: [0.2, 0.5, 0.8].map((f) => ({ positionMs: DURATION * f, match: match(41.7, 0.7, 2) })) }), cal);
  assert.equal(r.decision, 'eligible');
  assert.deepEqual(warnings(r), ['ITALIAN_TRANSFER_OFFSET']);
  assert.equal(r.warnings[0]?.value, 41.7);
  assert.equal(result(r, 'transfer'), 'fail');
});

test('ITALIAN_UNVERIFIED: l\'italiano non correla con la lingua di misura', () => {
  const r = decide(base({ transfer: [0.2, 0.5, 0.8].map((f) => ({ positionMs: DURATION * f, match: null })) }), cal);
  assert.equal(r.decision, 'eligible');
  assert.deepEqual(warnings(r), ['ITALIAN_UNVERIFIED']);
});

test('INTERNAL: mancano le misure di una fase che serve', () => {
  const { checkpoints: _, ...withoutCheckpoints } = base();
  assert.throws(
    () => decide(withoutCheckpoints, cal),
    (e) => e instanceof DyadrrError && e.code === 'INTERNAL',
  );
  // Dopo un rifiuto strutturale le misure non servono.
  const { anchors: __, ...withoutAnchors } = base({ files: [reference(), reference()] });
  assert.deepEqual(reasons(decide(withoutAnchors, cal)), ['NO_ITALIAN_AUDIO']);
});

test('solo i controlli strutturali: dicono se vale la pena misurare', () => {
  const ok = checkStructure({ files: [reference(), donor()], originalLanguage: null }, cal);
  assert.equal(ok.decision, 'eligible');
  assert.deepEqual(ok.roles, { reference: 0, donor: 1 });
  assert.equal(ok.measureLanguage?.language, 'eng');
  for (const name of ['roles', 'measure-language', 'video', 'framerate', 'integrity']) assert.equal(result(ok, name), 'pass');
  assert.ok(ok.checks.slice(5).every((c) => c.result === 'skipped'));

  // Un rifiuto strutturale è già il report definitivo, uguale a quello di decide.
  const better = { ...donor(), video: { ...reference().video, width: 7680, height: 4320 } };
  const refused = checkStructure({ files: [reference(), better], originalLanguage: null }, cal);
  assert.deepEqual(refused, decide({ files: [reference(), better], originalLanguage: null }, cal));
  assert.deepEqual(reasons(refused), ['DONOR_BETTER_VIDEO']);
});
