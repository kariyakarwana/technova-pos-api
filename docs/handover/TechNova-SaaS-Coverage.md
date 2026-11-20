# TechNova SaaS Coverage Review

Prepared for NxCodeWorks Engineering and QA on 18 November 2026.

## Decision and interpretation

The supplied technova-saas.pdf is a 13-page remediation audit of frontend PR 118 and API PR 22. It is not a separate list of finalized product features. This comparison checks the current local candidate against all 22 findings and the acceptance/product-decision sections.

Do not treat the current candidate as fully production-ready. Several core security defects were corrected, and production-stack configuration plus a controlled bootstrap are prepared. Missing capabilities below have not been added without owner approval. The table distinguishes local implementation from staging or production proof.

The source audit describes the original PR code. This report reflects the final V1 candidate and the approved scope decisions; it does not claim production deployment or live-provider acceptance.

### Capabilities deferred from approved V1

Real online payment gateway and bank-slip upload; annual billing, proration, refunds and price grandfathering; organization switching; tenant-owned SMTP and cloud mail adapters; and an independent carry-forward credit ledger.

No organization switcher is implemented. Current access assumes one organization per internal account. This is a product choice, not an authorization to add multi-business accounts.

### External release prerequisites

Licensed MinIO rehearsal, real provider checks, production-shaped database migration/restore and residual dependency review remain required. The MinIO license is VPS-only. GitHub secret names are visible but their values cannot be retrieved; current server settings were not inspected.

## Finding coverage 1 to 6

Finding and PDF page | Current status and evidence
F01  Remote code loader
PDF page 3 | Fixed locally
PostCSS restored before builds; remote PR is not changed by local edits. Exposure from earlier builds is not ruled out.
F02  Platform privilege escalation
PDF page 3 to 4 | Implemented
Tenant role/user assignment rejects platform roles; scoped role tests exist. Complete staging cross-tenant tests remain required.
F03  Unverified online payments
PDF page 4 | Disabled
Fake settlement rejects with 400 and card UI is removed. PDF expects 404/405. Real gateway and bank-slip upload are absent; reference entry/manual recording exist.
F04  SaaS migrations and backfill
PDF page 5 | Prepared
Two migrations and explicit non-demo bootstrap exist and were locally tested. Production-shaped migration and restore are not yet verified.
F05  Deployment pipeline deletion
PDF page 5 | Restored
Frontend owner-merge deployment workflow restored from main. No production run was performed.
F06  Default platform password
PDF page 5 to 6 | Implemented
Seed and bootstrap require explicit unique credentials; supplied example is rejected. Bootstrap preserves existing hashes and refuses tenant promotion.

## Finding coverage 7 to 12

Finding and PDF page | Current status and evidence
F07  Global tenant role edits
PDF page 6 | Implemented
Composite role scope/name; tenant-local template copies and assignment validation. Schema rollback requires coordinated database restoration.
F08  Suspension and expiry
PDF page 6 | Implemented with differences
Protected APIs are denied; login/billing recovery remain accessible. PDF suggests rejecting login. Offline cached data is not remotely erased.
F09  Billing permissions
PDF page 6 to 7 | Implemented
Dedicated billing:view and billing:manage permissions separate billing access from general settings changes.
F10  Request validation
PDF page 7 | Implemented
Plan and add-on requests use validated DTOs with bounded strings and integer quantities. QA should test unknown properties and invalid quantities.
F11  Recurring lifecycle
PDF page 7 | Implemented for V1
Monthly periods, renewal invoices seven days before expiry, seven-day grace and monthly quota resets. Annual billing, proration and refunds are deferred.
F12  One-time add-on permanence
PDF page 7 to 8 | Implemented for V1
Unused add-on units expire at the subscription period end; an independent carry-forward credit ledger is deferred.

## Finding coverage 13 to 18

Finding and PDF page | Current status and evidence
F13  Quota races
PDF page 8 | Implemented and integration-tested
Conditional AI/message reservations and database branch/user caps prevent concurrent usage from exceeding limits.
F14  Duplicate approvals
PDF page 8 | Implemented and integration-tested
Transactional request claims and idempotent manual settlement allow only one effective approval or payment.
F15  Invoice pricing and tax snapshots
PDF page 8 to 9 | Implemented
Issued invoices snapshot customer, currency, tax rate, period, line items and totals; database guards reject edits after issue.
F16  Public receipt signing
PDF page 9 | Implemented
Required signing secret, tamper/expiry checks and 30-day public receipt-link expiry.
F17  Receipt totals
PDF page 9 to 10 | Implemented
Stored totals and signed receipt URLs are delivered through a durable email outbox with deduplication.
F18  Undelivered marked sent
PDF page 10 | Implemented; live provider acceptance remains
Quota failures throw and outbox state records delivery attempts; production SMTP delivery still requires staging verification.

## Finding coverage 19 to 22

Finding and PDF page | Current status and evidence
F19  Tenant SMTP secrets
PDF page 10 | Deferred by approved V1 scope
V1 uses platform-managed SMTP from the VPS environment file; tenant-owned SMTP and cloud mail adapters are deferred.
F20  Fictional successful billing data
PDF page 10 | Fixed locally
Removed invented Enterprise data and empty-success fallbacks; explicit error/retry views added.
F21  Reminder deduplication
PDF page 11 | Implemented
Durable invoice/stage/recipient reminder deduplication with seven-day advance notices and seven-day grace rules.
F22  Scale and review hygiene
PDF page 11 | Implemented
Paginated organization, invoice, audit and request reads, bounded aggregation and body-free privileged-mutation audit events.

## Approved V1 acceptance policy

Question | V1 policy
Payment model | Manual platform settlement only. Online settlement is disabled; no gateway or bank-slip upload.
Billing period | Monthly subscription periods; renewal invoice seven days before expiry; seven-day grace period.
Quota reset | Usage resets on monthly subscription renewal.
Unused add-ons | Expire at the subscription period end; no carry-forward credit ledger.
Suspension | Protected POS requests blocked; billing recovery allowed.
Business membership | One organization per internal account; no organization switcher.
Receipt expiry | 30 days.

Automated local evidence includes eight integration checks for billing deduplication, immutable invoices, grace expiry, settlement races, quotas, outbox rollback/deduplication, S3-compatible storage and local SMTP. Production-shaped restore, licensed MinIO, real provider delivery, AI inference and full acceptance on staging remain required.

No merge to main or production deployment was performed. The owner merge remains the authorized deployment trigger.
