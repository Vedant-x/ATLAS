import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const alert = require('../scripts/alert.cjs');

// A fake GitHub that records every call that would email the owner.
function fakeGitHub() {
  const issues = [];
  const mails = [];
  const rest = {
    issues: {
      createLabel: async () => ({}),
      listForRepo: async () => ({ data: issues.filter((i) => i.state === 'open') }),
      create: async ({ body, assignees }) => { issues.push({ number: issues.length + 1, body, state: 'open', assignees }); mails.push('opened'); },
      update: async ({ issue_number, body, state }) => { const i = issues.find((x) => x.number === issue_number); if (body) i.body = body; if (state) { i.state = state; mails.push('closed'); } },
      createComment: async () => { mails.push('comment'); },
    },
  };
  return { github: { rest }, issues, mails };
}

async function runBuilds(sequence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-'));
  const cwd = process.cwd();
  process.chdir(dir);
  fs.mkdirSync('dist/pages/data', { recursive: true });
  fs.mkdirSync('track');
  const gh = fakeGitHub();
  const core = { setOutput() {}, info() {} };
  const context = { repo: { owner: 'me', repo: 'atlas' }, serverUrl: 'https://github.com', runId: 1 };
  try {
    for (const problems of sequence) {
      fs.writeFileSync('dist/pages/data/health.json', JSON.stringify({ problems, espnGames: 600 }));
      await alert({ github: gh.github, context, core });
    }
  } finally { process.chdir(cwd); }
  return gh;
}

const F1 = (m) => `Formula 1 data failed: ${m}`;

test('a one-off feed timeout never emails', async () => {
  const gh = await runBuilds([[], [F1('The operation was aborted')], [], ['KHL feed failed: fetch failed'], [], [F1('fetch failed')], []]);
  assert.deepEqual(gh.mails, []);
});

test('a problem lasting 3 builds opens one issue (no assignment), closed quietly after 2 clean builds', async () => {
  const gh = await runBuilds([[F1('aborted')], [F1('fetch failed')], [F1('aborted')], [F1('aborted')], [], []]);
  assert.deepEqual(gh.mails, ['opened', 'closed']);
  assert.equal(gh.issues[0].assignees, undefined);
  assert.match(gh.issues[0].body, /@me/);
});

test('a changing error message or a problem dropping away sends nothing; a new lasting one comments once', async () => {
  const esp = 'Esports feed (bo3.gg) failed: timeout';
  const gh = await runBuilds([[F1('a')], [F1('b')], [F1('c'), esp], [F1('d'), esp], [F1('e'), esp], [esp], [esp]]);
  assert.deepEqual(gh.mails, ['opened', 'comment']);
  assert.equal(gh.issues[0].state, 'open');
});

test('one clean build between failures does not close and reopen', async () => {
  const gh = await runBuilds([[F1('a')], [F1('a')], [F1('a')], [], [F1('a')], [F1('a')], [F1('a')]]);
  assert.deepEqual(gh.mails, ['opened']);
});

test('error text after the first colon does not split a problem', () => {
  assert.equal(alert.keyOf(F1('The operation was aborted')), alert.keyOf(F1('fetch failed')));
});
