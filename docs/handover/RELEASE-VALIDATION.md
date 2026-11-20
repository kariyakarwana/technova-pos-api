# Release validation — 19 November 2026

## Decision

Prepared for code review and staging. **Not approved for production rollout.** The API and frontend candidates are committed and pushed on `feature/saas`. No merge to main, production deployment or production-secret change was performed.

## Checks completed

| Check | Result |
| --- | --- |
| API typecheck, Jest and ESLint after Prisma client regeneration | Passed; 28 suites, 100 tests |
| Frontend typecheck, ESLint and Vitest | Passed; 16 files, 79 tests |
| Final Docker API runtime and migration/build images | Built successfully |
| Final Docker frontend standalone image | Built successfully using Next.js 16.4.6 |
| Final image local API smoke test | Passed: health, platform/tenant login, eight platform reads, tenant denial of platform access, fake payment rejection, tenant billing separation and suspension/recovery |
| Prisma client | Generated successfully, 7.10.1 |
| Controlled bootstrap checks against isolated local PostgreSQL | Five passed: existing readiness, password preservation, missing subscription rejection, explicit legacy backfill, post-backfill readiness |
| Production Compose and local production override | Configuration validation passed using placeholders; no production services started |
| API reference inventory | 226 operations, 34 controllers, 451 inferred schemas; eight internal AI routes and 34 Pydantic models |
| V1 billing integration checks | Eight passed: monthly lifecycle/grace, immutable invoice snapshots, idempotent settlement, quota race caps, durable outbox deduplication/rollback, S3-compatible storage and local SMTP |
| PDF document visual review | All 22 pages checked across three documents |

These are development checks, not a complete production acceptance matrix. Licensed MinIO, production SMTP and WhatsApp delivery, AI inference, production-shaped data restore and full tenant-isolation staging acceptance remain required.

## Dependency review

Compatible lockfile updates were applied without `npm audit fix --force`. Next.js and its ESLint configuration were updated to 16.4.6. The shadcn CLI is now a development dependency; its build-time stylesheet import remains available during the Docker build.

`npm audit --omit=dev` reports:

- Frontend: **0 reported production vulnerabilities** at the time of this check.
- API: **0 reported production vulnerabilities** after replacing the MinIO Node SDK with AWS SDK S3 and updating Nodemailer.

This production-only audit does not certify development or CI tooling. The source audit files record the captured production dependency results.

## Production alignment

Production configuration preserves PostgreSQL 16.15, licensed MinIO AIStor, Node 22/Next.js/NestJS, Python/FastAPI, Docker Compose, GHCR images, Nginx and public SSH. New tool-profile services provide a non-demo SaaS bootstrap and a read-only preflight. Existing passwords, plans and subscriptions are preserved. A dedicated platform account and explicit legacy entitlement mapping are required.

The licensed MinIO image has not been started locally: the user confirmed the license is **VPS only**. The laptop preview still uses SeaweedFS and Mailpit. Do not treat that preview as proof of MinIO licensing, production storage policy, real email/WhatsApp delivery or AI inference.

## Release blockers / outstanding acceptance

1. Resolve or formally review the remaining dependency risks with tested fixes.
2. Follow the owner-approved V1 scope: manual platform settlement only; online payments, bank-slip upload, annual billing, proration and refunds remain deferred.
3. Rehearse migration and restore using representative existing production data. The role uniqueness change makes old-image-only rollback unsafe; restore the database and old images together during the first transition if recovery is needed.
4. Validate licensed MinIO start, upload/read/delete and private bucket denial; actual SMTP/WhatsApp delivery and webhook behavior; AI artifacts and inference; concurrent quota/billing operations and the full tenant-isolation QA matrix.
5. Set the new runtime values on the VPS through the secure channel, use a unique platform bootstrap password, and approve the legacy plan/period. Local `.env` changes do not provision production.
6. Confirm production environment values and the readiness switch with the VPS operator before merging. The owner merge triggers deployment; this task did not merge or deploy.

## Reviewed main references

- API: `1b172129e22270f6a381bf430d2e110c08aff8a5`
- Frontend: `16f9ad2c74ac5bdb92112ebac6937df429983956`
- AI: `ecbfa4fad542a53e85f690871093777fd93a54e8` (no source changes prepared)

These identify fetched comparison references, not the candidate or currently running VPS image. API candidate: `9fed187`; frontend candidate: `68a640d`. Record immutable image digests after authorized deployment.
