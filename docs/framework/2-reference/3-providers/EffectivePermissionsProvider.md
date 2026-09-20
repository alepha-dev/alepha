# EffectivePermissionsProvider

## Import

```typescript
import { EffectivePermissionsProvider } from "alepha/security";
```

## Overview

The caller's **effective** permission set, computed once, server-side.

## Why the final answer and not the raw material

Effective access is `application permission AND <whatever else narrows it>`.
The client could be sent the pieces and asked to intersect them, and that is
precisely what must not happen: two implementations of one rule, on two
sides of a wire, is how a sidebar and an endpoint come to disagree about who
may do something - and the disagreement is invisible until somebody with an
unusual rank complains that a button does nothing.

So the client receives a flat list of short strings, its own, and its only
operation is `includes`.

## What is here and what is not

Only the application layer is: the catalogue, the role grant, the privileged
bypass and the permission scope. Everything that narrows FURTHER is the
application's, passed in as `EffectivePermissionsOptions.narrow`. A
rank, a per-project capability, a subscription tier and a feature flag are
all the same shape from here, so adding one is a new predicate rather than a
change to this class.

## It performs no I/O, deliberately

`resolve` is synchronous. Whatever a narrowing factor needs - a rank's
granted list, a row of entitlements - the caller has already read by the
time its gate ran, and passes in. An extraction that fetched would cost a
query on every path that uses it, which is the property being preserved:
a plain member costs no extra read.
