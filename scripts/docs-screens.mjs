#!/usr/bin/env node
// Schermate del terminale per la documentazione (docs/img/screens/*.svg).
//
// Genera due "film" sintetici con nomi inventati (rumore rosa in 5.1 e un
// video di prova, come i test), lancia i veri `dyadrr` e `dyadrr-pairs` da
// dist/ e salva comandi e uscite come immagini SVG di una finestra di
// terminale. Le uscite si normalizzano (cartella temporanea, ore, durate),
// così una nuova esecuzione dà gli stessi file finché non cambia il
// comportamento: la CI la ripete e fallisce se le immagini sono diverse.
//
// Uso: npm run build && npm run docs:screens
// Serve: ffmpeg, mkvtoolnix e Node 22, come per i test.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'img', 'screens');
const BIN = join(ROOT, 'dist', 'bin.js');
const PAIRS = join(ROOT, 'dist', 'pairs-bin.js');

/** La cartella mostrata nelle schermate al posto di quella temporanea. */
const SHOWN = '/media/film';

const SECONDS = 480;
const OFFSET_MS = 1500;
const REF = 'Faro di Velmora (2011) [UHD].mkv';
const DONOR = 'Faro di Velmora (2011) [BD ITA].mkv';
const OTHER = 'Isola Chiusa (2010) [BD ITA].mkv';
const FINAL = 'Faro di Velmora (2011).mkv';

// ---------------------------------------------------------------- processi

