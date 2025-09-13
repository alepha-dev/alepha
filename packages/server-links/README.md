# Alepha Server Links

Enables type-safe communication between different services.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-links
```

## Module

Provides server-side link management and remote capabilities for client-server interactions.

The server-links module enables declarative link definitions using `$remote` and `$client` descriptors,
facilitating seamless API endpoint management and client-server communication. It integrates with server
security features to ensure safe and controlled access to resources.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerLinks } from "alepha/server/links";

const alepha = Alepha.create()
	.with(AlephaServerLinks);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $client()

Create a new client.

#### $remote()

$remote is a descriptor that allows you to define remote service access.

Use it only when you have 2 or more services that need to communicate with each other.

All remote services can be exposed as actions, ... or not.

You can add a service account if you want to use a security layer.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

#### LinkProvider

Browser, SSR friendly, service to handle links.
