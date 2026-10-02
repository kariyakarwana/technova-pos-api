#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 77
fi

readonly SOURCE_DIR="${1:-/home/devops/technova-deploy-candidate}"
readonly AI_SOURCE_DIR="${2:-/home/devops/technova-ai-assets-candidate-20261002}"
readonly DEPLOY_PUBLIC_KEY="${3:-/home/devops/technova_ci_deploy.pub}"

required_files=(
  "$SOURCE_DIR/compose.production.yml"
  "$SOURCE_DIR/production.env.example"
  "$SOURCE_DIR/technova-deploy"
  "$SOURCE_DIR/nginx/technova-private.conf"
  "$DEPLOY_PUBLIC_KEY"
)

for required_file in "${required_files[@]}"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required file: $required_file" >&2
    exit 66
  fi
done

if [[ ! -d "$AI_SOURCE_DIR/artifacts" || ! -d "$AI_SOURCE_DIR/data/processed" ]]; then
  echo "Missing AI artifacts or processed data under $AI_SOURCE_DIR" >&2
  exit 66
fi

if [[ -f "$AI_SOURCE_DIR/SHA256SUMS" ]]; then
  (
    cd "$AI_SOURCE_DIR"
    sha256sum --check SHA256SUMS
  )
fi

install -d -o root -g root -m 0755 /opt/technova/deploy
install -d -o root -g root -m 0750 /etc/technova
install -d -o root -g root -m 0750 /srv/technova/ai/artifacts
install -d -o root -g root -m 0750 /srv/technova/ai/data/processed
install -d -o root -g root -m 0750 /var/backups/technova

install -o root -g root -m 0644 \
  "$SOURCE_DIR/compose.production.yml" \
  /opt/technova/deploy/compose.production.yml
install -o root -g root -m 0644 \
  "$SOURCE_DIR/production.env.example" \
  /etc/technova/production.env.example
install -o root -g root -m 0755 \
  "$SOURCE_DIR/technova-deploy" \
  /usr/local/sbin/technova-deploy

cp -a "$AI_SOURCE_DIR/artifacts/." /srv/technova/ai/artifacts/
cp -a "$AI_SOURCE_DIR/data/processed/." /srv/technova/ai/data/processed/
chown -R root:root /srv/technova/ai
find /srv/technova/ai -type d -exec chmod 0750 {} +
find /srv/technova/ai -type f -exec chmod 0640 {} +

if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash deploy
fi
install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
install -o deploy -g deploy -m 0600 \
  "$DEPLOY_PUBLIC_KEY" \
  /home/deploy/.ssh/authorized_keys

sudoers_candidate="$(mktemp)"
trap 'rm -f "$sudoers_candidate"' EXIT
printf '%s\n' \
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/technova-deploy' \
  > "$sudoers_candidate"
chmod 0440 "$sudoers_candidate"
visudo --check --file "$sudoers_candidate"
install -o root -g root -m 0440 \
  "$sudoers_candidate" \
  /etc/sudoers.d/technova-deploy
visudo --check

install -o root -g root -m 0644 \
  "$SOURCE_DIR/nginx/technova-private.conf" \
  /etc/nginx/sites-available/technova-private
ln -sfn \
  /etc/nginx/sites-available/technova-private \
  /etc/nginx/sites-enabled/technova-private
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

test -x /usr/local/sbin/technova-deploy
test -r /opt/technova/deploy/compose.production.yml
test -r /home/deploy/.ssh/authorized_keys
curl --fail --silent --show-error http://127.0.0.1:8080/nginx-health

cat <<'EOF'

Server installation completed.

Still required before the first application deployment:
1. Create /etc/technova/production.env from the installed example.
2. Set its owner to root:root and mode to 0600.
3. Log the root Docker client into ghcr.io using a read:packages token.
4. Supply the four immutable image digest references to technova-deploy.
EOF
