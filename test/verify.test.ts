import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMerge, commitBuild, type Build } from '../src/build.js';
import { loadCalibration, parseCalibration } from '../src/calibration.js';
import { DyadrrError } from '../src/codes.js';
import { readInput, type InputFile } from '../src/inputs.js';
import { planMerge, startCuts, type Plan } from '../src/plan.js';
import { PACKET_TOLERANCE_MS, VerifyFailedError, packetToleranceMs, verifyBuild } from '../src/verify.js';
import { run, runAsync, settle, tempDir } from './helpers/mkv.js';
import { writeSup } from './helpers/pgs.js';

// Verifiche dopo il merge su MKV veri, generati al volo (studio §9.5; §15, 1a
// e 1e). Il "film" sono 30 s di rumore rosa in 5.1, un rumore diverso per
// canale: l'italiano ha gli stessi canali dell'inglese tranne il centrale,
// come un doppiaggio, quindi nel file finale italiano e inglese correlano sui
// canali non centrali. Il riferimento ha un video HEVC HDR10 320x180, l'audio
// inglese, un PGS inglese forced e due capitoli; il donatore un video H.264 160x90, l'audio
// italiano e quello inglese, che cominciano 1,5 s dopo nel film: S = +1500 ms.

const SECONDS = 30;
const S = 1500;
const ENGLISH = [1, 2, 3, 4, 5, 6];
const ITALIAN = [1, 2, 7, 4, 5, 6];

// Finestre del trasferimento più corte: il file dura 30 s.
const base = loadCalibration();
const cal = parseCalibration({ version: base.version, provisional: base.provisional, values: { ...base.values, checkpointWindowMs: 3000 } });

const CHAPTERS = 'CHAPTER01=00:00:00.000\nCHAPTER01NAME=Uno\nCHAPTER02=00:00:15.000\nCHAPTER02NAME=Due\n';

let dir: string;
const p = (name: string) => join(dir, name);
let reference: InputFile;
let bareReference: InputFile;
let donor: InputFile;

/** 5.1 di rumori rosa (FL, FR, FC, LFE, BL, BR), uno per seed, in AC3. */
const surround = (name: string, seeds: readonly number[]) => runAsync('ffmpeg', [
  '-v', 'error', '-y', '-filter_complex',
  [
    ...seeds.map((s, i) => `anoisesrc=d=${SECONDS}:c=pink:r=48000:a=0.2:s=${s}[c${i}]`),
    `${seeds.map((_, i) => `[c${i}]`).join('')}join=inputs=6:channel_layout=5.1:map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-BL|5.0-BR[o]`,
  ].join(';'),
  '-map', '[o]', '-c:a', 'ac3', p(name),
]);

before(async () => {
  dir = tempDir();
  await Promise.all([
    runAsync('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24000/1001', '-t', String(SECONDS),
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le',
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
      '-x265-params', 'hdr10=1:max-cll=1000,400:log-level=error', p('ref-video.mkv'),
    ]),
    runAsync('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24000/1001', '-t', String(SECONDS),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', p('donor-video.mkv'),
    ]),
    surround('eng.mka', ENGLISH),
    surround('ita.mka', ITALIAN),
  ]);
  writeSup(p('eng.sup'), [[3, 5], [12, 14]]);
  writeFileSync(p('chapters.txt'), CHAPTERS);
  const referenceArgs = [
    '--chapters', p('chapters.txt'),
    p('ref-video.mkv'),
    '--language', '0:eng', p('eng.mka'),
    '--language', '0:eng', '--forced-display-flag', '0:1', '--compression', '0:none', p('eng.sup'),
  ];
  await Promise.all([
    runAsync('mkvmerge', ['-q', '-o', p('reference.mkv'), '--title', 'Reference', ...referenceArgs]),
    // Lo stesso riferimento senza tag statistici: i pacchetti si contano.
    runAsync('mkvmerge', ['-q', '-o', p('bare.mkv'), '--disable-track-statistics-tags', ...referenceArgs]),
    // Il donatore perde i primi 1,5 s del film.
    runAsync('mkvmerge', [
      '-q', '-o', p('donor.mkv'), p('donor-video.mkv'),
      '--language', '0:ita', '--track-name', '0:Italiano', '--sync', `0:-${S}`, p('ita.mka'),
      '--language', '0:eng', '--sync', `0:-${S}`, p('eng.mka'),
    ]),
  ]);
  reference = await readInput(settle(p('reference.mkv')), { calibration: cal });
  bareReference = await readInput(settle(p('bare.mkv')), { calibration: cal });
  donor = await readInput(settle(p('donor.mkv')), { calibration: cal });
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ---------------------------------------------------------------- aiuti

