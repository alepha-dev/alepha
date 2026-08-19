# Alepha @alepha/devtools

Developer tools for Alepha applications.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/devtools
```

## Module

Runtime inspection and debugging UI.

**Features:**
- DevTools UI at `GET /__devtools`
- Application metadata at `GET /__devtools/api/metadata`
- Last 10,000 logs at `GET /__devtools/api/logs`
- Runtime inspection of actions, jobs, topics, storages
- Log viewer with filtering
- React Flow visualization
- Provider and module browsing

## API Reference

### Providers

- [`DevAtomLogProvider`](https://alepha.dev/docs/reference-providers-devatomlogprovider) - In-memory ring buffer of `state:mutate` events, powering the devtools
