#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dyadrrVersion } from './report.js';
import { RUNNER, runRunner } from './runner.js';

// Il processo `dyadrr-runner` (studio §14.1), il comando di default
// dell'immagine: segnali di stop e argomenti. Il protocollo è in `runner.ts`.

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
const log = (line: string) => process.stderr.write(`dyadrr-runner: ${line}\n`);

/** Il primo segnale chiude il lavoro in corso (annullato) e ferma il runner; il secondo esce subito. */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (++stops > 1) process.exit(1);
    log(`${signal}: stopping`);
    controller.abort();
  });
}

const dataDir = values.data ?? RUNNER.dataDir;
log(`dyadrr ${dyadrrVersion()}, jobs in ${dataDir}/${RUNNER.jobs}`);
runRunner({ dataDir, signal: controller.signal, log }).then(
  () => {
    log('stopped');
  },
  (e: unknown) => {
    log(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
