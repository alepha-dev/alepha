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

## API Reference

### Descriptors

#### $client()

Create a new client.

#### $remote()

$remote is a descriptor that allows you to define remote service access.

Use it only when you have 2 or more services that need to communicate with each other.

All remote services can be exposed as actions, ... or not.

You can add a service account if you want to use a security layer.
