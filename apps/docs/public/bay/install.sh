#!/bin/sh
#
# Bay installer -- https://alepha.dev/bay
#
#   curl -sSL https://alepha.dev/bay/install.sh | sh
#
# Installs the `bay` binary and creates the directory layout described in
# apps/bay/INSTALL.md. It deliberately stops there: steps 3 to 5 of that guide
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
#
set -eu

REPO="alepha-dev/alepha"
BAY_VERSION="${BAY_VERSION:-latest}"
BAY_PREFIX="${BAY_PREFIX:-/opt/bay}"
BAY_BIN_LINK="${BAY_BIN_LINK:-/usr/local/bin/bay}"

die() {
  echo "bay-install: $*" >&2
  exit 1
}

# --- checks ----------------------------------------------------------------

[ "$(uname -s)" = "Linux" ] || die "Bay runs on Linux only (this is $(uname -s)).
Build from source for other systems: https://github.com/$REPO/tree/main/apps/bay"

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

# --- download --------------------------------------------------------------

if [ "$BAY_VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$BAY_VERSION"
fi

ASSET="bay-linux-$ARCH"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

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
mkdir -p "$BAY_PREFIX/bin" "$BAY_PREFIX/data" "$BAY_PREFIX/runtimes"
chmod 0755 "$BAY_PREFIX/bin" "$BAY_PREFIX/runtimes"
# Holds every app's `.env` and SQLite file, so it is not world-readable.
#
# `0711`, not `0700`: Bay runs each app as its own user, whose WorkingDirectory
# lives under this directory. `0700` blocks traversal as well as listing, so
# every app died at CHDIR before executing a line, and Bay reported it upstream
# as a readiness timeout. `rwx--x--x` keeps the stated intent (nobody but root
# can list or enumerate this directory) while letting each app user pass
# through to its own subtree. Confidentiality never rested on this mode anyway:
# each app's `.env` is written `0600` owned by that app's user.
chmod 0711 "$BAY_PREFIX/data"

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
echo "  runtimes $BAY_PREFIX/runtimes"
echo

if [ "$RESTARTED" = "yes" ]; then
  echo "The bay service was restarted on the new binary. Nothing else to do."
else
  echo "Next: run it under systemd, then grant a user the right to deploy."
  echo "Both steps, with the unit file to copy:"
  echo "  https://github.com/$REPO/blob/main/apps/bay/INSTALL.md"
fi
