# Alepha - React Websocket

## Installation

Part of the `alepha` package. Import from `alepha/react/websocket`.

```bash
npm install alepha
```

## Overview

React hooks for real-time WebSocket communication - `useRoom` connects a
component to a `$channel`, exposing typed `send` and the connection state,
hands each message to its `handler`, and no-ops during SSR.

## API Reference

### React Hooks

- [`useRoom`](/docs/reference-react-hooks-useroom) - React hook for WebSocket room communication
