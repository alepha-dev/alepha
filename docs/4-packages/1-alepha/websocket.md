# Alepha - Websocket

## Installation

Part of the `alepha` package. Import from `alepha/websocket`.

```bash
npm install alepha
```

## Overview

Real-time bidirectional communication.

**Features:**
- WebSocket server definition
- Named communication channels
- Type-safe message handling
- Connection lifecycle management
- Room/channel grouping
- Browser compatibility

## API Reference

### Primitives

- [`$channel`](/docs/reference-primitives-$channel) — Defines a WebSocket channel with specified client and server message schemas.
- [`$websocket`](/docs/reference-primitives-$websocket) — Defines a WebSocket server endpoint for a specific channel.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `WEBSOCKET_MAX_RECONNECT_ATTEMPTS` | integer | 10 | Maximum number of reconnection attempts. Set to -1 for infinite. |
| `WEBSOCKET_RECONNECT_INTERVAL` | integer | 3000 | Reconnection interval in milliseconds |
| `WEBSOCKET_URL` | text |  | WebSocket server URL (e.g., ws://localhost:3001). Leave empty to auto-detect. |
