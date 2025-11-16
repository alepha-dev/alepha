# Alepha - Command

## Installation

```bash
npm install alepha
```

## Overview

This module provides a powerful way to build command-line interfaces
directly within your Alepha application, using declarative descriptors.

It allows you to define commands using the `$command` descriptor.

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $command()

Declares a CLI command.

This descriptor allows you to define a command, its flags, and its handler
within your Alepha application structure.
