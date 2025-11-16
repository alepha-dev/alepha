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

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $job()

Job descriptor - a drop-in replacement for $scheduler with built-in execution tracking.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### JobProvider

Provider for job management and execution.
Handles job lifecycle, execution tracking, log capturing, and event emission.
