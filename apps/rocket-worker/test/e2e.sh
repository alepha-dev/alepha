#!/usr/bin/env bash
#
# End-to-end smoke test for the full rocket-worker → rocket-container
# → example-ssr deploy chain against real Cloudflare.
#
# What it does:
#   1. Push `alepha/rocket:latest` to Docker Hub (Cloudflare Containers
#      pulls it on first cold start of the DO).
#   2. Build + pack `apps/example-ssr` and upload the tarball to R2.
#   3. Materialise `apps/rocket-worker/.env.production` from the host
#      `.env.secrets` so the worker build bakes the secrets into the
#      generated `Rocket` Durable Object class's `envVars`.
#   4. Deploy rocket-worker via `alepha platform up` (real Cloudflare,
#      custom domain `rocket-worker.alepha.dev`).
#   5. Curl `GET /api/health` on the worker — confirms the
#      worker → DO → container fetch chain is wired (a 200 means the
#      container booted and responded to `health()` via the proxy).
#   6. POST `/api/deploys` on the worker with the example-ssr artifact,
#      poll `GET /api/deploys/:id` until `succeeded`, curl the deployed
#      example-ssr URL.
#   7. POST `/api/deploys` op=down to tear example-ssr back down.
#   8. `alepha platform down` to tear rocket-worker back down.
#
# Requirements on the host:
#   - docker daemon running, `docker login` done as `alepha` org
#   - aws CLI installed (`brew install awscli`)
#   - jq installed
#   - `apps/rocket/.env.secrets` present (same file used by the older
#     container-only test):
#       CLOUDFLARE_API_TOKEN=...
#       CLOUDFLARE_ACCOUNT_ID=...
#       S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com
#       S3_ACCESS_KEY_ID=...
#       S3_SECRET_ACCESS_KEY=...
#
# Idempotency: rerun the script and it'll re-deploy the same worker
# + redeploy example-ssr. Cleanup runs on exit even on failure.

set -euo pipefail

cd "$(dirname "$0")/.."   # apps/rocket-worker

