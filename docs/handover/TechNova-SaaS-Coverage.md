# TechNova SaaS Coverage Review

Prepared for NxCodeWorks Engineering and QA on 18 November 2026.

## Decision and interpretation

The supplied technova-saas.pdf is a 13-page remediation audit of frontend PR 118 and API PR 22. It is not a separate list of finalized product features. This comparison checks the current local candidate against all 22 findings and the acceptance/product-decision sections.

Do not treat the current candidate as fully production-ready. Several core security defects were corrected, and production-stack configuration plus a controlled bootstrap are prepared. Missing capabilities below have not been added without owner approval. The table distinguishes local implementation from staging or production proof.

The PDF contains some implementation-specific claims that do not exactly match current source. For example, it names a local cleanup commit that was not established by this review; the actual work here is uncommitted. Current Prisma names are Plan, Subscription and related mapped tables, rather than every example name in the PDF. This report follows inspected code and verified tool results.

### Missing or incomplete capabilities to approve

Dedicated billing permissions; real online payment gateway; bank-slip file upload; advance renewal/grace policy; annual billing, proration, refunds and price grandfathering; independent carry-forward add-on credits; complete immutable invoice snapshots; encrypted tenant-managed email and cloud adapters; automatic durable email reminders; complete signed-receipt delivery; large-scale server pagination and full privileged auditing.

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
PDF page 6 to 7 | Partial match
Uses settings:manage rather than separate billing:view and billing:manage permission keys. Dedicated billing permissions are not added.
F10  Request validation
PDF page 7 | Implemented
Plan and add-on requests use validated DTOs with bounded strings and integer quantities. QA should test unknown properties and invalid quantities.
F11  Recurring lifecycle
PDF page 7 | Partial
Hourly opt-in worker renews 30-day periods and handles overdue/cancelled status. PDF proposes advance invoices/grace rules; annual/prorated billing is absent.
F12  One-time add-on permanence
PDF page 7 to 8 | Partial
Expiry prevents permanent allowance. Current policy expires at UTC month end; no independent carry-forward consumable-credit ledger.

## Finding coverage 13 to 18

Finding and PDF page | Current status and evidence
F13  Quota races
PDF page 8 | Implemented pending full stress test
Conditional AI/message reservations and database branch/user caps added. Local cap rejection passed; full concurrent provider/renewal tests remain.
F14  Duplicate approvals
PDF page 8 | Implemented pending race coverage
Conditional transactional request claims and unpaid-invoice settlement prevent repeated effects. Sequential duplicate tests passed; concurrent error normalization still needs verification.
F15  Invoice pricing and tax snapshots
PDF page 8 to 9 | Partial
Amounts and some line items stored, plan VAT used on add-on approval. Complete immutable rate/currency/period snapshots and consistent PDF details remain incomplete.
F16  Public receipt signing
PDF page 9 | Implemented with differences
Independent required secret and versioned expiry/tamper validation added. Current default expiry is 90 days; PDF calls for 30 days.
F17  Receipt totals
PDF page 9 to 10 | Implemented pending end to end QA
Top-level snapshot totals, zero values, paid amount and balance corrected. Automatic signed-link distribution through delivery channels remains incomplete.
F18  Undelivered marked sent
PDF page 10 | Implemented pending provider tests
Quota failures throw; provider acceptance followed by persistence failure requires reconciliation. Real delivery and ambiguous network outcomes require provider testing.

## Finding coverage 19 to 22

Finding and PDF page | Current status and evidence
F19  Tenant SMTP secrets
PDF page 10 | Not complete
Encrypted tenant credential management, host validation and UI are absent. Cloud provider is unsupported. Keep production scope on platform-managed SMTP.
F20  Fictional successful billing data
PDF page 10 | Fixed locally
Removed invented Enterprise data and empty-success fallbacks; explicit error/retry views added.
F21  Reminder deduplication
PDF page 11 | Partial
Invoice number included in in-app lookup; no unified durable invoice/stage/recipient email key and scheduler. Automatic email reminders are not complete.
F22  Scale and review hygiene
PDF page 11 | Partial
Accidental tatus file removed. Server pagination, bounded tenant aggregation and complete privileged-mutation auditing remain incomplete.

## Acceptance differences requiring a decision

Question | Current implementation
Payment model | Manual platform settlement exists. Online settlement is disabled; no real gateway or receipt-file upload.
Quota reset | Monthly subscription period; usage resets at renewal.
One-time packs | Expire at the next UTC month boundary; no indefinite carry-forward balance.
Suspension | Protected POS requests blocked; billing recovery allowed. No read-only tenant mode.
Business membership | Ambiguous multi-organization users rejected; no organization switcher.
Receipt expiry | 30 days.

The ten acceptance cases on PDF page 12 still require staging evidence. Local tests support parts of authorization, tenant isolation, duplicate billing, quota rejection, signed-token behavior and explicit UI errors, but do not constitute the full acceptance matrix. In particular, record concurrent quota tests, restored production-shaped data and real signed receipt totals.

The PDF recommends force-pushing and rotating credentials. Those statements are source recommendations, not instructions acted on here. No force push, remote secret rotation or production mutation was performed. Any exposure response should be based on whether affected builds actually ran and which credentials they could access.
