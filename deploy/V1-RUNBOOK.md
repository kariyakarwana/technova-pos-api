# V1 production handoff for Navod and kariyakarwana

Status: release candidate. Do not announce V1 as live until all three production
runs succeed and their `v1.0.0` releases exist. No VPS changes were performed by
the coding agent. Main is the production branch; no permanent release branch is
needed. The temporary `release/v1-deployment` branches are reviewed through PRs.

## Permission model

- Only a PR merged into `main` by **kariyakarwana** can publish and deploy.
- Owner merge is the permission: no second environment approval click.
- Direct pushes, another person's merge, manual workflow dispatch, and reruns
  initiated by another account cannot deploy.
- The GitHub `production` environment allows the branch `main` only. Store
  deployment secrets in that environment, never as repository-wide secrets.
- Main's update rules allow only kariyakarwana to bypass via a pull request.
  A separate mandatory `verify` check has no bypass. CODEOWNERS remains the owner.
- This controls GitHub deployments. Anyone retaining root/sudo access to the VPS
  can still change production manually. Navod's existing VPS administrator access
  is not revoked. Do not share kariyakarwana's GitHub account.

## 1. Navod: inspect and back up the EXISTING production installation

Use the VPS console/current administrator SSH access. Do not execute the old
full installer: it reinstalls the private Nginx site. Do not run `docker compose
down -v`, replace production.env, move data directories, or change the Compose
project name. This update does not need any of those actions.

```bash
sudo test -s /opt/technova/deploy/release.env
sudo test -s /etc/technova/production.env
sudo test -f /opt/technova/deploy/compose.production.yml
sudo docker compose version
command -v flock curl timeout
sudo docker compose --project-name technova-pos-production \
  --env-file /etc/technova/production.env \
  --env-file /opt/technova/deploy/release.env \
  -f /opt/technova/deploy/compose.production.yml config --quiet
sudo docker compose --project-name technova-pos-production \
  --env-file /etc/technova/production.env \
  --env-file /opt/technova/deploy/release.env \
  -f /opt/technova/deploy/compose.production.yml ps
```

Confirm the current installation uses the expected service names `frontend`,
`backend`, `migrate`, `ai-service`, `postgres`, `minio`, `minio-init`, the same
project name and data volumes, healthy AI model mounts, and a valid MinIO license.
Stop if these differ: do not point this automation at a different stack.
Confirm the release file has all four current working GHCR digest references:
`FRONTEND_IMAGE`, `BACKEND_IMAGE`, `BACKEND_MIGRATE_IMAGE`, `AI_IMAGE`.
Values must be `ghcr.io/kariyakarwana/<expected-repo>@sha256:<64 lowercase hex>`.
Record the current digest set in a secure operational record. Never guess it.

Make and verify a PostgreSQL backup using the current stack, and confirm a
restore on a separate test database before enabling automation. Keep copies of
the current script, release.env and Compose file in a root-only dated backup.
Do not paste environment contents, registry credentials or database dumps into
GitHub issues/chat. Verify the root Docker client can pull the four existing
images; configure read-only GHCR package access if they are private.

## 2. Navod: install the reviewed deployment-script update only

Fetch the API release PR into a normal checkout. Verify its exact commit SHA
against the PR reviewed by kariyakarwana. Run `bash -n deploy/technova-deploy`
and `bash deploy/test-deployment.sh` in that checkout. Then:

```bash
# From the reviewed API checkout (not an arbitrary downloaded script):
sudo cp -a /usr/local/sbin/technova-deploy \
  /usr/local/sbin/technova-deploy.pre-v1
sudo install -o root -g root -m 0755 deploy/technova-deploy \
  /usr/local/sbin/technova-deploy
printf '%s\n' 'https://pos.nxcodeworks.com' | \
  sudo tee /etc/technova/public-base-url >/dev/null
sudo chown root:root /etc/technova/public-base-url
sudo chmod 0600 /etc/technova/public-base-url
sudo /usr/local/sbin/technova-deploy --version
# Expected: technova-deploy 1.0.0
```

Confirm the public hostname above is the live production origin before running
the command. This upgrade does not modify Nginx, TLS, Compose, or production.env.
Verify all endpoints from the VPS:

```bash
curl --fail --max-time 15 https://pos.nxcodeworks.com/nginx-health
curl --fail --max-time 15 https://pos.nxcodeworks.com/api/v1/health
curl --fail --max-time 15 https://pos.nxcodeworks.com/login >/dev/null
```

The AI check runs inside its container (`http://localhost:8000/health`). Ensure
the VPS can reach its public HTTPS hostname; public checks now participate in
rollback. Do not weaken TLS verification to make these checks pass.

