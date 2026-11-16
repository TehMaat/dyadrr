#!/usr/bin/env node
// Diagrammi della documentazione: da docs/diagrams/<nome>.mmd (Mermaid) a
// docs/img/diagrams/<nome>.svg (tema chiaro) e <nome>-dark.svg (tema scuro).
//
// Ogni SVG comincia con un commento con lo SHA-256 del sorgente: il test
// test/docs.test.ts lo confronta con il .mmd e fallisce se un diagramma non è
// stato rigenerato dopo una modifica. Così npm test non ha bisogno di un
// browser, e lo serve solo chi cambia un diagramma.
//
// Uso:
//   npm run docs:diagrams            rigenera gli SVG cambiati (--all: tutti)
//   npm run docs:diagrams -- --check controlla solo le impronte
//
// Il rendering usa @mermaid-js/mermaid-cli (versione fissata sotto) con npx, e
// un Chromium: quello di Puppeteer, oppure CHROME_PATH.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = join(ROOT, 'docs', 'diagrams');
const OUT = join(ROOT, 'docs', 'img', 'diagrams');
export const MERMAID_CLI = '@mermaid-js/mermaid-cli@11.4.2';

/** Le varianti di ogni diagramma: suffisso del file e tema di Mermaid. */
export const VARIANTS = [
  { suffix: '', theme: 'default' },
  { suffix: '-dark', theme: 'dark' },
];

export const sourceHash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
export const hashComment = (name, hash) => `<!-- docs/diagrams/${name}.mmd sha256:${hash} -->`;

/** Lo SHA-256 scritto in testa a un SVG, o null. */
export function svgHash(svg) {
  return /^<!-- docs\/diagrams\/[\w-]+\.mmd sha256:([0-9a-f]{64}) -->/.exec(svg)?.[1] ?? null;
}

export function diagramNames(dir = SOURCES) {
  return readdirSync(dir).filter((f) => f.endsWith('.mmd')).map((f) => f.slice(0, -4)).sort();
}

/** I diagrammi il cui SVG manca o non corrisponde al sorgente. */
export function stale(root = ROOT) {
  const out = [];
  for (const name of diagramNames(join(root, 'docs', 'diagrams'))) {
    const hash = sourceHash(readFileSync(join(root, 'docs', 'diagrams', `${name}.mmd`), 'utf8'));
    for (const { suffix } of VARIANTS) {
      const svg = join(root, 'docs', 'img', 'diagrams', `${name}${suffix}.svg`);
      if (!existsSync(svg) || svgHash(readFileSync(svg, 'utf8')) !== hash) out.push(`${name}${suffix}.svg`);
    }
  }
  return out;
}

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p;
  }
  return null;
}

function render(name, all) {
  const source = readFileSync(join(SOURCES, `${name}.mmd`), 'utf8');
  const hash = sourceHash(source);
  const work = mkdtempSync(join(tmpdir(), 'dyadrr-diagrams-'));
  try {
    const browser = chrome();
    const puppeteer = join(work, 'puppeteer.json');
    writeFileSync(puppeteer, JSON.stringify({ ...(browser ? { executablePath: browser } : {}), args: ['--no-sandbox'] }));
    const config = join(work, 'mermaid.json');
    writeFileSync(config, JSON.stringify({ flowchart: { htmlLabels: true, curve: 'basis' }, fontFamily: 'Helvetica, Arial, sans-serif' }));
    for (const { suffix, theme } of VARIANTS) {
      const target = join(OUT, `${name}${suffix}.svg`);
      if (!all && existsSync(target) && svgHash(readFileSync(target, 'utf8')) === hash) continue;
      const raw = join(work, `${name}${suffix}.svg`);
      const [cmd, args] = process.env.MMDC ? [process.env.MMDC, []] : ['npx', ['--yes', '-p', MERMAID_CLI, 'mmdc']];
      const r = spawnSync(cmd, [...args, '-q', '-p', puppeteer, '-c', config, '-t', theme, '-b', 'transparent', '-i', join(SOURCES, `${name}.mmd`), '-o', raw], {
        stdio: 'inherit',
        env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: browser ? '1' : (process.env.PUPPETEER_SKIP_DOWNLOAD ?? '') },
      });
      if (r.status !== 0) throw new Error(`mmdc failed on ${name}.mmd (${theme})`);
      writeFileSync(target, `${hashComment(name, hash)}\n${readFileSync(raw, 'utf8')}`);
      console.log(`docs/img/diagrams/${name}${suffix}.svg`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const bad = stale();
    if (bad.length > 0) {
      console.error(`Diagrams out of date (run npm run docs:diagrams): ${bad.join(', ')}`);
      process.exitCode = 1;
    } else console.log('Diagrams up to date');
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const names = diagramNames();
  for (const name of names) render(name, args.includes('--all'));
  // Gli SVG senza più un sorgente si tolgono.
  const expected = new Set(names.flatMap((n) => VARIANTS.map((v) => `${n}${v.suffix}.svg`)));
  for (const f of readdirSync(OUT)) {
    if (f.endsWith('.svg') && !expected.has(f)) {
      rmSync(join(OUT, f));
      console.log(`removed docs/img/diagrams/${f}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
