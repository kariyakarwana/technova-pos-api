# TechNova API QA Guide

Prepared for NxCodeWorks Engineering and QA on 18 November 2026.

## Purpose and package contents

This guide tells QA how to exercise the current TechNova API and how to distinguish implemented behavior from unverified production integrations. The accompanying searchable reference covers all 226 NestJS controller endpoints, with parameters, request schemas, inferred response types, permission decorators and source locations. A second reference covers all 8 internal AI routes and 34 Pydantic model contracts.

File | Use
TechNova-API-Reference.html | Search every public backend route, permission and response type.
technova-openapi.json | Import the complete source-derived API contract into an OpenAPI client.
technova-postman.json | Import requests grouped by module. Set local variables and fill request bodies from the schema.
TechNova-AI-API-Reference.html | Internal FastAPI routes and exact request/response model definitions.
database-schema.prisma | Database enums, columns, relations, indexes and constraints.

### Contract limits

Return types are inferred from checked TypeScript source, not captured live responses. JSON/any fields remain open-ended and include x-typescript-type notes. x-validation records class-validator rules that cannot all be expressed by JSON Schema. Redirects, cookies, multipart handling and handler-written responses require the source-specific checks indicated in the reference.

The documentation is not a QA sign-off. The feature-gap report lists incomplete capabilities and differences from the supplied audit. Do not execute destructive or financial test cases against the production database.

## Environment and authentication

Target | Address
Local backend | http://localhost:4100/api/v1
Local frontend | http://localhost:3100
Local captured email | http://localhost:8125
Production after release | https://pos.nxcodeworks.com/api/v1
Internal AI only | http://ai-service:8000

Use a platform owner, two different organization owners, a limited staff user in each organization, a supplier and a customer test account. Keep tenant A and tenant B browser sessions separate. Obtain credentials through the approved test-account channel; no working passwords are included in this package.

POST /api/v1/auth/login
Content-Type: application/json
{"email":"qa-owner@example.test","password":"<test account password>"}

Login returns accessToken, expiresIn and user. The normal access-token lifetime is 900 seconds. Send Authorization: Bearer <accessToken> on authenticated routes. Normal browser refresh sessions use the HttpOnly technova_refresh cookie with an eight-hour lifetime. Retain a cookie jar when testing refresh and logout. Production cookies require HTTPS; the isolated HTTP preview uses its explicit local override.

PLATFORM_SUPER_ADMIN is the NxCodeWorks platform role. SUPER_ADMIN is an organization administrator and bypasses that organization's permission checks, but cannot call platform-admin routes. Permission requirements in the API reference are combined with membership/resource checks in the service. Public routes can still require signed tokens, webhook signatures or other handler checks.

Verify expired tokens, refresh rotation, logout, disabled accounts, password reset and temporary-password flows. Do not assume a successful login proves entitlement to protected POS operations. Suspended organizations can authenticate for billing recovery while their protected POS API requests are denied.

## Request and response rules

The NestJS API applies ValidationPipe with transformation, a property whitelist and rejection of unexpected properties. Send JSON unless the reference identifies multipart/form-data. Decimal money values may serialize as strings; preserve decimal precision in assertions. Dates are ISO timestamps. Use opaque IDs returned by the server, not invented numeric IDs.

Status | QA interpretation
200 or 201 | Normal controller success; endpoint-specific HttpCode can override the default.
204 | Success with no body where explicitly declared.
400 | Validation or business-rule rejection. Check message shape and absence of mutation.
401 | Missing, invalid or expired authentication where required.
403 | Permission, tenant, suspension or quota rejection. Verify which condition caused it.
404 | Resource absent or concealed; cross-tenant resource IDs must never reveal data.
409 | Conflict where explicitly handled. Concurrent Prisma conflicts can still need error normalization.
429 | Proxy or auth rate limit. Record Retry-After if supplied.
5xx | Unexpected failure or unavailable external dependency; do not treat as a successful empty result.

Success response shapes vary by module: some are lists, others use pagination or operation-specific objects. Do not impose a universal data envelope. Errors can expose message as a string or a validation array. Use the route contract and actual response to build precise assertions.

Uploads use multipart field file. Product images allow supported image formats up to 8 MiB; branding logos use 5 MiB; product media has a 50 MiB interceptor limit. Inspect content-type, actual file-signature validation, object metadata and browser reachability. Nginx and application limits both apply. Base64 JSON invoice content is subject to the 8 MiB API JSON limit.

