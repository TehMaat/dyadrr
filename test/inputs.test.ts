import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCalibration } from '../src/calibration.js';
import { DyadrrError } from '../src/codes.js';
import { decide } from '../src/decision.js';
import {
  hdrFormat,
  isCommentaryOrDescription,
  mainItalianTrack,
  parseTagDuration,
  readInput,
  type InputFile,
} from '../src/inputs.js';
import { isItalian } from '../src/languages.js';
import { TAIL_INITIAL_BYTES } from '../src/matroska.js';
import { ffmpegSource, mkvmerge, run, settle, tempDir } from './helpers/mkv.js';

// MKV veri, generati al volo con ffmpeg e mkvmerge (studio §15, punto 2):
// - riferimento: video 1280x720 senza perdite (più di 8 MiB, così la coda si
//   legge a finestre crescenti), inglese 5.1, giapponese che finisce a metà,
//   sottotitoli italiani forced compressi, un allegato;
// - donatore: video 320x180, italiano (tag IETF it-IT), inglese, italiano per
//   non vedenti, commento inglese.

const cal = loadCalibration();
let dir: string;
const files: Record<string, string> = {};
const read = (name: string) => readInput(files[name]!, { calibration: cal });

const code = (expected: string) => (e: unknown) => {
  assert.ok(e instanceof DyadrrError, String(e));
  assert.equal(e.code, expected, e.message);
  return true;
};

