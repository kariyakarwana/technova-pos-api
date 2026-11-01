import { pathToFileURL } from 'node:url';
const OWNER = 'kariyakarwana';

function assertOwnerMerge(context, branch, pulls) {
  if (context.event !== 'push' || context.ref !== 'refs/heads/main') {
    throw new Error('Production accepts only a push to main caused by an owner merge.');
  }
  if (context.actor !== OWNER || context.triggeringActor !== OWNER) {
    throw new Error('Only kariyakarwana may initiate or rerun production deployment.');
  }
  if (branch.commit.sha !== context.sha) throw new Error('This release has been superseded on main.');
  const approved = pulls.find(pr => pr.merged_at && pr.merge_commit_sha === context.sha &&
    pr.base.ref === 'main' && pr.base.repo.full_name === context.repository &&
    pr.merged_by?.login === OWNER);
  if (!approved) throw new Error('No matching PR merged by kariyakarwana; direct pushes cannot deploy.');
  return approved.number;
}

async function main() {
  const context = {
    event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
    actor: process.env.GITHUB_ACTOR, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
    sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY,
  };
  if (!/^kariyakarwana\/technova-pos(?:-api|-ai)?$/.test(context.repository || '')) {
    throw new Error('Unexpected production repository.');
  }
  const request = async path => {
    const response = await fetch(`https://api.github.com/repos/${context.repository}/${path}`, {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub authorization lookup failed: HTTP ${response.status}`);
    return response.json();
  };
  const branch = await request('branches/main');
  const associated = await request(`commits/${context.sha}/pulls?per_page=100`);
  // The commit association response does not reliably include merged_by.
  const pulls = await Promise.all(associated.filter(pr => pr.base.ref === 'main')
    .map(pr => request(`pulls/${pr.number}`)));
  console.log(`Production authorized by owner merge of PR #${assertOwnerMerge(context, branch, pulls)}.`);
}

export { assertOwnerMerge };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
