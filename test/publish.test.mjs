// The Pages publish (scripts/publish.cjs) and the state kept between builds (scripts/lib.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { newerState, stateStamp, siteAgeProblem, STUCK_MIN } from '../scripts/lib.mjs';
import { longShot, MULTI_TARGETS } from '../js/track.js';

const publish = createRequire(import.meta.url)('../scripts/publish.cjs');
const T = 'a'.repeat(40), C = 'c'.repeat(40);
const fake = (statuses, { refuse = [] } = {}) => {
  const calls = [];
  const github = { request: async (route, args) => {
    calls.push([route, args]);
    if (route.startsWith('POST') && route.endsWith('/deployments')) {
      if (refuse.includes(args.pages_build_version)) throw Object.assign(new Error('Not Found'), { status: 404 });
      return { data: { id: 'd1', page_url: 'https://x.github.io/ATLAS/' } };
    }
    if (route.startsWith('GET')) return { data: { status: statuses.shift() } };
    return { data: {} };
  } };
  const out = {};
  const core = { getIDToken: async () => 'oidc', info() {}, warning() {}, setOutput: (k, v) => { out[k] = v; } };
  return { github, core, calls, out };
};
const context = { repo: { owner: 'Vedant-x', repo: 'ATLAS' }, sha: C, runId: 42 };
const posts = (f) => f.calls.filter(([r]) => r.startsWith('POST') && r.endsWith('/deployments')).map(([, a]) => a.pages_build_version);

test('publish: under this build\'s own commit (the track record\'s), and waits until it is live', async () => {
  const f = fake(['deployment_in_progress', 'syncing_files', 'succeed']);
  assert.equal(await publish({ ...f, context }, { artifactId: '777', versions: [T], sleep: async () => {} }), 'succeed');
  assert.deepEqual(posts(f), [T]);
  const [, args] = f.calls[0];
  assert.equal(args.artifact_id, 777);
  assert.equal(args.oidc_token, 'oidc');
  assert.equal(f.out.version, T);
  assert.equal(f.out.page_url, 'https://x.github.io/ATLAS/');
});

test('publish: a version GitHub refuses falls back to the commit, as before; never a made-up version', async () => {
  const f = fake(['succeed'], { refuse: [T] });
  assert.equal(await publish({ ...f, context }, { artifactId: '1', versions: [T], sleep: async () => {} }), 'succeed');
  assert.deepEqual(posts(f), [T, C]);
  assert.equal(f.out.version, C);
  // No track-record commit (nothing changed), or not a commit: straight to the commit.
  const g = fake(['succeed']);
  await publish({ ...g, context }, { artifactId: '1', versions: ['', 'abc-42-1'], sleep: async () => {} });
  assert.deepEqual(posts(g), [C]);
});

test('publish: a failed deployment fails the step (the workflow retries once); no artifact, no publish', async () => {
  await assert.rejects(publish({ ...fake(['deployment_failed']), context }, { artifactId: '1', sleep: async () => {} }), /deployment_failed/);
  await assert.rejects(publish({ ...fake([]), context }, { artifactId: '', sleep: async () => {} }), /No artifact/);
  // The commit itself refused: a real failure, not hidden.
  await assert.rejects(publish({ ...fake([], { refuse: [T, C] }), context }, { artifactId: '1', versions: [T], sleep: async () => {} }), /Not Found/);
  // Still in progress at the time limit: cancelled and failed, never reported live.
  const f = fake(Array(50).fill('deployment_in_progress'));
  await assert.rejects(publish({ ...f, context }, { artifactId: '1', timeoutMs: 0, sleep: async () => {} }), /still/);
  assert.ok(f.calls.some(([r]) => r.endsWith('/cancel')));
});

test('the workflow publishes with publish.cjs, after the track record is loaded for the build state', async () => {
  const wf = parse(await readFile('.github/workflows/pages.yml', 'utf8'));
  const steps = wf.jobs.deploy.steps;
  const at = (pred) => steps.findIndex(pred);
  assert.equal(at((s) => /deploy-pages/.test(s.uses || '')), -1, 'actions/deploy-pages publishes under the bare commit');
  const pub = steps[at((s) => s.id === 'deployment')];
  assert.match(pub.with.script, /publish\.cjs/);
  assert.match(pub.with.script, /steps\.artifact\.outputs\.artifact_id/);
  assert.match(pub.with.script, /steps\.savetrack\.outputs\.sha/);
  assert.match(steps[at((s) => s.id === 'savetrack')].run, /sha=\$\(git rev-parse HEAD\)/);
  assert.ok(at((s) => s.name === 'Load track record') < at((s) => /scripts\/pages\.mjs/.test(s.run || '')), 'the kept state is there before the build reads it');
  assert.equal(steps[at((s) => /scripts\/pages\.mjs/.test(s.run || ''))].env.STATE_DIR, 'track/state');
  assert.match(steps[at((s) => s.name === 'Save track record')].run, /odds-extra\.json stake\.json/);
});

test('build state: the newer of the live site\'s copy and the track-record copy is used', () => {
  const site = { fetchedAt: 1000, spentAt: 900, credits: 120 }, kept = { fetchedAt: 5000, spentAt: 4000, credits: 60 };
  assert.equal(newerState(site, kept), kept, 'a stale live site no longer resets the credits');
  assert.equal(newerState(kept, site), kept);
  assert.equal(newerState(null, kept), kept);
  assert.equal(newerState(site, null), site);
  assert.equal(newerState(null, null), null);
  // Stake's file: `at` is the last read; the odds file's `at` is an object of reads per league.
  assert.equal(stateStamp({ at: 7000, spentAt: 100 }), 7000);
  assert.equal(stateStamp({ at: { a: 9e12 }, fetchedAt: 10 }), 10);
});

test('stuck-site alarm: the live data older than 45 minutes at a build\'s start is a data problem', () => {
  const now = Date.parse('2026-11-15T16:55:00Z');
  assert.equal(siteAgeProblem(now - 12 * 6e4, now), null, 'one build behind is normal');
  assert.equal(siteAgeProblem(now - STUCK_MIN * 6e4, now), null);
  assert.match(siteAgeProblem(Date.parse('2026-11-15T15:37:00Z'), now), /Live site behind: its data is 78 minutes old/);
  assert.equal(siteAgeProblem(undefined, now), null, 'unknown age: no claim');
});

test('long shots: 10x and up are labelled, the smaller multipliers are not', () => {
  assert.deepEqual(MULTI_TARGETS.filter(longShot), [10, 20, 100, 1000]);
  assert.equal(longShot(5), false);
});
