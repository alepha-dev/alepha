# Alepha - Cli Infra Lib

## Installation

Part of the `alepha` package. Import from `alepha/cli/infra-lib`.

```bash
npm install alepha
```

## Overview

Framework-agnostic platform deploy services.

Exports `InfraOrchestrator` + adapters + secret stores + the
`infraOptions` atom: everything needed to drive a deploy
programmatically. **No `$command` instances** and **no
`AppEntryProvider` / `ViteBuildProvider` dependency**, so consumers
importing this subpath don't pull in the CLI argv-parser or Vite.

Used by Alepha Rocket (and other non-CLI deploy orchestrators) to
call `orchestrator.up({ ... })` directly. For CLI usage
(`alepha deploy`), import `AlephaCliInfraPlugin` from
`alepha/cli/infra`, which adds the command layer on top.

## API Reference

### Providers

- [`GitHubSecretStore`](/docs/reference-providers-githubsecretstore) - GitHub Actions secret store backed by the `gh` CLI.
- [`InfraCacheProvider`](/docs/reference-providers-infracacheprovider) - Caches cloud provider login state to avoid slow auth checks.
- [`MemorySecretStore`](/docs/reference-providers-memorysecretstore) - In-memory implementation of SecretStoreProvider for testing.
- [`SecretStoreProvider`](/docs/reference-providers-secretstoreprovider) - Abstract provider for managing secrets in an external store.
