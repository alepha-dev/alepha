# Alepha Sms

SMS sending interface with multiple provider implementations (memory, local file).

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides SMS sending capabilities for Alepha applications with multiple provider backends.

The SMS module enables declarative SMS sending through the `$sms` descriptor, allowing you to send
text messages through different providers: memory (for testing) or local file system.
It supports automatic provider selection based on environment configuration.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaSms } from "alepha/sms";

const alepha = Alepha.create()
	.with(AlephaSms);

run(alepha);
```
