# Alepha - Cli Config

## Installation

Part of the `alepha` package. Import from `alepha/cli/config`.

```bash
npm install alepha
```

## Overview

`defineConfig` for `alepha.config.ts` - the typed home for `entry`,
`services`, `plugins`, `build`, `dev` and `env`. The `env` map is applied
to `process.env` when the config loads, so it can seed variables for every
CLI command.

