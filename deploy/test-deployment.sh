#!/usr/bin/env bash
# Isolated failure-injection tests. No Docker daemon, network, sudo, or production files.
set -euo pipefail
source_file="$(cd "$(dirname "$0")" && pwd)/technova-deploy"
bash -n "$source_file"
workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
mkdir -p "$workspace/bin"
cat > "$workspace/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$CASE_DIR/docker.log"
if [[ "$*" == *release.previous.env* && "$*" == *' up '* ]]; then
  touch "$CASE_DIR/recovering"
  [[ "$FAIL_STAGE" != rollback ]] || exit 1
fi
if [[ "$*" == *'printenv POSTGRES_USER'* ]]; then echo postgres; exit; fi
if [[ "$*" == *'printenv POSTGRES_DB'* ]]; then echo technova; exit; fi
if [[ "$*" == *'pg_dump '* ]]; then [[ "$FAIL_STAGE" != backup ]] || exit 1; echo backup; exit; fi
if [[ "$*" == *'pg_restore --list'* ]]; then cat >/dev/null; exit; fi
if [[ "$*" == *'run --rm --no-deps migrate'* && "$FAIL_STAGE" == migrate ]]; then exit 1; fi
if [[ "$*" == *release.candidate.* && "$*" == *' pull'* && "$FAIL_STAGE" == pull ]]; then exit 1; fi
if [[ "$*" == *release.candidate.* && "$*" == *' up '* && "$FAIL_STAGE" == rollout ]]; then exit 1; fi
if [[ "$*" == *'exec -T ai-service'* && ! -e "$CASE_DIR/recovering" && "$FAIL_STAGE" == ai ]]; then exit 1; fi
exit 0
MOCK
cat > "$workspace/bin/curl" <<'MOCK'
#!/usr/bin/env bash
echo "$*" >> "$CASE_DIR/curl.log"
if [[ ! -e "$CASE_DIR/recovering" && ( "$FAIL_STAGE" == https || "$FAIL_STAGE" == rollback ) ]]; then exit 1; fi
exit 0
MOCK
cat > "$workspace/bin/install" <<'MOCK'
#!/usr/bin/env bash
# Production uses install only to create the backup directory. Ownership/mode
# are not portable to Windows; runtime permissions are checked in the VPS runbook.
mkdir -p "${@: -1}"
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$workspace/bin/chown"
printf '#!/usr/bin/env bash\n[[ "$FAIL_STAGE" != lock ]]\n' > "$workspace/bin/flock"
chmod +x "$workspace/bin/"*
export PATH="$workspace/bin:$PATH"
export CASE_DIR FAIL_STAGE
old_digest="$(printf 'a%.0s' {1..64})"
new_digest="$(printf 'b%.0s' {1..64})"

run_case() {
  local name="$1" mode="$2" failure="$3" expected="$4"
  CASE_DIR="$workspace/$name"
  FAIL_STAGE="$failure"
  mkdir -p "$CASE_DIR/deploy" "$CASE_DIR/etc" "$CASE_DIR/backups"
  touch "$CASE_DIR/etc/production.env" "$CASE_DIR/deploy/compose.production.yml"
  echo https://pos.example.test > "$CASE_DIR/etc/public-base-url"
  cat > "$CASE_DIR/deploy/release.env" <<EOF
FRONTEND_IMAGE=ghcr.io/kariyakarwana/technova-pos@sha256:$old_digest
BACKEND_IMAGE=ghcr.io/kariyakarwana/technova-pos-api@sha256:$old_digest
BACKEND_MIGRATE_IMAGE=ghcr.io/kariyakarwana/technova-pos-api-migrate@sha256:$old_digest
AI_IMAGE=ghcr.io/kariyakarwana/technova-pos-ai@sha256:$old_digest
EOF
  cp "$CASE_DIR/deploy/release.env" "$CASE_DIR/original.env"
  sed -e "s|/opt/technova/deploy|$CASE_DIR/deploy|g" \
    -e "s|/etc/technova/|$CASE_DIR/etc/|g" \
    -e "s|/var/backups/technova/postgres|$CASE_DIR/backups|g" \
    -e "s|/run/lock/technova-deploy.lock|$CASE_DIR/lock|g" \
    "$source_file" > "$CASE_DIR/script"
  local -a args=()
  case "$mode" in
    frontend) args=(--frontend "ghcr.io/kariyakarwana/technova-pos@sha256:$new_digest") ;;
    ai) args=(--ai "ghcr.io/kariyakarwana/technova-pos-ai@sha256:$new_digest") ;;
    backend) args=(--backend "ghcr.io/kariyakarwana/technova-pos-api@sha256:$new_digest" "ghcr.io/kariyakarwana/technova-pos-api-migrate@sha256:$new_digest") ;;
    invalid) args=(--frontend 'ghcr.io/attacker/image:latest') ;;
  esac
  [[ "$name" != missing_release ]] || rm "$CASE_DIR/deploy/release.env"
  [[ "$name" != missing_origin ]] || rm "$CASE_DIR/etc/public-base-url"
  local status=0
  bash "$CASE_DIR/script" "${args[@]}" > "$CASE_DIR/output" 2>&1 || status=$?
  if [[ "$expected" == success ]]; then
    [[ "$status" == 0 ]] || { cat "$CASE_DIR/output"; return 1; }
    grep -q "$new_digest" "$CASE_DIR/deploy/release.env"
    grep -q 'https://pos.example.test/login' "$CASE_DIR/curl.log"
    if [[ "$mode" != backend ]]; then ! grep -q 'run --rm' "$CASE_DIR/docker.log"; fi
    grep -q -- '--no-deps' "$CASE_DIR/docker.log"
  else
    [[ "$status" != 0 ]] || { echo "Unexpected success: $name"; return 1; }
    if [[ "$name" != missing_release ]]; then cmp "$CASE_DIR/original.env" "$CASE_DIR/deploy/release.env"; fi
    case "$failure" in
      rollout|ai|https|rollback) test -e "$CASE_DIR/recovering" ;;
      *) test ! -e "$CASE_DIR/recovering" ;;
    esac
    if [[ "$failure" == rollback ]]; then grep -q 'CRITICAL: rollback verification failed' "$CASE_DIR/output"; fi
  fi
  echo "PASS $name"
}
run_case frontend_success frontend none success
run_case ai_success ai none success
run_case backend_success backend none success
run_case invalid_digest invalid none failure
run_case missing_release frontend none failure
run_case missing_origin frontend none failure
run_case lock_timeout frontend lock failure
run_case pull_failure frontend pull failure
run_case backup_failure backend backup failure
run_case migration_failure backend migrate failure
run_case rollout_failure backend rollout failure
run_case ai_unhealthy ai ai failure
run_case public_health_failure frontend https failure
run_case rollback_failure frontend rollback failure
