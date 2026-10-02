# Alepha - Cli

## Installation

Part of the `alepha` package. Import from `alepha/cli`.

```bash
npm install alepha
```

## Overview

The Alepha CLI core: `init`, `dev`, `build`, `verify`, `db`, `test`,
`lint`, `typecheck`, `gen` and `pack`. Loaded automatically when the
`alepha` binary runs; each command is documented in the CLI section of the
docs site.

## API Reference

### Providers

- [`AppEntryProvider`](/docs/reference-providers-appentryprovider) - Service for locating entry files in Alepha projects.
- [`ViteDevServerProvider`](/docs/reference-providers-vitedevserverprovider) - Vite development server with Alepha integration.
