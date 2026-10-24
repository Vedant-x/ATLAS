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
