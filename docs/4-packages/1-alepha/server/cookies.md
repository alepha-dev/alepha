# Alepha - Server Cookies

## Installation

Part of the `alepha` package. Import from `alepha/server/cookies`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.3.0 | node, bun, workerd|

Server and browser-safe cookie handling.

**Features:**
- Cookie management on server and browser

## API Reference

### Primitives

- [`$cookie`](/docs/reference-primitives-$cookie) — Declares a type-safe, configurable HTTP cookie.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `APP_SECRET` | text | DEFAULT_APP_SECRET |  |
