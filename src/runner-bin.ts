#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dyadrrVersion } from './report.js';
import { RUNNER, logLine, runRunner, type RunnerLogEntry } from './runner.js';

// Il processo `dyadrr-runner` (studio §14.1), il comando di default
// dell'immagine: segnali di stop e argomenti. Il protocollo è in `runner.ts`,
// che scrive le righe del log anche in `dyadrr.runner.jsonl`; qui vanno su
// stderr.

const USAGE = `Usage: dyadrr-runner [--data <dir>]

Runs the Dyadrr jobs that Wayfinderr writes in <dir>/${RUNNER.jobs}/,
one at a time. <dir> (default ${RUNNER.dataDir}) holds the shared folders, the
watched folder as <dir>/${RUNNER.watch}. Stop it with SIGTERM: a running job is
cancelled and closed first.
`;

let values;
try {
  ({ values } = parseArgs({
    options: { data: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' } },
    strict: true,
  }));
} catch (e) {
  process.stderr.write(`dyadrr-runner: ${(e as Error).message}\n${USAGE}`);
  process.exit(2);
}
if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (values.version) {
  process.stdout.write(`dyadrr-runner ${dyadrrVersion()}\n`);
  process.exit(0);
}

const controller = new AbortController();
let stops = 0;
const log = (entry: RunnerLogEntry) => process.stderr.write(`dyadrr-runner: ${logLine(entry)}\n`);

/**
 * Il primo segnale chiude il lavoro in corso (annullato) e ferma il runner,
 * che scrive "<segnale>: stopping"; il secondo esce subito.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (++stops > 1) process.exit(1);
    controller.abort(signal);
  });
}

// Avvio, stop ed errori li scrive il runner.
runRunner({ dataDir: values.data ?? RUNNER.dataDir, signal: controller.signal, log }).catch(() => {
  process.exitCode = 1;
});
