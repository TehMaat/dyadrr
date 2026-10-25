import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  buildMerge,
  commitBuild,
  firstTrueHdSync,
  hexDumpBytes,
  mkvmergeOutcome,
  removeStaleJobs,
  splitTimestamp,
  subtitleOnScreen,
  textOnScreen,
  type Build,
} from '../src/build.js';
import { loadCalibration } from '../src/calibration.js';
import type { GivenChoices } from '../src/choices.js';
import { DyadrrError } from '../src/codes.js';
import { readInput, type InputFile } from '../src/inputs.js';
import { planMerge, startCuts, type Plan } from '../src/plan.js';
import { DEFAULT_TOOLS } from '../src/tools.js';
import { verifyBuild } from '../src/verify.js';
import { run, runAsync, settle, tempDir } from './helpers/mkv.js';
import { writeSup } from './helpers/pgs.js';

// Costruzione su MKV veri, generati al volo (studio §6, §7; §15, 1a). Il
// riferimento ha video 320x180, audio inglese AC3, un PGS inglese forced non
// compresso, un PGS italiano e i suoi capitoli. Il donatore ha video 160x90,
// audio italiano in AC3, TrueHD e FLAC, audio inglese, un PGS italiano
// "Forzati" non compresso e uno completo compresso, e capitoli suoi. Un
// secondo donatore ha gli stessi sottotitoli in testo: SubRip "Forzati"
// compresso e SSA/ASS completo. Tutto dura 30 s. Il piano si calcola con
// `planMerge` da uno S e da confini dati, senza misurare.

const SECONDS = 30;
const cal = loadCalibration();

let dir: string;
const p = (name: string) => join(dir, name);
let reference: InputFile;
let donor: InputFile;
let textDonor: InputFile;

/** Sottotitoli completi e forced del donatore, in secondi. */
const FULL: [number, number][] = [[2, 4], [5, 7], [10, 12], [15, 17], [20, 22], [24.5, 27.5]];
const FORCED: [number, number][] = [[5.2, 6], [25, 27]];

before(async () => {
  dir = tempDir();
  const video = (name: string, size: string) => runAsync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24000/1001`, '-t', String(SECONDS),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', p(name),
  ]);
  const tone = (name: string, frequency: number, codec: string) => runAsync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${frequency}:sample_rate=48000:duration=${SECONDS}`,
    '-ac', '2', '-c:a', codec, ...(codec === 'truehd' ? ['-strict', '-2'] : []), p(name),
  ]);
  await Promise.all([
    video('ref-video.mkv', '320x180'),
    video('donor-video.mkv', '160x90'),
    tone('eng.mka', 300, 'ac3'),
    tone('ita-ac3.mka', 440, 'ac3'),
    tone('ita-truehd.mka', 550, 'truehd'),
    tone('ita-flac.mka', 660, 'flac'),
  ]);
  writeSup(p('ref-eng.sup'), [[3, 5], [12, 14]]);
  writeSup(p('ref-ita.sup'), [[8, 9]]);
  writeSup(p('ita-full.sup'), FULL);
  writeSup(p('ita-forced.sup'), FORCED);
  const srt = (cues: [number, number][]) => cues.map(([a, b], i) => `${i + 1}\n${splitTimestamp(a * 1000).replace('.', ',')} --> ${splitTimestamp(b * 1000).replace('.', ',')}\nRiga ${i + 1}\n`).join('\n');
  writeFileSync(p('ita-forced.srt'), srt(FORCED));
  writeFileSync(p('ita-full.srt'), srt(FULL));
  await runAsync('ffmpeg', ['-v', 'error', '-y', '-i', p('ita-full.srt'), p('ita-full.ass')]);
  writeFileSync(p('ref-chapters.txt'), 'CHAPTER01=00:00:00.000\nCHAPTER01NAME=Uno\nCHAPTER02=00:00:15.000\nCHAPTER02NAME=Due\n');
  writeFileSync(p('donor-chapters.txt'), 'CHAPTER01=00:00:00.000\nCHAPTER01NAME=A\nCHAPTER02=00:00:10.000\nCHAPTER02NAME=B\nCHAPTER03=00:00:20.000\nCHAPTER03NAME=C\n');

  await Promise.all([
    runAsync('mkvmerge', [
      '-q', '-o', p('reference.mkv'), '--title', 'Reference', '--chapters', p('ref-chapters.txt'),
      p('ref-video.mkv'),
      '--language', '0:eng', p('eng.mka'),
      '--language', '0:eng', '--compression', '0:none', '--forced-display-flag', '0:1', p('ref-eng.sup'),
      '--language', '0:ita', p('ref-ita.sup'),
    ]),
    runAsync('mkvmerge', [
      '-q', '-o', p('donor.mkv'), '--title', 'Donor', '--chapters', p('donor-chapters.txt'),
      p('donor-video.mkv'),
      '--language', '0:ita', '--track-name', '0:Italiano', p('ita-ac3.mka'),
      '--language', '0:ita', p('ita-truehd.mka'),
      '--language', '0:ita', p('ita-flac.mka'),
      '--language', '0:eng', p('eng.mka'),
      '--language', '0:ita', '--track-name', '0:Forzati', '--compression', '0:none', p('ita-forced.sup'),
      '--language', '0:ita', p('ita-full.sup'),
    ]),
    runAsync('mkvmerge', [
      '-q', '-o', p('text-donor.mkv'), '--title', 'Donor',
      p('donor-video.mkv'),
      '--language', '0:ita', '--track-name', '0:Italiano', p('ita-ac3.mka'),
      '--language', '0:eng', p('eng.mka'),
      '--language', '0:ita', '--track-name', '0:Forzati', '--compression', '0:zlib', p('ita-forced.srt'),
      '--language', '0:ita', p('ita-full.ass'),
    ]),
  ]);
  reference = await readInput(settle(p('reference.mkv')), { calibration: cal });
  donor = await readInput(settle(p('donor.mkv')), { calibration: cal });
  textDonor = await readInput(settle(p('text-donor.mkv')), { calibration: cal });
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ---------------------------------------------------------------- aiuti

