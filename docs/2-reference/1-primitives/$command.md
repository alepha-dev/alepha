# $command

## Import

```typescript
import { $command } from "alepha/command";
```

## Overview

Declares a CLI command.

This primitive allows you to define a command, its flags, and its handler
within your Alepha application structure.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `handler` | `Object` | Yes | The handler function to execute when the command is matched |
| `name` | `string` | No | The name of the command |
| `description` | `string` | No | A short description of the command, shown in the help message. |
| `aliases` | `string[]` | No | An array of alternative names for the command. |
| `flags` | `T` | No | A Zod object schema defining the flags for the command. |
| `env` | `E` | No | A Zod object schema defining required environment variables |
| `args` | `A` | No | An optional Zod schema defining the arguments for the command |
| `root` | `boolean` | No | Marks this command as the root command |
| `pre` | `string` | No | Run this command's handler BEFORE the specified target command |
| `post` | `string` | No | Run this command's handler AFTER the specified target command |
| `hide` | `boolean` | No | If true, this command will be hidden from the help output. |
| `mode` | `boolean \| string` | No | Adds a `--mode, -m` flag to load environment files |
| `children` | `CommandPrimitive&lt;any, any&gt;[]` | No | Child commands (subcommands) for this command |

