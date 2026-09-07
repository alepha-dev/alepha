# $rankResource

## Import

```typescript
import { $rankResource } from "alepha/api/ranks";
```

## Overview

Teach the ranks module about one kind of scope.

```ts
class ProjectRanks {
  project = $rankResource({
    type: "project",
    scope: ({ authority }) =>
      typeof authority?.id === "number" ? String(authority.id) : undefined,
    rank: ({ membership }) => membership?.rank as string | undefined,
    builtins: [
      { key: "owner", name: "Owner", permissions: ["*"] },
      { key: "member", name: "Member", permissions: ["project:read"] },
    ],
    ownerOnly: ["project:delete", "capability:manage"],
    floor: ["project:read"],
    manage: "rank:manage",
  });
}
```

## Options

| Option            | Type            | Required | Description                                                                               |
| ----------------- | --------------- | -------- | ----------------------------------------------------------------------------------------- |
| `type`            | `string`        | Yes      | The kind of scope this declaration answers for, e.g                                       |
| `scope`           | `Object`        | Yes      | Which scope the rows in hand belong to, as a string                                       |
| `rank`            | `Object`        | Yes      | The rank key this caller holds, read off a row the application has already loaded         |
| `builtins`        | `RankBuiltin[]` | Yes      | The ranks that exist without anybody creating them                                        |
| `ownerOnly`       | `string[]`      | No       | Permissions no rank may ever be granted, whatever the writer holds                        |
| `floor`           | `string[]`      | No       | Permissions every rank holds, whether or not its definition lists them                    |
| `manage`          | `string`        | No       | The permission that authorises editing ranks in this scope                                |
| `assertCanManage` | `Object`        | No       | May this caller create, rename, re-grant or delete ranks in this scope? Throw if not      |
| `assertCanAssign` | `Object`        | No       | May this caller give somebody a rank in this scope? Throw if not.                         |
| `assign`          | `Object`        | No       | Write the assignment                                                                      |
| `countHolders`    | `Object`        | No       | How many holders a rank has, so deleting one can be refused while anybody still holds it. |
| `load`            | `Object`        | No       | Load the row carrying the assignment, for the callers that have ids and no rows           |
| `refuse`          | `Object`        | No       | Say why a permission was refused, in this application's own words                         |
