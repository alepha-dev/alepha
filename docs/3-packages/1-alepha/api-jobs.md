# Alepha - Api Jobs

## Installation

```bash
npm install alepha
```

## Overview

Provides job management API endpoints for Alepha applications.

This module includes job queue operations, job status monitoring,
and background task management capabilities.

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
