# TechNova System Handover

Prepared for NxCodeWorks Engineering and QA on 18 November 2026.

## Handover status and system scope

TechNova is a POS application being extended from a single organization with branches into a multi-organization subscription platform. NxCodeWorks administers organizations, plans, add-ons, invoices and operational oversight through /platform-admin. Each customer organization retains its own administrative dashboard and POS workflows.

The code is committed on feature/saas branches. Local builds and automated tests establish development evidence only. Production acceptance remains pending: the MinIO license is available only on the VPS, real integrations and a production-shaped restore rehearsal are outstanding. The separate coverage report lists capabilities intentionally deferred from the approved V1 scope.

Repository | Responsibility
kariyakarwana/technova-pos | Next.js browser application, authentication actions, POS UI, tenant billing and platform dashboard.
kariyakarwana/technova-pos-api | NestJS API, authorization, PostgreSQL/Prisma data model, outbox, billing, bootstrap and deployment tooling.
kariyakarwana/technova-pos-ai | Python/FastAPI inference endpoints and model/data loading.

Frontend and API work is on feature/saas. No merge to main, production deployment or production-secret change was performed. Preserve that distinction when handing the package to QA or the operating company.

### Reading order

Start with the coverage report and secrets checklist, then the QA guide. Use the full API references and database schema for implementation-level details. Use SAAS-UPGRADE.md for the first production transition, not the development seed.

## Architecture and production technologies

Layer | Technology and role
User interface | Next.js 16, React 19, TypeScript and Tailwind CSS. Server actions and a backend proxy integrate the authenticated UI.
Application API | Node.js 22, NestJS 11, Prisma 7 with PostgreSQL adapter, JWT-based sessions and class-validator DTOs.
Database | PostgreSQL 16 in the production Compose network; persistent named data volume.
Object storage | MinIO AIStor with public and private buckets, app access keys and a read-only license-file mount.
AI | Python 3.12, FastAPI, Pydantic, uv and numerical/model libraries including scikit-learn, LightGBM and XGBoost.
Ingress and runtime | Nginx on the VPS, HTTPS at the configured public domain, Docker Compose and GHCR digest-pinned application images.
Delivery | Platform SMTP, Meta or WhatChimp WhatsApp adapter, and Gemini for the business assistant.

Browser traffic reaches the frontend or /api/v1 through Nginx. The API reads and writes PostgreSQL, stores media in MinIO, calls the internal AI service and queues outbound notifications. The AI port is not published in production. Database and MinIO administration endpoints must remain private.

Production Compose pins postgres:16.15-alpine3.23 and quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z, with a matching AIStor mc initializer. Do not substitute the laptop's SeaweedFS service for production MinIO. The real-stack local override deliberately requires a MinIO license path and local AI artifact/data paths.

## Organizations users and permissions

An organization owns branches, business records and one subscription. OrganizationUser links internal users to their organization; branch assignments restrict operational context. The present guard rejects ambiguous multiple-organization memberships. There is no multi-business organization switcher in this candidate.

Principal | Intended access
NxCodeWorks platform owner | PLATFORM_SUPER_ADMIN; platform organization, catalog and invoice administration. Use a dedicated account, never a tenant account.
Organization owner | SUPER_ADMIN; administration within its own organization. This is not a platform-owner role.
Manager or staff | Tenant-scoped roles and permission keys controlling specific operations.
Supplier | Supplier portal access derived from supplier membership and associated organization.
Customer | Customer authentication/profile access and signed receipt links where applicable.

Global role templates use scope GLOBAL. Tenant-customized roles use the organization ID as scope. Updating an editable global template produces a tenant-local role and reassigns only that tenant's bindings. Reserved platform and root roles cannot be created or modified through tenant role management.

JWT authentication loads the current user and applies tenant status/subscription checks to protected routes. Platform operations have a separate platform guard. Permission decorators and service-level organization predicates both matter: a valid token or known object ID alone must not authorize access.

Suspension blocks protected POS operations while retaining billing recovery. Existing browser caches and offline records require operational handling; server-side suspension cannot retract data that a device already downloaded. Test both online requests and later offline synchronization.

## Business modules and data ownership