function exec(cmd, args, cwd, env = {}) {
  return new Promise((done, fail) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DYADRR_')));
    const child = spawn(cmd, args, { cwd, env: { ...clean, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', fail);
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

async function must(cmd, args, cwd) {
  const r = await exec(cmd, args, cwd);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')}: exit ${r.code}\n${r.stderr}`);
  return r;
}

// ---------------------------------------------------------------- film sintetici

/** 5.1 di rumori rosa, uno per seed, in AC3 (come test/cli.test.ts). */
const surround = (dir, name, seeds) => must('ffmpeg', [
  '-v', 'error', '-y', '-filter_complex',
  [
    ...seeds.map((s, i) => `anoisesrc=d=${SECONDS}:c=pink:r=48000:a=0.2:s=${s}[c${i}]`),
    `${seeds.map((_, i) => `[c${i}]`).join('')}join=inputs=6:channel_layout=5.1:map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-BL|5.0-BR[o]`,
  ].join(';'),
  '-map', '[o]', '-c:a', 'ac3', join(dir, name),
], dir);

const video = (dir, name, size) => must('ffmpeg', [
  '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24000/1001`, '-t', String(SECONDS),
  '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', join(dir, name),
], dir);

/** Un file appena scritto è INPUT_BUSY: la data di modifica va a un'ora fa. */
function settle(path) {
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(path, past, past);
}

async function films(work, dir) {
  await Promise.all([
    video(work, 'ref-video.mkv', '320x180'),
    video(work, 'donor-video.mkv', '160x90'),
    surround(work, 'eng.mka', [1, 2, 3, 4, 5, 6]),
    surround(work, 'ita.mka', [1, 2, 7, 4, 5, 6]),
    surround(work, 'other-eng.mka', [11, 12, 13, 14, 15, 16]),
    surround(work, 'other-ita.mka', [11, 12, 17, 14, 15, 16]),
  ]);
  const w = (n) => join(work, n);
  await Promise.all([
    must('mkvmerge', ['-q', '-o', join(dir, REF), '--title', 'Faro di Velmora', w('ref-video.mkv'), '--language', '0:eng', '--track-name', '0:English', w('eng.mka')], work),
    must('mkvmerge', [
      '-q', '-o', join(dir, DONOR), '--title', 'Faro di Velmora', w('donor-video.mkv'),
      '--language', '0:ita', '--track-name', '0:Italiano', '--sync', `0:-${OFFSET_MS}`, w('ita.mka'),
      '--language', '0:eng', '--track-name', '0:English', '--default-track-flag', '0:0', '--sync', `0:-${OFFSET_MS}`, w('eng.mka'),
    ], work),
    must('mkvmerge', [
      '-q', '-o', join(dir, OTHER), '--title', 'Isola Chiusa', w('donor-video.mkv'),
      '--language', '0:ita', '--track-name', '0:Italiano', w('other-ita.mka'),
      '--language', '0:eng', '--track-name', '0:English', '--default-track-flag', '0:0', w('other-eng.mka'),
    ], work),
  ]);
  for (const f of [REF, DONOR, OTHER]) settle(join(dir, f));
}

// ---------------------------------------------------------------- schermate

const q = (s) => (/[^\w./-]/.test(s) ? `"${s}"` : s);
const json = (v) => JSON.stringify(v, null, 2);

/** Toglie dall'uscita ciò che cambia a ogni esecuzione. */
function normalize(text, dir) {
  return text
    .split(dir).join(SHOWN)
    .replace(/\d{8}T\d{6}Z/g, '20261115T101500Z')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '2026-11-15T10:15:00.000Z')
    .replace(/"elapsedMs":\d+/g, '"elapsedMs":…')
    .replace(/\(\d+ s\)/g, '(… s)')
    .replace(/\s+$/g, '');
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const xml = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

/** Colonne del terminale: le righe più lunghe vanno a capo, come in un terminale vero. */
const COLUMNS = 100;
const wrap = (line) => {
  const out = [];
  for (let rest = line; ; rest = rest.slice(COLUMNS)) {
    out.push(rest.slice(0, COLUMNS));
    if (rest.length <= COLUMNS) return out;
  }
};

/**
 * Una finestra di terminale in SVG. `lines` sono righe già pronte: quelle
 * che cominciano con "$ " sono comandi.
 */
function terminal(title, lines) {
  // Una riga è un comando se comincia con "$ " o se la precedente finisce con " \\".
  const shown = [];
  let continued = false;
  for (const line of lines) {
    const isCommand = line.startsWith('$ ') || continued;
    continued = isCommand && line.endsWith(' \\');
    for (const part of wrap(line)) shown.push({ text: part, isCommand });
  }
  const charW = 8.4;
  const lineH = 20;
  const pad = 20;
  const top = 44;
  const width = Math.max(640, Math.ceil(Math.max(...shown.map((l) => l.text.length)) * charW + pad * 2));
  const height = top + shown.length * lineH + pad;
  const rows = shown.map(({ text, isCommand }, i) => {
    const y = top + (i + 1) * lineH - 6;
    if (text.startsWith('$ ')) {
      return `  <text x="${pad}" y="${y}"><tspan class="p">$</tspan><tspan class="c"> ${xml(text.slice(2))}</tspan></text>`;
    }
    const cls = isCommand ? 'c' : text.startsWith('#') ? 'm' : 'o';
    return `  <text x="${pad}" y="${y}" class="${cls}">${xml(text)}</text>`;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title)}">`,
    `  <title>${xml(title)}</title>`,
    '  <style>',
    '    text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace; font-size: 14px; white-space: pre; }',
    '    .p { fill: #7ee787; font-weight: bold; } .c { fill: #f0f6fc; } .o { fill: #c9d1d9; } .m { fill: #8b949e; } .t { fill: #8b949e; font-size: 13px; }',
    '  </style>',
    `  <rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>`,
    `  <rect width="${width}" height="32" rx="10" fill="#161b22"/>`,
    `  <rect y="22" width="${width}" height="10" fill="#161b22"/>`,
    '  <circle cx="20" cy="16" r="6" fill="#ff5f57"/><circle cx="40" cy="16" r="6" fill="#febc2e"/><circle cx="60" cy="16" r="6" fill="#28c840"/>',
    `  <text x="${width / 2}" y="21" text-anchor="middle" class="t">${xml(title)}</text>`,
    ...rows,
    '</svg>',
    '',
  ].join('\n');
}

/** Un comando, spezzato con " \\" se non sta in una riga. */
function command(args, tail = '') {
  const words = args.map(q);
  const out = [];
  let line = '$';
  for (const word of words) {
    if (line.length + 1 + word.length + 2 > COLUMNS && line !== '$') {
      out.push(`${line} \\`);
      line = '   ';
    }
    line += ` ${word}`;
  }
  if (tail !== '' && line.length + 1 + tail.length > COLUMNS) {
    out.push(`${line} \\`);
    line = `   ${tail}`;
  } else if (tail !== '') line += ` ${tail}`;
  out.push(line);
  return out;
}
const lines = (text) => (text === '' ? [] : text.split('\n'));

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'dyadrr-screens-'));
  const dir = join(work, 'film');
  mkdirSync(dir);
  try {
    await films(work, dir);
    const dyadrr = (args, env) => exec(process.execPath, [BIN, ...args], dir, env);
    const n = (t) => normalize(t, dir);
    const screens = {};

    // 1. Aiuto
    const help = await dyadrr(['--help']);
    screens.help = terminal('dyadrr --help', [...command(['dyadrr', '--help']), ...lines(n(help.stdout))]);

    // 2. Analisi idonea
    const analyze = await dyadrr(['analyze', DONOR, REF, '--report', 'analisi.json']);
    if (analyze.code !== 0) throw new Error(`analyze: exit ${analyze.code}\n${analyze.stderr}`);
    const report = JSON.parse(readFileSync(join(dir, 'analisi.json'), 'utf8'));
    const summary = {
      decision: report.decision,
      roles: { reference: report.roles.reference, donor: report.roles.donor },
      offsetMs: report.measurement.offset.offsetMs,
      checkpoints: report.measurement.checkpoints.length,
      pending: report.plan.pending,
      warnings: report.warnings.map((w) => w.code),
    };
    screens.analyze = terminal('dyadrr analyze', [
      ...command(['dyadrr', 'analyze', DONOR, REF, '--report', 'analisi.json']),
      ...lines(n(analyze.stdout)),
      '$ echo $?',
      String(analyze.code),
      "$ jq '{decision, roles: {reference: .roles.reference, donor: .roles.donor}, \\",
      "    offsetMs: .measurement.offset.offsetMs, checkpoints: (.measurement.checkpoints | length), \\",
      "    pending: .plan.pending, warnings: [.warnings[].code]}' analisi.json",
      ...lines(n(json(summary))),
      '# roles: posizione dei file nel comando (0 il primo); offsetMs: lo spostamento S misurato',
    ]);

    // 3. Merge con l'analisi confermata
    const mergeArgs = ['merge', DONOR, REF, '--output', FINAL, '--expect', 'analisi.json', '--report', 'merge.json', '--inputs', 'keep'];
    const merge = await dyadrr(mergeArgs, { DYADRR_TAIL: 'trim' });
    if (merge.code !== 0) throw new Error(`merge: exit ${merge.code}\n${merge.stderr}`);
    const merged = JSON.parse(readFileSync(join(dir, 'merge.json'), 'utf8'));
    const pick = (t) => ({ source: t.source, type: t.type, language: t.language, name: t.name, default: t.default });
    screens.merge = terminal('dyadrr merge', [
      '$ export DYADRR_TAIL=trim',
      ...command(['dyadrr', ...mergeArgs]),
      ...lines(n(merge.stdout)),
      '$ echo $?',
      String(merge.code),
      "$ jq -c '.decision, .output.delivered, \\",
      "    (.output.build.tracks[] | {source, type, language, name, default})' merge.json",
      JSON.stringify(merged.decision),
      JSON.stringify(merged.output.delivered),
      ...merged.output.build.tracks.map((t) => JSON.stringify(pick(t))),
    ]);

    // 4. Un rifiuto: due film diversi
    const refusedArgs = ['analyze', OTHER, REF, '--report', 'rifiuto.json'];
    const refused = await dyadrr(refusedArgs);
    const refusal = JSON.parse(readFileSync(join(dir, 'rifiuto.json'), 'utf8'));
    screens.refused = terminal('dyadrr analyze: rifiuto', [
      ...command(['dyadrr', ...refusedArgs]),
      ...lines(n(refused.stdout)),
      '$ echo $?',
      String(refused.code),
      "$ jq '{decision, reasons}' rifiuto.json",
      ...lines(n(json({ decision: refusal.decision, reasons: refusal.reasons }))),
    ]);

    // 5. Avanzamento per Wayfinderr: --progress json
    const progressArgs = ['analyze', DONOR, REF, '--report', 'analisi-2.json', '--progress', 'json'];
    const progress = await dyadrr(progressArgs);
    const events = lines(progress.stderr.trim()).map((l) => JSON.parse(l));
    const shown = events.filter((e) => e.event !== 'progress' || e.done === e.total);
    screens.progress = terminal('dyadrr analyze --progress json', [
      ...command(['dyadrr', ...progressArgs], `2>&1 >/dev/null | jq -c 'select(.event != "progress" or .done == .total)'`),
      ...shown.map((e) => n(JSON.stringify(e))),
      '# elapsedMs cambia a ogni esecuzione: qui è sostituito da …',
    ]);

    // 6. dyadrr-pairs su un elenco di due coppie
    writeFileSync(join(dir, 'coppie.txt'), [
      '# Coppie di esempio',
      '[faro-di-velmora]',
      `input=${DONOR}`,
      `input=${REF}`,
      'expected=eligible',
      'category=uhd-bd',
      '',
      '[film-diversi]',
      `input=${OTHER}`,
      `input=${REF}`,
      'expected=refused',
      'category=different-film',
      '',
    ].join('\n'));
    const pairs = await exec(process.execPath, [PAIRS, 'coppie.txt'], dir);
    if (pairs.code !== 0) throw new Error(`dyadrr-pairs: exit ${pairs.code}\n${pairs.stderr}`);
    const series = JSON.parse(readFileSync(join(dir, 'coppie-results', 'summary.json'), 'utf8'));
    const rows = series.pairs.map((p) => ({ id: p.id, expected: p.expected, decision: p.decision, code: p.code, verdict: p.verdict, offsetMs: p.offset?.offsetMs ?? null }));
    screens.pairs = terminal('dyadrr-pairs', [
      ...command(['dyadrr-pairs', 'coppie.txt']),
      ...lines(n(pairs.stderr)).filter((l) => l !== ''),
      ...lines(n(pairs.stdout)),
      "$ jq '[.pairs[] | {id, expected, decision, code, verdict, offsetMs: .offset.offsetMs}]' \\",
      '    coppie-results/summary.json',
      ...lines(n(json(rows))),
    ]);

    mkdirSync(OUT, { recursive: true });
    for (const [name, svg] of Object.entries(screens)) {
      writeFileSync(join(OUT, `${name}.svg`), svg);
      console.log(`docs/img/screens/${name}.svg`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
