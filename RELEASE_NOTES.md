# TechNova POS V1.0.0

The first named production release of the existing TechNova application, with
owner-authorized deployment after a merge into main.

- Only kariyakarwana's PR merge may publish and deploy production images.
- Images are pinned by digest; main deployment runs are not auto-cancelled.
- Deployment verifies the installed V1 server script before making changes.
- Backend releases back up PostgreSQL before migrations; migrations must remain
  backward compatible. Frontend/AI releases do not run database migrations.
- Rollout and health failures attempt verified application-image rollback.
- A release is recorded only after production deployment succeeds.

This release does not add new application features. The API, frontend and AI
repositories each record their own V1 commit and image digest. See the API
repository's deploy/V1-RUNBOOK.md for installation, configuration and recovery.
