#!/usr/bin/env node
// Pulizia dei branch (CONTRIBUTING.md, "Branch"; docs/WORKFLOW.md).
//
// Le regole stanno in `decide`, una funzione pura provata da
// test/branch-cleanup.test.ts; i numeri e le eccezioni in
// .github/branch-cleanup.json. Il resto legge i branch e le PR dall'API di
// GitHub e cancella i branch decisi, oppure li elenca soltanto (--dry-run).
//
// Uso (nel workflow Branch cleanup):
//   node scripts/branch-cleanup.mjs [--dry-run] [--branch <nome>]
// Variabili: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo), GITHUB_API_URL,
// GITHUB_STEP_SUMMARY (facoltativa: il riepilogo in Markdown).

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 24 * 60 * 60 * 1000;

/** La configurazione, con i suoi controlli. */
export function parseConfig(text) {
  const c = JSON.parse(text);
  const days = (k) => {
    if (!Number.isInteger(c[k]) || c[k] < 1) throw new Error(`branch-cleanup.json: ${k} must be a positive integer`);
    return c[k];
  };
  const list = (k) => {
    if (!Array.isArray(c[k]) || !c[k].every((x) => typeof x === 'string' && x !== '')) {
      throw new Error(`branch-cleanup.json: ${k} must be a list of non-empty strings`);
    }
    return c[k];
  };
  return { closedUnmergedDays: days('closedUnmergedDays'), staleDays: days('staleDays'), keep: list('keep'), keepPrefixes: list('keepPrefixes') };
}

export const loadConfig = () => parseConfig(readFileSync(join(ROOT, '.github', 'branch-cleanup.json'), 'utf8'));

/**
 * Cancellare o tenere un branch. Le regole, nell'ordine:
 *
 * Si tiene sempre: il branch di default, un branch protetto, uno in `keep` o
 * con un prefisso di `keepPrefixes`, uno con una PR aperta (anche draft).
 * Si cancella se:
 *   1. `merged`: l'ultima PR del branch è mergiata e il branch non ha commit
 *      dopo (la sua testa è quella della PR, o è già in main);
 *   2. `in-default`: la sua testa è già contenuta nel branch di default;
 *   3. `closed`: l'ultima PR è chiusa senza merge da più di `closedUnmergedDays`
 *      e il branch non ha commit dopo;
 *   4. `stale`: nessuna PR e nessun commit da più di `staleDays`.
 * Altrimenti si tiene.
 *
 * @param {object} b
 * @param {string} b.name
 * @param {string} b.sha                 testa del branch
 * @param {boolean} b.protected
 * @param {string|null} b.lastCommitAt   data dell'ultimo commit, ISO 8601
 * @param {boolean} b.inDefault          la testa è contenuta nel branch di default
 * @param {Array<{number:number,state:'open'|'closed',mergedAt:string|null,closedAt:string|null,createdAt:string,headSha:string}>} b.pulls
 * @param {object} ctx
 * @param {string} ctx.defaultBranch
 * @param {Date} ctx.now
 * @param {ReturnType<typeof parseConfig>} ctx.config
 * @returns {{ action: 'delete'|'keep', rule: string, reason: string }}
 */
