#!/usr/bin/env bash
#
# End-to-end smoke test for Alepha Rocket against real Cloudflare R2.
#
# What it does:
#   1. Builds + packs apps/example-ssr (`alepha build && alepha pack`).
#   2. Uploads the tar.gz to a real R2 bucket (`aws s3 cp` with the
#      bucket's S3 endpoint).
#   3. Starts the alepha/rocket:latest container, env-wired at R2.
#   4. POST /deploys op=up, polls until succeeded, curls the deployed
#      worker URL.
#   5. POST /deploys op=down, polls until succeeded.
#
# Requirements on the host:
#   - docker daemon running
#   - aws CLI installed (`brew install awscli`)
#   - jq installed
#   - alepha/rocket:latest built locally (`yarn workspace rocket push --dry-run`)
#   - apps/rocket/.env.secrets present (gitignored) — see below
#
# apps/rocket/.env.secrets format:
#   CLOUDFLARE_API_TOKEN=...      # Workers Scripts: Edit + Workers Routes: Edit
#   CLOUDFLARE_ACCOUNT_ID=...     # 32-char hex
#   S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com
#   S3_ACCESS_KEY_ID=...          # R2 API token (Object Read & Write)
#   S3_SECRET_ACCESS_KEY=...
#
# R2 bucket name is the BUCKET var below — create it once in the CF
# dashboard before running this script.
#
# Idempotency: rerun the script and it'll re-deploy the same worker
# (example-ssr-production). Cleanup runs on exit even if the script fails.

set -euo pipefail

cd "$(dirname "$0")/.."   # apps/rocket

ROCKET=rocket-e2e-rocket
BUCKET=${R2_BUCKET:-alepha-rocket-e2e}
ARTIFACT=example-ssr-latest.tar.gz
WORK=/tmp/rocket-e2e
APP_DIR=../example-ssr
ROCKET_IMAGE=alepha/rocket:latest

# Cap any single curl + the polling loops so a stuck container can't
# hang the whole script past the host's command timeout.
POLL_TIMEOUT_S=${POLL_TIMEOUT_S:-240}
WAIT_TIMEOUT_S=${WAIT_TIMEOUT_S:-60}

