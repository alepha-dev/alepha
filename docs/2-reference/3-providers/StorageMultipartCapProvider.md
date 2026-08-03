# StorageMultipartCapProvider

## Import

```typescript
import { StorageMultipartCapProvider } from "alepha/api/files";
```

## Overview

Lets the targeted `$storage` decide how many bytes a request may carry.

This is what makes `$storage({ maxSize })` mean what it says. Before, the
declaration could only ever tighten an application-wide ceiling it knew
nothing about, so a bucket asking for 100 MB was silently held at 5 — a
promise the framework could not keep, and one nothing reported.

The bucket is known **before** the body is read, because it arrives in the
URL. That is the whole reason a per-destination budget is possible at all:
by the time the first byte lands, where it is going has already been decided.

