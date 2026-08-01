#!/usr/bin/env sh
#
# The checks Bay must pass, in the order the `bay` CI job runs them.
#
# A file of its own rather than a string passed to `sh -c`, so there is no
# nested quoting to work around — the previous version could not write an
# apostrophe in its own error message.
#
# Run inside the container by `test-linux.sh`, and mirrored by
# .github/workflows/ci.yml. The two must stay in step: this one exists so a
# break is found before the push, not by the push.

set -eu

# The toolchain must be the one go.mod asks for.
#
# Specifically the too-NEW direction, which is the one nothing else catches. An
# image older than go.mod already fails at build time — the official golang
# images set GOTOOLCHAIN=local, so `go mod download` refuses and names both
# versions. But a NEWER toolchain runs an older go.mod perfectly happily: pin
# `1.26` in the Dockerfile instead of `1.26.1` and you silently test Bay on
# 1.26.5, which is not what it ships on. Verified: that exact pin trips this.
want=$(awk '/^go /{print $2; exit}' go.mod)
have=$(go env GOVERSION | sed 's/^go//')
if [ "$want" != "$have" ]; then
  echo "ci: toolchain mismatch — go.mod wants $want, the image has $have." >&2
  echo "  Update ARG GO_VERSION in apps/bay/Dockerfile to $want." >&2
  exit 1
fi

# `gofmt -l` prints the files it dislikes and exits 0 either way, so the test
# has to be on its output rather than on its status.
unformatted=$(gofmt -l .)
if [ -n "$unformatted" ]; then
  echo "Not gofmt'd:" >&2
  echo "$unformatted" >&2
  exit 1
fi

go vet ./...
go build ./...
go test ./...

# Bay is developed on macOS and only ever runs on Linux, so a break specific to
# one target architecture would otherwise surface on the VPS rather than here.
for target in amd64 arm64; do
  echo "-> linux/$target"
  GOOS=linux GOARCH="$target" CGO_ENABLED=0 go build -o /dev/null ./cmd/bay
done
