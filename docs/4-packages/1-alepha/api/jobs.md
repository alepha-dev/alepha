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
- Manual trigger tracking

## API Reference

### Primitives

- [`$job`](/docs/reference-primitives-$job) — Job primitive - a drop-in replacement for $scheduler with built-in execution tracking.

### Providers

- [`JobProvider`](/docs/reference-providers-jobprovider) — Provider for job management and execution.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `JOB_PREFIX` | text | - | Prefix for job lock keys |