REPO_ROOT="$(cd ../.. && pwd)"
ROCKET_IMAGE=alepha/rocket:latest
WORKER_URL=${WORKER_URL:-https://rocket-worker.alepha.dev}
BUCKET=${R2_BUCKET:-alepha-rocket-e2e}
ARTIFACT=example-ssr-latest.tar.gz
WORK=/tmp/rocket-worker-e2e
APP_DIR="$REPO_ROOT/apps/example-ssr"

# Cap any single curl + the polling loops so the script can't hang.
POLL_TIMEOUT_S=${POLL_TIMEOUT_S:-360}
WAIT_TIMEOUT_S=${WAIT_TIMEOUT_S:-180}

red()    { printf "\033[31m%s\033[0m\n" "$*" >&2; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
note()   { printf "\033[36m▶ %s\033[0m\n" "$*"; }

cleanup() {
  local rc=$?
  if [ -z "${ROCKET_DEBUG_RETAIN:-}" ]; then
    note "cleanup"
    rm -rf "$WORK"
    rm -f .env.production
  else
    note "ROCKET_DEBUG_RETAIN set — $WORK and .env.production kept"
  fi
  if [ "$rc" -ne 0 ]; then
    red "e2e FAILED (exit $rc)"
  fi
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# 0. Pre-flight
# -----------------------------------------------------------------------------

SECRETS_FILE="$REPO_ROOT/apps/rocket/.env.secrets"
[ -f "$SECRETS_FILE" ] || {
  red "Missing $SECRETS_FILE — see header of this script."
  exit 1
}
# shellcheck disable=SC1090
source "$SECRETS_FILE"

for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  if [ -z "${!v:-}" ]; then
    red "$v not set in $SECRETS_FILE"
    exit 1
  fi
done

command -v jq >/dev/null || { red "jq required"; exit 1; }
command -v aws >/dev/null || { red "aws CLI required (brew install awscli)"; exit 1; }
command -v docker >/dev/null || { red "docker required"; exit 1; }

mkdir -p "$WORK"

# -----------------------------------------------------------------------------
# 1. Build + push alepha/rocket:latest to Docker Hub
# -----------------------------------------------------------------------------

note "build rocket image ($ROCKET_IMAGE)"
( cd "$REPO_ROOT/apps/rocket" && yarn alepha push --dry-run >/dev/null )

note "push $ROCKET_IMAGE → Docker Hub"
docker push "$ROCKET_IMAGE" 2>&1 | tail -3
green "  pushed"

# -----------------------------------------------------------------------------
# 2. Build + pack example-ssr
# -----------------------------------------------------------------------------

note "build + pack example-ssr → $WORK/$ARTIFACT"
( cd "$APP_DIR" \
  && yarn alepha build -t cloudflare >/dev/null \
  && yarn alepha pack --output "$WORK" >/dev/null )
green "  $(ls -lh "$WORK/$ARTIFACT" | awk '{print $5}')"

# -----------------------------------------------------------------------------
# 3. Upload artifact to R2
# -----------------------------------------------------------------------------

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

if ! aws s3api head-bucket --bucket "$BUCKET" \
     --endpoint-url "$S3_ENDPOINT" >/dev/null 2>&1; then
  note "create R2 bucket $BUCKET"
  aws s3 mb "s3://$BUCKET" --endpoint-url "$S3_ENDPOINT" >/dev/null
fi

note "upload → s3://$BUCKET/$ARTIFACT (R2)"
aws s3 cp "$WORK/$ARTIFACT" "s3://$BUCKET/$ARTIFACT" \
  --endpoint-url "$S3_ENDPOINT" --no-progress
green "  uploaded"

# -----------------------------------------------------------------------------
# 4. Materialise .env.production for rocket-worker
# -----------------------------------------------------------------------------
#
# The worker build reads `process.env.*` and bakes them into the
# generated `Rocket` DO class's `envVars` — those become the
# container's runtime env when CF spins up an instance.

note "write apps/rocket-worker/.env.production"
cat > .env.production <<EOF
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID
S3_ENDPOINT=$S3_ENDPOINT
S3_REGION=auto
S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
EOF

# -----------------------------------------------------------------------------
# 5. Deploy rocket-worker
# -----------------------------------------------------------------------------

note "alepha platform up (rocket-worker → $WORKER_URL)"
UP_JSON=$(yarn alepha platform up --json --env production 2>&1 | tail -1)
echo "$UP_JSON" | jq . >/dev/null 2>&1 || {
  red "could not parse alepha platform up output:"
  echo "$UP_JSON" >&2
  exit 1
}
DEPLOYED_URL=$(echo "$UP_JSON" | jq -r '.urls[0] // ("https://" + .domain)')
green "  deployed: $DEPLOYED_URL"

# -----------------------------------------------------------------------------
# 6. Health check (worker → DO → container chain)
# -----------------------------------------------------------------------------

note "GET $DEPLOYED_URL/api/health"
HEALTH_DEADLINE=$(( $(date +%s) + WAIT_TIMEOUT_S ))
until HEALTH=$(curl -sf --max-time 10 "$DEPLOYED_URL/api/health" 2>/dev/null); do
  [ "$(date +%s)" -ge "$HEALTH_DEADLINE" ] && {
    red "/api/health never returned 200 (container probably didn't boot)"
    exit 1
  }
  sleep 3
done
echo "$HEALTH" | jq .
[ "$(echo "$HEALTH" | jq -r '.ok')" = "true" ] || { red "worker.ok != true"; exit 1; }
[ "$(echo "$HEALTH" | jq -r '.container.ok')" = "true" ] || {
  red "container.ok != true (worker reachable but container not)"
  exit 1
}
green "  ✓ worker + container both healthy"

# -----------------------------------------------------------------------------
# 7. POST /api/deploys op=up (example-ssr)
# -----------------------------------------------------------------------------

post_deploy() {
  local op=$1
  curl -sf --max-time 15 -X POST "$DEPLOYED_URL/api/deploys" \
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
    state=$(curl -sf --max-time 10 "$DEPLOYED_URL/api/deploys/$id") \
      || { red "GET /api/deploys/$id failed"; return 1; }
    status=$(echo "$state" | jq -r .status)
    printf "  [poll] %s\n" "$status" >&2
    case "$status" in
      succeeded) echo "$state"; return 0 ;;
      failed)
        red "deploy failed:"
        printf "%s\n" "$state" | jq '{ status, error }' >&2 || printf "%s\n" "$state" >&2
        printf "\n--- log ---\n%s\n" "$(printf "%s\n" "$state" | jq -r .log)" >&2
        return 1
        ;;
    esac
    sleep 5
  done
  red "poll timeout (${POLL_TIMEOUT_S}s) — last state:"
  printf "%s\n" "$state" >&2
  return 1
}

note "POST /api/deploys op=up (example-ssr)"
UP_JOB=$(post_deploy up)
UP_ID=$(echo "$UP_JOB" | jq -r .id)
green "  id=$UP_ID"

UP_RESULT=$(poll_until_done "$UP_ID")
EXAMPLE_URL=$(echo "$UP_RESULT" | jq -r .deployedUrl)
green "  deployed: $EXAMPLE_URL"

if [ -n "$EXAMPLE_URL" ] && [ "$EXAMPLE_URL" != "null" ]; then
  note "curl deployed example-ssr"
  curl -sf --max-time 10 "$EXAMPLE_URL" -o /dev/null && green "  ✓ example-ssr responds"
fi

# -----------------------------------------------------------------------------
# 8. POST /api/deploys op=down (example-ssr)
# -----------------------------------------------------------------------------

note "POST /api/deploys op=down (example-ssr)"
DOWN_JOB=$(post_deploy down)
DOWN_ID=$(echo "$DOWN_JOB" | jq -r .id)
green "  id=$DOWN_ID"

poll_until_done "$DOWN_ID" >/dev/null
green "  ✓ example-ssr down succeeded"

# -----------------------------------------------------------------------------
# 9. Tear rocket-worker back down
# -----------------------------------------------------------------------------

note "alepha platform down (rocket-worker)"
yarn alepha platform down --yes --env production 2>&1 | tail -3
green "  ✓ rocket-worker down succeeded"

green "e2e OK"
