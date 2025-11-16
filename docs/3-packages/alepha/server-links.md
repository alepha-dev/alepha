# Alepha - Server Links

## Installation

```bash
npm install alepha
```

## Overview

Provides server-side link management and remote capabilities for client-server interactions.

The server-links module enables declarative link definitions using `$remote` and `$client` descriptors,
facilitating seamless API endpoint management and client-server communication. It integrates with server
security features to ensure safe and controlled access to resources.

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $client()

Create a new client.

#### $remote()

$remote is a descriptor that allows you to define remote service access.

Use it only when you have 2 or more services that need to communicate with each other.

All remote services can be exposed as actions, ... or not.

You can add a service account if you want to use a security layer.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### LinkProvider

Browser, SSR friendly, service to handle links.