const code = (expected: string) => (e: unknown) => {
  assert.ok(e instanceof DyadrrError, String(e));
  assert.equal(e.code, expected, e.message);
  return true;
};

function choices(values: Record<string, string>): GivenChoices {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, origin: 'option' }])) as GivenChoices;
}

/** Il piano con S e confini dati; il livello nei punti di taglio iniziale non conta qui. */
function plan(offsetMs: number, values: Record<string, string>, common?: { startMs: number; endMs: number }, from = donor): Plan {
  const commonMaterial = common ?? { startMs: 0, endMs: SECONDS * 1000 };
  const input = { reference, donor: from, offsetMs, commonMaterial };
  const cutLevels = startCuts(input).flatMap((c) => c.trackIds.map((trackId) => ({ atMs: c.atMs, trackId, levelDbfs: -90 })));
  return planMerge({ ...input, choices: choices(values), cutLevels }, cal);
}

let outputs = 0;
/** Una cartella di uscita nuova per ogni costruzione. */
function outDir(): string {
  const d = p(`out-${++outputs}`);
  mkdirSync(d);
  return d;
}

/** Tracce di un file finale, con i campi che controlla la costruzione. */
async function final(path: string) {
  const input = await readInput(settle(path), { calibration: cal });
  const json = JSON.parse(run('mkvmerge', ['-J', path])) as { chapters: { num_entries: number }[]; container: { properties: { title?: string } } };
  return { input, chapters: json.chapters.map((c) => c.num_entries), title: json.container.properties.title ?? null };
}

