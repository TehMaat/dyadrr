import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALIBRATION_LIMITS, CALIBRATION_NAMES, loadCalibration, parseCalibration } from '../src/calibration.js';
import { DyadrrError } from '../src/codes.js';

test('il file di taratura versionato è completo e dentro i limiti', () => {
  const cal = loadCalibration();
  assert.deepEqual(Object.keys(cal.values).sort(), [...CALIBRATION_NAMES].sort());
  // Le soglie ancora da tarare sono segnate come provvisorie.
  for (const name of ['nccMin', 'peakRatioMin', 'silenceDbfs', 'measureMixDiffersBand'] as const) {
    assert.ok(cal.provisional.includes(name), name);
  }
});

test('i limiti non superano le regole fisse dello studio (§9.1)', () => {
  assert.ok(CALIBRATION_LIMITS.toleranceMs.max <= 30);
  assert.ok(CALIBRATION_LIMITS.maxOffsetMs.max <= 300_000);
  // 24 contro 23,976 deve sempre risultare un framerate diverso.
  assert.ok(CALIBRATION_LIMITS.fpsRelativeTolerance.max < 1001 / 1000 - 1);
});

test('BAD_ARGUMENTS: un valore di taratura fuori dai limiti, mancante o sconosciuto', () => {
  const isBadArguments = (e: unknown) => e instanceof DyadrrError && e.code === 'BAD_ARGUMENTS';
  const good = loadCalibration();
  const withValues = (values: Record<string, unknown>) => ({
    version: good.version,
    values: { ...good.values, ...values },
    provisional: good.provisional,
  });

  for (const values of [
    { toleranceMs: 31 },
    { maxOffsetMs: 301_000 },
    { fpsRelativeTolerance: 0.001 },
    { nccMin: 0 },
    { minConsistentCheckpoints: 20.5 },
    { silenceDbfs: '-50' },
    { unknownThreshold: 1 },
  ]) {
    assert.throws(() => parseCalibration(withValues(values)), isBadArguments, JSON.stringify(values));
  }

  const { toleranceMs: _, ...withoutTolerance } = good.values;
  assert.throws(() => parseCalibration({ ...good, values: withoutTolerance }), isBadArguments);
  assert.throws(() => parseCalibration({ ...good, provisional: ['nope'] }), isBadArguments);
  assert.throws(() => parseCalibration({ ...good, version: 0 }), isBadArguments);
  assert.throws(() => parseCalibration(null), isBadArguments);
});