before(() => {
  dir = tempDir();
  const p = (name: string) => join(dir, name);

  ffmpegSource(p('ref-src.mkv'), { size: '1280x720', seconds: 10, lossless: true }, [
    { frequency: 440, channels: 6 },
    { frequency: 660, channels: 2, seconds: 5 },
  ]);
  writeFileSync(p('subs.srt'), '1\n00:00:01,000 --> 00:00:02,000\nCiao\n\n2\n00:00:04,000 --> 00:00:05,000\nArrivederci\n');
  writeFileSync(p('notes.txt'), 'allegato di prova\n');
  files.reference = settle(mkvmerge(p('reference.mkv'), [
    '--language', '1:en-US', '--track-name', '1:Surround 5.1', '--default-track-flag', '1:yes',
    '--language', '2:ja', '--default-track-flag', '2:no',
    p('ref-src.mkv'),
    '--language', '0:it', '--forced-display-flag', '0:yes', '--compression', '0:zlib', p('subs.srt'),
    '--attachment-mime-type', 'text/plain', '--attach-file', p('notes.txt'),
  ]));

  ffmpegSource(p('donor-src.mkv'), { size: '320x180', seconds: 9 }, [
    { frequency: 440, channels: 2 },
    { frequency: 550, channels: 2 },
    { frequency: 770, channels: 2 },
    { frequency: 880, channels: 1 },
  ]);
  files.donor = settle(mkvmerge(p('donor.mkv'), [
    '--language', '1:it-IT', '--track-name', '1:Italiano',
    '--language', '2:eng',
    '--language', '3:ita', '--track-name', '3:Audiodescrizione', '--visual-impaired-flag', '3:yes',
    '--language', '4:eng', '--commentary-flag', '4:yes',
    p('donor-src.mkv'),
  ]));

  // Italiano solo nel campo IETF: il campo classico dice "und".
  files.ietf = p('ietf.mkv');
  copyFileSync(files.donor, files.ietf);
  run('mkvpropedit', ['-q', files.ietf, '--edit', 'track:a1', '--set', 'language=und', '--set', 'language-ietf=it-CH']);
  settle(files.ietf);

  // Troncato a metà: l'intestazione dichiara ancora la durata piena (§4.8).
  files.truncated = p('truncated.mkv');
  copyFileSync(files.donor, files.truncated);
  truncateSync(files.truncated, Math.floor(statSync(files.donor).size / 2));
  settle(files.truncated);

  // L'inglese finisce a 9 s, ma i suoi tag statistici dicono 12 s.
  files.shortTrack = p('short-track.mkv');
  copyFileSync(files.donor, files.shortTrack);
  writeFileSync(p('tags.xml'), '<?xml version="1.0"?><Tags><Tag><Targets/>' +
    '<Simple><Name>BPS</Name><String>192000</String></Simple>' +
    '<Simple><Name>DURATION</Name><String>00:00:12.000000000</String></Simple></Tag></Tags>');
  run('mkvpropedit', ['-q', files.shortTrack, '--tags', `track:a2:${p('tags.xml')}`]);
  settle(files.shortTrack);

  ffmpegSource(p('hdr-src.mkv'), { size: '320x180', seconds: 1, hevcHdr10: true }, []);
  files.hdr = settle(mkvmerge(p('hdr.mkv'), [p('hdr-src.mkv')]));

  files.audioOnly = settle(mkvmerge(p('audio-only.mka'), ['-D', files.donor]));
  files.text = p('text.mkv');
  writeFileSync(files.text, 'not a matroska file\n');
  settle(files.text);
  files.mp4 = p('audio.mp4');
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine', '-t', '1', files.mp4]);
  settle(files.mp4);
  files.missing = p('missing.mkv');
  files.directory = dir;
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('tracce, lingue, flag e tag statistici da mkvmerge -J e ffprobe', async () => {
  const ref = await read('reference');
  assert.deepEqual(ref.tracks.map((t) => [t.id, t.type]), [[0, 'video'], [1, 'audio'], [2, 'audio'], [3, 'subtitles']]);
  const [, eng, jpn, subs] = ref.tracks;
  assert.deepEqual(
    [eng!.language, eng!.languageIetf, eng!.codec, eng!.channels, eng!.name, eng!.default],
    ['eng', 'en-US', 'AC-3', 6, 'Surround 5.1', true],
  );
  assert.deepEqual([jpn!.language, jpn!.languageIetf, jpn!.default], ['jpn', 'ja', false]);
  assert.deepEqual([subs!.language, subs!.forced, subs!.compression], ['ita', true, 'zlib']);
  assert.equal(subs!.statistics?.frames, 2);
  assert.equal(eng!.statistics?.bps !== null && eng!.statistics!.bps! > 0, true);
  assert.equal(jpn!.startMs, 0);
  assert.ok(Math.abs(jpn!.statistics!.durationMs! - 5000) < 50, String(jpn!.statistics?.durationMs));
  // Sottotitoli italiani sì, audio italiano no: il riferimento non è un donatore (§3.1).
  assert.equal(ref.italianAudio, false);
  assert.equal(ref.italianSubtitles, true);
  assert.equal(ref.audio.length, 2);

  const donor = await read('donor');
  const [, ita, eng2, ad, commentary] = donor.tracks;
  assert.deepEqual([ita!.language, ita!.languageIetf, ita!.name], ['ita', 'it-IT', 'Italiano']);
  assert.equal(eng2!.commentary || eng2!.visualImpaired, false);
  assert.deepEqual([ad!.visualImpaired, ad!.commentary, ad!.name], [true, false, 'Audiodescrizione']);
  assert.deepEqual([commentary!.commentary, commentary!.channels], [true, 1]);
  assert.equal(ita!.compression, null);
  assert.equal(donor.italianAudio, true);
  assert.equal(donor.italianSubtitles, false);
  assert.match(donor.writingApplication ?? '', /^mkvmerge v\d+/);
});

test('tag di lingua IETF: conta il campo IETF, anche con il campo classico und', async () => {
  const facts = await read('ietf');
  const ita = facts.tracks[1]!;
  assert.deepEqual([ita.language, ita.languageIetf], ['und', 'it-CH']);
  assert.equal(isItalian(ita), true);
  assert.equal(facts.italianAudio, true);
});

test('video: risoluzione, framerate, HDR e bitrate dai tag statistici', async () => {
  const ref = await read('reference');
  assert.equal(ref.video.trackId, 0);
  assert.deepEqual([ref.video.width, ref.video.height, ref.video.hdr, ref.video.codec], [1280, 720, 'SDR', 'V_MPEG4/ISO/AVC']);
  assert.ok(Math.abs(ref.video.fps - 24000 / 1001) < 1e-9, String(ref.video.fps));
  assert.ok(ref.video.bitrate !== null && ref.video.bitrate > 1e6, String(ref.video.bitrate));
  assert.ok(Math.abs(ref.video.durationMs - 10_010) < 50, String(ref.video.durationMs));

  const hdr = await read('hdr');
  assert.deepEqual([hdr.video.hdr, hdr.video.dvProfile, hdr.video.codec], ['HDR10', null, 'V_MPEGH/ISO/HEVC']);
});

test('hdrFormat: SDR, HLG, HDR10, HDR10+ e Dolby Vision con il profilo', () => {
  const dovi = [{ side_data_type: 'DOVI configuration record', dv_profile: 8 }];
  const hdr10plus = [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }];
  assert.deepEqual(hdrFormat(undefined), { hdr: 'SDR', dvProfile: null });
  assert.deepEqual(hdrFormat('bt709'), { hdr: 'SDR', dvProfile: null });
  assert.deepEqual(hdrFormat('arib-std-b67'), { hdr: 'HLG', dvProfile: null });
  assert.deepEqual(hdrFormat('smpte2084'), { hdr: 'HDR10', dvProfile: null });
  assert.deepEqual(hdrFormat('smpte2084', [], hdr10plus), { hdr: 'HDR10+', dvProfile: null });
  // Dolby Vision prevale sul livello base (HDR10 nel profilo 8, nessuno nel 5).
  assert.deepEqual(hdrFormat('smpte2084', dovi, hdr10plus), { hdr: 'DV', dvProfile: 8 });
  assert.deepEqual(hdrFormat(undefined, [{ side_data_type: 'DOVI configuration record', dv_profile: 5 }]), { hdr: 'DV', dvProfile: 5 });
});

test('durata dei tag statistici', () => {
  assert.equal(parseTagDuration('00:00:06.006000000'), 6006);
  assert.equal(parseTagDuration('01:58:29.375000000'), 7_109_375);
  assert.equal(parseTagDuration('00:00:05'), 5000);
  assert.equal(parseTagDuration('6.006'), null);
  assert.equal(parseTagDuration(undefined), null);
});

test("impronta: dimensione, data di modifica e hash del primo e dell'ultimo MiB", async () => {
  // Una data con frazioni di millisecondo: la data dell'impronta è quella di Node, non troncata.
  const modified = (Date.now() - 3_600_000 + 0.9) / 1000;
  utimesSync(files.reference!, modified, modified);
  const ref = await read('reference');
  const bytes = readFileSync(files.reference!);
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  assert.equal(ref.fingerprint.size, bytes.length);
  assert.equal(ref.fingerprint.modifiedAt, statSync(files.reference!).mtime.toISOString());
  assert.equal(ref.fingerprint.firstMiBSha256, sha(bytes.subarray(0, 1 << 20)));
  assert.equal(ref.fingerprint.lastMiBSha256, sha(bytes.subarray(bytes.length - (1 << 20))));
  assert.notEqual(ref.fingerprint.firstMiBSha256, ref.fingerprint.lastMiBSha256);
});

test('integrità: un file completo passa, con la fine di ogni traccia audio e video', async () => {
  const ref = await read('reference');
  const integrity = ref.integrity;
  assert.equal(integrity.result, 'pass', integrity.detail);
  assert.equal(ref.truncated, false);
  assert.ok(Math.abs(integrity.lastTimestampMs! - integrity.declaredDurationMs!) <= 1, JSON.stringify(integrity));
  // Video, inglese e giapponese; i sottotitoli non si controllano.
  assert.deepEqual(integrity.tracks.map((t) => [t.id, t.result]), [[0, 'pass'], [1, 'pass'], [2, 'pass']]);
  // Il giapponese finisce a 5 s: per trovarlo la coda si legge oltre gli 8 MiB iniziali.
  assert.ok(ref.fingerprint.size > TAIL_INITIAL_BYTES);
  assert.ok(integrity.scannedBytes > TAIL_INITIAL_BYTES, String(integrity.scannedBytes));
  const jpn = ref.tracks[2]!;
  assert.ok(Math.abs(jpn.endMs! - jpn.startMs! - jpn.statistics!.durationMs!) < 1, JSON.stringify(jpn));

  const donor = await read('donor');
  assert.equal(donor.integrity.result, 'pass', donor.integrity.detail);
  assert.equal(donor.integrity.tracks.length, 5);
});

test('INPUT_TRUNCATED: un file troncato a metà, e una traccia più corta dei suoi tag', async () => {
  const reference = await read('reference');

  const truncated = await read('truncated');
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.durationMs, (await read('donor')).durationMs, 'the header still declares the full duration');
  assert.ok(truncated.integrity.lastTimestampMs! < truncated.integrity.declaredDurationMs! / 2 + 2000);
  assert.match(truncated.integrity.detail ?? '', /the header declares/);

  const short = await read('shortTrack');
  assert.equal(short.truncated, true);
  const eng = short.integrity.tracks.find((t) => t.id === 2)!;
  assert.equal(eng.result, 'fail');
  assert.equal(eng.expectedEndMs, 12_000);
  assert.match(short.integrity.detail ?? '', /^track 2 ends at/);

  // Un ingresso troncato ferma la decisione al controllo di integrità (§9.6).
  for (const donor of [truncated, short]) {
    const report = decide({ files: [reference, donor], originalLanguage: null, anchors: [] }, cal);
    assert.equal(report.decision, 'error');
    assert.deepEqual(report.reasons.map((r) => r.code), ['INPUT_TRUNCATED']);
    assert.equal(report.checks.find((c) => c.name === 'integrity')?.result, 'fail');
  }
});

