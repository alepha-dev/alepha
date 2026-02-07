# Alepha - Devtools

## Installation

Part of the `alepha` package. Import from `alepha/devtools`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| tooling | rare | experimental |

Runtime inspection and debugging UI.

**Features:**
- DevTools UI at `GET /devtools`
- Application metadata at `GET /devtools/metadata`
- Last 10,000 logs at `GET /devtools/logs`
- Runtime inspection of actions, queues, schedulers, topics, buckets
- Log viewer with filtering
- React Flow visualization
- Provider and module browsing

