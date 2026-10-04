# Alepha @alepha/devtools

Alepha DevTools: every app running on this machine, inspected from one place. Run it with npx @alepha/devtools.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/devtools
```

## Module

The in-app devtools UI, served by the application itself at `/__devtools`.

What it shows comes from `alepha/inspector`, whose route table this module
mounts under `/__devtools/api`.

## API Reference

### Providers

- [`DevToolsProvider`](https://alepha.dev/docs/reference-providers-devtoolsprovider) - The in-app devtools: the UI at `/__devtools`, and the inspector's routes