test('i fatti degli ingressi bastano alla decisione: ruoli, lingua di misura, video, framerate', async () => {
  const facts: [InputFile, InputFile] = [await read('donor'), await read('reference')];
  const report = decide({ files: facts, originalLanguage: 'jpn', anchors: [] }, cal);
  assert.deepEqual(report.roles, { reference: 1, donor: 0 });
  assert.equal(report.measureLanguage?.language, 'eng');
  assert.deepEqual(report.warnings.map((w) => w.code), ['ORIGINAL_LANGUAGE_NOT_COMMON']);
  for (const name of ['roles', 'measure-language', 'video', 'framerate', 'integrity'] as const) {
    assert.equal(report.checks.find((c) => c.name === name)?.result, 'pass', name);
  }
  // Senza ancore misurate la coppia si ferma alla misura.
  assert.deepEqual(report.reasons.map((r) => r.code), ['NO_MATCH']);
});

test('INPUT_UNREADABLE: file mancante, non MKV o senza video', async () => {
  for (const name of ['missing', 'directory', 'text', 'mp4', 'audioOnly']) {
    await assert.rejects(read(name), code('INPUT_UNREADABLE'), name);
  }
  await assert.rejects(read('text'), /not a Matroska file/);
  // mkvmerge v82 dice "QuickTime/MP4", la v92 dell'immagine "MP4/QuickTime".
  await assert.rejects(read('mp4'), /not a Matroska file \((QuickTime\/MP4|MP4\/QuickTime)\)/);
  await assert.rejects(read('audioOnly'), /no video track/);
});

