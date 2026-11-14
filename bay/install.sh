#!/bin/sh
#
# Bay installer -- https://alepha.dev/bay
#
#   curl -sSL https://alepha.dev/bay/install.sh | sh
#
# Installs Docker when it is missing (Bay runs every app in a container), then
# the `bay` binary and the directory layout described in INSTALL.md. By default
# it stops there: steps 3 to 5 of that guide (the systemd unit, the base
# domain, the ACME email, the deploy group) need decisions this script cannot
# make for you, and a `curl | sh` has no business putting a public reverse
# proxy on :80 and :443 without being asked.
#
# Setting LORE_URL and LORE_ESTATE_SECRET is that ask (#Q3135): a machine
# enrolled with Lore, in one line, for a server bought to be driven from Lore:
#
#   curl -sSL https://alepha.dev/bay/install.sh \
#     | sudo LORE_URL=https://lore.alepha.dev LORE_ESTATE_SECRET=est_... sh
#
# LORE_ESTATE_SECRET may also be a one-time enrolment secret (`enr_...`, what
# `lore host provision` puts in cloud-init): `bay connector set` exchanges it
# for the host's own secret before storing anything.
#
# With both set, after the binary it writes the systemd unit INSTALL.md
# documents (unless one exists), starts it, waits for `bay serve` to write
# state.json and open its control socket, and runs `bay connector set`. The
# secret is never printed, and appears in `ps` only during that one call.
#
# Re-running it upgrades in place: the binary is replaced atomically and, if a
# `bay` service is already running, restarted.
#
# Environment:
#   BAY_VERSION   version to install (e.g. 0.34.0), or "latest" (default)
#   BAY_PREFIX    install root (default /opt/bay)
#   BAY_BIN_LINK  symlink to put on PATH (default /usr/local/bin/bay)
#   BAY_INSTALL_DOCKER  "no" to refuse installing Docker and stop instead
#                       (default "yes")
#   LORE_URL, LORE_ESTATE_SECRET
#                 both set: also start Bay under systemd and enrol it with
#                 that Lore host (the secret `lore host add` prints)
#   BAY_BASE_DOMAIN, BAY_ACME_EMAIL
#                 --base-domain and --acme-email for the unit written when
#                 enrolling (both optional)
#   BAY_UNIT      the unit written when enrolling
#                 (default /etc/systemd/system/bay.service)
#   BAY_SOCKET    the control socket the unit opens
#                 (default /run/bay/control.sock)
#
set -eu

# Bay is released from the Alepha repository with the framework and Lore, one
# version and one GitHub release for all three (#Q2776): the release carries
# `bay-linux-amd64`, `bay-linux-arm64` and `SHA256SUMS`. 0.34.0 is the oldest
# release with a Bay binary; the ones before it came from a repository that no
# longer exists.
REPO="alepha-dev/alepha"
BAY_VERSION="${BAY_VERSION:-latest}"
BAY_PREFIX="${BAY_PREFIX:-/opt/bay}"
BAY_BIN_LINK="${BAY_BIN_LINK:-/usr/local/bin/bay}"
BAY_UNIT="${BAY_UNIT:-/etc/systemd/system/bay.service}"
BAY_SOCKET="${BAY_SOCKET:-/run/bay/control.sock}"
LORE_URL="${LORE_URL:-}"
# LORE_ESTATE_SECRET keeps the word Lore used before #E147: Bay wire v1, set
# by `lore host provision` and by every command already pasted from Lore.
LORE_ESTATE_SECRET="${LORE_ESTATE_SECRET:-}"

die() {
  echo "bay-install: $*" >&2
  exit 1
}

# --- checks ----------------------------------------------------------------

# Enrolling takes both halves; one alone is a typo, caught before anything is
# installed. The secret is never echoed, here or below.
if [ -n "$LORE_URL" ] && [ -z "$LORE_ESTATE_SECRET" ]; then
  die "LORE_URL is set but LORE_ESTATE_SECRET is not: set both to enrol this machine, or neither."
fi
if [ -z "$LORE_URL" ] && [ -n "$LORE_ESTATE_SECRET" ]; then
  die "LORE_ESTATE_SECRET is set but LORE_URL is not: set both to enrol this machine, or neither."
fi

[ "$(uname -s)" = "Linux" ] || die "Bay runs on Linux only (this is $(uname -s)).
Build from source for other systems: https://github.com/$REPO/tree/main/bay"

case "$(uname -m)" in
  x86_64 | amd64) ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) die "unsupported architecture $(uname -m). Bay ships linux/amd64 and linux/arm64." ;;
esac

[ "$(id -u)" = "0" ] || die "this installer writes to $BAY_PREFIX and $BAY_BIN_LINK, so it needs root.
Re-run it as:  curl -sSL https://alepha.dev/bay/install.sh | sudo sh"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  die "neither curl nor wget is available."
fi

