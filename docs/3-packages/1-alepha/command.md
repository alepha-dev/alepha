# Alepha - Command

## Installation

Part of the `alepha` package. Import from `alepha/command`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| tooling | rare | stable |

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

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $command()

Declares a CLI command.

This primitive allows you to define a command, its flags, and its handler
within your Alepha application structure.

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

```typescript
// Define a command
class MyCommands {
  build = $command({
    name: "build",
    description: "Build the project",
    flags: t.object({ watch: t.optional(t.boolean()) }),
    handler: async ({ flags }) => { ... }
  });
}

// CLI automatically discovers and executes commands
const alepha = Alepha.create().with(MyCommands);
```

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLI_DESCRIPTION` | text |  | Description of the CLI application. |
| `CLI_NAME` | text | cli | Name of the CLI application. |
