// The Pages publish (scripts/publish.cjs) and the state kept between builds (scripts/lib.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { newerState, stateStamp } from '../scripts/lib.mjs';

const publish = createRequire(import.meta.url)('../scripts/publish.cjs');
const fake = (statuses) => {
  const calls = [];
  const github = { request: async (route, args) => {
    calls.push([route, args]);
    if (route.startsWith('POST') && route.endsWith('/deployments')) return { data: { id: 'd1', page_url: 'https://x.github.io/ATLAS/' } };
    if (route.startsWith('GET')) return { data: { status: statuses.shift() } };
    return { data: {} };
  } };
  const out = {};
  const core = { getIDToken: async () => 'oidc', info() {}, warning() {}, setOutput: (k, v) => { out[k] = v; } };
  return { github, core, calls, out };
};
const context = { repo: { owner: 'Vedant-x', repo: 'ATLAS' }, sha: 'abc123', runId: 42 };

test('publish: each build gets a version of its own (commit + run), and waits until it is live', async () => {
  const f = fake(['deployment_in_progress', 'syncing_files', 'succeed']);
  assert.equal(await publish({ ...f, context }, { artifactId: '777', sleep: async () => {} }), 'succeed');
  const [, args] = f.calls[0];
  assert.equal(args.artifact_id, 777);
  assert.match(args.pages_build_version, /^abc123-42-\d+$/, 'not the bare commit, which every build of the day shared');
  assert.equal(args.oidc_token, 'oidc');
  assert.equal(f.out.page_url, 'https://x.github.io/ATLAS/');
});

test('publish: a failed deployment fails the step (the workflow retries once); no artifact, no publish', async () => {
  await assert.rejects(publish({ ...fake(['deployment_failed']), context }, { artifactId: '1', sleep: async () => {} }), /deployment_failed/);
  await assert.rejects(publish({ ...fake([]), context }, { artifactId: '', sleep: async () => {} }), /No artifact/);
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
