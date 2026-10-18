#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { runCli } from './cli.js';
import { CancelledError, EXIT_CODES } from './codes.js';

// Il processo `dyadrr` (studio §10): segnali di stop, terminale, codice di
// uscita. Tutto il resto è in `cli.ts`.

const controller = new AbortController();
let stops = 0;

/**
 * Un segnale di stop annulla il lavoro: i programmi esterni ricevono
 * SIGTERM, i temporanei si eliminano e il report dice `cancelled`. Un secondo
 * segnale esce subito, senza pulizia (gli avanzi si eliminano all'avvio
 * successivo, §6.4).
 */
function stop(signal: NodeJS.Signals): void {
  if (++stops > 1) process.exit(EXIT_CODES.cancelled);
  controller.abort(new CancelledError(`received ${signal}`));
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => stop(signal));

/** Una domanda nel terminale; in un terminale Ctrl-C arriva a readline, non al processo. */
function ask(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    let done = false;
    const finish = (answer: string | null) => {
      if (done) return;
      done = true;
      rl.close();
      resolve(answer);
    };
    rl.on('SIGINT', () => {
      stop('SIGINT');
      finish(null);
    });
    rl.on('close', () => finish(null));
    rl.question(question, finish);
  });
}

const interactive = process.stdin.isTTY === true && process.stderr.isTTY === true;

runCli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  signal: controller.signal,
  ...(interactive ? { ask } : {}),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`dyadrr: INTERNAL: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exitCode = EXIT_CODES.internalError;
  },
);
