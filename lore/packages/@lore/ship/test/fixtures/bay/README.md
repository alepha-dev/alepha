# Bay fixtures (copy)

The wire format between Bay and Lore, as Bay pins it. Bay lives in this
repository (`bay/`), and its copies are the authority:

- `wire-v1/` is Bay's `internal/connector/testdata/wire-v1`, one frame of each
  kind, read by `apps/lore/test/host-wire-format.spec.ts` (the frame schemas
  are `@lore/core`'s) and `apps/e2e/web/bay-console.spec.ts`.
- `wire-v2/` is Bay's `internal/connector/testdata/stacks`: the `stack-deploy`
  and `stack-remove` frames, the registry pull and the outcome a stack deploy
  uploads, and the inventory with stacks, read by `stack-deploy.spec.ts`,
  `stack-member-deploy.spec.ts`, `stack-console.spec.ts` and
  `bay-removal.spec.ts`.
- `compose/` is Bay's `internal/stack/testdata/conformance`: compose files Bay
  accepts and refuses, with its words, read by `stack-model.spec.ts`.
- `logs-result.json` is Bay's `cmd/bay/testdata/logs-result.json`, what a
  `logs` command uploads, read by `host-command-result.spec.ts`.
- `backup-results/` is Bay's `cmd/bay/testdata/backup-results`, what the
  `backups-list`, `backup-verify`, `target-probe` and dry-run `restore`
  commands upload, read by `host-backup-results.spec.ts`.

A change to the wire format changes Bay's fixtures and these copies in the
same commit. `apps/e2e/cli/bay.e2e.spec.ts` runs the real Bay against a real
Lore, and is what catches a copy that fell behind.
