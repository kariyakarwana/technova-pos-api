# Configuration and secret placement

## GitHub Actions production environment in each repository

The existing deployment workflow needs these environment secrets:

| Name | Purpose | Action |
| --- | --- | --- |
| VPS_SSH_PRIVATE_KEY | SSH identity for deploy user | Already exists by name in all three repositories. GitHub does not reveal its value. Keep it private. |
| VPS_KNOWN_HOSTS | Verified public SSH server host key | Already exists by name. Verify against the VPS console when rotating the server key. |

These are environment variables, not secrets: `VPS_HOST=202.37.229.47`, `VPS_SSH_PORT=22`, `VPS_USER=deploy`, `PUBLIC_BASE_URL=https://pos.nxcodeworks.com`, and `VPS_DEPLOY_READY`. The API readiness flag was `true` during this review; no GitHub settings were changed. Frontend repository variable `PRODUCTION_API_URL=https://pos.nxcodeworks.com/api/v1` remains the build-time API address.

The public-SSH workflows do not use `TS_AUDIENCE` or `TS_OAUTH_CLIENT_ID`. Existing names can remain pending owner cleanup. `GITHUB_TOKEN` is supplied by GitHub for image publishing; do not create a duplicate user-managed secret with that name.

**No additional GitHub Actions secret is required by the SaaS code prepared here.** Adding an application password to GitHub alone does not inject it into the VPS containers. The deployment script intentionally preserves the server environment file instead of copying application secrets from Actions.

## New VPS application settings

Add these through an approved secure server configuration method to `/etc/technova/production.env`:

| Name | Type | Purpose |
| --- | --- | --- |
| RECEIPT_SIGNING_SECRET | Secret | Independent cryptographically random secret, at least 32 characters. Required at API startup. Rotation invalidates old signed receipt links. |
| PLATFORM_ADMIN_EMAIL | Setting | Dedicated NxCodeWorks platform-owner email. Must not be an existing tenant account. |
| PLATFORM_ADMIN_PASSWORD | Secret | New unique password of at least 16 characters for initial bootstrap. The shared example password is rejected. Existing passwords are not reset on rerun. Remove this bootstrap-only secret after verified setup if the operator's procedure permits. |
| SAAS_LEGACY_PLAN_CODE | Setting | Explicit catalog plan for existing organizations that lack subscriptions. No guessed default. |
| SAAS_LEGACY_PERIOD_END | Setting | Explicit future ISO timestamp for the initial legacy entitlement period. |
| BILLING_WORKER_ENABLED | Setting | Set true only after approving the current 30-day renewal behavior. Default template is false. |
| PUBLIC_FRONTEND_URL | Setting | `https://pos.nxcodeworks.com`, used with the configured frontend origin. |

Existing production authentication credentials, SMTP, provider credentials and storage keys must be retained. Do not replace them with values from the laptop's preview environment.

## WhatsApp runtime credentials

Choose the provider already approved for production. Do not enable both providers by guessing.

For Meta, set `WHATSAPP_PROVIDER=meta`, `WHATSAPP_ACCESS_TOKEN` (secret), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE`, and `WHATSAPP_TEMPLATE_HAS_BODY_PARAMETER`. Where templates require payload mapping, configure `WHATSAPP_TEMPLATE_PARAMETER_KEYS`. The webhook verifier reads `WHATSAPP_WEBHOOK_SECRET` (secret). Template approvals and matching parameters must be verified with the provider.

For WhatChimp, set `WHATSAPP_PROVIDER=whatchimp`, `WHATCHIMP_API_TOKEN` (secret), `WHATCHIMP_PHONE_NUMBER_ID`, `WHATCHIMP_TEMPLATE_NAME`, and `WHATCHIMP_LANGUAGE_CODE`. `WHATCHIMP_API_BASE_URL` is an optional provider endpoint override; retain the supported default unless the operator has verified an alternative.

The code also supports event-specific Meta template variables with an event suffix. Use the exact event names and parameter mapping in `notifications.service.ts`; do not assume every event can share one template.

These values go in the VPS application environment, not a separate category called WhatsApp secrets in GitHub. GitHub does not provide a built-in WhatsApp-secret store. Do not send access tokens or private keys through WhatsApp/chat.

## Other retained integrations

- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Use the real approved SMTP service in production. Mailpit is only for the isolated laptop preview.
- Gemini: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_RETRY_BASE_DELAY_MS`. Never commit the API key. Inference/model availability must be checked with the configured account.
- MinIO: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_PUBLIC_BUCKET`, `MINIO_PRIVATE_BUCKET`, `MINIO_PUBLIC_URL`. The backend uses its app access key, not a browser-exposed root key.
- MinIO AIStor license: `/etc/technova/minio.license`, mounted read-only. Confirmed by the user to exist on the VPS only. It is not a GitHub secret and has not been copied locally.
- Authentication: retain the existing `AUTH_JWT_ACCESS_SECRET` or the supported legacy `JWT_ACCESS_PRIVATE_KEY` setting, plus other configured auth/OTP/QR secrets. Do not rotate these as an incidental part of the SaaS migration.

## What has and has not been verified

GitHub secret names and selected non-secret variables were inspected using the authenticated API. Secret values were neither available nor read. The production server environment, license validity, live provider credentials, actual running image digests and restored backup were not inspected in this task. The local preview is not evidence that those external dependencies work.