# `sha256sum` on most distributions, `shasum` where coreutils is slim.
if command -v sha256sum >/dev/null 2>&1; then
  checksum() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  checksum() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "no sha256sum or shasum available, refusing to install an unverified binary."
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

# --- docker ----------------------------------------------------------------

# Bay supervises every app as a container, so a host without Docker can run
# nothing. Installed through Docker's own script (get.docker.com), which picks
# the right repository for the distribution and installs the Engine with the
# compose plugin, rather than a distribution package that is often years old.
# BAY_INSTALL_DOCKER=no stops instead, for a host whose Docker is managed by
# something else.
MIN_DOCKER_API="1.44"

if ! command -v docker >/dev/null 2>&1; then
  [ "${BAY_INSTALL_DOCKER:-yes}" != "no" ] || die "Docker is not installed, and BAY_INSTALL_DOCKER=no.
Install Docker Engine 25 or newer with the compose plugin, then re-run this installer:
  https://docs.docker.com/engine/install/"
  echo "==> Installing Docker Engine (get.docker.com)"
  fetch "https://get.docker.com" "$TMP/get-docker.sh" || die "download failed: https://get.docker.com"
  sh "$TMP/get-docker.sh" || die "the Docker installer failed; see its output above."
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker >/dev/null 2>&1 || true
fi

DOCKER_API="$(docker version --format '{{.Server.APIVersion}}' 2>/dev/null || true)"
[ -n "$DOCKER_API" ] || die "Docker is installed but its daemon does not answer.
Start it with:  systemctl enable --now docker"

# Major and minor compared as numbers: "1.9" is older than "1.44".
if ! echo "$DOCKER_API $MIN_DOCKER_API" | awk '{ split($1, h, "."); split($2, w, "."); exit !(h[1] > w[1] || (h[1] == w[1] && h[2] >= w[2])) }'; then
  die "Docker speaks Engine API $DOCKER_API; Bay needs $MIN_DOCKER_API or newer (Docker 25+).
Upgrade it with your package manager, or with:  curl -fsSL https://get.docker.com | sh"
fi

docker compose version >/dev/null 2>&1 || die "the Docker compose plugin is missing.
Install the docker-compose-plugin package, then re-run this installer."

echo "==> Docker ready (Engine API $DOCKER_API)"

# --- download --------------------------------------------------------------

ASSET="bay-linux-$ARCH"

# "latest" is the newest release that carries a Bay binary: the releases come
# newest first, and one cut before Bay joined the shared release has none.
if [ "$BAY_VERSION" = "latest" ]; then
  fetch "https://api.github.com/repos/$REPO/releases?per_page=100" "$TMP/releases.json" \
    || die "could not list releases: https://github.com/$REPO/releases"
  URL="$(grep -o "\"browser_download_url\": *\"[^\"]*/$ASSET\"" "$TMP/releases.json" | head -1 | sed 's/.*": *"\(.*\)"/\1/')"
  BAY_VERSION="$(printf '%s' "$URL" | sed -n 's#.*/releases/download/\([0-9][0-9.]*\)/.*#\1#p')"
  [ -n "$BAY_VERSION" ] || die "no Bay release found in $REPO"
fi
BAY_VERSION="${BAY_VERSION#v}"
BASE="https://github.com/$REPO/releases/download/$BAY_VERSION"

echo "==> Downloading $ASSET ($BAY_VERSION)"
fetch "$BASE/$ASSET" "$TMP/bay" || die "download failed: $BASE/$ASSET
Bay binaries ship with 0.34.0 and later: https://github.com/$REPO/releases"
[ -s "$TMP/bay" ] || die "download failed: $BASE/$ASSET"
fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" || die "download failed: $BASE/SHA256SUMS"

# The binary is about to run as root, so a truncated download and a tampered
# one have to be distinguishable from a good one.
echo "==> Verifying checksum"
EXPECTED="$(grep " $ASSET\$" "$TMP/SHA256SUMS" | cut -d' ' -f1)"
[ -n "$EXPECTED" ] || die "no checksum for $ASSET in SHA256SUMS."
ACTUAL="$(checksum "$TMP/bay")"
[ "$EXPECTED" = "$ACTUAL" ] || die "checksum mismatch for $ASSET.
  expected $EXPECTED
  got      $ACTUAL"

# --- install ---------------------------------------------------------------

echo "==> Installing to $BAY_PREFIX"
mkdir -p "$BAY_PREFIX/bin" "$BAY_PREFIX/data"
chmod 0755 "$BAY_PREFIX/bin"
# Holds every app's `.env` and SQLite file, so nobody but root may list it.
# Apps reach their own files through bind mounts into their containers, so no
# app user ever needs to traverse this directory on the host.
chmod 0700 "$BAY_PREFIX/data"