Domain | Responsibilities
Catalog and storage | Products, variants, categories, brands, units, barcodes, images/media and organization branding.
Inventory and purchasing | Stock levels, adjustments, serialized units, transfers, purchase orders, goods receipts and supplier workflows.
Sales and customers | Quotes, checkout, payments, discounts, loyalty, receipts, returns, credit schedules and customer records.
Warranties and QR | Warranty policies, registrations, activation and scoped QR access.
People and portals | Users, employees, roles, branch assignments, customer and supplier access.
Reporting and dashboards | Operational summaries, report endpoints, dashboard configuration and visual themes.
Notifications and offline sync | In-app messages, templates, preferences, delivery outbox, webhooks and replay-aware offline batches.
SaaS administration | Organizations, subscription plans, add-ons, quota usage, requests, invoices and platform analytics.

database-schema.prisma is the complete database reference, including enum values, optional fields, relations and indexes. Monetary values use Decimal fields in the API data model. Maintain transactional consistency between sales, inventory, payments and billing grants; do not repair business state by editing a single counter without reconciling its source records.

Customer and supplier information, receipts, financial records and audit data are sensitive company data. Restrict database dumps and object-store exports. Retention, lawful access, customer deletion/export procedures and backup retention must be approved by the company; this package does not invent legal retention periods.

## Subscriptions invoices and quotas

The existing catalog defines Basic, Standard, Professional and Enterprise tiers plus add-on packs. Catalog values are configurable data, not a confirmed commercial offer. The bootstrap inserts missing catalog entries without overwriting existing plans. The company must approve actual prices, tax setup and entitlement limits before taking customers live.

Tenant billing reads the subscription, invoices, usage and pending requests. Owners request a plan change or add-on; the platform administrator approves or rejects it. Approval claims the pending request inside a transaction before granting entitlements. Manual settlement applies only to an unpaid invoice. A user-supplied payment reference never verifies receipt of funds.

The implemented renewal worker is opt-in through BILLING_WORKER_ENABLED. It checks hourly, issues renewal invoices seven days before monthly period expiry, grants a seven-day grace period, extends recurring add-ons and marks overdue billing. Annual billing, proration and refunds are deferred from V1.

Usage periods follow monthly subscription periods and reset on renewal. Monthly add-ons expire at period end. Renewal notices are sent seven days before expiry, followed by a seven-day payment grace period. This differs from an indefinite consumable-credit ledger. Explicitly communicate the final approved policy to customers before selling packs.

Message and AI usage reservations use conditional updates. Database triggers serialize quota-sensitive branch/user creation per tenant. The isolated integration suite verifies concurrent quota limits, settlement deduplication, durable reminder/outbox behavior and transaction rollback. Live-provider failure behavior still requires staging acceptance.

Issued invoices store immutable currency, tax rate, billing period, customer snapshot, line items and totals. Database guards reject edits after issue. Public receipt links expire after 30 days. Accounting reconciliation and company tax approval remain operational responsibilities.

## Storage messaging and AI operations

### MinIO

Production mounts /etc/technova/minio.license read-only, persists minio_data and initializes public/private buckets. Public product assets use the configured public URL through /storage; private buckets must deny anonymous reads. Verify the app key has the required access and that root credentials never reach a browser bundle. Back up object data and configuration separately from PostgreSQL.

### Email and WhatsApp

The notification worker runs delivery processing every 30 seconds and operational alerts hourly when enabled. Durable outbox records and delivery attempts support investigation. Quota rejection must not be treated as a provider message ID. After provider acceptance followed by persistence failure, reconcile with the provider before retrying to avoid duplicate customer messages.

Platform-managed SMTP is the approved V1 baseline; its settings remain editable in the VPS environment file. Tenant-owned SMTP and cloud mail adapters are deferred. Local Mailpit checks prove delivery to a test inbox, not production delivery.

### AI

The API mediates authenticated access to the internal FastAPI service and Gemini. Mount the reviewed artifact and processed-data directories read-only. A healthy process can still lack a model or return a 503 for inference. Validate each intended inference route using representative data and record model/artifact versions alongside application image digests.

Provider credentials, approved WhatsApp templates, model availability and quota must be tested with the actual company accounts in a controlled environment. None of those live credentials can be recovered by reading GitHub secret values.

## Configuration bootstrap and deployment

SECRETS-AND-DEPLOYMENT.md lists exact names and storage locations. GitHub stores deployment SSH secrets and non-secret deployment variables. /etc/technova/production.env supplies application secrets. The MinIO license is a separate server file. Local .env changes do not automatically update the VPS or create a platform account.

