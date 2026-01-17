# Alepha - Cache Redis

## Installation

Part of the `alepha` package. Import from `alepha/cache/redis`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha Cache that provides Redis caching capabilities.

## API Reference

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REDIS_CACHE_PREFIX` | text | - | Force a prefix for all cache keys in Redis. Useful for testing or multi-tenant applications. |
