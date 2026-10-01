# CLAUDE.md

Bay is a self-hosted application server in Go: one static binary that does
reverse proxy, deploys, systemd supervision, TLS and backups. Start with
`README.md`; installation is `INSTALL.md`; the user guide is under `docs/`.

It lived in the Alepha monorepo (`apps/bay`) until 2026-10-01 (epic #E72 of
the Alepha project), and its history came with it.

## Checks

- `go test ./...` on a Mac is **not** the suite: every file under
  `internal/runner` that renders or applies a systemd unit is
  `//go:build linux`, so a native run skips them and reports success.
- `./test-linux.sh` runs gofmt, vet, build, the tests and the cross-compile in
  a Linux container (`compose.yml`, `Dockerfile`, `ci.sh`). Docker must be
  running.
- CI (`.github/workflows/ci.yml`, job `check`) runs the same on every push. It
  is the gate.

## Planning lives in Lore

Decisions, plans and bug reports live in the Lore project **Bay**
(`https://lore.alepha.dev/bay`). Every commit names its quest as `#Q<n>`;
record the sha with `quest_commit_add`. Decisions go in folios.

## Contracts with the other repositories

Nothing here is versioned: Alepha is pre-1.0 and breaking is allowed. When one
of these changes, the other side moves with it.

- **`manifest.json` and the `.tar.zst` archive**, written by `alepha build` and
  `alepha pack` in `alepha-dev/alepha`, read by `internal/manifest` and the
  deploy path.
- **The `bay` CLI**, driven over ssh by the framework's `BayAdapter`
  (`packages/alepha/src/cli/platform-lib/adapters/BayAdapter.ts`): `bay list`,
  `bay deploy -`, `bay env`, `--secrets-file`, `--control-socket`.
- **The names Bay writes itself** (`internal/deploy/deploy.go`), mirrored as
  `bayOwnedKeys` in the framework's `secretKeys.ts`.
- **The `_headers` conformance fixture** (`internal/headers/testdata/`), which
  the framework's `HeadersFileReader.spec.ts` runs from a copy.
- **The estate wire format with Lore** (`internal/connector/testdata/wire-v1`,
  `cmd/bay/testdata/logs-result.json`), pinned by copies in
  `alepha-dev/lore`. Lore's `bay.e2e.spec.ts` builds this repo and runs it
  against a real Lore.