export function decide(b, { defaultBranch, now, config }) {
  const keep = (rule, reason) => ({ action: 'keep', rule, reason });
  const del = (rule, reason) => ({ action: 'delete', rule, reason });
  const ageDays = (iso) => (iso === null ? null : (now.getTime() - Date.parse(iso)) / DAY_MS);

  if (b.name === defaultBranch) return keep('default', 'default branch');
  if (b.protected) return keep('protected', 'protected branch');
  if (config.keep.includes(b.name)) return keep('exception', 'listed in keep');
  const prefix = config.keepPrefixes.find((p) => b.name.startsWith(p));
  if (prefix !== undefined) return keep('exception', `prefix ${prefix}`);

  const open = b.pulls.filter((p) => p.state === 'open');
  if (open.length > 0) return keep('open-pr', `open PR #${open.map((p) => p.number).join(', #')}`);

  const last = [...b.pulls].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))[0];
  const unchanged = last !== undefined && (last.headSha === b.sha || b.inDefault);
  if (last?.mergedAt && unchanged) return del('merged', `PR #${last.number} merged`);
  if (b.inDefault) return del('in-default', `already in ${defaultBranch}`);
  if (last && !last.mergedAt && unchanged) {
    const days = ageDays(last.closedAt);
    if (days !== null && days > config.closedUnmergedDays) {
      return del('closed', `PR #${last.number} closed without merge ${Math.floor(days)} days ago`);
    }
    return keep('recently-closed', `PR #${last.number} closed ${days === null ? '' : `${Math.floor(days)} days ago`}`.trim());
  }
  const idle = ageDays(b.lastCommitAt);
  if (last === undefined && idle !== null && idle > config.staleDays) {
    return del('stale', `no PR, last commit ${Math.floor(idle)} days ago`);
  }
  if (last !== undefined) return keep('new-commits', `commits after PR #${last.number}`);
  return keep('recent', idle === null ? 'no PR' : `no PR, last commit ${Math.floor(idle)} days ago`);
}

// ---------------------------------------------------------------- GitHub

async function api(path, { method = 'GET' } = {}) {
  const base = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dyadrr-branch-cleanup',
    },
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return { body: res.status === 204 ? null : await res.json(), link: res.headers.get('link') ?? '' };
}

async function all(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const { body, link } = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...body);
    if (!link.includes('rel="next"')) return out;
  }
}

const enc = (s) => encodeURIComponent(s);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : null;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const config = loadConfig();
  const now = new Date();

  const { body: info } = await api(`/repos/${repo}`);
  const defaultBranch = info.default_branch;
  const branches = (await all(`/repos/${repo}/branches`)).filter((b) => only === null || b.name === only);
  const pulls = await all(`/repos/${repo}/pulls?state=all`);

  const results = [];
  for (const br of branches) {
    const own = pulls
      .filter((p) => p.head?.ref === br.name && p.head?.repo?.full_name === repo)
      .map((p) => ({ number: p.number, state: p.state, mergedAt: p.merged_at, closedAt: p.closed_at, createdAt: p.created_at, headSha: p.head.sha }));
    let inDefault = false;
    let lastCommitAt = null;
    if (br.name !== defaultBranch) {
      const { body: cmp } = await api(`/repos/${repo}/compare/${enc(defaultBranch)}...${enc(br.name)}`);
      inDefault = cmp.status === 'behind' || cmp.status === 'identical';
      const { body: commit } = await api(`/repos/${repo}/commits/${br.commit.sha}`);
      lastCommitAt = commit.commit?.committer?.date ?? null;
    }
    const d = decide({ name: br.name, sha: br.commit.sha, protected: br.protected, lastCommitAt, inDefault, pulls: own }, { defaultBranch, now, config });
    if (d.action === 'delete' && !dryRun) await api(`/repos/${repo}/git/refs/heads/${br.name.split('/').map(enc).join('/')}`, { method: 'DELETE' });
    results.push({ name: br.name, ...d });
    console.log(`${d.action === 'delete' ? (dryRun ? 'would delete' : 'deleted') : 'kept'}\t${br.name}\t${d.rule}: ${d.reason}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const verb = dryRun ? 'Would delete (dry run)' : 'Deleted';
    const lines = [
      `## Branch cleanup${dryRun ? ' (dry run)' : ''}`,
      '',
      `${verb}: ${results.filter((r) => r.action === 'delete').length}; kept: ${results.filter((r) => r.action === 'keep').length}.`,
      '',
      '| Branch | Action | Rule | Reason |',
      '|---|---|---|---|',
      ...results.map((r) => `| \`${r.name}\` | ${r.action === 'delete' ? (dryRun ? 'would delete' : 'deleted') : 'kept'} | ${r.rule} | ${r.reason} |`),
      '',
    ];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
