# Alepha - Command

## Installation

Part of the `alepha` package. Import from `alepha/command`.

```bash
npm install alepha
```

## Overview

This module provides a powerful way to build command-line interfaces
directly within your Alepha application, using declarative primitives.

It allows you to define commands using the `$command` primitive.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $command()

Declares a CLI command.

This primitive allows you to define a command, its flags, and its handler
within your Alepha application structure.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLI_DESCRIPTION` | text |  | Description of the CLI application. |
| `CLI_NAME` | text | cli | Name of the CLI application. |
