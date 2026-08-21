# $remote

## Import

```typescript
import { $remote } from "alepha/server/links";
```

## Overview

$remote is a primitive that allows you to define remote service access.

Use it only when you have 2 or more services that need to communicate with each other.

All remote services can be exposed as actions, ... or not.

You can add a service account if you want to use a security layer.

## Options

| Option           | Type                          | Required | Description                                                                       |
| ---------------- | ----------------------------- | -------- | --------------------------------------------------------------------------------- |
| `url`            | `string \| (() =&gt; string)` | Yes      | The URL of the remote service                                                     |
| `name`           | `string`                      | No       | The name of the remote service.                                                   |
| `serviceAccount` | `ServiceAccountPrimitive`     | No       | For communication between the server and the remote service with a security layer |