chmod 0755 "$TMP/bay"
# `mv` over a running executable, never `cp` into it: replacing the inode by
# rename is atomic and works while the old binary is executing, where writing
# through the existing path fails with ETXTBSY.
mv "$TMP/bay" "$BAY_PREFIX/bin/bay.new"
mv "$BAY_PREFIX/bin/bay.new" "$BAY_PREFIX/bin/bay"

ln -sf "$BAY_PREFIX/bin/bay" "$BAY_BIN_LINK"

# --- upgrade path ----------------------------------------------------------

RESTARTED="no"
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet bay 2>/dev/null; then
  echo "==> Restarting the running bay service"
  systemctl restart bay
  RESTARTED="yes"
fi

# --- enrol -----------------------------------------------------------------

# Only with both LORE_ variables (#Q3135). Service first, then enrol: `bay
# connector set` refuses until `bay serve` has written state.json, and tells
# the running serve over the control socket to dial.
ENROLLED="no"
if [ -n "$LORE_URL" ]; then
  DATA="$BAY_PREFIX/data"
  if ! command -v systemctl >/dev/null 2>&1; then
    die "this host has no systemd, so the installer cannot start Bay for you.
Bay is installed. Start it yourself, then enrol it:
  $BAY_PREFIX/bin/bay serve --root $DATA --control-socket $BAY_SOCKET
  bay connector set $LORE_URL <the host secret>"
  fi

  if [ -e "$BAY_UNIT" ]; then
    echo "==> Keeping the existing unit $BAY_UNIT"
  else
    echo "==> Writing the systemd unit $BAY_UNIT"
    SERVE_FLAGS="--root $DATA --addr :80 --tls --tls-addr :443"
    [ -z "${BAY_BASE_DOMAIN:-}" ] || SERVE_FLAGS="$SERVE_FLAGS --base-domain $BAY_BASE_DOMAIN"
    [ -z "${BAY_ACME_EMAIL:-}" ] || SERVE_FLAGS="$SERVE_FLAGS --acme-email $BAY_ACME_EMAIL"
    mkdir -p "$(dirname "$BAY_UNIT")"
    cat >"$BAY_UNIT" <<UNIT
# Written by install.sh, as INSTALL.md documents it. Edit and
# \`systemctl daemon-reload\` to change the base domain or the ACME email.
[Unit]
Description=Bay, Alepha application server
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
Restart=always
RestartSec=2
WorkingDirectory=$BAY_PREFIX
RuntimeDirectory=bay
RuntimeDirectoryMode=0755
ExecStart=$BAY_PREFIX/bin/bay serve $SERVE_FLAGS --control-socket $BAY_SOCKET

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
  fi

  echo "==> Starting the bay service"
  systemctl enable --now bay

  # Bounded: a serve that does not come up in 30 s has said why in its journal.
  echo "==> Waiting for bay serve"
  TRIES=0
  until [ -f "$DATA/state.json" ] && [ -S "$BAY_SOCKET" ]; do
    TRIES=$((TRIES + 1))
    [ "$TRIES" -le 30 ] || die "bay serve did not write $DATA/state.json and open $BAY_SOCKET within 30 s.
See why with:  journalctl -u bay -n 50
Then enrol by hand:  bay connector set $LORE_URL <the host secret>"
    sleep 1
  done

  echo "==> Enrolling with $LORE_URL"
  BAY_ROOT="$DATA" BAY_SOCKET="$BAY_SOCKET" "$BAY_PREFIX/bin/bay" connector set "$LORE_URL" "$LORE_ESTATE_SECRET" \
    || die "bay connector set failed; see its message above."
  ENROLLED="yes"
fi

# --- report ----------------------------------------------------------------

echo
echo "Installed: $("$BAY_PREFIX/bin/bay" version 2>/dev/null || echo "bay ($ARCH)")"
echo "  binary   $BAY_PREFIX/bin/bay  (on PATH as $BAY_BIN_LINK)"
echo "  data     $BAY_PREFIX/data"
echo

if [ "$ENROLLED" = "yes" ]; then
  echo "Bay runs under systemd and is enrolled with $LORE_URL."
  echo "Wait for it from your shell with:  lore host wait <slug>"
elif [ "$RESTARTED" = "yes" ]; then
  echo "The bay service was restarted on the new binary. Nothing else to do."
else
  echo "Check the host with:  bay doctor"
  echo "Next: run bay serve under systemd, then grant a user the right to deploy."
  echo "Both steps, with the unit file to copy:"
  echo "  https://github.com/$REPO/blob/main/bay/INSTALL.md"
fi
