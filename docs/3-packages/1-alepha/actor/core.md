# Alepha - Actor

## Installation

Part of the `alepha` package. Import from `alepha/actor`.

```bash
npm install alepha
```

## Overview

Pure synchronous JSON reducers with independent default/keyed snapshots.
Node and Bun use volatile per-container Memory unless Redis is selected.

## API Reference

### Primitives

- [`$actor`](/docs/reference-primitives-$actor) - Declare independent default and keyed actor state from an atom descriptor.

### Providers

- [`ActorCodec`](/docs/reference-providers-actorcodec) - Lossless JSON snapshots and protocol-v1 validation shared by actor providers.
- [`ActorProvider`](/docs/reference-providers-actorprovider) - Actor snapshot transport. Browser and native execution is unsupported.
- [`ActorRegistry`](/docs/reference-providers-actorregistry) - Per-container declaration allowlist, independent of the local atom store.
- [`MemoryActorProvider`](/docs/reference-providers-memoryactorprovider) - Volatile actor snapshots scoped to one container, serialized per identity.