The new non-demo bootstrap requires a dedicated platform email and a new unique password, refuses to promote a tenant user, preserves existing password hashes and requires explicit legacy plan/period settings when organizations have no subscription. It creates no demo organization and no retrospective invoice. Use --check for a read-only readiness check; use --apply only during the reviewed migration procedure.

npx tsx prisma/bootstrap-saas.ts --check
npx tsx prisma/bootstrap-saas.ts --apply

The existing GitHub workflow verifies code, checks that kariyakarwana merged the PR to current main, publishes immutable GHCR image digests, deploys over verified public SSH and records a release only after deployment succeeds. PR approval alone is not the deployment permission. The public-SSH path does not use Tailscale or require id-token: write.

For the first SaaS transition, hold automatic deployment using the existing readiness switch, publish reviewed candidate images, stop application writes, back up and rehearse restore, migrate, bootstrap/backfill and pass preflight before opening traffic. The owner then activates the newest authorized deployment. See SAAS-UPGRADE.md for commands and sequencing.

A green CI run is not proof of a successful business rollout. API health, frontend login, a protected tenant request, correct subscription access, storage read/write and intended AI/message integrations must all pass before operator sign-off.

## Recovery monitoring and incident response

The deployment script backs up PostgreSQL, validates the archive listing, retains previous image references and attempts image rollback on failure. A valid archive listing is not a restore test. The SaaS role migration removes the old global role-name unique key, so old binaries may fail against the new schema. The first transition must restore the pre-upgrade database and old image set together if rollback is required.

During recovery keep application writes stopped. Use the verified pre-upgrade backup in an isolated restore rehearsal first. Confirm tenant login, role permissions, inventory, sales balances and object references before reopening traffic. Restoring a backup after new writes would discard those writes; define the maintenance window and recovery decision explicitly.

Monitor application errors, database connectivity/capacity, disk space, MinIO health/license status, outbox failures, subscription renewal errors, provider rate limits and AI model availability. The dashboard no longer invents uptime; no connected external infrastructure monitor was established by this task.

Investigate delivery discrepancies using outbox IDs, attempt records and provider IDs. Investigate access issues using tenant membership, role scope, user status, subscription status/period and the relevant permission. Do not work around errors by disabling tenant guards or TLS/SSH host verification.

The original frontend PR contained an obfuscated remote-code loader. It was removed before local builds in this work. If earlier affected builds ran with credentials, the company should assess that exposure and rotate impacted credentials through its incident process. Source cleanup is not proof that prior machines or tokens were unaffected.

### Operational ownership

Repository owner controls merge/release permission. The VPS operator owns licensed storage, server secrets, backups, restore and ingress. QA owns acceptance evidence. The business owner approves commercial policies and missing feature scope. Record named people, escalation contacts and service-account ownership before company acceptance; this document does not assign authority to an unnamed person.

## Company acceptance and maintenance checklist

Accept the system only after the company has reviewed the known-gap report, selected the intended release scope and verified the actual deployment. Keep the source repositories, release digests, database schema, provider ownership and operational procedures together in the company-controlled handover location.

Evidence | Required record
Code and dependencies | Reviewed commits, dependency locks, clean build configuration and accepted residual security advisories.
Data transition | Production-shaped migration, explicit legacy plan mapping, unchanged existing passwords and verified restore test.
Access | Platform/tenant isolation, role escalation rejection, suspension behavior and approved account recovery.
Business flows | Sale/stock/payment integrity, receipts, offline replay, subscription approval and duplicate settlement tests.
Integrations | Licensed MinIO, private bucket denial, real SMTP and WhatsApp delivery, webhook validation and AI inference.
Operations | Named operator, secret ownership, backup schedule/retention, monitoring and tested rollback decision.
Commercial scope | Approved prices, taxes, billing periods, add-on expiry, payment model and explicit deferred features.

Local evidence includes 100 API tests and 79 frontend tests, successful local migrations and eight V1 integration checks. New dependency changes and bootstrap additions require the current release validation record in this package; use that record rather than assuming old test results cover a changed build.

Regenerate API documents after controller/DTO changes, run regression tests for affected domains, and deploy only owner-authorized current-main images. Do not run the demo seed against production or copy local preview passwords into company accounts. Keep unresolved items visible until their acceptance evidence is recorded.
