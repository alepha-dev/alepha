# Alepha - Api Jobs

## Installation

Part of the `alepha` package. Import from `alepha/api/jobs`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.8.0 | node, bun|

Job execution monitoring.

**Features:**
- Job definitions for tracking
- Job status tracking
- Execution history
- Retry management

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $job()

Job primitive - a drop-in replacement for $scheduler with built-in execution tracking.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### JobProvider

Provider for job management and execution.
Handles job lifecycle, execution tracking, log capturing, and event emission.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `JOB_PREFIX` | text | - | Prefix for job lock keys |
