// Le regole della pulizia dei branch (scripts/branch-cleanup.mjs, docs/WORKFLOW.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// I test girano da build/test/.
const ROOT = resolve(__dirname, '..', '..');

interface Pull { number: number; state: 'open' | 'closed'; mergedAt: string | null; closedAt: string | null; createdAt: string; headSha: string }
interface Branch { name: string; sha: string; protected: boolean; lastCommitAt: string | null; inDefault: boolean; pulls: Pull[] }
interface Config { closedUnmergedDays: number; staleDays: number; keep: string[]; keepPrefixes: string[] }
interface Decision { action: 'delete' | 'keep'; rule: string; reason: string }
interface Module {
  decide: (b: Branch, ctx: { defaultBranch: string; now: Date; config: Config }) => Decision;
  parseConfig: (text: string) => Config;
  loadConfig: () => Config;
}

// Lo script è un modulo ES: si carica con import() dal percorso.
const load = () => import(pathToFileURL(join(ROOT, 'scripts', 'branch-cleanup.mjs')).href) as Promise<Module>;

const NOW = new Date('2026-11-16T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const config: Config = { closedUnmergedDays: 14, staleDays: 30, keep: ['main', 'gh-pages'], keepPrefixes: ['keep/'] };

const branch = (b: Partial<Branch>): Branch => ({ name: 'claude/x', sha: 'aaa', protected: false, lastCommitAt: daysAgo(1), inDefault: false, pulls: [], ...b });
const pull = (p: Partial<Pull>): Pull => ({ number: 1, state: 'closed', mergedAt: null, closedAt: daysAgo(1), createdAt: daysAgo(2), headSha: 'aaa', ...p });

test('branch-cleanup: la configurazione versionata è valida, una sbagliata no', async () => {
  const { loadConfig, parseConfig } = await load();
  const c = loadConfig();
  assert.ok(c.keep.includes('main'));
  assert.ok(c.closedUnmergedDays > 0 && c.staleDays >= c.closedUnmergedDays);
  assert.deepEqual(parseConfig(readFileSync(join(ROOT, '.github', 'branch-cleanup.json'), 'utf8')), c);
  assert.throws(() => parseConfig('{"closedUnmergedDays":0,"staleDays":30,"keep":[],"keepPrefixes":[]}'), /closedUnmergedDays/);
  assert.throws(() => parseConfig('{"closedUnmergedDays":14,"staleDays":30,"keep":[""],"keepPrefixes":[]}'), /keep/);
});

test('branch-cleanup: default, protetti, eccezioni e PR aperte non si toccano mai', async () => {
  const { decide } = await load();
  const ctx = { defaultBranch: 'main', now: NOW, config };
  const old = { lastCommitAt: daysAgo(400), inDefault: true };
  assert.equal(decide(branch({ ...old, name: 'main' }), ctx).rule, 'default');
  assert.equal(decide(branch({ ...old, protected: true }), ctx).rule, 'protected');
  assert.equal(decide(branch({ ...old, name: 'gh-pages' }), ctx).rule, 'exception');
  assert.equal(decide(branch({ ...old, name: 'keep/esperimento' }), ctx).rule, 'exception');
  const open = decide(branch({ ...old, pulls: [pull({ number: 7, state: 'open', closedAt: null }), pull({ number: 3, mergedAt: daysAgo(90) })] }), ctx);
  assert.deepEqual([open.action, open.rule], ['keep', 'open-pr']);
});

test('branch-cleanup: PR mergiata, branch già in main, PR chiusa da tempo, branch abbandonato', async () => {
  const { decide } = await load();
  const ctx = { defaultBranch: 'main', now: NOW, config };
  const d = (b: Partial<Branch>) => { const r = decide(branch(b), ctx); return `${r.action}:${r.rule}`; };

  // 1. PR mergiata: subito, anche se squash (la testa è quella della PR)…
  assert.equal(d({ pulls: [pull({ mergedAt: daysAgo(0) })] }), 'delete:merged');
  // …ma non se sul branch ci sono commit dopo il merge: lavoro nuovo.
  assert.equal(d({ sha: 'bbb', pulls: [pull({ mergedAt: daysAgo(0) })] }), 'keep:new-commits');
  // Conta l'ultima PR del branch.
  assert.equal(d({ sha: 'ccc', pulls: [pull({ number: 1, mergedAt: daysAgo(40), createdAt: daysAgo(50), headSha: 'aaa' }), pull({ number: 2, mergedAt: daysAgo(1), createdAt: daysAgo(3), headSha: 'ccc' })] }), 'delete:merged');

  // 2. La testa è già in main, con o senza PR.
  assert.equal(d({ inDefault: true }), 'delete:in-default');

  // 3. PR chiusa senza merge: dopo 14 giorni sì, prima no.
  assert.equal(d({ pulls: [pull({ closedAt: daysAgo(15) })] }), 'delete:closed');
  assert.equal(d({ pulls: [pull({ closedAt: daysAgo(3) })] }), 'keep:recently-closed');
  assert.equal(d({ sha: 'bbb', pulls: [pull({ closedAt: daysAgo(60) })] }), 'keep:new-commits');

  // 4. Nessuna PR: dopo 30 giorni senza commit sì, prima no.
  assert.equal(d({ lastCommitAt: daysAgo(31) }), 'delete:stale');
  assert.equal(d({ lastCommitAt: daysAgo(29) }), 'keep:recent');
  assert.equal(d({ lastCommitAt: null }), 'keep:recent');
});
