# @alepha/ui - Command

## Installation

```bash
npm install @alepha/ui
```

## Overview

A command palette, on Base UI's `Autocomplete`.

`Command`, `CommandDialog` and their parts. Data-driven: the root takes
`items` and ranks them against the query with cmdk's fuzzy scorer, ported,
and `CommandList` / `CommandGroup` draw what is left through a function
child. Opt-in: only the shell's spotlight imports it.
