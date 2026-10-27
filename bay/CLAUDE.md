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

Bay ships in the repository's one release (#Q2776): `release.yml` at the root
tests Bay, builds the linux amd64 and arm64 binaries with the shared version
stamped in (`-X main.version`), and attaches them with `SHA256SUMS` to the
GitHub release of that bare `x.y.z` tag. Bay's version is the framework's, so
it jumped from 0.31.0 to the next shared one. `install.sh` takes the newest
release carrying a Bay binary, compared against the archived alepha-dev/bay's
latest (0.31.0), which keeps serving older versions. The install address is
`https://alepha.dev/bay/install.sh`, a redirect to `bay/install.sh` on `main`.

## Planning lives in Lore

Decisions, plans and bug reports live in the Lore project **Alepha**
(`https://lore.alepha.dev/alepha`, id `1`), area `bay`, with the framework's
and Lore's since #E94 (2026-10-27). Every commit names its quest as `#Q<n>`;
record the sha with `quest_commit_add`. Decisions go in folios. The project
`Bay` (id `75`) is archived: a number it used after 2026-10-01 was
renumbered, and folio #F1427 maps the old number to the new one.

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
