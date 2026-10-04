// Data alert: opens (or updates) one GitHub issue when the build reports data problems, assigned to
// the repo owner so GitHub emails them, and closes it once the data is healthy again. Comments only
// when the set of problems changes, so a lasting outage doesn't email every 15 minutes.
// Run by actions/github-script in .github/workflows/pages.yml.
module.exports = async ({ github, context, core }) => {
  const fs = require('fs');
  let health;
  try { health = JSON.parse(fs.readFileSync('dist/pages/data/health.json', 'utf8')); } catch { core.info('no health report'); return; }
  const { owner, repo } = context.repo;
  const label = 'data-alert';
  await github.rest.issues.createLabel({ owner, repo, name: label, color: 'd93f0b', description: 'Automatic: the site data has a problem' }).catch(() => {});
  const open = (await github.rest.issues.listForRepo({ owner, repo, labels: label, state: 'open', per_page: 5 })).data[0];
  const run = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const list = health.problems.map((p) => `- ${p}`).join('\n');
  const sig = `<!-- sig:${Buffer.from(health.problems.join('|')).toString('base64').slice(0, 120)} -->`;
  core.setOutput('notify', 'false');
  if (!health.problems.length) {
    if (open) {
      await github.rest.issues.createComment({ owner, repo, issue_number: open.number, body: `Recovered: the latest build found no data problems. [Build log](${run})` });
      await github.rest.issues.update({ owner, repo, issue_number: open.number, state: 'closed', state_reason: 'completed' });
      core.setOutput('notify', 'recovered');
    }
    return;
  }
  const body = `The site build found data problems. Visitors may see missing or stale fixtures until this is fixed.\n\n${list}\n\nESPN games loaded: ${health.espnGames}. [Build log](${run})\n\n${sig}`;
  if (!open) {
    await github.rest.issues.create({ owner, repo, title: 'ATLAS data alert: the site is missing data', body, labels: [label], assignees: [owner] });
    core.setOutput('notify', 'true');
  } else if (!open.body.includes(sig)) {
    await github.rest.issues.update({ owner, repo, issue_number: open.number, body });
    await github.rest.issues.createComment({ owner, repo, issue_number: open.number, body: `The problems changed:\n\n${list}\n\n[Build log](${run})` });
    core.setOutput('notify', 'true');
  }
  core.setOutput('summary', health.problems.join('\n'));
};
