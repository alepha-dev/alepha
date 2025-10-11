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
