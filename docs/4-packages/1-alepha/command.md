# Alepha - Command

## Installation

Part of the `alepha` package. Import from `alepha/command`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.6.0 | node, bun|

Declarative CLI command framework.

**Features:**
- CLI command definitions
- Interactive CLI prompts
- Command execution
- Formatted colored output
- Environment variable utilities
- Schema validation for CLI arguments

## API Reference

### Primitives

- [`$command`](/docs/primitives-$command) — Declares a CLI command.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### CliProvider

CLI provider for parsing and executing commands.

Handles:
- Command resolution (simple, nested, colon-notation)
- Flag and argument parsing
- Environment variable validation
- Help generation
- Pre/post command hooks

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLI_DESCRIPTION` | text |  | Description of the CLI application. |
| `CLI_NAME` | text | cli | Name of the CLI application. |
