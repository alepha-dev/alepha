# Runs Bay's checks on Linux, from a macOS working tree.
#
# Not a build image — nothing here ships. Bay's release binary is cross-compiled
# by the release workflow. This exists for one reason: `go test` on macOS is
# green while skipping every test of `Systemd.render()`, because those files are
# `//go:build linux` and the toolchain excludes them outright.
#
# The source is NOT copied in. It arrives as a read-only bind mount at run time,
# so what gets tested is the working tree — uncommitted changes included, which
# is the whole point of running this before a push.

# Pinned here rather than passed in, because Compose interpolates its whole file
# before consulting profiles — a required build arg for this service would make
# a plain `docker compose up` fail for postgres and redis too.
#
# The duplicate with go.mod is deliberate and is not left on trust, though the
# two directions fail differently:
#
#   too OLD — caught here, at build time. The official golang images set
#   GOTOOLCHAIN=local, so `go mod download` refuses outright with
#   "go.mod requires go >= 1.26.1 (running go 1.25.12)". Nothing to add.
#
#   too NEW — silent. A newer toolchain runs an older go.mod happily, so
#   writing `1.26` here (which resolves to the latest 1.26.x) would test Bay on
#   a Go it does not ship on, and say nothing. That is the case ci.sh catches,
#   by comparing the running toolchain against the `go` directive.
ARG GO_VERSION=1.26.1
FROM golang:${GO_VERSION}

WORKDIR /src

# Dependencies in their own layer, baked into the image.
#
# The alternative was bind-mounting the host's module cache, which worked but
# had the container (running as root) writing into a directory owned by the
# user. Invisible under Docker Desktop, where file ownership is virtualised —
# and on a Linux workstation it leaves root-owned files in ~/go/pkg/mod that
# their owner then cannot delete.
#
# Docker rebuilds this layer when go.mod or go.sum changes and reuses it
# otherwise, so the version stays correct with nothing to remember.
COPY go.mod go.sum ./
RUN go mod download

# Modules are already present and the source is mounted read-only, so nothing
# may reach out to the network or rewrite go.mod mid-run. A missing dependency
# must fail here, loudly, rather than be fetched and silently recorded.
ENV GOFLAGS=-mod=readonly

# GOCACHE defaults under HOME; naming it explicitly keeps every write inside the
# container, which is what allows the source mount to be read-only.
ENV GOCACHE=/tmp/go-build

CMD ["./ci.sh"]
