import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoPendingChoices,
  pendingChoices,
  readGivenChoices,
  resolveChoices,
  type ChoiceName,
} from '../src/choices.js';
import { DyadrrError } from '../src/codes.js';

const isCode = (code: string) => (e: unknown) => e instanceof DyadrrError && e.code === code;

test('l\'opzione vince sulla variabile d\'ambiente', () => {
  const given = readGivenChoices({ tail: 'keep' }, { DYADRR_TAIL: 'trim', DYADRR_EDGE_MISMATCH: 'keep' });
  assert.deepEqual(given, {
    tail: { value: 'keep', origin: 'option' },
    edgeMismatch: { value: 'keep', origin: 'env' },
  });
});

test('variabile d\'ambiente vuota = non impostata', () => {
  assert.deepEqual(readGivenChoices({}, { DYADRR_ITALIAN: '  ' }), {});
});

test('valori non validi sono BAD_ARGUMENTS, da opzione o da variabile', () => {
  assert.throws(() => readGivenChoices({ italian: 'some' }, {}), isCode('BAD_ARGUMENTS'));
  assert.throws(() => readGivenChoices({}, { DYADRR_REFERENCE_ITALIAN_SUBS: 'yes' }), isCode('BAD_ARGUMENTS'));
  // Anche quando un'opzione valida sovrascrive la variabile sbagliata.
  assert.throws(
    () => readGivenChoices({ tail: 'trim' }, { DYADRR_TAIL: 'cut' }),
    isCode('BAD_ARGUMENTS'),
  );
});

test('una scelta si chiede solo se serve', () => {
  const needed = new Set<ChoiceName>(['edgeMismatch', 'italian']);
  const states = resolveChoices(needed, readGivenChoices({ tail: 'trim', italian: 'all' }, {}));
  assert.deepEqual(states, [
    { name: 'tail', needed: false, status: 'ignored', value: 'trim', origin: 'option' },
    { name: 'italian', needed: true, status: 'decided', value: 'all', origin: 'option' },
    { name: 'referenceItalianSubs', needed: false, status: 'not-needed' },
    { name: 'edgeMismatch', needed: true, status: 'pending' },
  ]);
  assert.deepEqual(pendingChoices(states), ['edgeMismatch']);
});

test('merge senza terminale: una scelta in sospeso è CHOICE_REQUIRED', () => {
  const pending = resolveChoices(new Set<ChoiceName>(['edgeMismatch']), {});
  assert.throws(() => assertNoPendingChoices(pending), isCode('CHOICE_REQUIRED'));

  const decided = resolveChoices(
    new Set<ChoiceName>(['edgeMismatch']),
    readGivenChoices({}, { DYADRR_EDGE_MISMATCH: 'drop' }),
  );
  assert.doesNotThrow(() => assertNoPendingChoices(decided));
});
