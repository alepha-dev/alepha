#!/usr/bin/env sh
#
# Runs Bay's checks on Linux, from a macOS checkout.
#
# Why this exists: `go test ./...` on macOS is GREEN while running a fraction of
# the suite. `internal/runner/systemd_test.go` opens with `//go:build linux`, so
# the Go toolchain excludes the file outright — 5 of the 12 tests in that package
# run natively, the other 7 do not exist, and nothing says so. `ok
# internal/runner` is printed either way. Everything that unit tests
# `Systemd.render()` — the sandbox directives, the memory and CPU ceilings, the
# stop timeout — is in the half that stays silent.
#
# Cross-compiling is not a substitute. `GOOS=linux go build` proves the code
# COMPILES for Linux; it runs no assertion, and `go build` does not even look at
# _test.go files. A Linux test binary cannot be executed here either (`exec
# format error`). Running them needs Linux, which means a container.
#
# The work itself is in ci.sh, the image in Dockerfile, the wiring in the repo's
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
  echo "  re-run, or push and let the 'bay' CI job cover it." >&2
  exit 1
fi

echo "test-linux: reproducing the 'bay' CI job in a container"

# `run --rm`, not `up`: this is a task, and its exit code is the whole result.
# Compose rebuilds the image by itself when the Dockerfile or go.mod moves, so
# there is no staleness to manage here.
exec docker compose -f ../../compose.yml run --rm --build bay-test
