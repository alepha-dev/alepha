# @alepha/ui-registry

Private package — source of the Alepha shadcn registry.

## What this is

A folder of TSX blocks (login, register, admin pages, app shell, data table) that get distributed as a [shadcn registry](https://ui.shadcn.com/docs/registry). Consumers install blocks into their own apps via:

```bash
pnpm dlx shadcn@latest add https://alepha.dev/r/auth-login.json
```

Blocks compose stock shadcn primitives (`@/components/ui/*`) and Alepha's headless React layer (`alepha/react/*`). They are copied into the consumer's repo, owned and customizable by them.

## Structure

```
registry.json                       — index, lists all items
registry/default/<name>/<name>.tsx  — block source
stub/                                — local stubs for typecheck only (mock @/components/ui/*)
```

## Build

```bash
yarn build      # runs `shadcn build --output ../../../apps/docs/public/r`
```

Outputs JSON files to `apps/docs/public/r/`, deployed at `https://alepha.dev/r/*.json`.

## Authoring rules

1. Import primitives via `@/components/ui/*` — never from `@radix-ui/*` or `@base-ui/react`.
2. Import Alepha logic via `alepha/react/*` — these are runtime dependencies and ship via npm.
3. Cross-block imports (block A using block B) use `@/registry/default/<name>/<name>`.
4. Add every npm package used to the block's `dependencies` in `registry.json`.
5. Add every primitive used to `registryDependencies`.
