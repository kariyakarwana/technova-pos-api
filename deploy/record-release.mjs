// Release tags are created only after deploy succeeds. Never move an existing tag.
import fs from 'node:fs';
async function main() {
  if (process.env.GITHUB_ACTOR !== 'kariyakarwana' || process.env.GITHUB_TRIGGERING_ACTOR !== 'kariyakarwana' ||
      process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Only the owner-merged production run may record a release.');
  }
  const version = fs.readFileSync('VERSION', 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('VERSION must contain a stable semantic version.');
  const tag = `v${version}`;
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' };
  const existing = await fetch(`${url}/releases/tags/${tag}`, { headers, signal: AbortSignal.timeout(30000) });
  if (existing.ok) { console.log(`${tag} already exists and will not be moved. This deployment is identified by ${process.env.GITHUB_SHA}.`); return; }
  if (existing.status !== 404) throw new Error(`Cannot check release: HTTP ${existing.status}`);
  const ref = await fetch(`${url}/git/ref/tags/${tag}`, { headers, signal: AbortSignal.timeout(30000) });
  if (ref.ok) throw new Error(`${tag} already exists without a release. Review it manually; refusing to relabel it.`);
  if (ref.status !== 404) throw new Error(`Cannot check tag: HTTP ${ref.status}`);
  const body = [fs.readFileSync('RELEASE_NOTES.md', 'utf8'), '',
    `Production commit: ${process.env.GITHUB_SHA}`, `Image: ${process.env.RELEASE_IMAGE}`,
    process.env.MIGRATION_IMAGE ? `Migration image: ${process.env.MIGRATION_IMAGE}` : '',
    `Deployment run: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`].join('\n');
  const response = await fetch(`${url}/releases`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, target_commitish: process.env.GITHUB_SHA, name: tag, body, draft: false, prerelease: false }),
    signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Release creation failed: HTTP ${response.status}; deployment already succeeded, do not redeploy blindly.`);
  console.log(`Recorded ${tag} for the successfully deployed commit.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
