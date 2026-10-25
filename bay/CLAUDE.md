# CLAUDE.md

Bay is a self-hosted application server in Go: one static binary that does
reverse proxy, deploys, Docker supervision, TLS and backups. Start with
`README.md`; installation is `INSTALL.md`; the user guide is under `docs/`.

It lived in the Alepha monorepo (`apps/bay`) until 2026-10-01 (epic #E72 of
the Alepha project), and its history came with it.

## Checks

- `go test ./...` on a Mac runs most of the suite, the tests against a real
  Docker daemon included (they skip without one; `BAY_REQUIRE_DOCKER=1`, set
  in CI and `compose.yml`, makes that a failure). The host gauge in
  `internal/connector` is `//go:build linux` and only runs in the container.
- `./test-linux.sh` runs gofmt, vet, build, the tests and the cross-compile in
  a Linux container (`compose.yml`, `Dockerfile`, `ci.sh`). Docker must be
  running.
- CI (`.github/workflows/bay-ci.yml` at the repository root, job `check`) runs the same on every push touching `bay/`. It
  is the gate.
- Two tests skip unless a tool is on PATH, and a skip prints `ok`: the ACME
  issuance test in `internal/tlsconf` needs `pebble` and `pebble-challtestsrv`
  (installed by CI and the container, same version in both), and the backup
  round trip in `internal/backup` needs a `node` with `node:sqlite`.
- The Go version lives in `go.mod` and in `ARG GO_VERSION` in the `Dockerfile`;
  `ci.sh` fails when they differ.

## Releases

`Bay Release` (`.github/workflows/bay-release.yml` at the repository root) is
run by hand (`workflow_dispatch`, with a dry-run switch): it builds the linux
amd64 and arm64 binaries, tags the commit **`bay-<version>`** and publishes a
GitHub release with `SHA256SUMS`, then redeploys alepha.dev so the Bay pages
follow the tag (#Q2767). The prefix is load-bearing: the framework tags bare
versions in the same repository. Bay's releases are never the repository's
"latest", so `install.sh` asks the GitHub API for the newest `bay-*` release
(and falls back to alepha-dev/bay's last one until a `bay-*` exists). The
install address is `https://alepha.dev/bay/install.sh`, a redirect to
`bay/install.sh` on `main`.

## Planning lives in Lore

Decisions, plans and bug reports live in the Lore project **Bay**
(`https://lore.alepha.dev/bay`). Every commit names its quest as `#Q<n>`;
record the sha with `quest_commit_add`. Decisions go in folios.

## Contracts with the other repositories

Nothing here is versioned: Alepha is pre-1.0 and breaking is allowed. When one
of these changes, the other side moves with it.

- **`manifest.json` and the `.tar.zst` archive**, written by `alepha build` and
  `alepha pack` in `../framework`, read by `internal/manifest` and the
  deploy path.
- **The `bay` CLI**, driven over ssh by the framework's `BayAdapter`
  (`../framework/packages/alepha/src/cli/infra-lib/adapters/BayAdapter.ts`): `bay list`,
  `bay deploy -`, `bay env`, `--secrets-file`, `--control-socket`.
- **The names Bay writes itself** (`internal/deploy/deploy.go`), mirrored as
  `bayOwnedKeys` in the framework's `secretKeys.ts`.
- **The `_headers` conformance fixture** (`internal/headers/testdata/`), which
  the framework's `HeadersFileReader.spec.ts` runs from a copy.
- **The estate wire format with Lore** (`internal/connector/testdata/wire-v1`,
  `cmd/bay/testdata/logs-result.json`), pinned by copies in
  `../lore`. Lore's `bay.e2e.spec.ts` builds `bay/` and runs it against a real
  Lore.
