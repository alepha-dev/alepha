# Alepha - Queue Redis

## Installation

```bash
npm install alepha
```

## Overview

Plugin for Alepha Queue that provides Redis queue capabilities.

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### RedisQueueProvider

Redis-based queue provider with full job support.

Features:
- Atomic job acquisition using Lua scripts
- Blocking wait using Redis BZPOPMIN (no polling)
- Event emission for job lifecycle
- removeOnComplete/removeOnFail support

Uses the following Redis data structures:
- HASH `{prefix}:job:{queue}:{id}` - Job data
- ZSET `{prefix}:waiting:{queue}` - Waiting jobs (score = priority)
- ZSET `{prefix}:delayed:{queue}` - Delayed jobs (score = availableAt timestamp)
- SET `{prefix}:active:{queue}` - Active jobs
- LIST `{prefix}:completed:{queue}` - Completed jobs (newest first)
- LIST `{prefix}:failed:{queue}` - Failed jobs (newest first)
- LIST `{prefix}:messages:{queue}` - Simple message queue (backward compat)
- LIST `{prefix}:notify:{queue}` - Notification list for blocking wait