test('INPUT_BUSY: file modificato negli ultimi secondi, o con una data nel futuro', async () => {
  const path = files.hdr!;
  const at = (offsetMs: number) => {
    const t = new Date(Date.now() + offsetMs);
    utimesSync(path, t, t);
  };
  try {
    at(-1000);
    await assert.rejects(read('hdr'), code('INPUT_BUSY'));
    at(-(cal.values.inputBusyMs - 2000));
    await assert.rejects(read('hdr'), code('INPUT_BUSY'));
    at(3_600_000);
    await assert.rejects(read('hdr'), /in the future/);
    at(-(cal.values.inputBusyMs + 2000));
    assert.equal((await read('hdr')).truncated, false);
  } finally {
    settle(path);
  }
});

test('commenti e audiodescrizioni dai flag o dal nome; traccia italiana principale (§4.2, §8)', async () => {
  const track = (name: string | null, flags: { commentary?: boolean; visualImpaired?: boolean; default?: boolean } = {}) => ({
    name,
    commentary: flags.commentary ?? false,
    visualImpaired: flags.visualImpaired ?? false,
    default: flags.default ?? false,
  });
  for (const name of ["Director's Commentary", 'Commento del regista', 'Audiodescrizione', 'Audio Description', 'Descriptive Audio', 'Italiano per non vedenti', 'Italiano AD']) {
    assert.equal(isCommentaryOrDescription(track(name)), true, name);
  }
  for (const name of [null, 'Italiano', 'Surround 5.1', 'Adattamento 2004', 'Dolby Atmos', 'commentarium']) {
    assert.equal(isCommentaryOrDescription(track(name)), false, String(name));
  }
  assert.equal(isCommentaryOrDescription(track(null, { commentary: true })), true);
  assert.equal(isCommentaryOrDescription(track(null, { visualImpaired: true })), true);

  const ita = (name: string | null, flags = {}) => ({ ...track(name, flags), language: 'ita' });
  const commento = ita('Commento');
  const principale = ita('Italiano');
  assert.equal(mainItalianTrack([{ ...track(null), language: 'eng' }, commento, principale]), principale);
  const predefinita = ita('Commento', { default: true });
  assert.equal(mainItalianTrack([principale, predefinita]), predefinita);
  assert.equal(mainItalianTrack([commento]), commento);
  assert.equal(mainItalianTrack([{ ...track(null), language: 'eng' }]), null);

  // Sul donatore vero: la prima traccia italiana, non quella per non vedenti.
  const donor = await read('donor');
  assert.equal(mainItalianTrack(donor.audio)?.name, 'Italiano');
  assert.equal(donor.audio.filter((t) => isCommentaryOrDescription(t)).length, 2);
});
