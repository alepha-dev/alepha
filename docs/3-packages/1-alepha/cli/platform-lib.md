# Alepha - Cli Platform Lib

## Installation

Part of the `alepha` package. Import from `alepha/cli/platform-lib`.

```bash
npm install alepha
```

## Overview

Framework-agnostic platform deploy services.

Exports `PlatformOrchestrator` + adapters + secret stores + the
`platformOptions` atom: everything needed to drive a deploy
programmatically. **No `$command` instances** and **no
`AppEntryProvider` / `ViteBuildProvider` dependency**, so consumers
importing this subpath don't pull in the CLI argv-parser or Vite.

Used by Alepha Rocket (and other non-CLI deploy orchestrators) to
call `orchestrator.up({ ... })` directly. For CLI usage
(`alepha platform up`), import `AlephaCliPlatformPlugin` from
`alepha/cli/platform`, which adds the command layer on top.

## API Reference

### Providers

- [`GitHubSecretStore`](/docs/reference-providers-githubsecretstore) - GitHub Actions secret store backed by the `gh` CLI.
- [`MemorySecretStore`](/docs/reference-providers-memorysecretstore) - In-memory implementation of SecretStoreProvider for testing.
- [`PlatformCacheProvider`](/docs/reference-providers-platformcacheprovider) - Caches cloud provider login state to avoid slow auth checks.
- [`SecretStoreProvider`](/docs/reference-providers-secretstoreprovider) - Abstract provider for managing secrets in an external store.
