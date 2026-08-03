# ConsoleOutputProvider

## Import

```typescript
import { ConsoleOutputProvider } from "alepha/command";
```

## Overview

What a command *produces*, as opposed to what it *reports*.

Two different things shared one stream: `ConsoleDestinationProvider` logs
through `console.log`, so `alepha --version` came back as a timestamped,
coloured, two-line log entry — 112 bytes where a script wanted `0.24.0`.
Worse, its shape followed `LOG_FORMAT`, an environment variable the script
does not control, so a parser written against one format broke under another.

`printHelp` had already hit this and worked around it by flipping
`alepha.logger.format` to `raw` and restoring it afterwards — a global
mutation whose own comment records the bug it caused ("flipping the format
permanently made every later log lose its timestamp and level"). That
workaround also cannot fix scripting: changing the format changes how a line
*looks*, not which stream it goes to.

So output is written here, straight to stdout, never through the logger. The
logger keeps narrating; this prints results.

Colour is dropped when stdout is not a TTY, which is what makes the output
pipeable without the caller stripping escape sequences by hand. `NO_COLOR`
is honoured for the same reason.

