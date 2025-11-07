# Alepha Api Jobs

Job management API endpoints for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides job management API endpoints for Alepha applications.

This module includes job queue operations, job status monitoring,
and background task management capabilities.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";

const alepha = Alepha.create()
	.with(AlephaApiJobs);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $job()

Job descriptor - a drop-in replacement for $scheduler with built-in execution tracking.
