#!/usr/bin/env bash
#
# Smoke test for the self-hosted Lore image.
#
# The one-line `docker run` is the whole promise of the image, and nothing in
# `yarn v` exercises it: a build that produces an image which cannot boot is
# exactly as green as one that works. This is what makes that promise a red
# X instead of a discovery on release day.
#
# What it proves, in order of how badly it would hurt to get wrong:
#
#   1. The image boots with only a port and a volume, and `/version` answers
#      the framework version.
#   2. The first account through the real HTTP surface lands `admin`, and the
#      second does NOT. The image ships with registration open, so the bug to
#      catch is an instance that hands admin to everyone.
#   3. A restart on the SAME volume keeps a session minted before it valid.
#      This is the one that matters most: a regenerated APP_SECRET invalidates
#      every session on every restart, and the image would look perfectly
#      healthy right up until the operator restarted it.
#   4. A fresh volume produces a DIFFERENT secret, so the key is per-install
#      rather than baked into a public image.
#   5. The process is not root.
#
# The secret itself is never read out of the container or matched against a
# log line: the assertions are on observable behaviour, which is what actually
# matters and does not break when a message is reworded. The boot warning is
# the one exception, because being seen is its entire job.
#
# Usage:  scripts/docker-smoke.sh [image]
#         IMAGE=... PORT=... scripts/docker-smoke.sh
set -euo pipefail

IMAGE="${1:-${IMAGE:-ghcr.io/alepha-dev/lore:latest}}"
PORT="${PORT:-38080}"
BASE="http://127.0.0.1:${PORT}"

PREFIX="lore-smoke-$$"
FIRST="${PREFIX}-first"
RESTARTED="${PREFIX}-restarted"
FRESH="${PREFIX}-fresh"
VOLUME_MAIN="${PREFIX}-data"
VOLUME_FRESH="${PREFIX}-data-fresh"
COOKIES="$(mktemp)"

# Registered so a failed assertion cannot leak a container and two volumes
# into the runner (or into a developer's machine).
cleanup() {
  docker rm -f "$FIRST" "$RESTARTED" "$FRESH" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_MAIN" "$VOLUME_FRESH" >/dev/null 2>&1 || true
  rm -f "$COOKIES"
}
trap cleanup EXIT

fail() {
  echo "✗ $*" >&2
  exit 1
}

ok() {
  echo "✓ $*"
}

# The one-line contract: a port and a volume, and nothing else. Any `-e` added
# here would quietly stop testing what this file exists to test.
start() {
  local name="$1" volume="$2"
  docker run -d --name "$name" -p "${PORT}:3000" -v "${volume}:/data" \
    "$IMAGE" >/dev/null
}

wait_for_version() {
  local name="$1" i status
  for i in $(seq 1 90); do
    status="$(curl -fsS -o /dev/null -w '%{http_code}' "${BASE}/version" 2>/dev/null || true)"
    if [ "$status" = "200" ]; then
      return 0
    fi
    if [ -z "$(docker ps -q -f "name=^${name}$")" ]; then
      docker logs "$name" 2>&1 | tail -40 >&2
      fail "container '${name}' exited before answering /version"
    fi
    sleep 1
  done
  docker logs "$name" 2>&1 | tail -40 >&2
  fail "/version did not answer within 90s"
}

json_field() {
  python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get(sys.argv[1],""))' "$1"
}

# Both phases of the registration flow. The realm ships with
# `verifyEmailRequired` off (no EMAIL_HOST), so no code is involved — which is
# itself part of what a self-hosted instance with no mail server has to do.
register() {
  local email="$1" intent
  intent="$(curl -fsS -X POST "${BASE}/api/users/register" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${email}\",\"password\":\"SecurePassword123!\"}" \
    | json_field intentId)"
  [ -n "$intent" ] || fail "no intentId for ${email}"
  curl -fsS -X POST "${BASE}/api/users/register/complete" \
    -H 'content-type: application/json' \
    -d "{\"intentId\":\"${intent}\"}"
}

echo "── image: ${IMAGE}"

# ── 1. Boot on a fresh volume ───────────────────────────────────────────────
start "$FIRST" "$VOLUME_MAIN"
wait_for_version "$FIRST"

