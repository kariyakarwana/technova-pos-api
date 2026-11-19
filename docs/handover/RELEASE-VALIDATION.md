# Release validation — 18 November 2026

## Decision

Prepared for code review and staging. **Not approved for production rollout.** Work remains uncommitted on `fix/saas-local-preview` in the frontend and API repositories. No remote branch, secret, environment readiness flag or production deployment was changed.

## Checks completed

| Check | Result |
| --- | --- |
| API TypeScript and Jest after Prisma client regeneration | Passed; 26 suites, 94 tests |
| Frontend typecheck, ESLint and Vitest | Passed; 15 files, 77 tests |
| Final Docker API runtime and migration/build images | Built successfully |
| Final Docker frontend standalone image | Built successfully using Next.js 16.4.6 |
| Final image local API smoke test | Passed: health, platform/tenant login, eight platform reads, tenant denial of platform access, fake payment rejection, tenant billing separation and suspension/recovery |
| Prisma client | Generated successfully, 7.10.1 |
| Controlled bootstrap checks against isolated local PostgreSQL | Five passed: existing readiness, password preservation, missing subscription rejection, explicit legacy backfill, post-backfill readiness |
| Production Compose and local production override | Configuration validation passed using placeholders; no production services started |
| API reference inventory | 226 operations, 34 controllers, 446 inferred schemas; eight internal AI routes and 34 Pydantic models |
| PDF document visual review | All 22 pages checked across three documents |

The local preview previously exercised migrations, platform and tenant login, billing requests, sequential duplicate rejection, suspension/recovery and branch-cap enforcement. These are development checks, not a complete production acceptance matrix. See the QA guide for outstanding concurrency and integration cases.

## Dependency review

Compatible lockfile updates were applied without `npm audit fix --force`. Next.js and its ESLint configuration were updated to 16.4.6. The shadcn CLI is now a development dependency; its build-time stylesheet import remains available during the Docker build.

`npm audit --omit=dev` reports:

- Frontend: **0 reported production vulnerabilities** at the time of this check.
- API: **5 affected packages: 4 high and 1 moderate; 0 critical**. This is not five distinct root advisories. The affected packages are `minio`, `query-string`, `decode-uri-component`, `stream-json`, and `nodemailer`.

The MinIO client chain includes malformed-input denial-of-service and JSON parser prototype-pollution advisories. Nodemailer includes recipient parsing, denial-of-service and SMTP/TLS behavior advisories. Reachability has not been established by an exploit test. Keep these as unresolved release risks; do not describe the API dependencies as clean. The audit's MinIO remedy suggests a major-version change/downgrade, which was not applied blindly. Review supported patched client/mail versions and validate storage and SMTP behavior before release. Full audit JSON is included under `evidence/`.

Development tooling also has advisories (the final frontend install reported 22). A production-only audit excludes those and does not certify CI/build tooling. The source audit files retain the recorded production findings.

## Production alignment

Production configuration preserves PostgreSQL 16.15, licensed MinIO AIStor, Node 22/Next.js/NestJS, Python/FastAPI, Docker Compose, GHCR images, Nginx and public SSH. New tool-profile services provide a non-demo SaaS bootstrap and a read-only preflight. Existing passwords, plans and subscriptions are preserved. A dedicated platform account and explicit legacy entitlement mapping are required.

The licensed MinIO image has not been started locally: the user confirmed the license is **VPS only**. The laptop preview still uses SeaweedFS and Mailpit. Do not treat that preview as proof of MinIO licensing, production storage policy, real email/WhatsApp delivery or AI inference.

## Release blockers / outstanding acceptance

1. Resolve or formally review the remaining dependency risks with tested fixes.
2. Approve the missing-feature scope and commercial-policy differences listed in the SaaS coverage report. No additional missing capabilities were implemented in this task.
3. Rehearse migration and restore using representative existing production data. The role uniqueness change makes old-image-only rollback unsafe; restore the database and old images together during the first transition if recovery is needed.
4. Validate licensed MinIO start, upload/read/delete and private bucket denial; actual SMTP/WhatsApp delivery and webhook behavior; AI artifacts and inference; concurrent quota/billing operations and the full tenant-isolation QA matrix.
5. Set the new runtime values on the VPS through the secure channel, use a unique platform bootstrap password, and approve the legacy plan/period. Local `.env` changes do not provision production.
6. Hold automatic deployment using the existing readiness switch before the first owner merge, then follow `SAAS-UPGRADE.md`. This task did not change the current readiness setting.

## Reviewed main references

- API: `1b172129e22270f6a381bf430d2e110c08aff8a5`
- Frontend: `16f9ad2c74ac5bdb92112ebac6937df429983956`
- AI: `ecbfa4fad542a53e85f690871093777fd93a54e8` (no source changes prepared)

These identify fetched comparison references, not the uncommitted candidate or currently running VPS image. Record final reviewed commits and immutable image digests after the code is approved and published.