## 3. Navod + owner: establish restricted CI access

Use a dedicated `deploy` SSH account, not root/devops. Install a dedicated CI
public key in its authorized_keys with the `restrict` option. The account must
not belong to the docker group and must not write the deployment script,
Compose file, production.env, release files or their parent directories.
Validate `/etc/sudoers.d/technova-deploy` with `visudo -cf`:

```text
deploy ALL=(root) NOPASSWD: /usr/local/sbin/technova-deploy
```

Test noninteractive `sudo -n /usr/local/sbin/technova-deploy --version` as deploy.
Check existing sudo grants too; the line above does not remove broader grants.
Keep the old operational admin access for incident recovery.

Configure Tailscale workload identity federation for the three exact repositories
and the GitHub `production` environment, tag `tag:ci`. Restrict CI network access
to this VPS SSH service with the tailnet ACL/grants. Verify issuer, audience,
repository and environment claims; do not trust every GitHub repository or all
of the owner's repositories. This action uses OIDC (`id-token: write`),
`oauth-client-id` and `audience`; it does not use a stored OAuth client secret.

In EACH repository, Settings → Environments → production, configure:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | TS_OAUTH_CLIENT_ID | Tailscale federated identity client ID |
| Secret | TS_AUDIENCE | Configured federation audience |
| Secret | VPS_SSH_PRIVATE_KEY | Dedicated CI SSH private key; enter directly in GitHub |
| Secret | VPS_KNOWN_HOSTS | Verified SSH host-key line matching VPS_HOST |
| Variable | VPS_HOST | Reachable Tailscale VPS hostname or address |
| Variable | VPS_USER | deploy |
| Variable | PUBLIC_BASE_URL | https://pos.nxcodeworks.com |
| Variable | VPS_DEPLOY_READY | false until every setup check passes |

Get the host-key fingerprint from the trusted VPS console with
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Compare it to the key collected
for VPS_HOST before saving known_hosts. Do not trust an unverified ssh-keyscan.
Transfer private keys through the approved secure channel or enter them directly
in GitHub; do not send them in this chat. The owner must control the GitHub
settings. Navod can provide configuration to the owner without receiving admin
rights on the repositories.

Frontend repository variable `PRODUCTION_API_URL` must remain
`https://pos.nxcodeworks.com/api/v1`; it must be a repository variable because
the image build does not access the production environment. Public browser
configuration is baked into the image at build time.

## 4. Owner: enable and merge the V1 release PRs

After Navod confirms the checks above, set `VPS_DEPLOY_READY=true` in each
production environment. Kariyakarwana then squash-merges the reviewed API PR,
waits for its production run, then merges the AI PR and frontend PR one at a
time. These PRs only change deployment/release mechanics and package version
metadata; unrelated feature changes must receive their own review.

The merge starts verify → owner authorization → immutable image publishing →
VPS deployment → GitHub release. Each repository creates `v1.0.0` only after
its first successful deployment with VERSION=1.0.0. Existing tags are never
moved. Later merges with the same VERSION deploy by SHA/digest without creating
a new version tag; bump VERSION and package metadata for the next named release.
All three versioned releases and their image digests together identify system V1.

If a setup check fails after merge, fix setup and have kariyakarwana rerun the
failed run. Manual workflow_dispatch is verification-only and does not deploy.
An older run is rejected if main has advanced. Do not merge the superseded
Navod deployment PRs on top of this implementation: they could restore unsafe
deployment paths. Review/close them separately after the replacement PRs land.

## Recovery and acceptance

Partial deploys replace only their target service; backend deploys first back
up the database and run migrations. Frontend/AI deploys never run migrations.
The server lock serializes the three repositories. Compose readiness, explicit
AI/API/UI checks and public HTTPS checks must pass before release.env is
atomically updated. Failed rollout/checks attempt to restore previous images
and verify recovery; the GitHub run stays failed even if recovery succeeds.

Rollback does NOT reverse migrations. Use expand/contract migrations compatible
with both old and new application versions. A backup listing is checked during
deployment, but this is not a substitute for a tested database restore. If the
log reports CRITICAL rollback failure, Navod must inspect service state and
recover manually. SIGKILL, VPS power loss and storage failure cannot be solved
by shell traps. A brief restart interruption is possible; this is not a
zero-downtime blue/green deployment.

Before announcing V1, test sign-in, core sales/inventory operations, uploads,
and an AI request against production using authorized test data. Record the
three release URLs and deployed digests. Do not mark the release complete based
only on CI or mock tests.
