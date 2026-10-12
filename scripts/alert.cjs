// Data alert: one GitHub issue for data problems that last, closed once the data is healthy again.
// A feed that times out once (bo3.gg, F1, KHL…) recovers by the next build ten minutes later, so a
// problem must be present in PERSIST builds in a row before it alerts. Each alert is one email: the
// issue mentions the owner (no separate assignment email), a comment only when a new lasting problem
// appears, and a quiet close (no comment) after RECOVER builds in a row with no problem at all.
// Streaks are kept in track/alert-state.json, saved with the track record.
// Run by actions/github-script in .github/workflows/pages.yml.
const PERSIST = 3;
const RECOVER = 2;
// "Formula 1 data failed: The operation was aborted" and "…: fetch failed" are the same problem.
const keyOf = (p) => String(p).split(':')[0].trim();

// Pure: next streak state and the problems that have lasted long enough to alert.
function step(prev, problems) {
  const counts = {};
  for (const p of problems) { const k = keyOf(p); counts[k] = (prev?.counts?.[k] || 0) + 1; }
  const lasting = problems.filter((p) => counts[keyOf(p)] >= PERSIST);
  const clean = problems.length ? 0 : (prev?.clean || 0) + 1; // builds in a row with no problem at all
  return { state: { counts, clean }, lasting };
}

module.exports = async ({ github, context, core }, file = 'track/alert-state.json') => {
  const fs = require('fs');
  core.setOutput('notify', 'false');
  let health;
  try { health = JSON.parse(fs.readFileSync('dist/pages/data/health.json', 'utf8')); } catch { core.info('no health report'); return; }
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  const { state, lasting } = step(prev, health.problems || []);
  try { fs.writeFileSync(file, JSON.stringify(state)); } catch (e) { core.info(`alert state not saved: ${e.message}`); }
  for (const p of health.problems || []) core.info(`problem (${state.counts[keyOf(p)]}/${PERSIST} builds): ${p}`);

  const { owner, repo } = context.repo;
  const label = 'data-alert';
  const open = (await github.rest.issues.listForRepo({ owner, repo, labels: label, state: 'open', per_page: 5 })).data[0];
  const run = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;

  if (!lasting.length) {
    if (open && state.clean >= RECOVER) {
      await github.rest.issues.update({ owner, repo, issue_number: open.number, state: 'closed', state_reason: 'completed', body: `${open.body}\n\n**Recovered:** ${RECOVER} builds in a row found no data problems. [Build log](${run})` });
      core.setOutput('notify', 'recovered');
    }
    return;
  }
  const keys = lasting.map(keyOf);
  const sig = `<!-- keys:${Buffer.from(keys.join('|')).toString('base64')} -->`;
  const list = lasting.map((p) => `- ${p}`).join('\n');
  const body = `@${owner} the site build has had data problems for ${PERSIST}+ builds in a row (about half an hour). Visitors may see missing or stale fixtures until this is fixed.\n\n${list}\n\nESPN games loaded: ${health.espnGames}. [Build log](${run})\n\n${sig}`;
  if (!open) {
    await github.rest.issues.createLabel({ owner, repo, name: label, color: 'd93f0b', description: 'Automatic: the site data has a lasting problem' }).catch(() => {});
    await github.rest.issues.create({ owner, repo, title: 'ATLAS data alert: the site is missing data', body, labels: [label] });
    core.setOutput('notify', 'true');
  } else {
    const known = (/<!-- keys:([^ ]*) -->/.exec(open.body || '')?.[1] || '');
    const before = known ? Buffer.from(known, 'base64').toString().split('|') : [];
    const added = lasting.filter((p) => !before.includes(keyOf(p)));
    if (!open.body.includes(sig)) await github.rest.issues.update({ owner, repo, issue_number: open.number, body });
    if (added.length) {
      await github.rest.issues.createComment({ owner, repo, issue_number: open.number, body: `New lasting problem:\n\n${added.map((p) => `- ${p}`).join('\n')}\n\n[Build log](${run})` });
      core.setOutput('notify', 'true');
    }
  }
  core.setOutput('summary', lasting.join('\n'));
};
module.exports.step = step;
module.exports.keyOf = keyOf;
