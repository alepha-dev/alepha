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

#### MemoryShellProvider

In-memory implementation of ShellProvider for testing.

Records all commands that would be executed without actually running them.
Can be configured to return specific outputs or throw errors for testing.

```typescript
// In tests, substitute the real ShellProvider with MemoryShellProvider
const alepha = Alepha.create().with({
  provide: ShellProvider,
  use: MemoryShellProvider,
});

// Configure mock behavior
const shell = alepha.inject(MemoryShellProvider);
shell.configure({
  outputs: { "echo hello": "hello\n" },
  errors: { "failing-cmd": "Command failed" },
});

// Or use the fluent API
shell.outputs.set("another-cmd", "output");
shell.errors.set("another-error", "Error message");

// Run code that uses ShellProvider
const service = alepha.inject(MyService);
await service.doSomething();

// Verify commands were called
expect(shell.calls).toHaveLength(2);
expect(shell.calls[0].command).toBe("yarn install");
```

#### NodeShellProvider

Node.js implementation of ShellProvider.

Executes shell commands using Node.js child_process module.
Supports binary resolution from node_modules/.bin for local packages.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLI_DESCRIPTION` | text |  | Description of the CLI application. |
| `CLI_NAME` | text | cli | Name of the CLI application. |
