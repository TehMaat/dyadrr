import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, EXIT_CODES, REFUSAL_CODES, WARNING_CODES, exitCodeFor } from '../src/codes.js';

test('i codici sono unici tra rifiuti, errori e avvisi', () => {
  const all = [...REFUSAL_CODES, ...ERROR_CODES, ...WARNING_CODES, 'CANCELLED'];
  assert.equal(new Set(all).size, all.length);
});

test('codici di uscita', () => {
  assert.equal(exitCodeFor('eligible'), 0);
  assert.equal(exitCodeFor('refused'), 20);
  assert.equal(exitCodeFor('error', 'NO_SPACE'), 30);
  assert.equal(exitCodeFor('error', 'CHOICE_REQUIRED'), 30);
  assert.equal(exitCodeFor('error', 'MERGE_FAILED'), 40);
  assert.equal(exitCodeFor('error', 'VERIFY_FAILED'), 40);
  assert.equal(exitCodeFor('error', 'INTERNAL'), 40);
  assert.equal(exitCodeFor('error'), 40);
  assert.equal(exitCodeFor('cancelled'), 50);
});

test('nessun codice di uscita coincide con quelli che Node usa da solo', () => {
  const node = new Set([1, 3, 4, 5, 6, 7, 9, 10, 12, 13, 14]);
  for (const code of Object.values(EXIT_CODES)) {
    assert.ok(!node.has(code) && code <= 128, String(code));
  }
});
