# Alepha Command

Build powerful, type-safe command-line interfaces for your application.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

This module provides a powerful way to build command-line interfaces
directly within your Alepha application, using declarative descriptors.

It allows you to define commands using the `$command` descriptor.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaCommand } from "alepha/command";

const alepha = Alepha.create()
	.with(AlephaCommand);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $command()

Declares a CLI command.

This descriptor allows you to define a command, its flags, and its handler
within your Alepha application structure.
