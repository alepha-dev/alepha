# $permission

## Import

```typescript
import { $permission } from "alepha/security";
```

## Overview

Create a new permission.

## ⚠️ A permission's id is `group:name`, and it is a stable string

Whatever grants this permission - a role, a stored profile, a per-resource
rank - stores that string. So `group` and `name` are an external identity,
not a label: renaming either one silently re-points every grant that held
the old string, and nothing anywhere goes red.

The corollary is that an id must never be DERIVED from position. A
catalogue that numbers its permissions by their index in an array re-maps
every stored grant the moment somebody inserts one in the middle - and the
grants that move are not the ones being edited. This has a worked example:
a club whose receptionists woke up able to delete tournaments.

Say what the permission is called with `PermissionPrimitiveOptions.label`;
that is the string a reader sees, and it can be changed freely.

## Options

| Option        | Type     | Required | Description                                                            |
| ------------- | -------- | -------- | ---------------------------------------------------------------------- |
| `name`        | `string` | No       | Name of the permission                                                 |
| `group`       | `string` | No       | Group of the permission                                                |
| `description` | `string` | No       | Describe the permission.                                               |
| `label`       | `string` | No       | Translation key for this permission's human-readable name              |
| `groupLabel`  | `string` | No       | Translation key for the human-readable name of this permission's GROUP |
| `groupOrder`  | `number` | No       | Where this permission's group sits in a matrix                         |
