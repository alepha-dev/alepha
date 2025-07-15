# Alepha Command

Build powerful, type-safe command-line interfaces for your application.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/command
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaCommand } from "alepha/command";

const alepha = Alepha.create()
  .with(AlephaCommand);

run(alepha);
```

Alepha Command Module

This module provides a powerful way to build command-line interfaces
directly within your Alepha application, using declarative descriptors.

## API Reference

### Descriptors

#### $command()

Declares a CLI command.

This descriptor allows you to define a command, its flags, and its handler
within your Alepha application structure.
