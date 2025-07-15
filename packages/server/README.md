# Alepha Server

Core HTTP server for creating REST APIs.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server
```

## API Reference

### Providers

#### ServerRouterProvider

Main router for all routes on the server side.

- $route => generic route
- $action => action route (for API calls)
- $page => React route (for SSR)
