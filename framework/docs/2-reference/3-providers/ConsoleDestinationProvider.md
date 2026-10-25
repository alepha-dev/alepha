# ConsoleDestinationProvider

## Import

```typescript
import { ConsoleDestinationProvider } from "alepha/logger";
```

## Overview

Writes log lines to the console: stdout by default, stderr when the
container's store says `alepha.logger.stream` is `"stderr"`.

## Why the stream is read from the store, at write time

A CLI's log lines are diagnostics, and its stdout is data: `alepha --version`,
help, a rendered result that a script pipes into `jq`. Sharing one stream
meant `cmd | jq` broke on the first warning, and a failure wrote its reason
where the data goes. So `CliProvider` moves its own container's logs to
stderr.

It cannot do that by substituting this provider. The destination is chosen
once, in `AlephaLogger`'s `register`, bound `optional: true`, and the logger
is injected right there, so a substitution from a command module arrives
after the resolution it would have to change. The store is read live
instead, the way `alepha.logger.level` and `alepha.logger.format` already
are for `--verbose`.

The store belongs to ONE container. An application container a command
boots in the same process (`alepha dev` does) keeps writing to stdout,
because an application's logs are its output wherever it runs.
