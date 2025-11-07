# Alepha Api Workflows

Workflow management API endpoints for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides workflow management API endpoints for Alepha applications.

This module includes workflow orchestration, execution monitoring,
and automation capabilities.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiWorkflows } from "alepha/api/workflows";

const alepha = Alepha.create()
	.with(AlephaApiWorkflows);

run(alepha);
```
