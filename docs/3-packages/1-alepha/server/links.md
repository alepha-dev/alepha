# Alepha - Server Links

## Installation

Part of the `alepha` package. Import from `alepha/server/links`.

```bash
npm install alepha
```

## Overview

Provides server-side link management and remote capabilities for client-server interactions.

The server-links module enables declarative link definitions using `$remote` and `$client` primitives,
facilitating seamless API endpoint management and client-server communication. It integrates with server
security features to ensure safe and controlled access to resources.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $client()

Create a new client.

#### $remote()

$remote is a primitive that allows you to define remote service access.

Use it only when you have 2 or more services that need to communicate with each other.

All remote services can be exposed as actions, ... or not.

You can add a service account if you want to use a security layer.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### LinkProvider

Browser, SSR friendly, service to handle links.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SERVER_API_PREFIX` | text | /api | Prefix for all API routes (e.g. $action). |
