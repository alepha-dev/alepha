#!/usr/bin/env bash
#
# End-to-end smoke test for Alepha Rocket.
#
# What it does:
#   1. Builds apps/example-ssr (the test workload).
#   2. Tars the workspace (src + dist + alepha.config.ts + package.json).
#   3. Starts a local MinIO container (S3-compatible bucket on :9000).
#   4. Starts the alepha/rocket:latest image on :3000.
#   5. Uploads the tar.gz to the MinIO bucket.
#   6. POST /deploys with `op: "up"`, polls until succeeded, curls the
#      deployed worker URL.
#   7. POST /deploys with `op: "down"`, polls until succeeded.
#
# Requirements on the host:
#   - docker daemon running
#   - alepha/rocket:latest built locally (`yarn workspace rocket push --dry-run`)
#   - apps/rocket/.env.secrets present (gitignored) — see below
#
# apps/rocket/.env.secrets format:
#   CLOUDFLARE_API_TOKEN=...      # Workers Scripts: Edit + Workers Routes: Edit
#   CLOUDFLARE_ACCOUNT_ID=...     # 32-char hex (optional — auto-resolved if omitted)
#
# Idempotency: rerun the script and it'll re-deploy the same worker
# (example-ssr-production). Cleanup runs on exit even if the script fails.

set -euo pipefail

cd "$(dirname "$0")/.."   # apps/rocket

NET=rocket-e2e-net
MINIO=rocket-e2e-minio
ROCKET=rocket-e2e-rocket
BUCKET=alepha-rocket-e2e
ARTIFACT=example-ssr-0.0.1.tar.gz
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
  printf "\n--- docker logs %s ---\n" "$MINIO" >&2
  docker logs "$MINIO" 2>&1 | tail -20 >&2 || true
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
    docker rm -f "$ROCKET" "$MINIO" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    rm -rf "$WORK"
  else
    note "ROCKET_DEBUG_RETAIN set — containers + $WORK kept"
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

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { red "CLOUDFLARE_API_TOKEN not set"; exit 1; }

docker image inspect "$ROCKET_IMAGE" >/dev/null 2>&1 || {
  red "$ROCKET_IMAGE not found — run 'yarn workspace rocket push --dry-run' first."
  exit 1
}

command -v jq >/dev/null || { red "jq required"; exit 1; }

cleanup   # in case a previous run left containers behind

# -----------------------------------------------------------------------------
# 1. Build example-ssr
# -----------------------------------------------------------------------------

note "build example-ssr (target=cloudflare)"
( cd "$APP_DIR" && yarn alepha build -t cloudflare )

# -----------------------------------------------------------------------------
# 2. Tar workspace
# -----------------------------------------------------------------------------

note "tar workspace → $WORK/$ARTIFACT"
mkdir -p "$WORK/stage"
# example-ssr's tsconfig.json extends `../../tsconfig.json` (monorepo
# root). That chain isn't in the artifact, so write a self-contained
# tsconfig into the staged copy. Real apps deployed via Rocket should
# already have self-contained tsconfigs.
rsync -a --delete \
  --exclude node_modules \
  --exclude '._*' \
  --exclude '.DS_Store' \
  "$APP_DIR/" "$WORK/stage/"
cat > "$WORK/stage/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "esnext",
    "strict": true,
    "jsx": "react-jsx",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
JSON
TAR_INCLUDE=(src dist alepha.config.ts package.json tsconfig.json)
[ -d "$WORK/stage/migrations" ] && TAR_INCLUDE+=(migrations)
COPYFILE_DISABLE=1 tar -czf "$WORK/$ARTIFACT" -C "$WORK/stage" "${TAR_INCLUDE[@]}"
green "  $(ls -lh "$WORK/$ARTIFACT" | awk '{print $5}')"

# -----------------------------------------------------------------------------
# 3. Docker network + MinIO
# -----------------------------------------------------------------------------

note "start docker network + minio"
docker network create "$NET" >/dev/null
docker run -d --rm --name "$MINIO" --network "$NET" \
  -p 9000:9000 \
  -e MINIO_ROOT_USER=testaccess \
  -e MINIO_ROOT_PASSWORD=testsecret \
  minio/minio server /data >/dev/null

# Wait for MinIO ready (cap at WAIT_TIMEOUT_S)
MINIO_DEADLINE=$(( $(date +%s) + WAIT_TIMEOUT_S ))
until curl -sf --max-time 2 http://localhost:9000/minio/health/ready >/dev/null; do
  [ "$(date +%s)" -ge "$MINIO_DEADLINE" ] && { red "minio not ready"; exit 1; }
  sleep 0.5
done

# Create bucket + upload artifact via `mc` (bundled in the minio image).
# `docker cp` into /data/ doesn't work — MinIO requires uploads to go
# through the S3 API so its internal metadata gets written.
docker cp "$WORK/$ARTIFACT" "$MINIO:/tmp/$ARTIFACT"
docker exec "$MINIO" sh -c "
  mc alias set local http://localhost:9000 testaccess testsecret >/dev/null &&
  mc mb local/$BUCKET 2>/dev/null || true
  mc cp /tmp/$ARTIFACT local/$BUCKET/$ARTIFACT >/dev/null
" >/dev/null
green "  uploaded s3://$BUCKET/$ARTIFACT"

# -----------------------------------------------------------------------------
# 4. Start Rocket
# -----------------------------------------------------------------------------

note "start rocket"
ROCKET_RUN_ARGS=(
  -d --rm --name "$ROCKET" --network "$NET"
  -p 3000:3000
  -e CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN"
  -e S3_ENDPOINT="http://$MINIO:9000"
  -e S3_REGION=auto
  -e S3_ACCESS_KEY_ID=testaccess
  -e S3_SECRET_ACCESS_KEY=testsecret
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
