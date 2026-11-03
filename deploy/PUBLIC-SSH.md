# Public SSH deployment

The production workflows now connect directly from GitHub-hosted runners to
202.37.229.47 using SSH. They no longer join Tailscale. Owner-merge authorization,
mandatory CI, immutable images, host-key verification and server-side rollback
remain unchanged. No self-hosted GitHub runner is required.

## GitHub configuration in each production environment

Variables:

- VPS_HOST: 202.37.229.47
- VPS_USER: deploy
- VPS_SSH_PORT: 22 (default; confirm the public port with the server owner)
- PUBLIC_BASE_URL: https://pos.nxcodeworks.com
- VPS_DEPLOY_READY: false until public SSH access and server setup are verified

Secrets:

- VPS_SSH_PRIVATE_KEY: the existing dedicated deployment private key
- VPS_KNOWN_HOSTS: the verified SSH host key for the public endpoint

For port 22, known_hosts starts with `202.37.229.47 ssh-ed25519 ...`.
For a nonstandard port it starts with `[202.37.229.47]:PORT ssh-ed25519 ...`.
Keep the trusted host key supplied by the server owner; do not accept a new key
automatically or disable StrictHostKeyChecking to bypass a mismatch.
TS_OAUTH_CLIENT_ID and TS_AUDIENCE are no longer used by these workflows.
Existing Tailscale credentials may remain during transition; do not revoke ones
used by other services. The frontend repository PRODUCTION_API_URL is unchanged.

## Navod and the server owner

1. Confirm this public address and port reach the intended VPS. If a gateway or
   NAT is involved, forward the approved public SSH port to the VPS SSH service.
2. Permit the deployment connection through the hosting firewall and the VPS
   firewall. GitHub-hosted runners do not have one fixed source IP. Do not
   disable the firewall or expose unrelated services. If the server owner
   requires fixed-source allowlisting, arrange a runner/network with a stable
   approved egress address before enabling deployments.
3. Keep a dedicated deploy account with public-key authentication, restricted
   authorized_keys, and sudo limited to /usr/local/sbin/technova-deploy. Do not
   enable root/password login as a workaround. Preserve administrator access.
4. Verify the public endpoint's host-key fingerprint from the trusted VPS
   console and match it to the supplied key. If the endpoint has a different
   verified host key, have kariyakarwana update VPS_KNOWN_HOSTS.
5. Check the installed V1 script, release.env, production.env, existing stack,
   database backups and health endpoints using V1-RUNBOOK.md. Do not rerun the
   old full installer or change Nginx for this transport change.
6. Confirm noninteractive SSH as deploy and the read-only command
   `sudo -n /usr/local/sbin/technova-deploy --version` return
   `technova-deploy 1.0.0`. Never paste the private key into chat or logs.

## Owner activation

Merge the public-SSH PRs as kariyakarwana only after CI passes. Keep readiness
false if the firewall, endpoint identity or server setup is not yet confirmed.
After confirmation, set VPS_DEPLOY_READY=true and rerun failed jobs on the
latest main merge runs, API then AI then frontend. An older Tailscale run must
not be rerun to test the new transport: it still uses its original workflow.
No deployment is proven until SSH, rollout and all health checks succeed.

## Troubleshooting

- Timeout: check public IP, port, NAT, source restrictions and both firewalls.
- Connection refused: check SSH listener and port forwarding.
- Host key verification failed: verify endpoint identity and known_hosts.
- Permission denied publickey: check the deploy account, authorized_keys and
  the matching private-key secret.

This change does not alter the application's public HTTPS address.