EXPECTED_VERSION="$(python3 -c 'import json;print(json.load(open("packages/alepha/package.json"))["version"])')"
VERSION="$(curl -fsS "${BASE}/version" | json_field version)"
[ "$VERSION" = "$EXPECTED_VERSION" ] ||
  fail "/version reported '${VERSION}', expected '${EXPECTED_VERSION}'"
ok "boots on a port and a volume, /version → ${VERSION}"

# ── 2. Not root ─────────────────────────────────────────────────────────────
UID_IN_CONTAINER="$(docker exec "$FIRST" id -u | tr -d '\r')"
[ "$UID_IN_CONTAINER" = "1000" ] ||
  fail "container runs as uid ${UID_IN_CONTAINER}, expected 1000"
ok "runs as uid 1000"

# ── 3. The boot warning ─────────────────────────────────────────────────────
# Asserted on directly, unlike everything else here, because being seen is the
# whole point of it: it is what answers the window between starting an
# instance and finishing setup.
docker logs "$FIRST" 2>&1 | grep -q "No accounts exist" ||
  fail "no boot warning while the users table is empty"
ok "warns at boot while no account exists"

# ── 4. The first account owns the instance, the second does not ─────────────
FIRST_ROLES="$(register "owner@example.com" | python3 -c 'import json,sys;print(",".join(json.load(sys.stdin)["roles"]))')"
case ",${FIRST_ROLES}," in
  *,admin,*) ok "first account lands admin (${FIRST_ROLES})" ;;
  *) fail "first account has roles '${FIRST_ROLES}', expected admin" ;;
esac

SECOND_ROLES="$(register "second@example.com" | python3 -c 'import json,sys;print(",".join(json.load(sys.stdin)["roles"]))')"
case ",${SECOND_ROLES}," in
  *,admin,*) fail "second account also landed admin ('${SECOND_ROLES}')" ;;
  *) ok "second account is not admin (${SECOND_ROLES})" ;;
esac

# ── 5. A session minted now must survive a restart ──────────────────────────
curl -fsS -c "$COOKIES" -X POST "${BASE}/_auth/token?provider=credentials" \
  -H 'content-type: application/json' \
  -d '{"username":"owner@example.com","password":"SecurePassword123!"}' \
  >/dev/null || fail "could not log in as the first account"

USER_BEFORE="$(curl -fsS -b "$COOKIES" "${BASE}/_auth/userinfo" \
  | python3 -c 'import json,sys;print((json.load(sys.stdin).get("user") or {}).get("email",""))')"
[ "$USER_BEFORE" = "owner@example.com" ] ||
  fail "the session does not resolve before the restart (got '${USER_BEFORE}')"

docker rm -f "$FIRST" >/dev/null
start "$RESTARTED" "$VOLUME_MAIN"
wait_for_version "$RESTARTED"
ok "a second container on the same volume boots (migrations replay cleanly)"

USER_AFTER="$(curl -fsS -b "$COOKIES" "${BASE}/_auth/userinfo" \
  | python3 -c 'import json,sys;print((json.load(sys.stdin).get("user") or {}).get("email",""))')"
[ "$USER_AFTER" = "owner@example.com" ] ||
  fail "the session stopped validating after the restart — APP_SECRET was regenerated"
ok "a session minted before the restart still validates"

if docker logs "$RESTARTED" 2>&1 | grep -q "No accounts exist"; then
  fail "still warning about an empty users table after two accounts exist"
fi
ok "the boot warning is gone once an account exists"

docker rm -f "$RESTARTED" >/dev/null

# ── 6. A fresh volume gets its own secret ───────────────────────────────────
start "$FRESH" "$VOLUME_FRESH"
wait_for_version "$FRESH"

# The same cookie against a different install. A baked constant would resolve
# here; a per-install secret cannot.
FRESH_USER="$(curl -fsS -b "$COOKIES" "${BASE}/_auth/userinfo" \
  | python3 -c 'import json,sys;print((json.load(sys.stdin).get("user") or {}).get("email",""))')"
[ -z "$FRESH_USER" ] ||
  fail "a session from another install validated here — APP_SECRET is not per-install"
ok "a fresh volume mints its own secret"

echo
echo "docker smoke test passed"
