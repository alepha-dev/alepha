# @alepha/capacitor - Ota Admin

## Installation

```bash
npm install @alepha/capacitor
```

## Overview

The OTA back office, in an app's existing admin (`@alepha/ui/admin`), under
its own "Live updates" group: apps and their publisher keys, channels and
what each serves per compatibility cohort (rollout, fallback, rollback,
kill switch), bundles (exact native builds, key, digests, upload of a
pre-encrypted release, kill switch), devices seen in the last seven days,
and operator device overrides.

Every page reads and writes through the typed actions of
`@alepha/capacitor/ota-api`, which enforce `ota:read`, `ota:manage` and
`ota:release` on the server; the pages only hide what the user cannot do.
Nothing here imports server code: the controller is a type.

Mount it beside the app's admin, with `ota-api` on the server:

```ts
alepha.with(AlephaCapacitorOtaAdmin);
```

Labels are `ota.admin.*` keys with English defaults; `otaAdminFr`
(and `otaAdminEn` for an app falling back to another language) are
spread into the app's dictionaries.
