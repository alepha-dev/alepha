# Alepha @alepha/devtools

Developer tools for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Runtime inspection and debugging UI.

**Features:**
- DevTools UI at `GET /devtools`
- Application metadata at `GET /devtools/metadata`
- Last 10,000 logs at `GET /devtools/logs`
- Runtime inspection of actions, jobs, topics, buckets
- Log viewer with filtering
- React Flow visualization
- Provider and module browsing

## API Reference

### Providers

- [`DevAtomLogProvider`](https://alepha.dev/docs/reference-providers-devatomlogprovider) — In-memory ring buffer of `state:mutate` events, powering the devtools
