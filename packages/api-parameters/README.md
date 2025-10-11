# Alepha Api Parameters

Parameter management API endpoints for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides parameter management API endpoints for Alepha applications.

This module includes configuration parameter storage, retrieval,
and dynamic application settings management.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiParameters } from "alepha/api/parameters";

const alepha = Alepha.create()
	.with(AlephaApiParameters);

run(alepha);
```
