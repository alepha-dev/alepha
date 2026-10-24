#!/bin/sh
#
# Bay installer -- https://github.com/alepha-dev/bay
#
#   curl -sSL https://raw.githubusercontent.com/alepha-dev/bay/main/install.sh | sh
#
# Installs Docker when it is missing (Bay runs every app in a container), then
# the `bay` binary and the directory layout described in INSTALL.md. It
# deliberately stops there: steps 3 to 5 of that guide
# (the systemd unit, the base domain, the ACME email, the deploy group) need
# decisions this script cannot make for you, and a `curl | sh` has no business
# putting a public reverse proxy on :80 and :443 without being asked.
#
# Re-running it upgrades in place: the binary is replaced atomically and, if a
# `bay` service is already running, restarted.
#
# Environment:
#   BAY_VERSION   release tag to install, or "latest" (default)
#   BAY_PREFIX    install root (default /opt/bay)
#   BAY_BIN_LINK  symlink to put on PATH (default /usr/local/bin/bay)
#   BAY_INSTALL_DOCKER  "no" to refuse installing Docker and stop instead
#                       (default "yes")
#
set -eu

REPO="alepha-dev/bay"
BAY_VERSION="${BAY_VERSION:-latest}"
BAY_PREFIX="${BAY_PREFIX:-/opt/bay}"
BAY_BIN_LINK="${BAY_BIN_LINK:-/usr/local/bin/bay}"

die() {
  echo "bay-install: $*" >&2
  exit 1
}

# --- checks ----------------------------------------------------------------

[ "$(uname -s)" = "Linux" ] || die "Bay runs on Linux only (this is $(uname -s)).
Build from source for other systems: https://github.com/$REPO"

case "$(uname -m)" in
  x86_64 | amd64) ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) die "unsupported architecture $(uname -m). Bay ships linux/amd64 and linux/arm64." ;;
esac

[ "$(id -u)" = "0" ] || die "this installer writes to $BAY_PREFIX and $BAY_BIN_LINK, so it needs root.
Re-run it as:  curl -sSL https://raw.githubusercontent.com/alepha-dev/bay/main/install.sh | sudo sh"

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

if [ "$BAY_VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$BAY_VERSION"
fi

ASSET="bay-linux-$ARCH"

echo "==> Downloading $ASSET ($BAY_VERSION)"
fetch "$BASE/$ASSET" "$TMP/bay" || die "download failed: $BASE/$ASSET"
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

# --- report ----------------------------------------------------------------

echo
echo "Installed: $("$BAY_PREFIX/bin/bay" version 2>/dev/null || echo "bay ($ARCH)")"
echo "  binary   $BAY_PREFIX/bin/bay  (on PATH as $BAY_BIN_LINK)"
echo "  data     $BAY_PREFIX/data"
echo

if [ "$RESTARTED" = "yes" ]; then
  echo "The bay service was restarted on the new binary. Nothing else to do."
else
  echo "Check the host with:  bay doctor"
  echo "Next: run bay serve under systemd, then grant a user the right to deploy."
  echo "Both steps, with the unit file to copy:"
  echo "  https://github.com/$REPO/blob/main/INSTALL.md"
fi
