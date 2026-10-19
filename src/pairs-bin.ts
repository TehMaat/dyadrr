#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { EXIT_CODES } from './codes.js';
import { runPairs } from './pairs.js';
import { dyadrrVersion } from './report.js';

// Il processo `dyadrr-pairs` (studio §15, fase 1, punto 3): segnali di stop e
// argomenti. La serie è in `pairs.ts`.

const USAGE = `Usage: dyadrr-pairs <list> [--results <dir>] [--only <id>]... [--again]

Runs dyadrr analyze on each pair of <list>, one at a time, and summarizes the
reports for the calibration: <id>.json and <id>.log for each pair,
summary.json and summary.md for the series, in <dir> (default: <list without
extension>-results next to the list). A report from the same Dyadrr and
calibration is reused, unless --again. --only measures only that pair.

Exit codes: 0 done, 30 list or argument error, 40 summary not written,
50 cancelled.
`;

let parsed;
try {
  parsed = parseArgs({
    options: {
      results: { type: 'string' },
      only: { type: 'string', multiple: true },
      again: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
} catch (e) {
  process.stderr.write(`dyadrr-pairs: BAD_ARGUMENTS: ${(e as Error).message}\n${USAGE}`);
  process.exit(EXIT_CODES.inputError);
}
const { values, positionals } = parsed;
if (values.help) {
  process.stdout.write(USAGE);
  process.exit(EXIT_CODES.eligible);
}
if (values.version) {
  process.stdout.write(`dyadrr-pairs ${dyadrrVersion()}\n`);
  process.exit(EXIT_CODES.eligible);
}
if (positionals.length !== 1) {
  process.stderr.write(`dyadrr-pairs: BAD_ARGUMENTS: expected one list of pairs, got ${positionals.length}\n${USAGE}`);
  process.exit(EXIT_CODES.inputError);
}

const controller = new AbortController();
let stops = 0;
const log = (line: string) => process.stderr.write(`dyadrr-pairs: ${line}\n`);

/** Il primo segnale annulla la coppia in corso e ferma la serie; il secondo esce subito. */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (++stops > 1) process.exit(EXIT_CODES.cancelled);
    log(`${signal}: stopping`);
    controller.abort();
  });
}

runPairs({
  list: positionals[0]!,
  ...(values.results === undefined ? {} : { results: values.results }),
  ...(values.only === undefined ? {} : { only: values.only }),
  again: values.again === true,
  signal: controller.signal,
  log,
  stdout: (text) => process.stdout.write(text),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    log(`INTERNAL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    process.exitCode = EXIT_CODES.internalError;
  },
);
