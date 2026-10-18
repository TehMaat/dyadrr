import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCalibration } from '../src/calibration.js';
import { DyadrrError } from '../src/codes.js';
import { readInput } from '../src/inputs.js';
import {
  DEFAULT_TOOLS,
  MIN_MKVMERGE_MAJOR,
  checkTools,
  ffmpegRelease,
  parseFfmpegVersion,
  parseMkvmergeVersion,
} from '../src/tools.js';
import { tempDir } from './helpers/mkv.js';

const dir = tempDir();
after(() => rmSync(dir, { recursive: true, force: true }));

const code = (expected: string) => (e: unknown) => {
  assert.ok(e instanceof DyadrrError, String(e));
  assert.equal(e.code, expected, e.message);
  return true;
};

/** Un finto programma che stampa sempre lo stesso testo. */
function fake(name: string, output: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\ncat <<'EOF'\n${output}\nEOF\n`);
  chmodSync(path, 0o755);
  return path;
}

test('versioni di mkvmerge e ffmpeg', async () => {
  assert.deepEqual(parseMkvmergeVersion("mkvmerge v82.0 ('I'm The President') 64-bit"), { major: 82, minor: 0, patch: 0 });
  assert.deepEqual(parseMkvmergeVersion("mkvmerge v57.0.0 ('Till The End') 64-bit"), { major: 57, minor: 0, patch: 0 });
  assert.equal(parseMkvmergeVersion('ffmpeg version 6.1.1'), null);
  assert.equal(parseFfmpegVersion('ffmpeg', 'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023'), '6.1.1-3ubuntu5');
  assert.equal(parseFfmpegVersion('ffprobe', 'ffprobe version n7.0.2 Copyright'), 'n7.0.2');

  // Versione di ffmpeg confrontabile con il minimo: dal numero, o da libavformat per le build da git.
  const release = (text: string) => ffmpegRelease(text);
  assert.deepEqual(release('ffmpeg version 6.1.1-3ubuntu5 Copyright'), { release: { major: 6, minor: 1 }, from: 'version' });
  assert.deepEqual(release('ffmpeg version n7.0.2 Copyright'), { release: { major: 7, minor: 0 }, from: 'version' });
  assert.deepEqual(release('ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/'), { release: { major: 7, minor: 0 }, from: 'version' });
  assert.deepEqual(
    release('ffmpeg version N-117000-gabcdef Copyright\nlibavutil      59. 39.100 / 59. 39.100\nlibavformat    61.  7.100 / 61.  7.100'),
    { release: { major: 61, minor: 7 }, from: 'libavformat' },
  );
  assert.equal(release('ffmpeg version git-2024-01-01'), null);

  // I programmi installati: quelli che usano i test degli ingressi.
  const versions = await checkTools();
  assert.ok(Number(versions.mkvmerge.split('.')[0]) >= MIN_MKVMERGE_MAJOR, versions.mkvmerge);
  assert.ok(versions.ffmpeg && versions.ffprobe);
});

test('TOOL_MISSING: mkvmerge, ffprobe o ffmpeg mancanti', async () => {
  const missing = join(dir, 'does-not-exist');
  for (const tool of ['mkvmerge', 'ffprobe', 'ffmpeg'] as const) {
    await assert.rejects(checkTools({ ...DEFAULT_TOOLS, [tool]: missing }), code('TOOL_MISSING'), tool);
  }
  // Un programma che risponde ma non è mkvmerge.
  const impostor = fake('not-mkvmerge', 'hello');
  await assert.rejects(checkTools({ ...DEFAULT_TOOLS, mkvmerge: impostor }), code('TOOL_MISSING'));
  // Anche la lettura di un ingresso si ferma se mkvmerge manca.
  const file = join(dir, 'input.mkv');
  writeFileSync(file, 'x');
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(file, past, past);
  await assert.rejects(
    readInput(file, { calibration: loadCalibration(), tools: { ...DEFAULT_TOOLS, mkvmerge: missing } }),
    code('TOOL_MISSING'),
  );
});

test('TOOL_TOO_OLD: mkvmerge più vecchio di v57', async () => {
  const old = fake('mkvmerge-56', "mkvmerge v56.1.0 ('My Friend') 64-bit");
  await assert.rejects(checkTools({ ...DEFAULT_TOOLS, mkvmerge: old }), code('TOOL_TOO_OLD'));
  await assert.rejects(checkTools({ ...DEFAULT_TOOLS, mkvmerge: old }), /at least v57/);
  const ok = fake('mkvmerge-57', "mkvmerge v57.0.0 ('Till The End') 64-bit");
  assert.equal((await checkTools({ ...DEFAULT_TOOLS, mkvmerge: ok })).mkvmerge, '57.0.0');
});

test('TOOL_TOO_OLD: ffmpeg più vecchio di 6.1', async () => {
  const ffmpeg = (name: string, text: string) => ({ ...DEFAULT_TOOLS, ffmpeg: fake(name, text) });
  for (const [name, text] of [
    ['ffmpeg-6.0', 'ffmpeg version 6.0.1 Copyright (c) 2000-2023 the FFmpeg developers'],
    ['ffmpeg-4.4', 'ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers'],
    // Una build da git di ffmpeg 6.0: libavformat 60.3.
    ['ffmpeg-git-60.3', 'ffmpeg version N-110000-g1234567 Copyright\nlibavformat    60.  3.100 / 60.  3.100'],
    // Né numero di versione né libavformat: non si può sapere.
    ['ffmpeg-unknown', 'ffmpeg version git-2024-01-01 Copyright'],
  ] as const) {
    await assert.rejects(checkTools(ffmpeg(name, text)), code('TOOL_TOO_OLD'), name);
  }
  await assert.rejects(checkTools(ffmpeg('ffmpeg-6.0b', 'ffmpeg version 6.0 Copyright')), /at least 6\.1 is required/);

  for (const [name, text, version] of [
    ['ffmpeg-6.1', 'ffmpeg version 6.1 Copyright', '6.1'],
    ['ffmpeg-7.0', 'ffmpeg version n7.0.2 Copyright', 'n7.0.2'],
    ['ffmpeg-git-61', 'ffmpeg version N-117000-gabcdef Copyright\nlibavformat    61.  7.100 / 61.  7.100', 'N-117000-gabcdef'],
  ] as const) {
    assert.equal((await checkTools(ffmpeg(name, text))).ffmpeg, version, name);
  }
});
