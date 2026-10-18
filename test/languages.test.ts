import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalLanguage,
  chooseMeasureLanguage,
  isItalian,
  parseOriginalLanguage,
  trackLanguage,
} from '../src/languages.js';
import { DyadrrError } from '../src/codes.js';

test('canonicalLanguage riduce 639-1, 639-2/B, 639-2/T e IETF alla stessa forma', () => {
  for (const code of ['fre', 'fra', 'fr', 'FR', 'fr-CA', 'FRA']) {
    assert.equal(canonicalLanguage(code), 'fre', code);
  }
  for (const code of ['ger', 'deu', 'de', 'de-DE']) {
    assert.equal(canonicalLanguage(code), 'ger', code);
  }
  assert.equal(canonicalLanguage('zh-Hans'), 'chi');
  assert.equal(canonicalLanguage('es-419'), 'spa');
});

test('canonicalLanguage non conta und, codici non linguistici e valori vuoti', () => {
  for (const code of ['und', 'zxx', 'mis', 'mul', '', 'xx', 'english', '123', null, undefined]) {
    assert.equal(canonicalLanguage(code), null, String(code));
  }
});

test('italiano: ita, it e it-*; mai und', () => {
  assert.equal(isItalian({ language: 'ita' }), true);
  assert.equal(isItalian({ language: 'it' }), true);
  assert.equal(isItalian({ languageIetf: 'it-IT' }), true);
  assert.equal(isItalian({ language: 'und' }), false);
  assert.equal(isItalian({}), false);
});

test('il campo IETF vince sul campo classico, se indica una lingua', () => {
  assert.equal(trackLanguage({ language: 'eng', languageIetf: 'it' }), 'ita');
  assert.equal(trackLanguage({ language: 'ita', languageIetf: 'und' }), 'ita');
});

test('--original-language accetta ITA, ENG, jpn, fr; rifiuta il resto', () => {
  assert.equal(parseOriginalLanguage('ITA'), 'ita');
  assert.equal(parseOriginalLanguage('ENG'), 'eng');
  assert.equal(parseOriginalLanguage('jpn'), 'jpn');
  assert.equal(parseOriginalLanguage('fr'), 'fre');
  for (const bad of ['english', 'und', '', 'x1']) {
    assert.throws(
      () => parseOriginalLanguage(bad),
      (e) => e instanceof DyadrrError && e.code === 'BAD_ARGUMENTS',
      bad,
    );
  }
});

test('lingua di misura: prima la lingua originale, se in comune', () => {
  assert.deepEqual(chooseMeasureLanguage(['jpn', 'eng'], ['ita', 'eng', 'jpn'], 'jpn'), {
    language: 'jpn',
    reason: 'original',
    originalNotCommon: false,
  });
});

test('lingua di misura: poi l\'inglese, con avviso se l\'originale non è in comune', () => {
  assert.deepEqual(chooseMeasureLanguage(['eng', 'fre'], ['ita', 'eng'], 'jpn'), {
    language: 'eng',
    reason: 'english',
    originalNotCommon: true,
  });
  assert.deepEqual(chooseMeasureLanguage(['fre', 'eng'], ['ita', 'eng', 'fre'], null), {
    language: 'eng',
    reason: 'english',
    originalNotCommon: false,
  });
});

test('lingua di misura: l\'italiano non lo è mai, nemmeno se è la lingua originale', () => {
  assert.deepEqual(chooseMeasureLanguage(['ita', 'eng'], ['ita', 'eng'], 'ita'), {
    language: 'eng',
    reason: 'english',
    originalNotCommon: false,
  });
  assert.equal(chooseMeasureLanguage(['ita'], ['ita'], 'ita'), null);
});

test('lingua di misura: poi un\'altra lingua in comune, altrimenti nessuna', () => {
  assert.deepEqual(chooseMeasureLanguage(['ger', 'fre'], ['ita', 'fre', 'ger'], null), {
    language: 'ger',
    reason: 'other',
    originalNotCommon: false,
  });
  assert.equal(chooseMeasureLanguage(['eng'], ['ita', 'jpn'], null), null);
});
