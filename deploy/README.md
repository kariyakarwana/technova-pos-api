# TechNova POS deployment

This directory contains the single-VPS production stack. Until DNS is ready,
the stack is tested privately through Nginx on `127.0.0.1:8080` and an SSH
port-forward. PostgreSQL and the AI service never publish host ports.

## Files

- `compose.production.yml`: immutable application images plus PostgreSQL and MinIO.
- `production.env.example`: required secret and runtime variable names.
- `release.env.example`: the four immutable GHCR image references.
- `technova-deploy`: locked deployment, migration, backup, health-check and rollback script.
- `nginx/technova-private.conf`: pre-DNS loopback-only reverse proxy.
- `nginx/technova-production.conf.template`: public HTTP configuration used immediately before Certbot.

## One-time server installation

Run these commands interactively as the existing `devops` administrator:

```bash
sudo install -d -o root -g root -m 0755 /opt/technova/deploy
sudo install -d -o root -g root -m 0750 /etc/technova
sudo install -d -o root -g root -m 0750 /srv/technova/ai/artifacts
sudo install -d -o root -g root -m 0750 /srv/technova/ai/data/processed
sudo install -d -o root -g root -m 0750 /var/backups/technova
```

Install the Compose file and deployment command:

```bash
sudo install -o root -g root -m 0644 compose.production.yml /opt/technova/deploy/compose.production.yml
sudo install -o root -g root -m 0755 technova-deploy /usr/local/sbin/technova-deploy
```

Create `/etc/technova/production.env` from `production.env.example`, replacing
every placeholder. Keep mode `0600` and never commit this file.

## Private pre-DNS Nginx

```bash
sudo install -o root -g root -m 0644 nginx/technova-private.conf /etc/nginx/sites-available/technova-private
sudo ln -sfn /etc/nginx/sites-available/technova-private /etc/nginx/sites-enabled/technova-private
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
curl --fail http://127.0.0.1:8080/nginx-health
```

From Windows, open a private tunnel:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_vps" `
  -L 8080:127.0.0.1:8080 `
  devops@100.79.83.54
```

Then browse to `http://localhost:8080`.

## CI/CD connection

Each application repository verifies source and publishes a commit-tagged image
to GHCR. The workflow summary gives the immutable digest reference. The backend
repository owns the coordinated `Deploy Production` workflow.

The deployment workflow requires a Tailscale workload identity and a dedicated
`deploy` SSH key. Its sudo policy must allow only:

```text
/usr/local/sbin/technova-deploy
```

Do not make the production VPS a permanent self-hosted GitHub runner.

## DNS phase

After the supervisor confirms the final hostname and inbound mapping for ports
80 and 443, replace `__DOMAIN__` in the production template, install it as the
active Nginx site, update production URLs and secure-cookie settings, rebuild the
frontend image, and only then run Certbot.
