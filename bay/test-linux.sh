#!/usr/bin/env sh
#
# Runs Bay's checks on Linux, from a macOS checkout.
#
# Why this exists: Bay only runs on Linux, and part of the suite only exists
# there. The host gauge in `internal/connector` is `//go:build linux`, so the
# Go toolchain excludes it outright on macOS and nothing says so. And the tests
# that drive the Docker daemon run here as root, which is the only way to
# exercise what Bay does as root on a host: handing each app's files to its own
# uid. The container talks to the host's daemon (compose.yml), with
# BAY_REQUIRE_DOCKER=1 so a missing daemon fails rather than skips.
#
# Cross-compiling is not a substitute. `GOOS=linux go build` proves the code
# COMPILES for Linux; it runs no assertion, and `go build` does not even look at
# _test.go files. A Linux test binary cannot be executed here either (`exec
# format error`). Running them needs Linux, which means a container.
#
# The work itself is in ci.sh, the image in Dockerfile, the wiring in
# compose.yml. This file is only the front door: it exists so that Docker being
# down is a sentence rather than a stack trace.

set -eu

cd "$(dirname "$0")"

# Docker being down must be a loud failure, never a skip.
#
# A script that "passes" because it ran nothing is the exact problem this closes
# — it would restore the green-while-testing-nothing state, with more confidence
# attached to it than before.
if ! docker info >/dev/null 2>&1; then
  echo "test-linux: Docker is not running." >&2
  echo "  The Linux-only tests cannot run without it, and skipping them would" >&2
  echo "  report success for a suite that never executed. Start Docker and" >&2
  echo "  re-run, or push and let the CI 'check' job cover it." >&2
  exit 1
fi

echo "test-linux: reproducing the CI 'check' job in a container"

# `run --rm`, not `up`: this is a task, and its exit code is the whole result.
# Compose rebuilds the image by itself when the Dockerfile or go.mod moves, so
# there is no staleness to manage here.
exec docker compose run --rm --build bay-test
