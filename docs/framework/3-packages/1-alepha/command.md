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
- Command execution with captured output (streamed live at DEBUG level)
- Environment variable utilities
- Schema validation for CLI arguments

## API Reference

### Primitives

- [`$command`](/docs/reference-primitives-$command) - Declares a CLI command.

### Providers

- [`CliProvider`](/docs/reference-providers-cliprovider) - CLI provider for parsing and executing commands.
- [`ConsoleOutputProvider`](/docs/reference-providers-consoleoutputprovider) - What a command _produces_, as opposed to what it _reports_.
- [`ExclusiveProvider`](/docs/reference-providers-exclusiveprovider) - A machine-wide FIFO queue for CLI commands that must not run concurrently.
- [`MemoryOutputProvider`](/docs/reference-providers-memoryoutputprovider) - Captures command output instead of writing it to stdout.
- [`TaskCacheProvider`](/docs/reference-providers-taskcacheprovider) - Remembers that a task passed against a particular set of inputs, so an

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable          | Type | Default | Description                         |
| ----------------- | ---- | ------- | ----------------------------------- |
| `CLI_DESCRIPTION` | text |         | Description of the CLI application. |
| `CLI_NAME`        | text | cli     | Name of the CLI application.        |