/** Il piano con lo S dato; nessuna scelta serve: una sola traccia italiana, niente coda in più. */
function plan(offsetMs: number, ref = reference): Plan {
  const input = { reference: ref, donor, offsetMs, commonMaterial: { startMs: S, endMs: SECONDS * 1000 } };
  const cutLevels = startCuts(input).flatMap((c) => c.trackIds.map((trackId) => ({ atMs: c.atMs, trackId, levelDbfs: -90 })));
  const pl = planMerge({ ...input, choices: {}, cutLevels }, cal);
  assert.deepEqual(pl.pending, []);
  return pl;
}

let outputs = 0;
async function build(pl: Plan, ref = reference): Promise<Build> {
  const d = p(`out-${++outputs}`);
  mkdirSync(d);
  return buildMerge({ reference: ref, donor, plan: pl, output: join(d, 'Film.mkv') });
}

/** La traccia della lingua di misura nel riferimento: l'inglese. */
const MEASURE = 1;

const failed = (expected: string[]) => (e: unknown) => {
  assert.ok(e instanceof VerifyFailedError, String(e));
  assert.equal(e.code, 'VERIFY_FAILED');
  assert.deepEqual(e.verification.checks.filter((c) => c.result === 'fail').map((c) => c.name), expected, e.message);
  return true;
};

// ---------------------------------------------------------------- test

test('tolleranze "entro un pacchetto" per codec', () => {
  const t = (codec: string, codecId: string | null) => packetToleranceMs({ codec, codecId });
  assert.equal(t('AC-3', 'A_AC3'), PACKET_TOLERANCE_MS.ac3);
  assert.equal(t('E-AC-3', 'A_EAC3'), PACKET_TOLERANCE_MS.ac3);
  assert.equal(t('DTS-HD Master Audio', 'A_DTS'), PACKET_TOLERANCE_MS.dts);
  assert.equal(t('TrueHD Atmos', 'A_TRUEHD'), PACKET_TOLERANCE_MS.trueHd);
  assert.equal(t('FLAC', 'A_FLAC'), PACKET_TOLERANCE_MS.flac);
  assert.equal(t('AAC', 'A_AAC'), PACKET_TOLERANCE_MS.other);
});

test('verifiche dopo il merge: tracce, video HDR10, pacchetti, inizio e fine dell\'italiano, durata; trasferimento a zero', async () => {
  const pl = plan(S);
  const b = await build(pl);
  const v = await verifyBuild({ reference, plan: pl, measureTrackId: MEASURE }, b, cal);
  assert.equal(v.result, 'pass');
  assert.deepEqual(v.checks.map((c) => [c.name, c.result]), [
    ['layout', 'pass'], ['video', 'pass'], ['reference-tracks', 'pass'], ['italian-tracks', 'pass'], ['duration', 'pass'], ['transfer', 'pass'],
  ]);
  assert.deepEqual(v.warnings, []);
  assert.equal(reference.video.hdr, 'HDR10');
  // L'AC3 italiano comincia sul primo pacchetto dopo lo zero del donatore (4 ms), spostato di S.
  assert.deepEqual(v.italian.map((x) => [x.trackId, x.startMs, x.expectedStartMs, x.toleranceMs]), [[1, S + 4, S + 4, 33]]);
  assert.ok(Math.abs(v.italian[0]!.endMs! - v.italian[0]!.expectedEndMs) <= 1);
  // Il file finisce con l'italiano, oltre la fine del riferimento.
  assert.ok(v.duration!.endMs! >= v.duration!.minMs && v.duration!.endMs! <= v.duration!.maxMs, JSON.stringify(v.duration));
  // Nel file finale italiano e inglese correlano a spostamento zero.
  assert.equal(v.transfer!.confident, 5);
  assert.ok(Math.abs(v.transfer!.offsetMs!) <= 1, String(v.transfer!.offsetMs));
  assert.deepEqual([v.transfer!.measureTrackId, v.transfer!.italianTrackId], [2, 1]);
  await commitBuild(b);
  assert.ok(existsSync(b.output));
});

test('OUTPUT_TRANSFER_OFFSET: con uno S sbagliato di 40 ms le verifiche bloccanti passano, il trasferimento lo trova', async () => {
  // Il file è costruito come previsto da un piano sbagliato: solo il
  // trasferimento sul file finale, una misura indipendente, se ne accorge.
  const pl = plan(S + 40);
  const b = await build(pl);
  const v = await verifyBuild({ reference, plan: pl, measureTrackId: MEASURE }, b, cal);
  assert.equal(v.result, 'pass');
  assert.deepEqual(v.warnings.map((w) => w.code), ['OUTPUT_TRANSFER_OFFSET']);
  // L'italiano arriva 40 ms dopo l'inglese: posizione nell'inglese − posizione nell'italiano.
  assert.ok(Math.abs(v.warnings[0]!.value! + 40) <= 1, String(v.warnings[0]!.value));
  assert.deepEqual(v.checks.find((c) => c.name === 'transfer')!.code, 'OUTPUT_TRANSFER_OFFSET');
  await commitBuild(b);
});

