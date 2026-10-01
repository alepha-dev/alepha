# Bay fixtures (copy)

The estate wire format between Bay and Lore, as Bay pins it:

- `wire-v1/` is Bay's `internal/connector/testdata/wire-v1`, one frame of each
  kind, read by `estate-wire-format.spec.ts` and `e2e/bay-console.spec.ts`.
- `logs-result.json` is Bay's `cmd/bay/testdata/logs-result.json`, what a
  `logs` command uploads, read by `estate-command-result.spec.ts`.

**Bay's copies, in `github.com/alepha-dev/bay`, are the authority.** These were
copied when Bay and Lore left the Alepha monorepo (#E72). A change to the wire
format lands in both repositories, fixtures included, in step.
`apps/e2e-cli/src/bay.e2e.spec.ts` runs the real Bay against a real Lore, and
is what catches a copy that fell behind.
