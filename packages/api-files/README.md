# Alepha Api Files

File management API endpoints for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides file management API endpoints for Alepha applications.

This module includes file upload, download, storage management,
and file metadata operations.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";

const alepha = Alepha.create()
	.with(AlephaApiFiles);

run(alepha);
```