/** Il primo blocco di ogni traccia (ID di mkvmerge): fotogramma chiave e timestamp in ms. */
function firstBlocks(path: string): Map<number, { key: boolean; ms: number }> {
  const numbers = new Map<number, number>();
  const blocks = new Map<number, { key: boolean; ms: number }>();
  const text = execFileSync('mkvinfo', ['-v', path], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  for (const line of text.split('\n')) {
    const t = /Track number: (\d+) \(track ID for mkvmerge & mkvextract: (\d+)\)/.exec(line);
    if (t) numbers.set(Number(t[1]), Number(t[2]));
    const b = /Simple block: (key, )?track number (\d+), .*timestamp (\d+):(\d+):(\d+\.\d+)/.exec(line);
    if (b) {
      const id = numbers.get(Number(b[2]))!;
      const ms = (Number(b[3]) * 3600 + Number(b[4]) * 60 + Number(b[5])) * 1000;
      if (!blocks.has(id)) blocks.set(id, { key: b[1] !== undefined, ms: Math.round(ms * 1000) / 1000 });
    }
  }
  return blocks;
}

/** Timestamp dei blocchi di una traccia, in ms. */
function blockTimes(path: string, trackId: number): number[] {
  return run('ffprobe', ['-v', 'error', '-select_streams', String(trackId), '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', path])
    .trim().split('\n').filter((l) => l !== '').map((l) => Math.round(Number(l) * 1000));
}

const layout = (b: Build) => b.tracks.map((t) => `${t.source[0]}${t.sourceTrackId}`);

/**
 * Le verifiche dopo il merge (§9.5): passano tutte quelle bloccanti. L'italiano
 * e l'inglese sono toni diversi, quindi il trasferimento non correla mai.
 */
async function verified(pl: Plan, b: Build) {
  const v = await verifyBuild({ reference, plan: pl, measureTrackId: 1 }, b, cal);
  assert.deepEqual(v.checks.map((c) => [c.name, c.result]), [
    ['layout', 'pass'], ['video', 'pass'], ['reference-tracks', 'pass'], ['italian-tracks', 'pass'], ['duration', 'pass'], ['transfer', 'fail'],
  ], JSON.stringify(v.checks));
  return v;
}

// ---------------------------------------------------------------- test puri

test('comandi: tempi di --split, dump di ffprobe, punti di sincronizzazione TrueHD, sottotitolo a schermo', () => {
  assert.equal(splitTimestamp(0), '00:00:00.000');
  assert.equal(splitTimestamp(25_500), '00:00:25.500');
  assert.equal(splitTimestamp(7_384_041.6), '02:03:04.042');

  const dump = '\n00000000: d03c f458 f872 6fba 0050 a001 b752 0000  .<.X.ro..P...R..\n00000010: 0000 8c                                  ...\n';
  assert.equal(hexDumpBytes(dump).toString('hex'), 'd03cf458f8726fba0050a001b752000000008c');

  const sync = Buffer.from('d03cf458f8726fba', 'hex');
  const plain = Buffer.from('500cf4a860092772', 'hex');
  // Il primo punto letto non conta: dopo una ricerca può avere il tempo sbagliato.
  const thd = [[990, sync], [994, plain], [1003, sync], [1010, plain], [1016, sync]].map(([ptsMs, data]) => ({ ptsMs: ptsMs as number, data: data as Buffer }));
  assert.equal(firstTrueHdSync(thd, 1000), 1003);
  assert.equal(firstTrueHdSync(thd, 1004), 1016);
  assert.equal(firstTrueHdSync(thd, 1017), null);

  const pcs = (objects: number) => Buffer.from([0x16, 0, 11, 7, 0x80, 4, 0x38, 0x10, 0, 1, 0x80, 0, 0, objects]);
  const subs = [{ ptsMs: 2000, data: pcs(1) }, { ptsMs: 4000, data: pcs(0) }, { ptsMs: 5000, data: pcs(1) }, { ptsMs: 5500, data: pcs(1) }, { ptsMs: 7000, data: pcs(0) }];
  assert.equal(subtitleOnScreen(subs, 3000), 2000);
  assert.equal(subtitleOnScreen(subs, 4500), null);
  // Un aggiornamento a metà non cambia l'inizio del sottotitolo.
  assert.equal(subtitleOnScreen(subs, 6000), 5000);
  assert.equal(subtitleOnScreen(subs, 5000), null);
  assert.equal(subtitleOnScreen(subs, 8000), null);

  // Testo: a schermo dall'inizio del blocco alla fine della sua durata.
  const cues = [{ ptsMs: 2000, durationMs: 2000 }, { ptsMs: 5000, durationMs: 2000 }, { ptsMs: 5500, durationMs: 3000 }, { ptsMs: 9000, durationMs: null }]
    .map((c) => ({ ...c, data: Buffer.alloc(0) }));
  assert.equal(textOnScreen(cues, 3000), 2000);
  assert.equal(textOnScreen(cues, 4000), null);
  assert.equal(textOnScreen(cues, 2000), null);
  // Due righe insieme: l'inizio della prima.
  assert.equal(textOnScreen(cues, 6000), 5000);
  assert.equal(textOnScreen(cues, 8000), 5500);
  assert.equal(textOnScreen(cues, 9500), null);
});

test('esito di mkvmerge: 0 e 1 riusciti con gli avvisi, 2 fallito; il disco pieno è NO_SPACE, non MERGE_FAILED', () => {
  const ok = mkvmergeOutcome({ exitCode: 1, stderr: '', stdout: '#GUI#progress 50%\n#GUI#warning something odd\n#GUI#progress 100%\n' });
  assert.deepEqual(ok, { ok: true, warnings: ['something odd'], errors: [], noSpace: false });
  const failed = mkvmergeOutcome({ exitCode: 2, stderr: '', stdout: '#GUI#error Could not open the output file\n' });
  assert.deepEqual([failed.ok, failed.errors, failed.noSpace], [false, ['Could not open the output file'], false]);
  const full = mkvmergeOutcome({ exitCode: 2, stderr: '', stdout: '#GUI#error Could not write to the output file: No space left on device\n' });
  assert.equal(full.noSpace, true);
  assert.equal(mkvmergeOutcome({ exitCode: null, stderr: '', stdout: '' }).ok, false);
});

// ---------------------------------------------------------------- costruzioni

test('costruzione con S > 0 e --tail trim: ordine, flag, compressione, capitoli, coda tagliata anche in FLAC', async () => {
  const pl = plan(1500, { italian: 'all', tail: 'trim', referenceItalianSubs: 'keep' });
  assert.deepEqual(pl.pending, []);
  assert.equal(pl.end.excess, 'trimmed');
  const out = join(outDir(), 'Film.mkv');
  const progress: string[] = [];
  const build = await buildMerge({ reference, donor, plan: pl, output: out }, { onProgress: (x) => progress.push(`${x.phase}:${x.step}/${x.steps}`) });
  // Intermedio con una sola passata, coda con --split e con ffmpeg per FLAC, unione.
  assert.deepEqual(build.commands.map((c) => [c.tool, c.exitCode]), [['mkvmerge', 0], ['mkvmerge', 0], ['ffmpeg', 0], ['mkvmerge', 0]]);
  assert.deepEqual([...new Set(progress)], ['intermediate:1/4', 'intermediate:2/4', 'intermediate:3/4', 'merge:4/4']);
  assert.deepEqual(build.warnings, []);
  assert.equal(build.startCutMs, null);
  assert.equal(build.endCutMs, Math.round(pl.film.endMs));
  assert.equal(build.space.italianEstimated, false);
  assert.ok(!existsSync(out), 'renamed before the checks');

  // Video, audio italiano (principale per primo), audio del riferimento, PGS
  // italiani (forced per primi), sottotitoli del riferimento.
  assert.deepEqual(layout(build), ['r0', 'd1', 'd2', 'd3', 'r1', 'd5', 'd6', 'r2', 'r3']);
  // Le verifiche: alla fine AC3 e FLAC finiscono sul pacchetto a cavallo del
  // taglio, TrueHD sul primo punto di sincronizzazione dopo.
  const v = await verified(pl, build);
  assert.deepEqual(v.warnings.map((w) => w.code), ['OUTPUT_TRANSFER_UNVERIFIED']);
  assert.deepEqual(v.italian.map((x) => [x.codec, x.toleranceMs]), [['AC-3', 33], ['TrueHD', 108], ['FLAC', 97]]);
  for (const x of v.italian) assert.ok(x.endMs! >= x.expectedEndMs && x.endMs! <= x.expectedEndMs + x.toleranceMs, JSON.stringify(x));
  await commitBuild(build);
  assert.ok(existsSync(out));
  assert.deepEqual(readdirSync(join(out, '..')), ['Film.mkv'], 'the temporary folder is removed');

  const { input, chapters, title } = await final(out);
  assert.deepEqual(chapters, [2], 'only the reference chapters');
  assert.equal(title, 'Reference');
  const tracks = input.tracks.map((t) => [t.type, t.language, t.name, t.default, t.forced, t.compression]);
  assert.deepEqual(tracks, [
    ['video', 'und', null, true, false, null],
    ['audio', 'ita', 'Italiano', true, false, null],
    ['audio', 'ita', null, false, false, null],
    ['audio', 'ita', null, false, false, null],
    ['audio', 'eng', null, false, false, null],
    ['subtitles', 'ita', 'Forzati', true, true, null],
    ['subtitles', 'ita', null, false, false, 'zlib'],
    ['subtitles', 'eng', null, false, true, null],
    ['subtitles', 'ita', null, false, false, 'zlib'],
  ]);
  assert.deepEqual(input.tracks.map((t) => t.codec), [
    'AVC/H.264/MPEG-4p10', 'AC-3', 'TrueHD', 'FLAC', 'AC-3', 'HDMV PGS', 'HDMV PGS', 'HDMV PGS', 'HDMV PGS',
  ]);
  // Il video è quello del riferimento.
  assert.equal(input.video.width, 320);
  // L'italiano comincia a S e finisce sulla fine del video, entro un pacchetto (FLAC: 96 ms).
  const end = build.endCutMs!;
  for (const id of [1, 2, 3]) {
    const t = input.tracks[id]!;
    assert.equal(t.startMs, 1500, `track ${id} starts at ${t.startMs}`);
    assert.ok(t.endMs! >= end - 100 && t.endMs! <= end + 100, `track ${id} ends at ${t.endMs}, cut at ${end}`);
    assert.equal(build.tracks[id]!.expectedStartMs, 1500);
    assert.equal(build.tracks[id]!.expectedEndMs, end);
  }
  // I PGS italiani si spostano di S.
  assert.deepEqual(blockTimes(out, 6).slice(0, 2), [3500, 5500]);
});

test('SUBTITLES_DROPPED_AT_CUT: con S < 0 si taglia all\'inizio del film; TrueHD riparte da un punto di sincronizzazione', async () => {
  const pl = plan(-5500, { italian: 'all', referenceItalianSubs: 'drop' });
  assert.equal(pl.start.cutMs, 0);
  assert.equal(pl.end.cutMs, null);
  const out = join(outDir(), 'Film.mkv');
  const build = await buildMerge({ reference, donor, plan: pl, output: out });
  // Due passate: TrueHD riparte da un punto di sincronizzazione dopo il taglio.
  assert.deepEqual(build.commands.map((c) => c.tool), ['mkvmerge', 'mkvmerge', 'mkvmerge']);
  // A 5,5 s nel donatore sono a schermo il sottotitolo completo 5–7 s e il forced 5,2–6 s.
  assert.deepEqual(build.warnings.map((w) => [w.code, w.value]), [['SUBTITLES_DROPPED_AT_CUT', 2]]);
  assert.deepEqual(build.droppedSubtitles.map((d) => [d.trackId, d.edge, d.cutMs, d.subtitleStartMs]), [
    [5, 'start', 0, -300],
    [6, 'start', 0, -500],
  ]);
  // Il PGS italiano del riferimento si scarta.
  assert.deepEqual(layout(build), ['r0', 'd1', 'd2', 'd3', 'r1', 'd5', 'd6', 'r2']);
  // TrueHD comincia esattamente dove previsto; AC3 e FLAC entro un pacchetto.
  const v = await verified(pl, build);
  const late = v.italian.map((x) => x.startMs! - x.expectedStartMs);
  assert.equal(late[1], 0);
  for (const [i, x] of v.italian.entries()) assert.ok(late[i]! >= 0 && late[i]! < x.toleranceMs, JSON.stringify(x));
  await commitBuild(build);

  const blocks = firstBlocks(out);
  const { input } = await final(out);
  // AC3 e FLAC perdono al più il pacchetto a cavallo dello zero (32 e 96 ms).
  assert.ok(input.tracks[1]!.startMs! >= 0 && input.tracks[1]!.startMs! < 32, String(input.tracks[1]!.startMs));
  assert.ok(input.tracks[3]!.startMs! >= 0 && input.tracks[3]!.startMs! < 96, String(input.tracks[3]!.startMs));
  // TrueHD: il primo blocco è un punto di sincronizzazione, ed è dove la costruzione lo aspettava.
  const thd = blocks.get(2)!;
  assert.equal(thd.key, true);
  assert.ok(thd.ms >= 0 && thd.ms < 20, String(thd.ms));
  assert.equal(thd.ms, build.tracks[2]!.expectedStartMs);
  // Dal primo blocco, gli stessi timestamp del donatore spostati di S, entro
  // il millisecondo: negli intermedi senza video mkvmerge separa i pacchetti
  // con lo stesso timestamp, e nel file finale lo arrotonda.
  const shifted = blockTimes(p('donor.mkv'), 2).filter((t) => t >= 5500 + thd.ms).slice(0, 200).map((t) => t - 5500);
  const times = blockTimes(out, 2).slice(0, 200);
  assert.equal(times.length, shifted.length);
  assert.ok(times.every((t, i) => Math.abs(t - shifted[i]!) <= 1), `${times.slice(0, 20)} / ${shifted.slice(0, 20)}`);
  // Del sottotitolo 5–7 s resta solo il blocco che lo toglie, a 1,5 s; poi 10–12 s a 4,5 s.
  assert.deepEqual(blockTimes(out, 6).slice(0, 2), [1500, 4500]);
});

test('--edge-mismatch drop: tagli sui confini, anche prima della fine del video; i sottotitoli a cavallo si perdono', async () => {
  const pl = plan(0, { italian: 'all', edgeMismatch: 'drop', referenceItalianSubs: 'keep' }, { startMs: 3000, endMs: 25_500 });
  assert.deepEqual([pl.start.cutMs, pl.end.cutMs], [3000, 25_500]);
  const out = join(outDir(), 'Film.mkv');
  const build = await buildMerge({ reference, donor, plan: pl, output: out });
  // Due passate per il taglio iniziale; alla fine un --split per ogni punto
  // di taglio (l'audio, e ogni PGS con un sottotitolo a cavallo), ffmpeg per FLAC.
  assert.deepEqual(build.commands.map((c) => c.tool), ['mkvmerge', 'mkvmerge', 'mkvmerge', 'mkvmerge', 'mkvmerge', 'ffmpeg', 'mkvmerge']);
  assert.deepEqual(build.droppedSubtitles.map((d) => [d.trackId, d.edge, d.subtitleStartMs]), [
    [5, 'end', 25_000],
    [6, 'end', 24_500],
    [6, 'start', 2000],
  ]);
  assert.deepEqual(build.warnings.map((w) => [w.code, w.value]), [['SUBTITLES_DROPPED_AT_CUT', 3]]);
  await verified(pl, build);
  await commitBuild(build);

  const { input } = await final(out);
  for (const id of [1, 3]) {
    const t = input.tracks[id]!;
    assert.ok(t.startMs! >= 3000 && t.startMs! < 3100, `track ${id} starts at ${t.startMs}`);
    assert.ok(t.endMs! >= 25_400 && t.endMs! <= 25_600, `track ${id} ends at ${t.endMs}`);
  }
  const thd = firstBlocks(out).get(2)!;
  assert.equal(thd.key, true);
  assert.ok(thd.ms >= 3000 && thd.ms < 3020, String(thd.ms));
  // Il PGS completo comincia con il blocco che toglie il sottotitolo 2–4 s e
  // finisce prima di quello a cavallo del taglio finale (24,5–27,5 s).
  const full = blockTimes(out, 6);
  assert.equal(full[0], 4000);
  assert.equal(full[full.length - 1], 22_000);
  assert.deepEqual(blockTimes(out, 5), [5200, 6000]);
});

test('sottotitoli di testo: si prendono come i PGS, si perdono solo al taglio iniziale, mai compressi', async () => {
  const pl = plan(0, { edgeMismatch: 'drop', referenceItalianSubs: 'keep' }, { startMs: 3000, endMs: 25_500 }, textDonor);
  assert.deepEqual(pl.subtitles.map((s) => [s.id, s.text, s.forced, s.taken]), [[3, true, true, true], [4, true, false, true]]);
  assert.equal(textDonor.tracks[3]!.compression, 'zlib');
  const out = join(outDir(), 'Film.mkv');
  const build = await buildMerge({ reference, donor: textDonor, plan: pl, output: out });
  // Due passate per il taglio iniziale e un solo --split: il testo non ha un taglio suo alla fine.
  assert.deepEqual(build.commands.map((c) => c.tool), ['mkvmerge', 'mkvmerge', 'mkvmerge', 'mkvmerge']);
  // A 3 s è a schermo la riga 2–4 s del completo; a 25,5 s le righe a
  // cavallo restano, perché si spengono da sole.
  assert.deepEqual(build.droppedSubtitles.map((d) => [d.trackId, d.edge, d.subtitleStartMs]), [[4, 'start', 2000]]);
  assert.deepEqual(build.warnings.map((w) => [w.code, w.value]), [['SUBTITLES_DROPPED_AT_CUT', 1]]);
  assert.deepEqual(layout(build), ['r0', 'd1', 'r1', 'd3', 'd4', 'r2', 'r3']);
  await verified(pl, build);
  await commitBuild(build);

  const { input } = await final(out);
  const tracks = input.tracks.filter((t) => t.type === 'subtitles').map((t) => [t.codecId, t.language, t.name, t.default, t.forced, t.compression]);
  assert.deepEqual(tracks, [
    ['S_TEXT/UTF8', 'ita', 'Forzati', true, true, null],
    ['S_TEXT/ASS', 'ita', null, false, false, null],
    ['S_HDMV/PGS', 'eng', null, false, true, null],
    ['S_HDMV/PGS', 'ita', null, false, false, 'zlib'],
  ]);
  assert.deepEqual(blockTimes(out, 3), [5200, 25_000]);
  const full = blockTimes(out, 4);
  assert.equal(full[0], 5000);
  assert.equal(full[full.length - 1], 24_500);
});

// ---------------------------------------------------------------- errori

test('CHOICE_REQUIRED, OUTPUT_EXISTS, OUTPUT_NOT_WRITABLE e BAD_ARGUMENTS prima di scrivere qualsiasi cosa', async () => {
  const out = join(outDir(), 'Film.mkv');
  const pending = plan(1500, { italian: 'all' });
  await assert.rejects(buildMerge({ reference, donor, plan: pending, output: out }), code('CHOICE_REQUIRED'));
  const ok = plan(1500, { italian: 'all', tail: 'keep', referenceItalianSubs: 'keep' });
  await assert.rejects(buildMerge({ reference, donor, plan: ok, output: reference.path }), code('OUTPUT_EXISTS'));
  writeFileSync(out, '');
  await assert.rejects(buildMerge({ reference, donor, plan: ok, output: out }), code('OUTPUT_EXISTS'));
  rmSync(out);
  await assert.rejects(buildMerge({ reference, donor, plan: ok, output: p('missing/Film.mkv') }), code('OUTPUT_NOT_WRITABLE'));
  await assert.rejects(buildMerge({ reference, donor, plan: ok, output: out, tempDir: join(dir, 'tmp') }), code('BAD_ARGUMENTS'));
  assert.deepEqual(readdirSync(join(out, '..')), []);
});

test('NO_SPACE: con un disco piccolo ci si ferma prima di scrivere', async () => {
  const pl = plan(1500, { italian: 'all', tail: 'keep', referenceItalianSubs: 'keep' });
  const out = join(outDir(), 'Film.mkv');
  // Il riferimento, le tracce italiane due volte e 2 GiB di margine.
  await assert.rejects(buildMerge({ reference, donor, plan: pl, output: out }, { freeSpace: async () => 1024 ** 3 }), (e: unknown) => {
    assert.ok(e instanceof DyadrrError && e.code === 'NO_SPACE', String(e));
    assert.match(e.message, /bytes free/);
    return true;
  });
  assert.deepEqual(readdirSync(join(out, '..')), [], 'nothing written');
});

/** Un mkvmerge finto: lancia quello vero, poi aggiunge `extra` all'uscita ed esce con `exit`. */
function wrapper(name: string, extra: string, exit: number, real = true): string {
  const path = p(name);
  writeFileSync(path, `#!/bin/sh\n${real ? 'mkvmerge "$@" || exit $?\n' : ''}echo '${extra}'\nexit ${exit}\n`);
  chmodSync(path, 0o755);
  return path;
}

test('MKVMERGE_WARNING: mkvmerge esce con 1, il file si accetta e ogni avviso va nel report', async () => {
  const tools = { ...DEFAULT_TOOLS, mkvmerge: wrapper('mkvmerge-warning', '#GUI#warning simulated warning', 1) };
  const pl = plan(1500, { italian: 'main', tail: 'keep', referenceItalianSubs: 'keep' });
  const build = await buildMerge({ reference, donor, plan: pl, output: join(outDir(), 'Film.mkv') }, { tools });
  assert.deepEqual(build.commands.map((c) => c.exitCode), [1, 1]);
  assert.deepEqual(build.warnings.map((w) => [w.code, w.message]), [
    ['MKVMERGE_WARNING', 'simulated warning'],
    ['MKVMERGE_WARNING', 'simulated warning'],
  ]);
  assert.ok(existsSync(build.file));
  await commitBuild(build);
  assert.ok(existsSync(build.output));
});

test('MERGE_FAILED: mkvmerge esce con 2, i temporanei si eliminano', async () => {
  const out = join(outDir(), 'Film.mkv');
  const pl = plan(1500, { italian: 'main', tail: 'keep', referenceItalianSubs: 'keep' });
  const failing = { ...DEFAULT_TOOLS, mkvmerge: wrapper('mkvmerge-error', '#GUI#error simulated failure', 2, false) };
  await assert.rejects(buildMerge({ reference, donor, plan: pl, output: out }, { tools: failing }), (e: unknown) => {
    assert.ok(e instanceof DyadrrError && e.code === 'MERGE_FAILED', String(e));
    assert.match(e.message, /simulated failure/);
    return true;
  });
  assert.deepEqual(readdirSync(join(out, '..')), [], 'no temporary files left');
  // Un disco che si riempie durante il merge è NO_SPACE, riprovabile.
  const full = { ...DEFAULT_TOOLS, mkvmerge: wrapper('mkvmerge-full', '#GUI#error Could not write to the output file: No space left on device', 2, false) };
  await assert.rejects(buildMerge({ reference, donor, plan: pl, output: out }, { tools: full }), code('NO_SPACE'));
});

test('annullamento: i programmi si fermano e i temporanei si eliminano', async () => {
  const pl = plan(-5500, { italian: 'all', referenceItalianSubs: 'keep' });
  const out = join(outDir(), 'Film.mkv');
  const controller = new AbortController();
  const build = buildMerge({ reference, donor, plan: pl, output: out }, {
    signal: controller.signal,
    onProgress: (x) => { if (x.step === 2) controller.abort(); },
  });
  await assert.rejects(build, (e: unknown) => (e as Error).name === 'AbortError');
  assert.deepEqual(readdirSync(join(out, '..')), []);
});

test('rinomina: un file finale comparso durante il merge non si sovrascrive; avanzi di un\'interruzione brusca', async () => {
  const pl = plan(1500, { italian: 'main', tail: 'keep', referenceItalianSubs: 'keep' });
  const out = join(outDir(), 'Film.mkv');
  const build = await buildMerge({ reference, donor, plan: pl, output: out });
  writeFileSync(out, 'someone else');
  await assert.rejects(commitBuild(build), code('OUTPUT_EXISTS'));
  assert.ok(!existsSync(build.jobDir));

  // Le cartelle di lavoro di un processo che non c'è più si eliminano; quelle di un altro host restano.
  const temp = join(outDir(), '.dyadrr');
  const stale = `job-${hostname()}-999999999-0123abcd`;
  const other = 'job-another-host-1-0123abcd';
  for (const name of [stale, other, `job-${hostname()}-${process.pid}-0123abcd`]) mkdirSync(join(temp, name), { recursive: true });
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(join(temp, stale), past, past);
  assert.deepEqual((await removeStaleJobs(temp)).sort(), [stale, `job-${hostname()}-${process.pid}-0123abcd`].sort());
  assert.deepEqual(readdirSync(temp), [other]);
});
