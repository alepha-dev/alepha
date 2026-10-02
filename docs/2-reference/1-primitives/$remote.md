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

## `$remote` or `$client({ hostname })`?

They overlap, and picking the wrong one is the usual mistake.

`$remote` is **service-to-service**: declared as a primitive on a class, for
an app you also run. It can carry a `$serviceAccount`, and with `proxy` it
re-exposes the remote's endpoints through your own server, which is what a
backend-for-frontend needs.

`$client({ hostname })` is a **consumer** calling an app it does not host - a
CLI, a worker, a script. It declares nothing, registers nothing and serves
nothing: it resolves against the remote's own `/api/_links` registry and
carries whatever credential its scope names.

## Options

| Option           | Type                          | Required | Description                                                                       |
| ---------------- | ----------------------------- | -------- | --------------------------------------------------------------------------------- |
| `url`            | `string \| (() =&gt; string)` | Yes      | The URL of the remote service                                                     |
| `name`           | `string`                      | No       | The name of the remote service.                                                   |
| `serviceAccount` | `ServiceAccountPrimitive`     | No       | For communication between the server and the remote service with a security layer |
