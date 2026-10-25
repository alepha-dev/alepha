# InspectorRunProvider

## Import

```typescript
import { InspectorRunProvider } from "alepha/inspector";
```

## Overview

The run registry, write side: announces this process in
`<runDir>/<runId>.json` once it is ready, and withdraws it on stop.

Under `alepha dev` the app is an Alepha instance inside the Vite process,
recreated on every reload: the entry is removed and rewritten under a new
run id within milliseconds. A tool keeps its selection across that by
matching `cwd`.
