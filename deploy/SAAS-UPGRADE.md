# SaaS upgrade and rollback

This is a coordinated first-time schema upgrade, not an ordinary per-service deployment. The production stack remains Next.js, NestJS, PostgreSQL 16, MinIO AIStor, Python/FastAPI, Docker Compose and the existing Nginx/public-SSH deployment path.

## Before an owner merge

1. Review the feature-gap report and complete the required staging acceptance tests. This candidate is not production-approved merely because unit tests pass.
2. Use the existing `VPS_DEPLOY_READY` environment variable to keep automatic deployment disabled during this first schema transition. The current GitHub setting was `true` when inspected; it was not changed by this work. Repository owner decides when to activate it after the rehearsal.
3. Have the VPS operator prepare the reviewed production Compose file, a valid MinIO license at `/etc/technova/minio.license`, retained image digests, a verified PostgreSQL backup and an isolated restore test.
4. Preserve the existing `/etc/technova/production.env`. Add `RECEIPT_SIGNING_SECRET` (independent random secret, at least 32 characters), a dedicated `PLATFORM_ADMIN_EMAIL`, and a new unique `PLATFORM_ADMIN_PASSWORD`. Never use a password copied from chat or a sample. Runtime secrets are not automatically copied from GitHub Actions secrets.
5. Explicitly choose `SAAS_LEGACY_PLAN_CODE` and `SAAS_LEGACY_PERIOD_END` for existing organizations. The bootstrap refuses to guess a plan or silently reduce current branch/user capacity. It creates no retrospective invoices.
6. Decide whether to enable `BILLING_WORKER_ENABLED=true` after confirming the implemented 30-day renewal rules. Keep it false while commercial rules are unresolved.

## Rehearse using candidate images and a cloned database

Use an isolated project, database, storage volumes and provider sandbox credentials. Do not run a production bootstrap against the laptop's preview and assume that validates existing production records. The `compose.production-local.yml` override uses the same MinIO AIStor image as production; it requires a licensed local file and local AI artifacts. The license is currently available only on the VPS.

The migration image must contain `prisma/bootstrap-saas.ts` and `prisma/saas-catalog.ts`. Keep all four immutable image references in a candidate release environment file. Do not replace the active release ledger before validation.

For the actual production maintenance window only, form this Compose command with the reviewed candidate image file. For an earlier rehearsal, substitute an isolated project name, environment file, database, mounts and image ledger; never use this production command for a rehearsal:

```bash
dc=(docker compose --project-name technova-pos-production \
  --env-file /etc/technova/production.env \
  --env-file /opt/technova/deploy/release.candidate.env \
  -f /opt/technova/deploy/compose.production.yml)
```

During a scheduled maintenance window with application writes stopped and the backup already verified:

```bash
"${dc[@]}" run --rm --no-deps migrate
"${dc[@]}" run --rm --no-deps saas-bootstrap
"${dc[@]}" run --rm --no-deps saas-preflight
```

`saas-bootstrap` refuses to promote an existing tenant user into a platform owner. It preserves existing password hashes, existing plan records and existing subscriptions. Repeated execution is designed to be safe. `saas-preflight` performs no data writes and fails if legacy organizations lack subscriptions or users have ambiguous organization memberships.

After the staging rehearsal passes, the owner can merge with deployment held, obtain the published candidate image digests, and have the operator perform the controlled transition. Enable readiness and rerun only the newest authorized main deployment. API first, then frontend; update AI only if its reviewed release changes. Wait for each service's health and application smoke checks. Recheck owner authorization and current main through the existing workflow.

## Rollback boundary

The tenant role migration removes the old global role-name unique constraint. Previous binaries use that old unique selector. **Do not rely on the existing automatic image rollback after this schema change.** Its rollback restores images, not database schema/data.

Before this first transition, prove recovery on a cloned database: restore the pre-upgrade PostgreSQL dump into an isolated database, start the previous image set against it, verify tenant login, sales totals, inventory and roles, and record the measured restore time. During a failed production transition, keep writes stopped, restore the verified pre-upgrade database and previous images together using the operator's reviewed database recovery procedure. Do not reopen traffic until checks pass. New writes made after the backup would otherwise be lost, so maintenance is mandatory for this transition.

## Release evidence

Record the owner merge, candidate commits, image digests, backup checksum and restore test, MinIO health and licensed start, AI inference checks, provider delivery IDs, platform/tenant isolation tests, invoice tests and final readiness decision. Never put secret contents or temporary passwords in that record.
