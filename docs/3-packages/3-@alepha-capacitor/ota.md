# @alepha/capacitor - Ota

## Installation

```bash
npm install @alepha/capacitor
```

## Overview

Live updates of a native shell's web layer, from the app's own server
(`@alepha/capacitor/ota-api`), through the pinned
`@capgo/capacitor-updater` 8.52.1 in manual mode.

Import it in the browser entry, after `AlephaCapacitor`:

```ts
alepha.with(AlephaCapacitor);
alepha.with(AlephaCapacitorOta);
```

`OtaProvider` acknowledges every healthy boot (the offline screen
included, without waiting for the API), checks on boot and on resume,
downloads full encrypted bundles in the background and applies them on
the next background or restart, follows rollbacks to older versions and
the kill switch at the next contact, and never fetches again a bundle this
device rolled back from. Inert in a browser, in `dev` mode, and in a shell
built without the updater, with the reason in the log.

The native config is written by `alepha capacitor init --ota`:
`autoUpdate: false`, the `/ota` URLs, the publisher's `publicKey`, and
`allowManualBundleError: true` (cancelling a pending bundle needs it).

The wire schemas the server shares (`ota/protocol`) are exported here
too.

## API Reference

### Providers

- [`CapgoUpdaterAdapter`](/docs/reference-providers-capgoupdateradapter) - The pinned `@capgo/capacitor-updater` 8.52.1, on a native shell whose
- [`MemoryUpdaterAdapter`](/docs/reference-providers-memoryupdateradapter) - The pinned updater's behaviour, in memory, for specs of the real
- [`OtaContentInspector`](/docs/reference-providers-otacontentinspector) - Completes core's content inspector with the updater: a bundled shell
- [`OtaProvider`](/docs/reference-providers-otaprovider) - The device side of live updates: a manual, self-hosted policy over the
- [`UpdaterAdapter`](/docs/reference-providers-updateradapter) - The live updater's native surface, as `OtaProvider` uses it: the subset