red()    { printf "\033[31m%s\033[0m\n" "$*" >&2; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
note()   { printf "\033[36m▶ %s\033[0m\n" "$*"; }

dump_logs() {
  printf "\n--- docker logs %s ---\n" "$ROCKET" >&2
  docker logs "$ROCKET" 2>&1 | tail -60 >&2 || true
}

cleanup() {
  local rc=$?
  # Surface container logs on any non-zero exit so the failure isn't
  # invisible. ROCKET_DEBUG_RETAIN=1 to skip the rm step entirely.
  if [ "$rc" -ne 0 ]; then
    dump_logs
  fi
  if [ -z "${ROCKET_DEBUG_RETAIN:-}" ]; then
    note "cleanup"
    docker rm -f "$ROCKET" >/dev/null 2>&1 || true
    rm -rf "$WORK"
  else
    note "ROCKET_DEBUG_RETAIN set — container + $WORK kept"
  fi
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# 0. Pre-flight
# -----------------------------------------------------------------------------

[ -f .env.secrets ] || {
  red "Missing apps/rocket/.env.secrets — see header of this script."
  exit 1
}
# shellcheck disable=SC1091
source .env.secrets

for v in CLOUDFLARE_API_TOKEN S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  if [ -z "${!v:-}" ]; then
    red "$v not set in apps/rocket/.env.secrets"
    exit 1
  fi
done

docker image inspect "$ROCKET_IMAGE" >/dev/null 2>&1 || {
  red "$ROCKET_IMAGE not found — run 'yarn workspace rocket push --dry-run' first."
  exit 1
}

command -v jq >/dev/null || { red "jq required"; exit 1; }
command -v aws >/dev/null || { red "aws CLI required (brew install awscli)"; exit 1; }

cleanup   # in case a previous run left containers behind

# -----------------------------------------------------------------------------
# 1. Build example-ssr
# -----------------------------------------------------------------------------

note "build + pack example-ssr → $WORK/$ARTIFACT"
mkdir -p "$WORK"
( cd "$APP_DIR" \
  && yarn alepha build -t cloudflare \
  && yarn alepha pack --output "$WORK" )
green "  $(ls -lh "$WORK/$ARTIFACT" | awk '{print $5}')"

# -----------------------------------------------------------------------------
# 2. Upload artifact to R2 via `aws s3 cp`
# -----------------------------------------------------------------------------

# Shared aws CLI env — R2 auth via the S3-compat keys from .env.secrets.
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

# Create the bucket if it doesn't exist (R2 supports `s3 mb` via the
# S3-compat API). Idempotent — fine to re-run.
if ! aws s3api head-bucket --bucket "$BUCKET" \
     --endpoint-url "$S3_ENDPOINT" >/dev/null 2>&1; then
  note "create R2 bucket $BUCKET"
  aws s3 mb "s3://$BUCKET" --endpoint-url "$S3_ENDPOINT" >/dev/null
fi

note "upload → s3://$BUCKET/$ARTIFACT (R2)"
aws s3 cp "$WORK/$ARTIFACT" "s3://$BUCKET/$ARTIFACT" \
  --endpoint-url "$S3_ENDPOINT" \
  --no-progress
green "  uploaded"

# -----------------------------------------------------------------------------
# 4. Start Rocket
# -----------------------------------------------------------------------------

note "start rocket"
ROCKET_RUN_ARGS=(
  -d --rm --name "$ROCKET"
  -p 3000:3000
  -e CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN"
  -e S3_ENDPOINT="$S3_ENDPOINT"
  -e S3_REGION=auto
  -e S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
  -e S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
)
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && ROCKET_RUN_ARGS+=(-e CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID")
docker run "${ROCKET_RUN_ARGS[@]}" "$ROCKET_IMAGE" >/dev/null

# Wait for Rocket ready (cap at WAIT_TIMEOUT_S)
ROCKET_DEADLINE=$(( $(date +%s) + WAIT_TIMEOUT_S ))
until curl -sf --max-time 2 http://localhost:3000/api/health >/dev/null; do
  [ "$(date +%s)" -ge "$ROCKET_DEADLINE" ] && {
    red "rocket not ready — logs:"
    docker logs "$ROCKET" 2>&1 | tail -30 >&2 || true
    exit 1
  }
  sleep 0.5
done
curl -sf --max-time 5 http://localhost:3000/api/health | jq .
green "  rocket up"

# -----------------------------------------------------------------------------
# 5. POST /deploys (op=up)
# -----------------------------------------------------------------------------

post_deploy() {
  local op=$1
  curl -sf --max-time 10 -X POST http://localhost:3000/api/deploys \
    -H 'content-type: application/json' \
    -d "{
      \"op\": \"$op\",
      \"project\": \"example-ssr\",
      \"env\": \"production\",
      \"artifact\": { \"bucket\": \"$BUCKET\", \"key\": \"$ARTIFACT\" }
    }"
}

poll_until_done() {
  local id=$1
  local state status
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    state=$(curl -sf --max-time 10 "http://localhost:3000/api/deploys/$id") \
      || { red "curl /api/deploys/$id failed"; return 1; }
    status=$(echo "$state" | jq -r .status)
    printf "  [poll] %s\n" "$status" >&2
    case "$status" in
      succeeded) echo "$state"; return 0 ;;
      failed)
        red "deploy failed:"
        printf "%s\n" "$state" | jq '{ status, error }' >&2 \
          || printf "%s\n" "$state" >&2
        printf "\n--- log ---\n%s\n" \
          "$(printf "%s\n" "$state" | jq -r .log)" >&2
        return 1
        ;;
    esac
    sleep 3
  done
  red "poll timeout (${POLL_TIMEOUT_S}s) — last state:"
  printf "%s\n" "$state" >&2
  return 1
}

note "POST /deploys op=up"
UP_JOB=$(post_deploy up)
UP_ID=$(echo "$UP_JOB" | jq -r .id)
green "  id=$UP_ID"

UP_RESULT=$(poll_until_done "$UP_ID")
URL=$(echo "$UP_RESULT" | jq -r .deployedUrl)
green "  deployed: $URL"

if [ -n "$URL" ] && [ "$URL" != "null" ]; then
  note "curl deployed worker"
  curl -sf --max-time 10 "$URL" -o /dev/null && green "  ✓ worker responds"
fi

# -----------------------------------------------------------------------------
# 6. POST /deploys (op=down)
# -----------------------------------------------------------------------------

note "POST /deploys op=down"
DOWN_JOB=$(post_deploy down)
DOWN_ID=$(echo "$DOWN_JOB" | jq -r .id)
green "  id=$DOWN_ID"

poll_until_done "$DOWN_ID" >/dev/null
green "  ✓ down succeeded"

green "e2e OK"