test('riferimento senza tag statistici: i pacchetti delle sue tracce si contano con ffprobe', async () => {
  // ffmpeg scrive solo la durata: mancano i pacchetti (NUMBER_OF_FRAMES).
  assert.ok(bareReference.tracks.every((t) => t.statistics?.frames == null));
  const pl = plan(S, bareReference);
  const b = await build(pl, bareReference);
  const v = await verifyBuild({ reference: bareReference, plan: pl, measureTrackId: MEASURE }, b, cal);
  assert.deepEqual(v.checks.filter((c) => c.blocking).map((c) => c.result), ['pass', 'pass', 'pass', 'pass', 'pass']);
  await commitBuild(b);
});

test('VERIFY_FAILED: un risultato della costruzione alterato, o il file cambiato dopo; la cartella di lavoro si elimina', async () => {
  const pl = plan(S);
  const request = { reference, plan: pl, measureTrackId: MEASURE };

  // Un flag default diverso da quello previsto.
  const flag = await build(pl);
  flag.tracks = flag.tracks.map((t, i) => (i === 1 ? { ...t, default: false } : t));
  await assert.rejects(verifyBuild(request, flag, cal), failed(['layout']));
  assert.ok(!existsSync(flag.jobDir), 'the job folder is removed');

  // L'italiano previsto mezzo secondo dopo: inizio, fine e durata non tornano.
  const late = await build(pl);
  late.tracks = late.tracks.map((t) => (t.expectedStartMs === null ? t : { ...t, expectedStartMs: t.expectedStartMs + 500, expectedEndMs: t.expectedEndMs! + 500 }));
  await assert.rejects(verifyBuild(request, late, cal), (e: unknown) => {
    failed(['italian-tracks', 'duration'])(e);
    assert.match((e as Error).message, /starts at 1504 ms, expected 2004 ms/);
    return true;
  });

  // Il file costruito cambiato dopo: una lingua e il titolo.
  const edited = await build(pl);
  run('mkvpropedit', ['-q', edited.file, '--edit', 'track:2', '--set', 'language=eng', '--edit', 'info', '--set', 'title=Other']);
  await assert.rejects(verifyBuild(request, edited, cal), (e: unknown) => {
    failed(['layout'])(e);
    assert.match((e as Error).message, /language "eng", expected "ita"/);
    assert.match((e as Error).message, /title "Other", expected "Reference"/);
    return true;
  });
  assert.ok(!existsSync(edited.jobDir));

  // Un file finale che non si legge.
  const broken = await build(pl);
  truncateSync(broken.file, 1000);
  await assert.rejects(verifyBuild(request, broken, cal), (e: unknown) => {
    assert.ok(e instanceof DyadrrError && e.code === 'VERIFY_FAILED', String(e));
    return true;
  });
  assert.ok(!existsSync(broken.jobDir));
});

test('capitoli: gli UID possono cambiare, inizi e titoli no', async () => {
  // mkvpropedit con capitoli in formato semplice genera UID nuovi, come ha
  // fatto mkvmerge nel merge di un file di MakeMKV.
  const pl = plan(S);
  const request = { reference, plan: pl, measureTrackId: MEASURE };
  // Gli UID come testo: sono interi a 64 bit.
  const uids = (file: string) => run('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file]).match(/"id": -?\d+/g);

  const renumbered = await build(pl);
  run('mkvpropedit', ['-q', renumbered.file, '--chapters', p('chapters.txt')]);
  assert.notDeepEqual(uids(renumbered.file), uids(reference.path));
  const v = await verifyBuild(request, renumbered, cal);
  assert.equal(v.checks.find((c) => c.name === 'layout')!.result, 'pass');
  await commitBuild(renumbered);

  writeFileSync(p('renamed.txt'), CHAPTERS.replace('Due', 'Tre'));
  const renamed = await build(pl);
  run('mkvpropedit', ['-q', renamed.file, '--chapters', p('renamed.txt')]);
  await assert.rejects(verifyBuild(request, renamed, cal), (e: unknown) => {
    failed(['layout'])(e);
    assert.match((e as Error).message, /chapters .*"title":"Tre".*expected those of the reference .*"title":"Due"/);
    return true;
  });
});
