# CliFormatterProvider

## Import

```typescript
import { CliFormatterProvider } from "alepha/logger";
```

## Overview

Compact formatter for CLI output.

Renders `HH:MM:SS L message {json}` — a short clock time, a single-letter
level colored by severity, the message, and any structured data appended
dim. Deliberately drops the `<module.service>`, app name and context UUID
that `PrettyFormatterProvider` prints: in an interactive CLI session
those are noise. Use `pretty` (or `--verbose`) when you need them, `raw`
when you want the bare message for piping, and `json` for aggregation.

