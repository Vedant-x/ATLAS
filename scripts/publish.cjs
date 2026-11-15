// Publishes the uploaded site to GitHub Pages, in place of actions/deploy-pages, under a build
// version of its own where GitHub accepts one.
// Why: the site is rebuilt every ~9 minutes from the same commit. Every deployment then carried the
// same build version (the commit), and GitHub reported each one a success while the site went on
// serving an older one: on 14 Nov 2026 the data stayed at 08:01 UTC for over 90 minutes across ten
// "successful" publishes, and on 15 Nov at 15:37 UTC for over an hour.
// GitHub refuses a version that is not a commit in the repository (15 Nov: a made-up commit-run
// string was answered 404), so the versions tried are real commits: first this build's track-record
// commit (a new one each build), then the build's own commit, as actions/deploy-pages did.
// Run by actions/github-script in .github/workflows/pages.yml (needs pages: write and id-token: write).
const DONE = 'succeed';
const FAILED = new Set(['deployment_failed', 'deployment_perms_error', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);

module.exports = async ({ github, context, core }, { artifactId, versions = [], timeoutMs = 10 * 6e4, everyMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) => {
  const { owner, repo } = context.repo;
  if (!artifactId) throw new Error('No artifact id from the upload step');
  const tries = [...new Set([...versions.filter((v) => /^[0-9a-f]{40}$/.test(String(v))), context.sha])];
  const oidc = await core.getIDToken();
  let dep = null, version = null;
  for (const v of tries) {
    try {
      ({ data: dep } = await github.request('POST /repos/{owner}/{repo}/pages/deployments', { owner, repo, artifact_id: Number(artifactId), pages_build_version: v, oidc_token: oidc }));
      version = v;
      break;
    } catch (e) {
      // Refused (not a commit GitHub accepts here): the next version; anything else is a real failure.
      if (![400, 404, 422].includes(e.status) || v === tries.at(-1)) throw e;
      core.warning(`Pages refused build version ${v} (HTTP ${e.status}); trying the next`);
    }
  }
  const id = dep.id || String(dep.status_url || '').split('/').pop();
  core.info(`Pages deployment ${id} for build version ${version}${version === context.sha ? ' (the commit)' : ' (this build\'s own)'}`);
  core.setOutput('version', version);
  const end = Date.now() + timeoutMs;
  let status = '';
  while (Date.now() < end) {
    await sleep(everyMs);
    try {
      ({ data: { status } } = await github.request('GET /repos/{owner}/{repo}/pages/deployments/{id}', { owner, repo, id }));
    } catch (e) { core.warning(`Status check failed: ${e.message}`); continue; }
    if (status === DONE) { core.info('Published.'); core.setOutput('page_url', dep.page_url || `https://${owner.toLowerCase()}.github.io/${repo}/`); return status; }
    if (FAILED.has(status)) throw new Error(`Pages deployment ${id} ended: ${status}`);
  }
  try { await github.request('POST /repos/{owner}/{repo}/pages/deployments/{id}/cancel', { owner, repo, id }); } catch { /* already over */ }
  throw new Error(`Pages deployment ${id} still "${status || 'unknown'}" after ${Math.round(timeoutMs / 6e4)} minutes`);
};
