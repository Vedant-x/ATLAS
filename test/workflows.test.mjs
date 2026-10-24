import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { parse } from 'yaml';

// A workflow GitHub cannot parse fails silently on main (no build, no deploy, no alert): every
// workflow and issue form is parsed here first. A ": " inside a plain run: line once broke one.
test('every GitHub workflow and issue form parses; each job has a runner and steps', async () => {
  for (const dir of ['.github/workflows', '.github/ISSUE_TEMPLATE']) {
    for (const f of (await readdir(dir)).filter((x) => /\.ya?ml$/.test(x))) {
      const doc = parse(await readFile(`${dir}/${f}`, 'utf8'));
      assert.ok(doc && typeof doc === 'object', `${dir}/${f} is empty`);
      if (dir.endsWith('workflows')) {
        assert.ok(doc.on, `${f}: no trigger`);
        for (const [name, job] of Object.entries(doc.jobs || {})) {
          assert.ok(job['runs-on'], `${f} ${name}: no runner`);
          assert.ok(Array.isArray(job.steps) && job.steps.length, `${f} ${name}: no steps`);
          for (const s of job.steps) assert.ok(s.uses || s.run, `${f} ${name}: a step with neither uses nor run`);
        }
      }
    }
  }
});

// Every action on a release that runs on Node 24 (GitHub retires Node 20): the first such major of
// each, read from the action's own action.yml (runs.using: node24) when it was raised.
const NODE24 = {
  'actions/checkout': 5, 'actions/setup-node': 5, 'actions/setup-java': 5, 'actions/github-script': 8, 'actions/upload-artifact': 6,
  'actions/configure-pages': 6, 'actions/upload-pages-artifact': 5, 'actions/deploy-pages': 5, 'dawidd6/action-send-mail': 23,
};
test('every action the workflows use runs on Node 24', async () => {
  for (const f of (await readdir('.github/workflows')).filter((x) => /\.ya?ml$/.test(x))) {
    const doc = parse(await readFile(`.github/workflows/${f}`, 'utf8'));
    for (const job of Object.values(doc.jobs || {})) {
      for (const s of job.steps.filter((x) => x.uses)) {
        const [name, ref] = s.uses.split('@');
        assert.ok(name in NODE24, `${f}: ${s.uses} is not in the Node 24 list (check its action.yml, then add it)`);
        assert.ok(Number(/^v(\d+)/.exec(ref)?.[1]) >= NODE24[name], `${f}: ${s.uses} runs on Node 20; use @v${NODE24[name]} or later`);
      }
    }
  }
});