## Core business acceptance flows

### Organization onboarding and access

As platform owner, POST /platform-admin/organizations with name, planCode, adminName and adminEmail; optional branchName and branchCode customize the first branch. Inspect the returned organization, branch, administrator, subscription and invoice. Verify the onboarding message through the test inbox. Sign in as the tenant owner and confirm only that organization is accessible.

### POS and inventory

Create catalog entries, variants and units; receive stock through purchasing; quote and complete a sale; assert inventory movement, payment records, tax, discount and receipt totals. Exercise zero-price and fully discounted lines, partial payment, credit, returns, stock transfers and warranty activation. Repeat a client operation according to its idempotency contract and verify no duplicate sale or inventory deduction.

### Tenant isolation

Try tenant B product, sale, customer, branch, role, supplier and invoice IDs using tenant A tokens. Check list filters and mutation paths as well as detail reads. Attempt to assign PLATFORM_SUPER_ADMIN through tenant user management. Edit a shared role template from one tenant and verify the other tenant's role permissions and sessions are unchanged.

### Offline behavior

Submit an offline batch through /offline-sync/batches, inspect its returned status and query it by clientBatchId. Test duplicate client batches, partial failures, suspended-tenant synchronization and revoked access. Server denial cannot erase already cached offline data; company policy must define what a suspended terminal may display and how unsynced sales are handled.

### Public receipt

Call /receipts/{receiptId}?token=<signed token> and open the corresponding frontend receipt. Compare subtotal, discount, tax, total, paid amount and balance to the stored sale. Test tampered receipt/tenant IDs, an expired token, a rotated signing secret and zero-valued line totals. Treat the URL as a bearer credential and exclude it from screenshots shared outside QA.

## SaaS billing and integration acceptance

Submit /subscription/plan-change-request with targetPlanCode or /subscription/addons with type and integer quantity. As platform owner, review /platform-admin/subscription-requests/{id}/review with action APPROVE or REJECT. Inspect the invoice and entitlements. Send simultaneous duplicate approvals, then verify one effective grant and one invoice. Repeating a manual payment must not settle the same invoice twice.

POST /subscription/invoices/{id}/pay-online is deliberately disabled and currently rejects with 400; no payment gateway is integrated. This differs from the supplied audit's suggested 404/405 result. A bank reference is a claim, not proof that money arrived. The platform owner must verify payment independently before recording settlement.

Exercise expiry and cancellation using a controlled test clock/database fixture. The current renewal worker runs hourly and advances monthly subscription periods; usage counters reset by UTC calendar month. Test one-time add-on expiry at the month boundary, recurring add-on renewal, no-subscription access and a downgrade below actual branch/user counts. Commercial-policy differences are listed in the coverage report.

At a quota boundary, send concurrent AI and message operations. Assert that reserved usage does not exceed the limit and that failed operations release reservations where implemented. Confirm that quota-blocked messages are not marked SENT. Provider acceptance followed by database failure requires reconciliation instead of blind resending.

On the licensed staging stack, test MinIO upload/read/delete permissions, private-object denial, actual SMTP delivery, approved WhatsApp templates and webhook signatures, Gemini success/failure and AI model inference. /health confirms process/database basics; it does not establish provider delivery or model correctness.

### Required evidence

For each case record build commit/image digest, role, tenant, sanitized request, response status, response body, database/outbox effect and expected result. Redact passwords, tokens, cookies, signed receipt URLs and provider credentials. Attach provider message IDs and backup-restore evidence separately through the approved private channel.

## Endpoint module index

The searchable HTML and OpenAPI files provide every endpoint and schema. The index below helps divide QA ownership without treating an entire module as passed after a single happy-path test.

Module | Routes
ai-intelligence | 7
ai-intelligence/business-assistant | 1
audit-events | 1
auth | 21
branches | 3
catalog | 17
credit | 3
customer-app | 10
customers | 4
dashboard-templates | 5
dashboards | 7
discounts | 6
health | 1
inventory | 10
loyalty | 6
notifications | 11
offline-sync | 4
organization | 5
platform-admin | 21
purchasing | 6
qr | 2
receipts | 1
reports | 23
returns | 5
roles | 4
root | 1
sales | 7
subscription | 8
supplier-portal | 8
suppliers | 4
users | 4
visual-themes | 6
warranties | 3
webhooks | 1

Machine-readable inventories are included for reconciliation. Regenerate them after changing controllers or DTOs, and compare operation counts and source locations before a release.
