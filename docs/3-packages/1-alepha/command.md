# Alepha - Command

## Installation

Part of the `alepha` package. Import from `alepha/command`.

```bash
npm install alepha
```

## Overview

Declarative CLI command framework.

**Features:**
- CLI command definitions
- Interactive CLI prompts (plain readline)
- Command execution with streamed, verbose output
- Environment variable utilities
- Schema validation for CLI arguments

## API Reference

### Primitives

- [`$command`](/docs/reference-primitives-$command) — Declares a CLI command.

### Providers

- [`CliProvider`](/docs/reference-providers-cliprovider) — CLI provider for parsing and executing commands.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLI_DESCRIPTION` | text |  | Description of the CLI application. |
| `CLI_NAME` | text | cli | Name of the CLI application. |
