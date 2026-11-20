# TechNova SaaS candidate handover

Prepared 18 November 2026. This is documentation for the uncommitted local candidate, not a production acceptance certificate. No commit, push, merge or production deployment was performed.

## Read in this order

1. **TechNova-SaaS-Coverage.pdf**: all 22 findings from the supplied audit, missing functionality and commercial decisions requiring owner approval.
2. **RELEASE-VALIDATION.md**: current local checks and unresolved release blockers.
3. **SECRETS-AND-DEPLOYMENT.md** and **SAAS-UPGRADE.md**: exact configuration names, safe bootstrap and first-transition recovery procedure.
4. **TechNova-QA-Guide.pdf**: QA setup, acceptance cases and evidence requirements.
5. **TechNova-API-Reference.html**: searchable backend reference. Open locally in a browser; keep the JSON files beside it. Covers all 226 controller operations. Import **technova-openapi.json** or **technova-postman.json** into QA tooling. The contracts are source-inferred and still require runtime validation.
6. **TechNova-AI-API-Reference.html**: eight internal AI operations and 34 Pydantic model contracts.
7. **TechNova-System-Handover.pdf**: architecture, tenant boundaries, billing behavior, operations, recovery and company acceptance.

Markdown companions support future maintenance. `database-schema.prisma` is the full schema; the JSON inventories preserve source references. No working credentials, private keys, MinIO license, database backup or AI model artifacts are included.

## Important environment distinction

The laptop preview at http://localhost:3100/platform-admin uses isolated PostgreSQL, Mailpit and SeaweedFS for development. It is not the licensed production stack. Production retains PostgreSQL 16, MinIO AIStor, Next.js, NestJS, Python/FastAPI, Docker Compose and Nginx. The MinIO license is on the VPS only, so licensed integration validation must be performed there or on an appropriately licensed isolated staging host.

Do not deploy the preview Compose file or copy its credentials to production. Do not run the demo seed against production. Use the controlled bootstrap in the upgrade guide.
